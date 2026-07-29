import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app } from './config';

/**
 * 通知の許可状態。
 * ブラウザがWeb Pushに対応していない場合は 'unsupported'。
 */
export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

/** 許可ダイアログを出さずに、現在の許可状態だけを調べる */
export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const supported = await isSupported().catch(() => false);
  if (!supported || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * FCM用Service Workerを登録し、この端末のトークンを取得する。
 * 通知が許可済みであることが前提(未許可だとgetTokenが失敗する)。
 */
async function registerAndGetToken(): Promise<string | null> {
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
  return token || null;
}

/**
 * 通知の許可を求め、FCMのデバイストークンを取得する。
 * iOS/iPadOSはPWAとしてホーム画面に追加されていないと通知許可自体が機能しないため、
 * 呼び出し側で「ホーム画面に追加してください」等の案内を出すこと。
 */
export async function requestNotificationPermissionAndToken(): Promise<string | null> {
  if ((await getNotificationPermissionState()) === 'unsupported') return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  return registerAndGetToken();
}

/**
 * 既に許可済みの場合のみ、許可ダイアログを出さずに現在のトークンを取得する。
 *
 * トークンはブラウザのデータ削除・Service Workerの登録解除・FCM側のローテーションなどで
 * 変わることがあり、その場合Firestoreに保存済みの古いトークン宛の送信は届かなくなる。
 * 呼び出し側はこの値と保存済みの値を突き合わせ、食い違っていれば保存し直すこと。
 */
export async function getCurrentFcmToken(): Promise<string | null> {
  if ((await getNotificationPermissionState()) !== 'granted') return null;
  return registerAndGetToken();
}

/**
 * 登録済みのFCM用Service Workerに更新チェックを促す。
 *
 * このSWは専用スコープ(firebase-cloud-messaging-push-scope)に登録されており、
 * アプリ画面はそのスコープ外にあるため、通常のページ遷移では更新が検知されない。
 * 放置するとブラウザ既定の定期チェック(最大24時間)まで古いSWが残り続け、
 * 通知の表示ロジックを変更した際に新旧の齟齬で通知が正しく表示されなくなる。
 * 失敗してもアプリの動作には影響しないため、例外は握りつぶす。
 */
export async function refreshMessagingServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL;
    const registration = await navigator.serviceWorker.getRegistration(
      `${base}firebase-cloud-messaging-push-scope`,
    );
    await registration?.update();
  } catch {
    // 更新チェックの失敗は通知以外の機能に影響しないため無視する
  }
}

export async function subscribeToForegroundMessages(
  callback: (payload: unknown) => void,
) {
  const supported = await isSupported().catch(() => false);
  if (!supported) return () => {};

  const messaging = getMessaging(app);
  return onMessage(messaging, callback);
}
