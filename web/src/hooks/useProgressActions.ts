import { useCallback } from 'react';
import { updateItem, upsertProgressLog } from '../firebase/firestore';
import {
  evaluateGroupStatuses,
  evaluateSingleTaskStatus,
  recalculateCumulativeAchieved,
  shouldArchiveGoal,
} from '../utils/progress';
import { useAppData } from './AppDataContext';

interface RecordProgressResult {
  archivedGoalName?: string;
}

/**
 * 進捗登録に伴う一連の副作用(選択的グループ判定・目標の累積値再計算・自動アーカイブ)を
 * まとめて実行するフック。
 */
export function useProgressActions() {
  const { uid, tasks, progressLogs, selectiveGroups, goals } = useAppData();

  const recordProgress = useCallback(
    async (taskId: string, dateKey: string, achievedValue: number): Promise<RecordProgressResult> => {
      if (!uid) return {};
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return {};

      // 1. 対象タスクの当日ログを保存(ステータスは一旦単体判定で仮登録)
      const provisionalStatus = evaluateSingleTaskStatus(task, achievedValue);
      await upsertProgressLog(uid, taskId, dateKey, {
        goalId: task.goalId,
        achievedValue,
        status: provisionalStatus,
      });

      // 2. 選択的グループに属する場合、グループ全体のステータスを再評価
      if (task.selectiveGroupId) {
        const group = selectiveGroups.find((g) => g.id === task.selectiveGroupId);
        if (group) {
          const tasksInGroup = tasks.filter((t) => group.taskIds.includes(t.id));
          const achievedValueByTaskId: Record<string, number> = {};
          for (const t of tasksInGroup) {
            if (t.id === taskId) {
              achievedValueByTaskId[t.id] = achievedValue;
            } else {
              const existingLog = progressLogs.find(
                (l) => l.taskId === t.id && l.date === dateKey,
              );
              achievedValueByTaskId[t.id] = existingLog?.achievedValue ?? 0;
            }
          }

          const statuses = evaluateGroupStatuses(group, tasksInGroup, achievedValueByTaskId);
          await Promise.all(
            tasksInGroup.map((t) =>
              upsertProgressLog(uid, t.id, dateKey, {
                goalId: t.goalId,
                achievedValue: achievedValueByTaskId[t.id],
                status: statuses[t.id],
              }),
            ),
          );
        }
      }

      // 3. 目標の累積達成値を再計算し、必要ならアーカイブ
      const goal = goals.find((g) => g.id === task.goalId);
      if (!goal) return {};

      const updatedLogs = progressLogs
        .filter((l) => !(l.taskId === taskId && l.date === dateKey))
        .concat([
          {
            id: `${dateKey}_${taskId}`,
            date: dateKey,
            taskId,
            goalId: task.goalId,
            achievedValue,
            status: provisionalStatus,
            updatedAt: Date.now(),
          },
        ]);

      const cumulativeAchieved = recalculateCumulativeAchieved(updatedLogs, goal.id);
      const updatedGoal = { ...goal, cumulativeAchieved };
      const archive = shouldArchiveGoal(updatedGoal);

      await updateItem(uid, 'goals', goal.id, {
        cumulativeAchieved,
        ...(archive ? { status: 'archived', archivedAt: Date.now() } : {}),
      });

      return archive ? { archivedGoalName: goal.name } : {};
    },
    [uid, tasks, progressLogs, selectiveGroups, goals],
  );

  return { recordProgress };
}
