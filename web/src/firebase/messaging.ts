import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app } from './config';

/**
 * FCMのデバイストークンを取得する。
 * iOS/iPadOSはPWAとしてホーム画面に追加されていないと通知許可自体が機能しないため、
 * 呼び出し側で「ホーム画面に追加してください」等の案内を出すこと。
 */
export async function requestNotificationPermissionAndToken(): Promise<string | null> {
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const messaging = getMessaging(app);
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  return token;
}

export async function subscribeToForegroundMessages(
  callback: (payload: unknown) => void,
) {
  const supported = await isSupported().catch(() => false);
  if (!supported) return () => {};

  const messaging = getMessaging(app);
  return onMessage(messaging, callback);
}
