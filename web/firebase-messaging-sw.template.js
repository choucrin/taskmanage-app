/* eslint-disable no-undef */
// FCMのバックグラウンド通知受信用Service Workerのテンプレート。
// 実ファイル(public/firebase-messaging-sw.js)はこのテンプレートを元に、
// `npm run dev` / `npm run build` 実行時に scripts/generate-sw-config.mjs が
// .env.local(またはCI環境変数)の値でプレースホルダーを置換して自動生成する。
// public/firebase-messaging-sw.js は生成物のためgit管理外。直接編集しないこと。
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '__VITE_FIREBASE_API_KEY__',
  authDomain: '__VITE_FIREBASE_AUTH_DOMAIN__',
  projectId: '__VITE_FIREBASE_PROJECT_ID__',
  storageBucket: '__VITE_FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__VITE_FIREBASE_APP_ID__',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? '日課管理アプリ';
  const options = {
    body: payload.notification?.body ?? '',
    icon: '/icons/icon-192.png',
  };
  self.registration.showNotification(title, options);
});
