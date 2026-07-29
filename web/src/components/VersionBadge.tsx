import { APP_VERSION } from '../constants';

/**
 * 画面右下にバージョンを表示する。
 * デプロイやService Workerの更新が端末に反映されたかを、この数字で確認する。
 * ログイン前でも確認できるよう、認証状態によらず常に表示する。
 */
export function VersionBadge() {
  return <span className="version-badge">{APP_VERSION}</span>;
}
