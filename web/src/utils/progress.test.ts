import { describe, expect, it } from 'vitest';
import type { Goal, ProgressLog, SelectiveGroup, Task } from '../types';
import {
  calculateGoalPercent,
  collectAffectedGroupIds,
  collectGoalProgressLogIds,
  evaluateGroupStatuses,
  isTaskScheduledOn,
  meetsArchiveThreshold,
  recalculateCumulativeAchieved,
  resolveGroupAfterTaskRemoval,
  shouldArchiveGoal,
} from './progress';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    name: 'テスト目標',
    targetType: 'count',
    targetValue: 10,
    status: 'active',
    cumulativeAchieved: 0,
    createdAt: 0,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    goalId: 'goal-1',
    displayName: 'テストタスク',
    schedule: {},
    targetType: 'count',
    targetValue: 1,
    createdAt: 0,
    ...overrides,
  };
}

describe('calculateGoalPercent / shouldArchiveGoal', () => {
  it('累積達成回数ベースで達成率を算出する', () => {
    const goal = makeGoal({ targetValue: 20, cumulativeAchieved: 5 });
    expect(calculateGoalPercent(goal)).toBe(25);
  });

  it('100%未満はアーカイブ対象にしない', () => {
    const goal = makeGoal({ targetValue: 20, cumulativeAchieved: 19 });
    expect(shouldArchiveGoal(goal)).toBe(false);
  });

  it('100%以上でアーカイブ対象になる', () => {
    const goal = makeGoal({ targetValue: 20, cumulativeAchieved: 20 });
    expect(shouldArchiveGoal(goal)).toBe(true);
  });

  it('targetRatePercentが設定されている場合はそれを基準にする', () => {
    const goal = makeGoal({ targetValue: 20, cumulativeAchieved: 16, targetRatePercent: 80 });
    expect(shouldArchiveGoal(goal)).toBe(true);
  });

  it('手動でアーカイブ解除した目標は自動アーカイブの対象外になる', () => {
    // 対象外にしないと、解除直後の進捗登録で即座に再アーカイブされ解除操作が無意味になる
    const goal = makeGoal({
      targetValue: 20,
      cumulativeAchieved: 20,
      autoArchiveDisabled: true,
    });
    expect(meetsArchiveThreshold(goal)).toBe(true);
    expect(shouldArchiveGoal(goal)).toBe(false);
  });

  it('meetsArchiveThresholdは抑止フラグに関係なく達成条件だけで判定する', () => {
    const goal = makeGoal({ targetValue: 20, cumulativeAchieved: 10, autoArchiveDisabled: true });
    expect(meetsArchiveThreshold(goal)).toBe(false);
  });
});

describe('collectGoalProgressLogIds(目標削除時の対象ログ抽出)', () => {
  const logs: ProgressLog[] = [
    { id: 'l1', date: '2026-07-01', taskId: 't1', goalId: 'goal-1', achievedValue: 1, status: 'achieved', updatedAt: 0 },
    // goalIdが欠けた古いログ。タスクID経由で拾えないと永久に残ってしまう
    { id: 'l2', date: '2026-07-02', taskId: 't1', goalId: '', achievedValue: 1, status: 'achieved', updatedAt: 0 },
    { id: 'l3', date: '2026-07-03', taskId: 't9', goalId: 'goal-2', achievedValue: 1, status: 'achieved', updatedAt: 0 },
  ];

  it('goalId一致とタスクID経由の両方を対象にする', () => {
    expect(collectGoalProgressLogIds(logs, 'goal-1', ['t1'])).toEqual(['l1', 'l2']);
  });

  it('他の目標のログは対象にしない', () => {
    expect(collectGoalProgressLogIds(logs, 'goal-1', [])).toEqual(['l1']);
  });
});

describe('collectAffectedGroupIds(整理対象グループの特定)', () => {
  const groups: SelectiveGroup[] = [
    { id: 'g1', name: 'g1', taskIds: ['t1', 't9'], minRequired: 1, createdAt: 0 },
    { id: 'g2', name: 'g2', taskIds: ['t9'], minRequired: 1, createdAt: 0 },
  ];

  it('グループ側のtaskIdsが対象タスクを含む場合に拾う', () => {
    expect(collectAffectedGroupIds([makeTask({ id: 't1' })], groups)).toEqual(['g1']);
  });

  it('タスク側のselectiveGroupIdだけが関係を示している場合も拾う', () => {
    // グループ側のtaskIdsがまだ古く t2 を含んでいなくても、タスク側の参照で対象にする
    const task = makeTask({ id: 't2', selectiveGroupId: 'g2' });
    expect(collectAffectedGroupIds([task], groups)).toEqual(['g2']);
  });

  it('両方の根拠があっても重複させない', () => {
    const task = makeTask({ id: 't1', selectiveGroupId: 'g1' });
    expect(collectAffectedGroupIds([task], groups)).toEqual(['g1']);
  });

  it('無関係なグループは対象にしない', () => {
    expect(collectAffectedGroupIds([makeTask({ id: 't5' })], groups)).toEqual([]);
  });
});

