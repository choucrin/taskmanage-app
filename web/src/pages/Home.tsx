import { useMemo, useState } from 'react';
import { TaskCard } from '../components/TaskCard';
import { Toast } from '../components/Toast';
import { useAppData } from '../hooks/AppDataContext';
import { useProgressActions } from '../hooks/useProgressActions';
import { todayKey } from '../utils/date';
import { getTodayTasks } from '../utils/progress';

export function Home() {
  const { tasks, progressLogs, goals } = useAppData();
  const { recordProgress } = useProgressActions();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dateKey = todayKey();

  const todayTasks = useMemo(() => getTodayTasks(tasks, dateKey), [tasks, dateKey]);

  const activeTodayTasks = useMemo(
    () =>
      todayTasks.filter((t) => {
        const goal = goals.find((g) => g.id === t.goalId);
        return goal?.status !== 'archived';
      }),
    [todayTasks, goals],
  );

  async function handleRecord(taskId: string, value: number) {
    setErrorMessage(null);
    try {
      const result = await recordProgress(taskId, dateKey, value);
      if (result.archivedGoalName) {
        setToastMessage(`「${result.archivedGoalName}」を達成しました!目標をアーカイブしました。`);
      }
    } catch (e) {
      console.error('進捗の登録に失敗しました:', e);
      setErrorMessage('進捗の登録に失敗しました。もう一度お試しください。');
    }
  }

  return (
    <div className="home-page">
      <h1>本日のタスク({dateKey})</h1>

      {errorMessage && <p className="error">{errorMessage}</p>}
      {activeTodayTasks.length === 0 && <p>本日実施予定のタスクはありません。</p>}

      <ul className="task-list">
        {activeTodayTasks.map((task) => {
          const log = progressLogs.find((l) => l.taskId === task.id && l.date === dateKey);
          return (
            <li key={task.id}>
              <TaskCard task={task} log={log} onRecord={(value) => handleRecord(task.id, value)} />
            </li>
          );
        })}
      </ul>

      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
    </div>
  );
}
