import type { Goal, ProgressLog, SelectiveGroup, Task, TaskStatus } from '../types';
import { weekdayOf } from './date';

/** 指定日にこのタスクを実施すべきかどうか(曜日指定 or 個別日付指定) */
export function isTaskScheduledOn(task: Task, dateKey: string): boolean {
  const { weekdays, dates } = task.schedule;
  if (dates?.includes(dateKey)) return true;
  if (weekdays?.includes(weekdayOf(dateKey))) return true;
  return false;
}

export function getTodayTasks(tasks: Task[], dateKey: string): Task[] {
  return tasks.filter((t) => isTaskScheduledOn(t, dateKey));
}

/** 進捗ログの達成値がタスクの達成条件に到達しているか */
export function isValueAchieved(task: Task, achievedValue: number): boolean {
  return achievedValue >= task.targetValue;
}

/**
 * 選択的グループ内のタスク群について、達成必要数に到達した場合に
 * 残りの未達成タスクを "excluded" として扱うためのステータス表を返す。
 * 戻り値: taskId -> TaskStatus
 */
export function evaluateGroupStatuses(
  group: SelectiveGroup,
  tasksInGroup: Task[],
  achievedValueByTaskId: Record<string, number>,
): Record<string, TaskStatus> {
  const result: Record<string, TaskStatus> = {};

  const achievedTaskIds = tasksInGroup
    .filter((t) => isValueAchieved(t, achievedValueByTaskId[t.id] ?? 0))
    .map((t) => t.id);

  const achievedCount = achievedTaskIds.length;
  const conditionMet = achievedCount >= group.minRequired;

  for (const task of tasksInGroup) {
    if (achievedTaskIds.includes(task.id)) {
      result[task.id] = 'achieved';
    } else if (conditionMet) {
      result[task.id] = 'excluded';
    } else {
      result[task.id] = 'not_achieved';
    }
  }
  return result;
}

/**
 * 単体タスク(選択的グループに属さない)のステータス判定。
 */
export function evaluateSingleTaskStatus(task: Task, achievedValue: number): TaskStatus {
  return isValueAchieved(task, achievedValue) ? 'achieved' : 'not_achieved';
}

/**
 * 目標全体の達成率(累積達成回数/時間ベース)。
 * cumulativeAchieved はサーバ側(または進捗登録時)で、
 * 「achieved」または「excluded」以外の実際に加算対象となったログ値の合計として更新される。
 */
export function calculateGoalPercent(goal: Goal): number {
  if (goal.targetValue <= 0) return 0;
  return (goal.cumulativeAchieved / goal.targetValue) * 100;
}

/** アーカイブすべきかどうか(targetRatePercentが設定されていればそれを基準、なければ100%) */
export function shouldArchiveGoal(goal: Goal): boolean {
  const threshold = goal.targetRatePercent && goal.targetRatePercent > 0 ? goal.targetRatePercent : 100;
  return calculateGoalPercent(goal) >= threshold;
}

/**
 * 目標に紐づく全 progressLogs から累積達成値を再計算する。
 * excluded となったログは加算しない。
 */
export function recalculateCumulativeAchieved(logs: ProgressLog[], goalId: string): number {
  return logs
    .filter((l) => l.goalId === goalId && l.status === 'achieved')
    .reduce((sum, l) => sum + l.achievedValue, 0);
}
