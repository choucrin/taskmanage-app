import { isFcmTokenRegistered, saveFcmToken } from './firestore';
import { getCurrentFcmToken, getNotificationPermissionState } from './messaging';

/**
 * この端末で通知を受け取れるかどうかの状態。
 *
 * 「許可済み」だけでは判断できない点に注意。ブラウザのデータ削除やService Workerの
 * 登録解除、FCM側のトークンローテーションが起きると、許可は残ったままトークンだけが
 * 変わり、登録済みの古いトークン宛の通知が届かなくなる。
 * そのため許可状態とトークンの登録有無の両方を見て判定する。
 */
export type PushStatus =
  | 'checking' // 判定中
  | 'unsupported' // ブラウザがWeb Pushに非対応
  | 'denied' // ブラウザ側でブロックされている
  | 'needs-request' // まだ許可を求めていない
  | 'needs-repair' // 許可済みだがトークンを取得・登録できなかった
  | 'ready'; // 通知を受け取れる

/**
 * この端末が通知を受け取れる状態かを調べ、必要なら登録を修復する。
 *
 * 許可済みなのにこの端末のトークンが未登録なら登録し直す。
 * これがないと、トークンが変わった端末では「許可済み」と表示されたまま
 * 通知だけが静かに届かなくなり、利用者は原因に気づけない。
 * 端末ごとに別ドキュメントとして登録するため、他の端末の登録を壊すことはない。
 */
export async function ensurePushRegistration(uid: string): Promise<PushStatus> {
  const permission = await getNotificationPermissionState();
  if (permission === 'unsupported') return 'unsupported';
  if (permission === 'denied') return 'denied';
  if (permission === 'default') return 'needs-request';

  try {
    const token = await getCurrentFcmToken();
    if (!token) return 'needs-repair';
    if (!(await isFcmTokenRegistered(uid, token))) {
      await saveFcmToken(uid, token);
    }
    return 'ready';
  } catch (e) {
    console.error('通知登録の確認に失敗しました:', e);
    return 'needs-repair';
  }
}
