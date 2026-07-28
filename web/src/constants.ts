/**
 * 個人利用専用アプリのため、このUID以外はアプリを利用できないようにする。
 * Firestore Security Rules・Cloud Functions側でも同じ値をチェックしている。
 * UIDは秘匿情報ではない(これ単体で他人がなりすませるものではない)ためハードコードしてよい。
 */
export const ALLOWED_UID = 'OBBBWdPsQqdzrJqDDLcHZ2EpAps2';
