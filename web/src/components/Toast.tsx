import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onClose: () => void;
  durationMs?: number;
}

export function Toast({ message, onClose, durationMs = 5000 }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(timer);
  }, [onClose, durationMs]);

  return (
    <div className="toast" role="status">
      {message}
      <button type="button" className="toast__close" onClick={onClose} aria-label="閉じる">
        ×
      </button>
    </div>
  );
}
