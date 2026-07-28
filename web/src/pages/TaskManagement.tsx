import { useState } from 'react';
import {
  addItem,
  addTaskToGroup,
  clearTaskSelectiveGroup,
  deleteTaskAndCleanup,
  removeTaskFromGroup,
  updateItem,
} from '../firebase/firestore';
import { useAppData } from '../hooks/AppDataContext';
import type { Goal, SelectiveGroup, Task, TargetType, TaskSchedule } from '../types';
import { WEEKDAY_LABELS } from '../utils/date';
import { recalculateCumulativeAchieved } from '../utils/progress';

type GroupMode = 'none' | 'existing' | 'new';

function formatSchedule(schedule: TaskSchedule): string {
  const parts: string[] = [];
  if (schedule.weekdays && schedule.weekdays.length > 0) {
    parts.push(schedule.weekdays.map((d) => WEEKDAY_LABELS[d]).join(''));
  }
  if (schedule.dates && schedule.dates.length > 0) {
    parts.push(schedule.dates.join(', '));
  }
  return parts.length > 0 ? parts.join(' / ') : '未設定';
}

export function TaskManagement() {
  const { uid, goals, tasks, selectiveGroups, progressLogs } = useAppData();
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(task: Task) {
    if (!uid) return;
    if (!window.confirm(`「${task.displayName}」を削除しますか?`)) return;
    setError(null);
    try {
      // このタスクの進捗ログを残すと、目標の累積達成値に永久に計上され続けて
      // しまうため、削除・目標の再計算・グループからの除去をアトミックに行う。
      const logIdsToDelete = progressLogs.filter((l) => l.taskId === task.id).map((l) => l.id);
      const remainingLogs = progressLogs.filter((l) => l.taskId !== task.id);
      const newCumulativeAchieved = recalculateCumulativeAchieved(remainingLogs, task.goalId);

      await deleteTaskAndCleanup(uid, task, logIdsToDelete, newCumulativeAchieved);
    } catch (e) {
      console.error('タスクの削除に失敗しました:', e);
      setError('タスクの削除に失敗しました。もう一度お試しください。');
    }
  }

  // アーカイブ済み目標のタスクも編集・削除できるよう、全ての目標を対象にする
  // (新規タスクの追加先としては選ばせない。それはTaskSetup.tsx側の責務)。
  const goalsWithTasks = goals.filter((g) => tasks.some((t) => t.goalId === g.id));

  return (
    <div className="task-management-page">
      <h1>タスク管理</h1>
      {error && <p className="error">{error}</p>}

      {goalsWithTasks.map((goal) => {
        const goalTasks = tasks.filter((t) => t.goalId === goal.id);
        return (
          <section key={goal.id}>
            <h2>
              {goal.name}
              {goal.status === 'archived' && ' (アーカイブ済み)'}
            </h2>
            <ul className="task-management-list">
              {goalTasks.map((task) => (
                <li key={task.id}>
                  {editingTaskId === task.id && uid ? (
                    <TaskEditForm
                      uid={uid}
                      task={task}
                      goal={goal}
                      selectiveGroups={selectiveGroups}
                      onCancel={() => setEditingTaskId(null)}
                      onSaved={() => setEditingTaskId(null)}
                    />
                  ) : (
                    <TaskRow
                      task={task}
                      selectiveGroups={selectiveGroups}
                      onEdit={() => setEditingTaskId(task.id)}
                      onDelete={() => handleDelete(task)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {tasks.length === 0 && <p>登録されているタスクはありません。</p>}
    </div>
  );
}

function TaskRow({
  task,
  selectiveGroups,
  onEdit,
  onDelete,
}: {
  task: Task;
  selectiveGroups: SelectiveGroup[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const group = selectiveGroups.find((g) => g.id === task.selectiveGroupId);

  return (
    <div className="task-management-row">
      <div className="task-management-row__main">
        <span className="task-management-row__name">{task.displayName}</span>
        <span className="task-management-row__detail">
          {formatSchedule(task.schedule)} ・ {task.targetValue}
          {task.targetType === 'time' ? '分' : '回'}
          {group && ` ・ グループ:${group.name}`}
        </span>
      </div>
      <div className="task-management-row__actions">
        <button type="button" onClick={onEdit}>
          編集
        </button>
        <button type="button" onClick={onDelete}>
          削除
        </button>
      </div>
    </div>
  );
}

function TaskEditForm({
  uid,
  task,
  goal,
  selectiveGroups,
  onCancel,
  onSaved,
}: {
  uid: string;
  task: Task;
  goal: Goal;
  selectiveGroups: SelectiveGroup[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(task.displayName);
  const [weekdays, setWeekdays] = useState<number[]>(task.schedule.weekdays ?? []);
  const [datesText, setDatesText] = useState((task.schedule.dates ?? []).join(', '));
  const [targetType, setTargetType] = useState<TargetType>(task.targetType);
  const [targetValue, setTargetValue] = useState(String(task.targetValue));

  const [groupMode, setGroupMode] = useState<GroupMode>(task.selectiveGroupId ? 'existing' : 'none');
  const [existingGroupId, setExistingGroupId] = useState(task.selectiveGroupId ?? '');
  const [newGroupName, setNewGroupName] = useState('');
  const [minRequired, setMinRequired] = useState('1');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 保存が途中で失敗し再送信された場合、新規グループを重複作成しないためのキャッシュ。
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    // 選択したモードに応じた入力が伴っていない場合、何もせず成功扱いにしない。
    if (groupMode === 'existing' && !existingGroupId) {
      setError('連携先のグループを選択してください。');
      return;
    }
    if (groupMode === 'new' && !newGroupName.trim()) {
      setError('新規グループ名を入力してください。');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const dates = datesText
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      await updateItem(uid, 'tasks', task.id, {
        displayName: displayName.trim(),
        schedule: { weekdays, dates },
        targetType,
        targetValue: Number(targetValue),
      });

      const oldGroupId = task.selectiveGroupId;

      if (groupMode === 'none') {
        if (oldGroupId) {
          await removeTaskFromGroup(uid, oldGroupId, task.id);
          await clearTaskSelectiveGroup(uid, task.id);
        }
      } else if (groupMode === 'existing') {
        if (oldGroupId !== existingGroupId) {
          // 先に新グループへの追加が成功したことを確認してから旧グループを
          // 外す。逆順だと、追加が失敗した際に旧グループからも外れた
          // ダングリング状態になってしまう。
          const added = await addTaskToGroup(uid, existingGroupId, task.id);
          if (!added) {
            setError('選択したグループが見つかりませんでした。選び直してください。');
            return;
          }
          if (oldGroupId) await removeTaskFromGroup(uid, oldGroupId, task.id);
          await updateItem(uid, 'tasks', task.id, { selectiveGroupId: existingGroupId });
        }
      } else if (groupMode === 'new') {
        // 同様に、新規グループの作成成功を確認してから旧グループを外す。
        const groupId =
          createdGroupId ??
          (await addItem(uid, 'selectiveGroups', {
            name: newGroupName.trim(),
            taskIds: [task.id],
            minRequired: Number(minRequired),
          }));
        if (!createdGroupId) setCreatedGroupId(groupId);
        if (oldGroupId) await removeTaskFromGroup(uid, oldGroupId, task.id);
        await updateItem(uid, 'tasks', task.id, { selectiveGroupId: groupId });
      }

      onSaved();
    } catch (e) {
      console.error('タスクの更新に失敗しました:', e);
      setError('タスクの更新に失敗しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="task-management-edit-form" onSubmit={handleSave}>
      <p className="task-management-edit-form__goal">目標: {goal.name}</p>

      <label>
        デイリータスクの表示名
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>

      <fieldset>
        <legend>配置する曜日</legend>
        {WEEKDAY_LABELS.map((label, i) => (
          <label key={i}>
            <input type="checkbox" checked={weekdays.includes(i)} onChange={() => toggleWeekday(i)} />
            {label}
          </label>
        ))}
      </fieldset>

      <label>
        個別の日付指定(任意、カンマ区切り YYYY-MM-DD)
        <input value={datesText} onChange={(e) => setDatesText(e.target.value)} />
      </label>

      <fieldset>
        <legend>タスク1回分の達成条件</legend>
        <label>
          <input
            type="radio"
            name={`targetType-${task.id}`}
            checked={targetType === 'count'}
            onChange={() => setTargetType('count')}
          />
          回数
        </label>
        <label>
          <input
            type="radio"
            name={`targetType-${task.id}`}
            checked={targetType === 'time'}
            onChange={() => setTargetType('time')}
          />
          時間(分)
        </label>
        <input
          type="number"
          min={1}
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
          required
        />
      </fieldset>

      <fieldset>
        <legend>他のタスクとの選択的連携</legend>
        <label>
          <input
            type="radio"
            name={`groupMode-${task.id}`}
            checked={groupMode === 'none'}
            onChange={() => setGroupMode('none')}
          />
          連携しない
        </label>
        <label>
          <input
            type="radio"
            name={`groupMode-${task.id}`}
            checked={groupMode === 'existing'}
            onChange={() => setGroupMode('existing')}
          />
          既存グループに追加
        </label>
        {groupMode === 'existing' && (
          <select
            value={existingGroupId}
            onChange={(e) => setExistingGroupId(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {selectiveGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        <label>
          <input
            type="radio"
            name={`groupMode-${task.id}`}
            checked={groupMode === 'new'}
            onChange={() => setGroupMode('new')}
          />
          新規グループを作成
        </label>
        {groupMode === 'new' && (
          <>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="グループ名"
              required
            />
            <label>
              達成扱いに必要な最小達成個数
              <input
                type="number"
                min={1}
                value={minRequired}
                onChange={(e) => setMinRequired(e.target.value)}
                required
              />
            </label>
          </>
        )}
      </fieldset>

      <div className="task-management-edit-form__actions">
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
