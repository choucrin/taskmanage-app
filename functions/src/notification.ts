/**
 * 通知の組み立てに関する純粋な処理。
 *
 * Firestoreやfirebase-adminに依存しないものだけをここに置き、
 * index.ts(スケジュール関数の登録やFirestoreアクセスを含む)を読み込まずに
 * テストできるようにしている。
 */

export interface TaskDoc {
  displayName: string;
  schedule?: { weekdays?: number[]; dates?: string[] };
  goalId: string;
}

/**
 * 通知を送る猶予(分)。
 * 設定時刻との分単位の完全一致を条件にすると、関数の起動遅延・一時的なFirestore障害・
 * 送信失敗があった場合に「その1分」を逃してその日の通知が丸ごと失われる。
 * 少しの猶予を持たせることで、次の実行(1分後)で取り返せるようにする。
 */
export const SEND_WINDOW_MINUTES = 5;

/** "HH:mm" を0時からの経過分に変換する。書式が不正なら null */
export function toMinutesOfDay(hhmm: string): number | null {
  const matched = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!matched) return null;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

/**
 * 設定時刻が「現在時刻からSEND_WINDOW_MINUTES分前まで」の範囲にあるか。
 * 日をまたぐケース(23:58設定を翌日00:01に送る等)は対象日が変わってしまうため、
 * 意図的に猶予の対象外としている。
 */
export function isWithinSendWindow(settingTime: string, nowHHmm: string): boolean {
  const settingMinutes = toMinutesOfDay(settingTime);
  const nowMinutes = toMinutesOfDay(nowHHmm);
  if (settingMinutes === null || nowMinutes === null) return false;
  const elapsed = nowMinutes - settingMinutes;
  return elapsed >= 0 && elapsed <= SEND_WINDOW_MINUTES;
}

/** 指定日にこのタスクを実施すべきかどうか(曜日指定 or 個別日付指定) */
export function isTaskScheduledToday(task: TaskDoc, dateKey: string, weekday: number): boolean {
  const { weekdays, dates } = task.schedule ?? {};
  if (dates?.includes(dateKey)) return true;
  if (weekdays?.includes(weekday)) return true;
  return false;
}

/**
 * 対象日に実施予定のタスクを絞り込む。
 *
 * アーカイブ済みの目標に紐づくタスクは、アプリの「本日のタスク」画面(Home.tsx)でも
 * 表示対象外になっている。通知にだけ現れると、アプリを開いても達成を記録できない
 * タスクが並ぶことになるため、ここでも同じ条件で除外して表示内容を揃える。
 * 目標が見つからないタスク(goalId欠損・ダングリング)は表示側に倒す。Home.tsxも同じ扱い。
 */
export function selectTodayTasks<T extends TaskDoc>(
  tasks: T[],
  archivedGoalIds: ReadonlySet<string>,
  dateKey: string,
  weekday: number,
): T[] {
  return tasks
    .filter((t) => isTaskScheduledToday(t, dateKey, weekday))
    .filter((t) => !archivedGoalIds.has(t.goalId));
}

/** 通知の識別キー。tagと送信済み記録のドキュメントIDに共通で使う */
export function notificationKey(type: string, dateKey: string, timeHHmm: string): string {
  return `${type}_${dateKey}_${timeHHmm}`;
}

/** タスク一覧通知のタイトル */
export function taskListTitle(taskCount: number): string {
  return `本日のタスク(${taskCount}件)`;
}

/** タスクが0件の日のタイトル */
export const TASK_LIST_EMPTY_TITLE = '本日のタスク';

/** 進捗通知のタイトル */
export const PROGRESS_TITLE = '本日の進捗状況';

/**
 * 本文に使えるバイト数の上限。
 *
 * FCMのdataペイロードは「全キー名と全値のUTF-8バイト数の合計」で4096バイトが上限。
 * 実測したオーバーヘッドは、キー名3つ(title/body/tag = 12バイト) +
 * 最長クラスのタイトル `本日のタスク(99999件)` (28バイト) +
 * tag `taskList_2026-07-29_08:00` (25バイト) = 65バイト。
 * 3700 + 65 = 3765 で、上限まで330バイト以上の余裕がある。
 * 件数では制限せず、この枠に収まる限りすべてのタスクを載せる。
 */
export const MAX_BODY_BYTES = 3700;

/** 1件あたりのタスク名の最大表示文字数(1件が長すぎて他のタスクを押し出すのを防ぐ) */
export const MAX_TASK_NAME_LENGTH = 40;

