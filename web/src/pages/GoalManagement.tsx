import { useState } from 'react';
import {
  addItem,
  deleteGoalAndCleanup,
  setGoalArchived,
  updateGoalDetails,
} from '../firebase/firestore';
import { useAppData } from '../hooks/AppDataContext';
import type { Genre, Goal, TargetType } from '../types';
import {
  calculateGoalPercent,
  collectAffectedGroupIds,
  collectGoalProgressLogIds,
  meetsArchiveThreshold,
} from '../utils/progress';

function unitLabel(targetType: TargetType): string {
  return targetType === 'time' ? '分' : '回';
}

export function GoalManagement() {
  const { uid, genres, goals, tasks, progressLogs, selectiveGroups } = useAppData();
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  // 単一のIDで管理すると、目標Aの削除中に目標Bを操作した際に、先に終わった方の後始末が
  // 両方の操作中フラグを解除してしまうため、集合で持つ。
  const [busyGoalIds, setBusyGoalIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function setBusy(goalId: string, busy: boolean) {
    setBusyGoalIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(goalId);
      else next.delete(goalId);
      return next;
    });
  }

  async function handleDelete(goal: Goal) {
    if (!uid) return;
    const goalTasks = tasks.filter((t) => t.goalId === goal.id);
    const goalTaskIds = goalTasks.map((t) => t.id);
    const goalLogIds = collectGoalProgressLogIds(progressLogs, goal.id, goalTaskIds);
    const affectedGroupIds = collectAffectedGroupIds(goalTasks, selectiveGroups);

    // 何がまとめて消えるのかを明示しないと、タスクや進捗記録まで失われることに
    // 気づかないまま削除してしまうため、件数を出して確認する。
    const confirmed = window.confirm(
      `「${goal.name}」を削除しますか?\n\n` +
        `紐づくタスク${goalTaskIds.length}件と進捗記録${goalLogIds.length}件もすべて削除されます。\n` +
        'この操作は取り消せません。',
    );
    if (!confirmed) return;

    setBusy(goal.id, true);
    setError(null);
    try {
      await deleteGoalAndCleanup(uid, goal.id, goalTaskIds, goalLogIds, affectedGroupIds);
    } catch (e) {
      console.error('目標の削除に失敗しました:', e);
      setError('目標の削除に失敗しました。もう一度お試しください。');
    } finally {
      setBusy(goal.id, false);
    }
  }

  async function handleToggleArchive(goal: Goal) {
    if (!uid) return;
    const archived = goal.status === 'archived';
    setBusy(goal.id, true);
    setError(null);
    try {
      await setGoalArchived(uid, goal.id, !archived);
    } catch (e) {
      console.error('目標の状態変更に失敗しました:', e);
      setError('目標の状態変更に失敗しました。もう一度お試しください。');
    } finally {
      setBusy(goal.id, false);
    }
  }

  // 管理画面ではどの目標も操作できる必要があるため、statusが欠けたドキュメントも
  // 「実行中」側に出す(=== 'active' で絞ると一覧から消えて編集も削除もできなくなる)。
  const activeGoals = goals.filter((g) => g.status !== 'archived');
  const archivedGoals = goals.filter((g) => g.status === 'archived');

  function renderGoal(goal: Goal) {
    return (
      <li key={goal.id}>
        {editingGoalId === goal.id && uid ? (
          <GoalEditForm
            uid={uid}
            goal={goal}
            genres={genres}
            onCancel={() => setEditingGoalId(null)}
            onSaved={() => setEditingGoalId(null)}
          />
        ) : (
          <GoalRow
            goal={goal}
            genres={genres}
            taskCount={tasks.filter((t) => t.goalId === goal.id).length}
            busy={busyGoalIds.has(goal.id)}
            onEdit={() => setEditingGoalId(goal.id)}
            onToggleArchive={() => handleToggleArchive(goal)}
            onDelete={() => handleDelete(goal)}
          />
        )}
      </li>
    );
  }

  return (
    <div className="goal-management-page">
      <h1>目標管理</h1>
      {error && <p className="error">{error}</p>}

      <section>
        <h2>実行中の目標</h2>
        {activeGoals.length === 0 ? (
          <p>実行中の目標はありません。</p>
        ) : (
          <ul className="goal-management-list">{activeGoals.map(renderGoal)}</ul>
        )}
      </section>

      <section>
        <h2>アーカイブ済みの目標</h2>
        {archivedGoals.length === 0 ? (
          <p>アーカイブされた目標はありません。</p>
        ) : (
          <ul className="goal-management-list">{archivedGoals.map(renderGoal)}</ul>
        )}
      </section>
    </div>
  );
}

