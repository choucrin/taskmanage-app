import { useCallback, useEffect, useState } from 'react';
import { saveFcmToken, upsertNotificationSetting } from '../firebase/firestore';
import { requestNotificationPermissionAndToken } from '../firebase/messaging';
import { ensurePushRegistration, type PushStatus } from '../firebase/pushRegistration';
import { useAppData } from '../hooks/AppDataContext';
import type { NotificationType } from '../types';

const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  taskList: '本日のタスク一覧を通知',
  progress: '現在の進捗状況(未達成タスク中心)を通知',
};

export function NotificationSettings() {
  const { uid, notificationSettings } = useAppData();
  const [status, setStatus] = useState<PushStatus>('checking');
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** 現在の受信可否を調べ直す。必要なら登録の修復も行い、判定結果を返す */
  const syncPushStatus = useCallback(async (): Promise<PushStatus | undefined> => {
    if (!uid) return undefined;
    const next = await ensurePushRegistration(uid);
    setStatus(next);
    return next;
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!uid) return;
      const next = await ensurePushRegistration(uid);
      // 判定中に別ページへ移動したりログアウトした場合、古い結果で上書きしない
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function handleEnablePush() {
    if (!uid) return;
    setSubmitting(true);
    setPermissionMessage(null);
    try {
      const token = await requestNotificationPermissionAndToken();
      if (token) {
        await saveFcmToken(uid, token);
        setStatus('ready');
        setPermissionMessage('この端末を通知の送信先として登録しました。');
      } else {
        // 失敗の理由は「許可されなかった」と「許可は得たがトークンを取得できなかった」の
        // 2通りあり、案内すべき内容が異なるため、取り直した状態で切り分ける。
        const next = await syncPushStatus();
        setPermissionMessage(
          next === 'needs-repair'
            ? '通知は許可されましたが、この端末の登録に失敗しました。時間をおいてもう一度お試しください。'
            : '通知が許可されませんでした。iPhone/iPadの場合はホーム画面に追加した状態でアクセスしているか確認してください。',
        );
      }
    } catch (e) {
      console.error('通知の許可取得に失敗しました:', e);
      setStatus('needs-repair');
      setPermissionMessage('通知の許可取得中にエラーが発生しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(type: NotificationType, enabled: boolean) {
    if (!uid) return;
    const existing = notificationSettings.find((n) => n.type === type);
    try {
      await upsertNotificationSetting(uid, type, {
        enabled,
        time: existing?.time ?? '08:00',
      });
    } catch (e) {
      console.error('通知設定の保存に失敗しました:', e);
    }
  }

  async function handleTimeChange(type: NotificationType, time: string) {
    if (!uid) return;
    const existing = notificationSettings.find((n) => n.type === type);
    try {
      await upsertNotificationSetting(uid, type, {
        enabled: existing?.enabled ?? false,
        time,
      });
    } catch (e) {
      console.error('通知設定の保存に失敗しました:', e);
    }
  }

  return (
    <div className="notification-settings-page">
      <h1>通知設定</h1>

      <PushRegistration status={status} submitting={submitting} onRequest={handleEnablePush} />
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

/** 受信可否の表示と、必要な場合のみ押せる登録ボタン */
function PushRegistration({
  status,
  submitting,
  onRequest,
}: {
  status: PushStatus;
  submitting: boolean;
  onRequest: () => void;
}) {
  if (status === 'checking') {
    return <p className="push-status">通知の受信状態を確認しています...</p>;
  }

  if (status === 'ready') {
    return (
      <p className="push-status push-status--ready">
        この端末で通知を受け取れる状態です。再度の許可は不要です。
        <br />
        他の端末で受け取りたい場合は、その端末でこのページを開いてください(端末ごとに登録され、既存の登録は解除されません)。
      </p>
    );
  }

  if (status === 'unsupported') {
    return (
      <p className="push-status">
        このブラウザは通知に対応していません。iPhone/iPadの場合はホーム画面に追加してから開いてください。
      </p>
    );
  }

  if (status === 'denied') {
    // ブロック済みの場合、ボタンを押しても許可ダイアログは二度と出ない。
    // ブラウザ設定を変えてもらう以外に手段がないため、押せるボタンは出さない。
    return (
      <p className="push-status push-status--warning">
        このサイトの通知がブロックされています。ブラウザの設定で通知を許可したあと、
        このページを再読み込みしてください。
      </p>
    );
  }

  const label =
    status === 'needs-repair'
      ? '通知の登録をやり直す'
      : 'このデバイスで通知を受け取る(許可をリクエスト)';

  return (
    <>
      {status === 'needs-repair' && (
        <p className="push-status push-status--warning">
          通知の許可は得られていますが、この端末の登録が有効ではありません。
          下のボタンで登録し直してください。
        </p>
      )}
      <button type="button" onClick={onRequest} disabled={submitting}>
        {label}
      </button>
    </>
  );
}
