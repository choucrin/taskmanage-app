import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// このスクリプトはリポジトリに実際のAPIキーを残さないため、
// firebase-messaging-sw.template.js のプレースホルダーを
// .env.local(ローカル開発)またはCI環境変数(GitHub Actions)の値で置換し、
// public/firebase-messaging-sw.js を生成する。生成物はgit管理外。
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const env = { ...loadEnv(mode, webRoot, 'VITE_'), ...process.env };

const replacements = {
  __VITE_FIREBASE_API_KEY__: env.VITE_FIREBASE_API_KEY,
  __VITE_FIREBASE_AUTH_DOMAIN__: env.VITE_FIREBASE_AUTH_DOMAIN,
  __VITE_FIREBASE_PROJECT_ID__: env.VITE_FIREBASE_PROJECT_ID,
  __VITE_FIREBASE_STORAGE_BUCKET__: env.VITE_FIREBASE_STORAGE_BUCKET,
  __VITE_FIREBASE_MESSAGING_SENDER_ID__: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  __VITE_FIREBASE_APP_ID__: env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(replacements)
  .filter(([, value]) => !value)
  .map(([placeholder]) => placeholder);

if (missing.length > 0) {
  console.warn(
    `[generate-sw-config] 環境変数が未設定のためプレースホルダーのままにします: ${missing.join(', ')}\n` +
      '(.env.local を設定していない場合、FCMのバックグラウンド通知受信は動作しません)',
  );
}

let content = readFileSync(path.join(webRoot, 'firebase-messaging-sw.template.js'), 'utf-8');
for (const [placeholder, value] of Object.entries(replacements)) {
  content = content.replaceAll(placeholder, value || 'REPLACE_ME');
}

writeFileSync(path.join(webRoot, 'public', 'firebase-messaging-sw.js'), content);
console.log('[generate-sw-config] public/firebase-messaging-sw.js を生成しました。');
