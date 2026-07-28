import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addItem, updateItem } from '../firebase/firestore';
import { useAppData } from '../hooks/AppDataContext';
import type { TargetType } from '../types';
import { WEEKDAY_LABELS } from '../utils/date';

type GroupMode = 'none' | 'existing' | 'new';

export function TaskSetup() {
  const { uid, goals, selectiveGroups } = useAppData();
  const navigate = useNavigate();
  const activeGoals = goals.filter((g) => g.status === 'active');

  const [goalId, setGoalId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [datesText, setDatesText] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('count');
  const [targetValue, setTargetValue] = useState('1');
  const [groupMode, setGroupMode] = useState<GroupMode>('none');
  const [existingGroupId, setExistingGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [minRequired, setMinRequired] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  function handleGoalChange(id: string) {
    setGoalId(id);
    if (!displayName) {
      const goal = activeGoals.find((g) => g.id === id);
      if (goal) setDisplayName(goal.name);
    }
  }

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !goalId || !displayName.trim()) return;
    setSubmitting(true);
    try {
      const dates = datesText
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      const taskId = await addItem(uid, 'tasks', {
        goalId,
        displayName: displayName.trim(),
        schedule: { weekdays, dates },
        targetType,
        targetValue: Number(targetValue),
      });

      if (groupMode === 'new' && newGroupName.trim()) {
        const groupId = await addItem(uid, 'selectiveGroups', {
          name: newGroupName.trim(),
          taskIds: [taskId],
          minRequired: Number(minRequired),
        });
        await updateItem(uid, 'tasks', taskId, { selectiveGroupId: groupId });
      } else if (groupMode === 'existing' && existingGroupId) {
        const group = selectiveGroups.find((g) => g.id === existingGroupId);
        if (group) {
          await updateItem(uid, 'selectiveGroups', existingGroupId, {
            taskIds: [...group.taskIds, taskId],
          });
          await updateItem(uid, 'tasks', taskId, { selectiveGroupId: existingGroupId });
        }
      }

      navigate('/');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="task-setup-page">
      <h1>タスク設定</h1>
      <form onSubmit={handleSubmit}>
        <label>
          対象の目標
          <select value={goalId} onChange={(e) => handleGoalChange(e.target.value)} required>
            <option value="">選択してください</option>
            {activeGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

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
          <input
            value={datesText}
            onChange={(e) => setDatesText(e.target.value)}
            placeholder="例: 2026-08-01, 2026-08-15"
          />
        </label>

        <fieldset>
          <legend>タスク1回分の達成条件</legend>
          <label>
            <input
              type="radio"
              name="taskTargetType"
              checked={targetType === 'count'}
              onChange={() => setTargetType('count')}
            />
            回数
          </label>
          <label>
            <input
              type="radio"
              name="taskTargetType"
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
            <input type="radio" name="groupMode" checked={groupMode === 'none'} onChange={() => setGroupMode('none')} />
            連携しない
          </label>
          <label>
            <input
              type="radio"
              name="groupMode"
              checked={groupMode === 'existing'}
              onChange={() => setGroupMode('existing')}
            />
            既存グループに追加
          </label>
          {groupMode === 'existing' && (
            <select value={existingGroupId} onChange={(e) => setExistingGroupId(e.target.value)}>
              <option value="">選択してください</option>
              {selectiveGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          <label>
            <input type="radio" name="groupMode" checked={groupMode === 'new'} onChange={() => setGroupMode('new')} />
            新規グループを作成
          </label>
          {groupMode === 'new' && (
            <>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="グループ名"
              />
              <label>
                達成扱いに必要な最小達成個数
                <input
                  type="number"
                  min={1}
                  value={minRequired}
                  onChange={(e) => setMinRequired(e.target.value)}
                />
              </label>
            </>
          )}
        </fieldset>

        <button type="submit" disabled={submitting}>
          タスクを登録
        </button>
      </form>
    </div>
  );
}
