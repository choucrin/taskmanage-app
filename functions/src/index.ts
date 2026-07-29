import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

/**
 * 個人利用専用アプリのため、このUID以外は通知送信の対象にしない。
 * Firestore Rules側でも同じ値を許可条件にしており、ここは念のための二重防御。
 */
const ALLOWED_UID = 'OBBBWdPsQqdzrJqDDLcHZ2EpAps2';

/** Asia/Tokyo基準の現在時刻を HH:mm 形式で返す */
function currentTimeHHmm(): string {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/**
 * 通知を送る猶予(分)。
 * 設定時刻との分単位の完全一致を条件にすると、関数の起動遅延・一時的なFirestore障害・
 * 送信失敗があった場合に「その1分」を逃してその日の通知が丸ごと失われる。
 * 少しの猶予を持たせることで、次の実行(1分後)で取り返せるようにする。
 */
const SEND_WINDOW_MINUTES = 5;

/** "HH:mm" を0時からの経過分に変換する。書式が不正なら null */
function toMinutesOfDay(hhmm: string): number | null {
  const matched = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

/**
 * 設定時刻が「現在時刻からSEND_WINDOW_MINUTES分前まで」の範囲にあるか。
 * 日をまたぐケース(23:58設定を翌日00:01に送る等)は対象日が変わってしまうため、
 * 意図的に猶予の対象外としている。
 */
function isWithinSendWindow(settingTime: string, nowHHmm: string): boolean {
  const settingMinutes = toMinutesOfDay(settingTime);
  const nowMinutes = toMinutesOfDay(nowHHmm);
  if (settingMinutes === null || nowMinutes === null) return false;
  const elapsed = nowMinutes - settingMinutes;
  return elapsed >= 0 && elapsed <= SEND_WINDOW_MINUTES;
}

/** Asia/Tokyo基準の当日の YYYY-MM-DD */
function todayDateKey(): string {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** Asia/Tokyo基準の当日の曜日(0=日曜〜6=土曜) */
function todayWeekday(): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  });
  const label = formatter.format(new Date());
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

interface TaskDoc {
  displayName: string;
  schedule?: { weekdays?: number[]; dates?: string[] };
  goalId: string;
}

interface ProgressLogDoc {
  taskId: string;
  date: string;
  status: 'not_achieved' | 'achieved' | 'excluded';
}

function isTaskScheduledToday(task: TaskDoc, dateKey: string, weekday: number): boolean {
  const { weekdays, dates } = task.schedule ?? {};
  if (dates?.includes(dateKey)) return true;
  if (weekdays?.includes(weekday)) return true;
  return false;
}

/**
 * FCMで通知を送る。
 *
 * ペイロードに `notification` を含めると、バックグラウンド時にブラウザ側が自動で1通表示し、
 * さらに firebase-messaging-sw.js の onBackgroundMessage が showNotification() で
 * もう1通表示するため、同一内容の通知が2件届いてしまう。
 * これを避けるため data のみを送り、表示はService Worker側に一本化する。
 *
 * tag は「同じ種類・同じ日・同じ設定時刻の通知」を識別するキー。同じtagの通知は積み上がらず
 * 置き換えられるため、万一二重送信された場合でも利用者の画面には1件しか残らない。
 */
async function sendToUser(
  fcmToken: string,
  title: string,
  body: string,
  tag: string,
): Promise<boolean> {
  try {
    await messaging.send({
      token: fcmToken,
      data: { title, body, tag },
      // data限定メッセージは省電力状態の端末で配信が遅延することがあるため、
      // 利用者に見せる通知として高優先度を明示する。
      webpush: { headers: { Urgency: 'high' } },
    });
    return true;
  } catch (err) {
    logger.error('FCM送信に失敗しました', err);
    return false;
  }
}

/** FCMのペイロード上限(4KB)に収めるため、本文に載せるタスクはこの件数までとする */
const MAX_TASKS_IN_BODY = 20;
/** 1件あたりのタスク名の最大表示文字数(日本語1文字=3バイトのため上限に効きやすい) */
const MAX_TASK_NAME_LENGTH = 40;

/**
 * タスク名の一覧を通知本文用の文字列に整形する。
 * 件数・文字数を打ち切ることで、タスクが増えてもFCMのペイロード上限を超えないようにする。
 */
function formatTaskLines(displayNames: (string | undefined)[]): string {
  const lines = displayNames.slice(0, MAX_TASKS_IN_BODY).map((name) => {
    // Firestore側のデータ不備でdisplayNameが欠けていても通知全体を落とさない
    const safeName = typeof name === 'string' ? name : '';
    // 絵文字などのサロゲートペアを途中で分断しないよう、コードポイント単位で数える
    const chars = Array.from(safeName);
    const trimmed =
      chars.length > MAX_TASK_NAME_LENGTH
        ? `${chars.slice(0, MAX_TASK_NAME_LENGTH).join('')}…`
        : safeName;
    return `・${trimmed}`;
  });
  const rest = displayNames.length - lines.length;
  if (rest > 0) lines.push(`ほか${rest}件`);
  return lines.join('\n');
}

/**
 * 「このユーザーの・この種類の・この日時の通知」を送信済みとして記録する。
 * 記録できた場合のみ true を返し、既に記録済みなら false を返す。
 *
 * 猶予(SEND_WINDOW_MINUTES)の間は毎分この関数が同じ設定を処理しうるが、
 * 記録済みなら2回目以降は送信をスキップできる。DocumentReference.create() は
 * 既存ドキュメントがあると失敗する(ALREADY_EXISTS)ため、トランザクションなしで原子的に判定できる。
 */
async function markAsSentIfFirst(
  uid: string,
  type: string,
  dateKey: string,
  timeHHmm: string,
): Promise<boolean> {
  const docId = `${type}_${dateKey}_${timeHHmm}`;
  try {
    await db
      .collection('users')
      .doc(uid)
      .collection('notificationLogs')
      .doc(docId)
      .create({ type, date: dateKey, time: timeHHmm, sentAt: FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    // ALREADY_EXISTS(gRPCコード6)は「既にこの時刻の通知を送った」ことを意味するので送信を止める。
    // 一方、権限エラーや通信障害でここに来た場合に送信まで止めてしまうと、
    // 障害が猶予(SEND_WINDOW_MINUTES)の間続いただけでその日の通知が丸ごと失われる。
    // そのため二重送信のリスクを取ってでも送信を続行する(fail-open)。
    // 仮に二重送信されても通知のtagが同一なので、利用者の画面には1件しか残らない。
    if ((err as { code?: number }).code === 6) return false;
    logger.error('送信済み記録の書き込みに失敗しましたが、送信は継続します', err);
    return true;
  }
}

/**
 * 送信済みの記録を取り消す。通知を送れなかった場合に呼び、
 * リトライ実行で再送できる状態に戻す。
 */
async function clearSentMark(uid: string, type: string, dateKey: string, timeHHmm: string) {
  try {
    await db
      .collection('users')
      .doc(uid)
      .collection('notificationLogs')
      .doc(`${type}_${dateKey}_${timeHHmm}`)
      .delete();
  } catch (err) {
    logger.error('送信済み記録の取り消しに失敗しました', err);
  }
}

/**
 * 1分ごとに実行し、各ユーザーの通知設定時刻(分単位)と現在時刻が一致した場合のみ送信する。
 * アプリ内で時刻を変更してもFunctions側の再デプロイは不要。
 * 呼び出し回数は1日1440回(月内約43,200回)で、Cloud Functions無料枠(月200万回)に対し十分小さい。
 */
export const checkAndSendNotifications = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Asia/Tokyo' },
  async () => {
    const nowHHmm = currentTimeHHmm();
    const dateKey = todayDateKey();
    const weekday = todayWeekday();

    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      if (uid !== ALLOWED_UID) continue;
      const fcmToken = userDoc.data().fcmToken as string | undefined;
      if (!fcmToken) continue;

      const settingsSnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('notificationSettings')
        .get();

      for (const settingDoc of settingsSnapshot.docs) {
        const setting = settingDoc.data() as { type: string; enabled: boolean; time: string };
        if (!setting.enabled || !isWithinSendWindow(setting.time, nowHHmm)) continue;
        if (setting.type !== 'taskList' && setting.type !== 'progress') continue;

        // 記録・tagのキーには実行時刻(nowHHmm)ではなく設定時刻(setting.time)を使う。
        // 猶予内に複数回実行されても同じキーになるため、重複送信を確実に弾ける。
        const isFirstSend = await markAsSentIfFirst(uid, setting.type, dateKey, setting.time);
        if (!isFirstSend) {
          logger.info('この設定時刻の通知は送信済みのためスキップしました', {
            uid,
            type: setting.type,
            date: dateKey,
            time: setting.time,
          });
          continue;
        }

        // 通知本文の組み立て(Firestore読み取り)で例外が出ても、他の設定や他ユーザーの
        // 処理まで巻き添えで止まらないようここで受け止める。
        let sent = false;
        try {
          sent =
            setting.type === 'taskList'
              ? await sendTaskListNotification(uid, fcmToken, dateKey, weekday, setting.time)
              : await sendProgressNotification(uid, fcmToken, dateKey, weekday, setting.time);
        } catch (err) {
          logger.error('通知の組み立て中にエラーが発生しました', err);
        }

        // 送信できなかった場合は記録を取り消す。猶予(SEND_WINDOW_MINUTES)内であれば
        // 次回以降の実行で再送されるため、「送っていないのに送信済み扱い」で通知が失われない。
        if (!sent) {
          await clearSentMark(uid, setting.type, dateKey, setting.time);
        }
      }
    }
  },
);

async function sendTaskListNotification(
  uid: string,
  fcmToken: string,
  dateKey: string,
  weekday: number,
  timeHHmm: string,
): Promise<boolean> {
  const tasksSnapshot = await db.collection('users').doc(uid).collection('tasks').get();
  const todayTasks = tasksSnapshot.docs
    .map((d) => d.data() as TaskDoc)
    .filter((t) => isTaskScheduledToday(t, dateKey, weekday));

  // 時刻までtagに含めることで、同じ日に通知時刻を変更した場合は
  // 前の通知を消さずに新しい通知として表示される。
  const tag = `taskList_${dateKey}_${timeHHmm}`;

  if (todayTasks.length === 0) {
    return sendToUser(fcmToken, '本日のタスク', '本日実施予定のタスクはありません。', tag);
  }

  const body = formatTaskLines(todayTasks.map((t) => t.displayName));
  return sendToUser(fcmToken, `本日のタスク(${todayTasks.length}件)`, body, tag);
}

async function sendProgressNotification(
  uid: string,
  fcmToken: string,
  dateKey: string,
  weekday: number,
  timeHHmm: string,
): Promise<boolean> {
  const [tasksSnapshot, logsSnapshot] = await Promise.all([
    db.collection('users').doc(uid).collection('tasks').get(),
    db
      .collection('users')
      .doc(uid)
      .collection('progressLogs')
      .where('date', '==', dateKey)
      .get(),
  ]);

  const todayTasks = tasksSnapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as TaskDoc) }))
    .filter((t) => isTaskScheduledToday(t, dateKey, weekday));

  const logsByTaskId = new Map<string, ProgressLogDoc>();
  for (const doc of logsSnapshot.docs) {
    const log = doc.data() as ProgressLogDoc;
    logsByTaskId.set(log.taskId, log);
  }

  const notAchieved = todayTasks.filter((t) => {
    const status = logsByTaskId.get(t.id)?.status ?? 'not_achieved';
    return status === 'not_achieved';
  });

  const tag = `progress_${dateKey}_${timeHHmm}`;

  if (notAchieved.length === 0) {
    return sendToUser(fcmToken, '進捗状況', '本日のタスクはすべて達成済みです。', tag);
  }

  const body = `未達成: ${notAchieved.length}件\n${formatTaskLines(notAchieved.map((t) => t.displayName))}`;
  return sendToUser(fcmToken, '本日の進捗状況', body, tag);
}
