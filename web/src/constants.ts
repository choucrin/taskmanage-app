/**
 * 個人利用専用アプリのため、このUID以外はアプリを利用できないようにする。
 * Firestore Security Rules・Cloud Functions側でも同じ値をチェックしている。
 * UIDは秘匿情報ではない(これ単体で他人がなりすませるものではない)ためハードコードしてよい。
 */
export const ALLOWED_UID = 'OBBBWdPsQqdzrJqDDLcHZ2EpAps2';

/**
 * アプリのバージョン。画面右下に常時表示し、デプロイが反映されたかを目視で確認するために使う。
 *
 * 機能追加や修正を行うたびに末尾の数字を1つ増やし、9の次は繰り上げる
 * (ver.01.0 → ver.01.1 → … → ver.01.9 → ver.02.0)。
 * 書式は `ver.NN.N` 固定。constants.test.ts で書式を検証している。
 */
export const APP_VERSION = 'ver.01.0';
