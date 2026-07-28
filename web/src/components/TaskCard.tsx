import { useEffect, useRef, useState } from 'react';
import type { ProgressLog, Task } from '../types';

interface TaskCardProps {
  task: Task;
  log?: ProgressLog;
  onRecord: (achievedValue: number) => void;
}

export function TaskCard({ task, log, onRecord }: TaskCardProps) {
  const status = log?.status ?? 'not_achieved';
  const currentValue = log?.achievedValue ?? 0;

  const [manualValue, setManualValue] = useState(String(currentValue));
  const [running, setRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    setManualValue(String(currentValue));
  }, [currentValue]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const disabled = status === 'excluded' || status === 'achieved';

  function handleCountUp() {
    onRecord(currentValue + 1);
  }

  function handleManualSubmit() {
    const value = Number(manualValue);
    if (Number.isNaN(value) || value < 0) return;
    onRecord(value);
  }

  function toggleStopwatch() {
    if (running) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      setRunning(false);
      const additionalMinutes = elapsedSeconds / 60;
      onRecord(currentValue + additionalMinutes);
      setElapsedSeconds(0);
    } else {
      setRunning(true);
      intervalRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
  }

  const statusLabel = { not_achieved: '未達成', achieved: '達成済み', excluded: '対象外' }[status];

  return (
    <div className={`task-card task-card--${status}`}>
      <div className="task-card__header">
        <span className="task-card__name">{task.displayName}</span>
        <span className={`task-card__status task-card__status--${status}`}>{statusLabel}</span>
      </div>

      <div className="task-card__progress">
        {currentValue} / {task.targetValue} {task.targetType === 'time' ? '分' : '回'}
      </div>

      {!disabled && (
        <div className="task-card__actions">
          {task.targetType === 'count' && (
            <button type="button" onClick={handleCountUp}>
              +1 する
            </button>
          )}

          {task.targetType === 'time' && (
            <button type="button" onClick={toggleStopwatch}>
              {running ? `計測中 ${elapsedSeconds}秒 (停止して記録)` : 'ストップウォッチ開始'}
            </button>
          )}

          <span className="task-card__manual">
            <input
              type="number"
              min={0}
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              aria-label="手動入力"
            />
            <button type="button" onClick={handleManualSubmit}>
              手動で登録
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
