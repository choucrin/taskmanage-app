import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addItem } from '../firebase/firestore';
import { useAppData } from '../hooks/AppDataContext';
import type { TargetType } from '../types';

export function GoalForm() {
  const { uid, genres } = useAppData();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('count');
  const [targetValue, setTargetValue] = useState('');
  const [targetRatePercent, setTargetRatePercent] = useState('');
  const [genreId, setGenreId] = useState('');
  const [newGenreName, setNewGenreName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !name.trim() || !targetValue) return;
    setSubmitting(true);
    try {
      let resolvedGenreId = genreId || undefined;
      if (!resolvedGenreId && newGenreName.trim()) {
        resolvedGenreId = await addItem(uid, 'genres', { name: newGenreName.trim() });
      }

      await addItem(uid, 'goals', {
        name: name.trim(),
        targetType,
        targetValue: Number(targetValue),
        targetRatePercent: targetRatePercent ? Number(targetRatePercent) : undefined,
        genreId: resolvedGenreId,
        status: 'active',
        cumulativeAchieved: 0,
      });
      navigate('/tasks/new');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="goal-form-page">
      <h1>目標登録</h1>
      <form onSubmit={handleSubmit}>
        <label>
          目標名
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <fieldset>
          <legend>進捗定義(100%到達に必要な条件)</legend>
          <label>
            <input
              type="radio"
              name="targetType"
              checked={targetType === 'count'}
              onChange={() => setTargetType('count')}
            />
            達成回数
          </label>
          <label>
            <input
              type="radio"
              name="targetType"
              checked={targetType === 'time'}
              onChange={() => setTargetType('time')}
            />
            達成時間(分)
          </label>
          <input
            type="number"
            min={1}
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder={targetType === 'count' ? '例: 30(回)' : '例: 600(分)'}
            required
          />
        </fieldset>

        <label>
          全体達成率の目標値(任意、未入力なら100%)
          <input
            type="number"
            min={1}
            max={1000}
            value={targetRatePercent}
            onChange={(e) => setTargetRatePercent(e.target.value)}
            placeholder="例: 80"
          />
        </label>

        <label>
          ジャンル(任意)
          <select value={genreId} onChange={(e) => setGenreId(e.target.value)}>
            <option value="">未設定</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        {!genreId && (
          <label>
            新しいジャンルを作成(任意)
            <input
              value={newGenreName}
              onChange={(e) => setNewGenreName(e.target.value)}
              placeholder="例: 日常タスク"
            />
          </label>
        )}

        <button type="submit" disabled={submitting}>
          登録してタスク設定へ進む
        </button>
      </form>
    </div>
  );
}
