import { describe, expect, it } from 'vitest';
import {
  buildBody,
  CHEER_ALL_DONE,
  CHEER_REMAINING,
  CHEER_REST_DAY,
  CHEER_TASK_LIST,
  formatTaskLine,
  joinLinesWithinBudget,
  MAX_BODY_BYTES,
  isTaskScheduledToday,
  isWithinSendWindow,
  MAX_TASK_NAME_LENGTH,
  notificationKey,
  pickCheer,
  PROGRESS_TITLE,
  selectTodayTasks,
  SEND_WINDOW_MINUTES,
  taskListTitle,
  toMinutesOfDay,
  withCheer,
  type TaskDoc,
} from './notification';

/** FCMのdataペイロード上限(全キー名と全値のUTF-8バイト数の合計) */
const FCM_DATA_LIMIT_BYTES = 4096;

/** 実際に送信する data ペイロードの総バイト数を求める */
function payloadBytes(title: string, body: string, tag: string): number {
  return Object.entries({ title, body, tag }).reduce(
    (sum, [key, value]) => sum + Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8'),
    0,
  );
}

function makeLines(count: number, nameLength: number): string[] {
  return Array.from({ length: count }, () => formatTaskLine('あ'.repeat(nameLength)));
}

describe('formatTaskLine', () => {
  it('タスク名の先頭に中黒を付ける', () => {
    expect(formatTaskLine('朝のストレッチ')).toBe('・朝のストレッチ');
  });

  it('displayNameが欠けていても例外にせず空の行にする', () => {
    // Firestore側のデータ不備1件で通知全体が落ちないこと
    expect(formatTaskLine(undefined)).toBe('・');
    expect(formatTaskLine('')).toBe('・');
  });

  it('長すぎる名前は打ち切って省略記号を付ける', () => {
    const line = formatTaskLine('あ'.repeat(MAX_TASK_NAME_LENGTH + 10));
    expect(Array.from(line)).toHaveLength(MAX_TASK_NAME_LENGTH + 2); // 中黒 + 本文 + …
    expect(line.endsWith('…')).toBe(true);
  });

  it('絵文字(サロゲートペア)を途中で分断しない', () => {
    const name = '🎉'.repeat(MAX_TASK_NAME_LENGTH + 5);
    const line = formatTaskLine(name);
    // 分断されると不正な文字(U+FFFD相当)になるため、絵文字がそのまま数えられることを確認
    expect(Array.from(line).filter((c) => c === '🎉')).toHaveLength(MAX_TASK_NAME_LENGTH);
  });
});

describe('joinLinesWithinBudget', () => {
  it('予算に収まるときは全件をそのまま連結する', () => {
    expect(joinLinesWithinBudget(['・A', '・B', '・C'], 1000)).toBe('・A\n・B\n・C');
  });

  it('予算を超えるときは入るところまで載せて残件数を添える', () => {
    const result = joinLinesWithinBudget(makeLines(100, 40), 1000);
    expect(result).toMatch(/\nほか\d+件$/);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(1000);
  });

  it('「ほかN件」の件数が実際に省略した件数と一致する', () => {
    const lines = makeLines(100, 40);
    const result = joinLinesWithinBudget(lines, 1000);
    const shown = result.split('\n').filter((l) => l.startsWith('・')).length;
    const omitted = Number(/ほか(\d+)件/.exec(result)?.[1]);
    expect(shown + omitted).toBe(lines.length);
  });

  it('空配列では空文字を返す', () => {
    expect(joinLinesWithinBudget([], 1000)).toBe('');
  });
});

describe('buildBody', () => {
  it('応援メッセージが必ず本文の末尾に付く', () => {
    const body = buildBody(makeLines(3, 10), CHEER_TASK_LIST);
    expect(CHEER_TASK_LIST.some((m) => body.endsWith(m))).toBe(true);
  });

  it('タスクが多くて打ち切られても応援メッセージは残る', () => {
    const body = buildBody(makeLines(1000, MAX_TASK_NAME_LENGTH), CHEER_TASK_LIST);
    expect(body).toContain('ほか');
    expect(CHEER_TASK_LIST.some((m) => body.endsWith(m))).toBe(true);
  });

  it('見出しは打ち切り対象にせず必ず先頭に残る', () => {
    const body = buildBody(makeLines(1000, MAX_TASK_NAME_LENGTH), CHEER_REMAINING, '未達成: 1000件');
    expect(body.startsWith('未達成: 1000件\n')).toBe(true);
  });

  it('どれだけタスクが多くてもFCMのペイロード上限を超えない', () => {
    // 上限を超えると送信そのものが失敗するため、ここが最も重要な保証。
    // タイトルとtagは実際の生成関数から作り、index.ts側で長くしても検出できるようにする。
    for (const count of [1, 50, 200, 1000, 5000]) {
      const body = buildBody(makeLines(count, MAX_TASK_NAME_LENGTH), CHEER_TASK_LIST, '未達成: 9999件');
      expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_BODY_BYTES);

      for (const title of [taskListTitle(count), taskListTitle(99999), PROGRESS_TITLE]) {
        const tag = notificationKey('taskList', '2026-07-29', '08:00');
        expect(payloadBytes(title, body, tag)).toBeLessThan(FCM_DATA_LIMIT_BYTES);
      }
    }
  });

  it('予算が枯渇しても上限を超えず、クラッシュもしない', () => {
    // 見出しが異常に長いケース。実運用では到達しないが、上限超過だけは避ける必要がある
    const header = 'あ'.repeat(MAX_BODY_BYTES);
    const body = buildBody(makeLines(10, 40), CHEER_REMAINING, header);
    expect(typeof body).toBe('string');
    expect(body.startsWith(header)).toBe(true);
  });

  it('現実的な件数では打ち切らずに全件載せる', () => {
    // 「その日のタスクを全て」載せる要件。通常の運用件数で省略が起きないこと
    const body = buildBody(makeLines(30, 12), CHEER_TASK_LIST);
    expect(body).not.toContain('ほか');
  });
});

