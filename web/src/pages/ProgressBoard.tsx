import { useAppData } from '../hooks/AppDataContext';
import type { Goal } from '../types';
import { calculateGoalPercent } from '../utils/progress';

export function ProgressBoard() {
  const { goals, genres } = useAppData();
  const activeGoals = goals.filter((g) => g.status === 'active');

  const genreless = activeGoals.filter((g) => !g.genreId);

  return (
    <div className="progress-board-page">
      <h1>進捗管理</h1>

      {genres.map((genre) => {
        const genreGoals = activeGoals.filter((g) => g.genreId === genre.id);
        if (genreGoals.length === 0) return null;
        return (
          <section key={genre.id}>
            <h2>{genre.name}</h2>
            <GoalList goals={genreGoals} />
          </section>
        );
      })}

      {genreless.length > 0 && (
        <section>
          <h2>ジャンル未設定</h2>
          <GoalList goals={genreless} />
        </section>
      )}

      {activeGoals.length === 0 && <p>進行中の目標はありません。</p>}
    </div>
  );
}

function GoalList({ goals }: { goals: Goal[] }) {
  return (
    <ul className="goal-list">
      {goals.map((goal) => {
        const percent = Math.min(calculateGoalPercent(goal), 999);
        return (
          <li key={goal.id} className="goal-card">
            <div className="goal-card__name">{goal.name}</div>
            <div className="goal-card__bar">
              <div
                className="goal-card__bar-fill"
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            <div className="goal-card__percent">
              {goal.cumulativeAchieved} / {goal.targetValue} ({percent.toFixed(1)}%)
            </div>
          </li>
        );
      })}
    </ul>
  );
}
