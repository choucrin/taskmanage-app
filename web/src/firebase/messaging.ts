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
  // vite-plugin-pwaが生成するsw.js(vite.config.tsのbasePath配下)と競合しないよう、
  // firebase-messaging-sw.jsは専用スコープに登録する。
  // 同一スコープに複数のService Workerを登録すると、PWA側のautoUpdate機構が
  // controllerの切り替わりを検知してページの状態がおかしくなることがある。
  // GitHub Pagesのサブパス配信(base: '/リポジトリ名/')に対応するため、
  // 絶対パス '/' 始まりではなく import.meta.env.BASE_URL を基準に組み立てる。
  const base = import.meta.env.BASE_URL;
  const registration = await navigator.serviceWorker.register(`${base}firebase-messaging-sw.js`, {
    scope: `${base}firebase-cloud-messaging-push-scope`,
  });

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