describe('isWithinSendWindow(送信の猶予判定)', () => {
  it('設定時刻ちょうどは対象', () => {
    expect(isWithinSendWindow('08:00', '08:00')).toBe(true);
  });

  it('設定時刻から猶予分数までは対象', () => {
    expect(isWithinSendWindow('08:00', `08:0${SEND_WINDOW_MINUTES}`)).toBe(true);
  });

  it('猶予を1分でも過ぎたら対象外', () => {
    expect(isWithinSendWindow('08:00', `08:0${SEND_WINDOW_MINUTES + 1}`)).toBe(false);
  });

  it('設定時刻より前は対象外', () => {
    expect(isWithinSendWindow('08:00', '07:59')).toBe(false);
  });

  it('日をまたぐ猶予は対象外(対象日が変わってしまうため)', () => {
    expect(isWithinSendWindow('23:58', '00:01')).toBe(false);
  });

  it('時刻の書式が不正なら送信しない', () => {
    expect(isWithinSendWindow('8:00', '08:00')).toBe(false);
    expect(isWithinSendWindow('', '08:00')).toBe(false);
    expect(toMinutesOfDay('あ')).toBeNull();
  });
});

describe('selectTodayTasks(通知対象タスクの絞り込み)', () => {
  function makeTask(overrides: Partial<TaskDoc> & { id: string }): TaskDoc & { id: string } {
    return { displayName: 'タスク', goalId: 'goal-1', schedule: {}, ...overrides };
  }

  // 2026-07-28は火曜(weekday=2)
  const dateKey = '2026-07-28';
  const weekday = 2;

  it('曜日指定に一致するタスクを対象にする', () => {
    const tasks = [
      makeTask({ id: 't1', schedule: { weekdays: [2] } }),
      makeTask({ id: 't2', schedule: { weekdays: [3] } }),
    ];
    expect(selectTodayTasks(tasks, new Set(), dateKey, weekday).map((t) => t.id)).toEqual(['t1']);
  });

  it('個別日付指定に一致するタスクを対象にする', () => {
    const tasks = [makeTask({ id: 't1', schedule: { dates: [dateKey] } })];
    expect(selectTodayTasks(tasks, new Set(), dateKey, weekday)).toHaveLength(1);
  });

  it('アーカイブ済み目標のタスクは除外する', () => {
    // アプリのHome.tsxでも表示されないため、通知にだけ現れると記録できないタスクが並ぶ
    const tasks = [
      makeTask({ id: 't1', goalId: 'active-goal', schedule: { weekdays: [2] } }),
      makeTask({ id: 't2', goalId: 'archived-goal', schedule: { weekdays: [2] } }),
    ];
    const result = selectTodayTasks(tasks, new Set(['archived-goal']), dateKey, weekday);
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });

  it('目標が見つからないタスクは表示側に倒す(Home.tsxと同じ扱い)', () => {
    const tasks = [makeTask({ id: 't1', goalId: 'missing-goal', schedule: { weekdays: [2] } })];
    expect(selectTodayTasks(tasks, new Set(['archived-goal']), dateKey, weekday)).toHaveLength(1);
  });

  it('スケジュール未設定のタスクは対象にしない', () => {
    expect(selectTodayTasks([makeTask({ id: 't1' })], new Set(), dateKey, weekday)).toHaveLength(0);
    expect(isTaskScheduledToday({ displayName: 'x', goalId: 'g' }, dateKey, weekday)).toBe(false);
  });
});

describe('notificationKey', () => {
  it('種類・日付・設定時刻から一意なキーを作る', () => {
    expect(notificationKey('taskList', '2026-07-29', '08:00')).toBe('taskList_2026-07-29_08:00');
  });

  it('種類が違えば別のキーになる(タスク一覧と進捗が打ち消し合わない)', () => {
    expect(notificationKey('taskList', '2026-07-29', '08:00')).not.toBe(
      notificationKey('progress', '2026-07-29', '08:00'),
    );
  });
});

describe('withCheer / pickCheer', () => {
  it('一覧を持たない本文にも応援メッセージを添える', () => {
    const body = withCheer('本日実施予定のタスクはありません。', CHEER_REST_DAY);
    expect(body.startsWith('本日実施予定のタスクはありません。\n\n')).toBe(true);
    expect(CHEER_REST_DAY.some((m) => body.endsWith(m))).toBe(true);
  });

  it('候補が空でもundefinedを本文に混ぜない', () => {
    expect(pickCheer([])).toBe('');
  });

  it('すべての応援メッセージが候補のいずれかに一致する', () => {
    for (const pool of [CHEER_TASK_LIST, CHEER_REST_DAY, CHEER_REMAINING, CHEER_ALL_DONE]) {
      for (let i = 0; i < 50; i++) {
        expect(pool).toContain(pickCheer(pool));
      }
    }
  });
});
