import { useAppData } from '../hooks/AppDataContext';
import { calculateGoalPercent } from '../utils/progress';

export function Archive() {
  const { goals } = useAppData();
  const archivedGoals = goals
    .filter((g) => g.status === 'archived')
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  return (
    <div className="archive-page">
      <h1>アーカイブ済み目標</h1>

      {archivedGoals.length === 0 && <p>アーカイブされた目標はまだありません。</p>}

      <ul className="goal-list">
        {archivedGoals.map((goal) => (
          <li key={goal.id} className="goal-card goal-card--archived">
            <div className="goal-card__name">{goal.name}</div>
            <div className="goal-card__percent">
              {goal.cumulativeAchieved} / {goal.targetValue} (
              {calculateGoalPercent(goal).toFixed(1)}%)
            </div>
            {goal.archivedAt && (
              <div className="goal-card__archived-at">
                達成日: {new Date(goal.archivedAt).toLocaleDateString('ja-JP')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