function GoalRow({
  goal,
  genres,
  taskCount,
  busy,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  goal: Goal;
  genres: Genre[];
  taskCount: number;
  busy: boolean;
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const genre = genres.find((g) => g.id === goal.genreId);
  const archived = goal.status === 'archived';
  const unit = unitLabel(goal.targetType);

  return (
    <div className="goal-management-row">
      <div className="goal-management-row__main">
        <span className="goal-management-row__name">{goal.name}</span>
        <span className="goal-management-row__detail">
          {goal.cumulativeAchieved} / {goal.targetValue}
          {unit} ({calculateGoalPercent(goal).toFixed(1)}%)
          {goal.targetRatePercent ? ` ・ 達成率目標:${goal.targetRatePercent}%` : ''}
        </span>
        <span className="goal-management-row__detail">
          ジャンル:{genre ? genre.name : '未設定'} ・ タスク{taskCount}件
          {archived && goal.archivedAt
            ? ` ・ 達成日:${new Date(goal.archivedAt).toLocaleDateString('ja-JP')}`
            : ''}
        </span>
      </div>
      <div className="goal-management-row__actions">
        <button type="button" onClick={onEdit} disabled={busy}>
          編集
        </button>
        <button type="button" onClick={onToggleArchive} disabled={busy}>
          {archived ? 'アーカイブ解除' : 'アーカイブ'}
        </button>
        <button type="button" onClick={onDelete} disabled={busy}>
          削除
        </button>
      </div>
    </div>
  );
}

function GoalEditForm({
  uid,
  goal,
  genres,
  onCancel,
  onSaved,
}: {
  uid: string;
  goal: Goal;
  genres: Genre[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(goal.name);
  const [targetType, setTargetType] = useState<TargetType>(goal.targetType);
  const [targetValue, setTargetValue] = useState(String(goal.targetValue));
  const [targetRatePercent, setTargetRatePercent] = useState(
    goal.targetRatePercent ? String(goal.targetRatePercent) : '',
  );
  const [genreId, setGenreId] = useState(goal.genreId ?? '');
  const [newGenreName, setNewGenreName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 保存が途中で失敗し再送信された場合、同名ジャンルを重複作成しないためのキャッシュ。
  const [createdGenreId, setCreatedGenreId] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !targetValue) return;

    setSubmitting(true);
    setError(null);
    try {
      let resolvedGenreId = genreId || undefined;
      if (!resolvedGenreId && newGenreName.trim()) {
        resolvedGenreId =
          createdGenreId ?? (await addItem(uid, 'genres', { name: newGenreName.trim() }));
        if (!createdGenreId) setCreatedGenreId(resolvedGenreId);
        setGenreId(resolvedGenreId);
        setNewGenreName('');
      }

      const nextTargetValue = Number(targetValue);
      // 0以下は達成率の目標として意味を持たず、判定側でも100%扱いにフォールバックされるため、
      // 未設定として保存する(手入力では min=1 を回避して0を入れられてしまう)。
      const nextTargetRatePercent =
        Number(targetRatePercent) > 0 ? Number(targetRatePercent) : undefined;

      await updateGoalDetails(uid, goal.id, {
        name: name.trim(),
        targetType,
        targetValue: nextTargetValue,
        targetRatePercent: nextTargetRatePercent,
        genreId: resolvedGenreId,
        // 目標値の引き上げで未達成に戻った場合、アーカイブ状態と自動アーカイブの抑止を
        // 解除する必要があるため、編集後の内容で達成条件を判定して渡す。
        meetsThreshold: meetsArchiveThreshold({
          ...goal,
          targetValue: nextTargetValue,
          targetRatePercent: nextTargetRatePercent,
        }),
      });
      onSaved();
    } catch (e) {
      console.error('目標の更新に失敗しました:', e);
      setError('目標の更新に失敗しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="goal-management-edit-form" onSubmit={handleSave}>
      <label>
        目標名
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <fieldset>
        <legend>進捗定義(100%到達に必要な条件)</legend>
        <label>
          <input
            type="radio"
            name={`targetType-${goal.id}`}
            checked={targetType === 'count'}
            onChange={() => setTargetType('count')}
          />
          達成回数
        </label>
        <label>
          <input
            type="radio"
            name={`targetType-${goal.id}`}
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
          required
        />
        {targetType !== goal.targetType && (
          <p className="goal-management-edit-form__note">
            単位が「{unitLabel(goal.targetType)}」から「{unitLabel(targetType)}」に変わります。
            これまでの累積値({goal.cumulativeAchieved})はそのまま引き継がれるため、必要なら
            達成条件の数値も見直してください。
          </p>
        )}
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

      <div className="goal-management-edit-form__actions">
        <button type="submit" disabled={submitting}>
          保存
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          キャンセル
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
