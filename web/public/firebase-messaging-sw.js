/* eslint-disable no-undef */
// FCMのバックグラウンド通知受信用Service Worker。
// Service Workerはビルド時の環境変数(import.meta.env)を利用できないため、
// 下記のfirebaseConfigはFirebaseプロジェクト作成後、実際の値に直接書き換えてください。
// (値はクライアント公開情報であり秘匿情報ではないため、コミットして問題ありません)
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
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