/** タスク名を1行分の表示文字列にする */
export function formatTaskLine(name: string | undefined): string {
  // Firestore側のデータ不備でdisplayNameが欠けていても通知全体を落とさない
  const safeName = typeof name === 'string' ? name : '';
  // 絵文字などのサロゲートペアを途中で分断しないよう、コードポイント単位で数える
  const chars = Array.from(safeName);
  const trimmed =
    chars.length > MAX_TASK_NAME_LENGTH
      ? `${chars.slice(0, MAX_TASK_NAME_LENGTH).join('')}…`
      : safeName;
  return `・${trimmed}`;
}

/**
 * 行を連結する。全部が予算に収まればそのまま、収まらない場合だけ入るところまで載せて
 * 残件数を添える。通常のタスク数であれば打ち切りは発生しない。
 */
export function joinLinesWithinBudget(lines: string[], budgetBytes: number): string {
  const full = lines.join('\n');
  if (Buffer.byteLength(full, 'utf8') <= budgetBytes) return full;

  const kept: string[] = [];
  let usedBytes = 0;
  for (const line of lines) {
    // 打ち切る場合に添える「ほかN件」の分も先に確保しておく。
    // ここで break すると残件数は予約時と同じ値になるため、見積もりは過不足なく一致する。
    const suffixBytes = Buffer.byteLength(`\nほか${lines.length - kept.length}件`, 'utf8');
    const lineBytes = Buffer.byteLength(kept.length === 0 ? line : `\n${line}`, 'utf8');
    if (usedBytes + lineBytes + suffixBytes > budgetBytes) break;
    kept.push(line);
    usedBytes += lineBytes;
  }

  const rest = lines.length - kept.length;
  if (rest === 0) return kept.join('\n');

  // 予算が極端に小さいと「ほかN件」だけでも超過しうる(1行目すら入らずkeptが空の場合)。
  // 上限超過は送信そのものの失敗につながるため、収まらないときは本文なしに倒す。
  // formatTaskLineが1件あたり40文字に抑えているため、実運用では到達しない経路。
  const withSuffix = [...kept, `ほか${rest}件`].join('\n');
  return Buffer.byteLength(withSuffix, 'utf8') <= budgetBytes ? withSuffix : '';
}

/** 本日のタスクがある日の応援メッセージ */
export const CHEER_TASK_LIST = [
  '今日も一緒にがんばろうね。応援してるよ♡',
  '無理しない範囲で、できるところから行こう♡',
  '小さな一歩でも前進だよ。ファイト♡',
  'いい一日になりますように。見守ってるね♡',
  '今日のあなたなら大丈夫。いってらっしゃい♡',
];

/** 予定がない日の応援メッセージ */
export const CHEER_REST_DAY = [
  '今日はお休みの日だね。ゆっくり休んでね♡',
  '予定がない日も大事。しっかり充電しよう♡',
  'たまにはのんびりも必要だよ。おつかれさま♡',
];

/** 未完了のタスクが残っているときの応援メッセージ */
export const CHEER_REMAINING = [
  'まだ時間はあるよ。ひとつずつ行こう♡',
  'ここまでよくがんばったね。あと少し♡',
  '完璧じゃなくて大丈夫。できる分だけやろう♡',
  '残りも一緒にがんばろう。応援してるよ♡',
];

/** すべて達成したときの応援メッセージ */
export const CHEER_ALL_DONE = [
  'ぜんぶ達成、すごい!今日のあなたは最高だよ♡',
  'ぜんぶ終わったね。本当におつかれさま♡',
  'パーフェクト!ゆっくり休んでね♡',
];

/** 応援メッセージからランダムに1つ選ぶ。空の場合は空文字を返す(本文にundefinedを混ぜない) */
export function pickCheer(messages: string[]): string {
  if (messages.length === 0) return '';
  return messages[Math.floor(Math.random() * messages.length)];
}

/** 本文末尾に付ける応援メッセージのブロック(前に空行を挟む) */
function cheerBlock(cheerMessages: string[]): string {
  return `\n\n${pickCheer(cheerMessages)}`;
}

/** 一覧を持たない本文に応援メッセージを添える */
export function withCheer(text: string, cheerMessages: string[]): string {
  return `${text}${cheerBlock(cheerMessages)}`;
}

/**
 * 見出し(任意)・タスク一覧・応援メッセージを組み立てる。
 * 見出しと応援メッセージが打ち切りで消えないよう、先に両方の分を予算から差し引く。
 */
export function buildBody(
  lines: string[],
  cheerMessages: string[],
  header?: string,
): string {
  const block = cheerBlock(cheerMessages);
  const headerBlock = header ? `${header}\n` : '';
  // 見出しと応援文だけで枠を使い切っても、一覧側の予算が負にならないようにする
  const budget = Math.max(
    0,
    MAX_BODY_BYTES - Buffer.byteLength(block, 'utf8') - Buffer.byteLength(headerBlock, 'utf8'),
  );
  return `${headerBlock}${joinLinesWithinBudget(lines, budget)}${block}`;
}
