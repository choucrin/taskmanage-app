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

/** 達成条件を満たしているか(targetRatePercentが設定されていればそれを基準、なければ100%) */
export function meetsArchiveThreshold(goal: Goal): boolean {
  const threshold = goal.targetRatePercent && goal.targetRatePercent > 0 ? goal.targetRatePercent : 100;
  return calculateGoalPercent(goal) >= threshold;
}

/**
 * 進捗登録に伴って自動アーカイブすべきかどうか。
 * 手動でアーカイブを解除した目標(autoArchiveDisabled)は対象外にする。
 * 除外しないと、達成条件を満たしたままの目標は解除直後の進捗登録で即座に再アーカイブされ、
 * 利用者からは「アーカイブ解除ボタンが効かない」ように見えてしまう。
 */
export function shouldArchiveGoal(goal: Goal): boolean {
  if (goal.autoArchiveDisabled) return false;
  return meetsArchiveThreshold(goal);
}

/**
 * 目標の削除時に、一緒に消すべき進捗ログのIDを列挙する。
 * goalIdだけで絞ると、goalIdが欠けた古いログが取り残されて容量を圧迫し続けるため、
 * その目標のタスクに紐づくログも対象に含める。
 */
export function collectGoalProgressLogIds(
  logs: ProgressLog[],
  goalId: string,
  taskIds: string[],
): string[] {
  const taskIdSet = new Set(taskIds);
  return logs.filter((l) => l.goalId === goalId || taskIdSet.has(l.taskId)).map((l) => l.id);
}

/**
 * これらのタスクを削除したときに影響を受ける選択的グループのIDを列挙する。
 *
 * タスク側の selectiveGroupId とグループ側の taskIds は別ドキュメントにあり、
 * 購読スナップショットではどちらか一方だけが古い状態になりうる。
 * 片方だけを根拠にするとグループの整理を取りこぼすため、どちらかが関係を示していれば対象にする。
 */
export function collectAffectedGroupIds(deletedTasks: Task[], groups: SelectiveGroup[]): string[] {
  const deletedTaskIds = new Set(deletedTasks.map((t) => t.id));
  const groupIds = new Set<string>();
  for (const task of deletedTasks) {
    if (task.selectiveGroupId) groupIds.add(task.selectiveGroupId);
  }
  for (const group of groups) {
    if (group.taskIds.some((id) => deletedTaskIds.has(id))) groupIds.add(group.id);
  }
  return [...groupIds];
}

/** タスクを取り除いた後の選択的グループがどうあるべきか */
export type GroupResolution =
  | { action: 'none' }
  | { action: 'delete' }
  | { action: 'update'; taskIds: string[]; minRequired: number };

/**
 * 指定タスクをグループから取り除いた結果を求める。
 * 全タスクが消える場合はグループごと削除、残る場合は
 * 残タスク数を下回るminRequiredを調整する(そのままだと永久に達成不能になるため)。
 */
export function resolveGroupAfterTaskRemoval(
  group: SelectiveGroup,
  deletedTaskIds: Set<string>,
): GroupResolution {
  const remainingTaskIds = group.taskIds.filter((id) => !deletedTaskIds.has(id));
  if (remainingTaskIds.length === group.taskIds.length) return { action: 'none' };
  if (remainingTaskIds.length === 0) return { action: 'delete' };
  return {
    action: 'update',
    taskIds: remainingTaskIds,
    minRequired: Math.min(group.minRequired, remainingTaskIds.length),
  };
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