describe('resolveGroupAfterTaskRemoval(選択的グループの整理)', () => {
  function makeGroup(overrides: Partial<SelectiveGroup> = {}): SelectiveGroup {
    return { id: 'g1', name: 'グループ', taskIds: ['t1', 't2', 't3'], minRequired: 2, createdAt: 0, ...overrides };
  }

  it('対象タスクを含まないグループは変更しない', () => {
    expect(resolveGroupAfterTaskRemoval(makeGroup(), new Set(['t9']))).toEqual({ action: 'none' });
  });

  it('全タスクが消える場合はグループごと削除する', () => {
    const result = resolveGroupAfterTaskRemoval(makeGroup(), new Set(['t1', 't2', 't3']));
    expect(result).toEqual({ action: 'delete' });
  });

  it('他の目標のタスクが残る場合はグループを維持する', () => {
    const result = resolveGroupAfterTaskRemoval(makeGroup(), new Set(['t1']));
    expect(result).toEqual({ action: 'update', taskIds: ['t2', 't3'], minRequired: 2 });
  });

  it('残タスク数を下回るminRequiredは縮小する(永久に達成不能になるのを防ぐ)', () => {
    const result = resolveGroupAfterTaskRemoval(makeGroup(), new Set(['t1', 't2']));
    expect(result).toEqual({ action: 'update', taskIds: ['t3'], minRequired: 1 });
  });
});

describe('isTaskScheduledOn', () => {
  it('曜日指定に一致する日を対象にする', () => {
    const task = makeTask({ schedule: { weekdays: [2] } }); // 2026-07-28は火曜日
    expect(isTaskScheduledOn(task, '2026-07-28')).toBe(true);
    expect(isTaskScheduledOn(task, '2026-07-29')).toBe(false);
  });

  it('個別日付指定に一致する日を対象にする', () => {
    const task = makeTask({ schedule: { dates: ['2026-08-01'] } });
    expect(isTaskScheduledOn(task, '2026-08-01')).toBe(true);
    expect(isTaskScheduledOn(task, '2026-08-02')).toBe(false);
  });
});

describe('evaluateGroupStatuses(選択的達成グループ)', () => {
  const group: SelectiveGroup = {
    id: 'group-1',
    name: '3択中2つ',
    taskIds: ['t1', 't2', 't3'],
    minRequired: 2,
    createdAt: 0,
  };
  const tasks = [
    makeTask({ id: 't1', targetValue: 1 }),
    makeTask({ id: 't2', targetValue: 1 }),
    makeTask({ id: 't3', targetValue: 1 }),
  ];

  it('必要数未達の場合は全て未達成', () => {
    const statuses = evaluateGroupStatuses(group, tasks, { t1: 1, t2: 0, t3: 0 });
    expect(statuses).toEqual({ t1: 'achieved', t2: 'not_achieved', t3: 'not_achieved' });
  });

  it('必要数に到達したら残りは対象外(excluded)になる', () => {
    const statuses = evaluateGroupStatuses(group, tasks, { t1: 1, t2: 1, t3: 0 });
    expect(statuses).toEqual({ t1: 'achieved', t2: 'achieved', t3: 'excluded' });
  });
});

describe('recalculateCumulativeAchieved', () => {
  it('achievedのログのみを合算し、excludedは含めない', () => {
    const logs = [
      { id: 'a', date: '2026-07-01', taskId: 't1', goalId: 'goal-1', achievedValue: 3, status: 'achieved' as const, updatedAt: 0 },
      { id: 'b', date: '2026-07-02', taskId: 't2', goalId: 'goal-1', achievedValue: 5, status: 'excluded' as const, updatedAt: 0 },
      { id: 'c', date: '2026-07-03', taskId: 't3', goalId: 'goal-1', achievedValue: 2, status: 'achieved' as const, updatedAt: 0 },
    ];
    expect(recalculateCumulativeAchieved(logs, 'goal-1')).toBe(5);
  });
});
