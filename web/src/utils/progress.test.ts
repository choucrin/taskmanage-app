import { describe, expect, it } from 'vitest';
import type { Goal, SelectiveGroup, Task } from '../types';
import {
  calculateGoalPercent,
  evaluateGroupStatuses,
  isTaskScheduledOn,
  recalculateCumulativeAchieved,
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
