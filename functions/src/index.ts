import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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

async function sendToUser(fcmToken: string, title: string, body: string) {
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
    });
  } catch (err) {
    logger.error('FCM送信に失敗しました', err);
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
        if (!setting.enabled || setting.time !== nowHHmm) continue;

        if (setting.type === 'taskList') {
          await sendTaskListNotification(uid, fcmToken, dateKey, weekday);
        } else if (setting.type === 'progress') {
          await sendProgressNotification(uid, fcmToken, dateKey, weekday);
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
) {
  const tasksSnapshot = await db.collection('users').doc(uid).collection('tasks').get();
  const todayTasks = tasksSnapshot.docs
    .map((d) => d.data() as TaskDoc)
    .filter((t) => isTaskScheduledToday(t, dateKey, weekday));

  if (todayTasks.length === 0) {
    await sendToUser(fcmToken, '本日のタスク', '本日実施予定のタスクはありません。');
    return;
  }

  const body = todayTasks.map((t) => `・${t.displayName}`).join('\n');
  await sendToUser(fcmToken, `本日のタスク(${todayTasks.length}件)`, body);
}

async function sendProgressNotification(
  uid: string,
  fcmToken: string,
  dateKey: string,
  weekday: number,
) {
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

  if (notAchieved.length === 0) {
    await sendToUser(fcmToken, '進捗状況', '本日のタスクはすべて達成済みです。');
    return;
  }

  const body = `未達成: ${notAchieved.length}件\n${notAchieved.map((t) => `・${t.displayName}`).join('\n')}`;
  await sendToUser(fcmToken, '本日の進捗状況', body);
}
