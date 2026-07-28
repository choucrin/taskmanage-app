import { useState } from 'react';
import { saveFcmToken, upsertNotificationSetting } from '../firebase/firestore';
import { requestNotificationPermissionAndToken } from '../firebase/messaging';
import { useAppData } from '../hooks/AppDataContext';
import type { NotificationType } from '../types';

const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  taskList: '本日のタスク一覧を通知',
  progress: '現在の進捗状況(未達成タスク中心)を通知',
};

export function NotificationSettings() {
  const { uid, notificationSettings } = useAppData();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);

  async function handleEnablePush() {
    if (!uid) return;
    const token = await requestNotificationPermissionAndToken();
    if (token) {
      await saveFcmToken(uid, token);
      setPermissionMessage('通知の許可を取得しました。');
    } else {
      setPermissionMessage(
        '通知が許可されませんでした。iPhone/iPadの場合はホーム画面に追加した状態でアクセスしているか確認してください。',
      );
    }
  }

  async function handleToggle(type: NotificationType, enabled: boolean) {
    if (!uid) return;
    const existing = notificationSettings.find((n) => n.type === type);
    await upsertNotificationSetting(uid, type, {
      enabled,
      time: existing?.time ?? '08:00',
    });
  }

  async function handleTimeChange(type: NotificationType, time: string) {
    if (!uid) return;
    const existing = notificationSettings.find((n) => n.type === type);
    await upsertNotificationSetting(uid, type, {
      enabled: existing?.enabled ?? false,
      time,
    });
  }

  return (
    <div className="notification-settings-page">
      <h1>通知設定</h1>

      <button type="button" onClick={handleEnablePush}>
        このデバイスで通知を受け取る(許可をリクエスト)
      </button>
      {permissionMessage && <p>{permissionMessage}</p>}

      {(['taskList', 'progress'] as NotificationType[]).map((type) => {
        const setting = notificationSettings.find((n) => n.type === type);
        const enabled = setting?.enabled ?? false;
        const time = setting?.time ?? '08:00';
        return (
          <fieldset key={type}>
            <legend>{NOTIFICATION_LABELS[type]}</legend>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => handleToggle(type, e.target.checked)}
              />
              通知をオンにする
            </label>
            <label>
              送信時刻
              <input
                type="time"
                value={time}
                onChange={(e) => handleTimeChange(type, e.target.value)}
                disabled={!enabled}
              />
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}
