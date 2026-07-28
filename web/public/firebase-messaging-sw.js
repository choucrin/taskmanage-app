/* eslint-disable no-undef */
// FCMのバックグラウンド通知受信用Service Worker。
// Service Workerはビルド時の環境変数(import.meta.env)を利用できないため、
// 下記のfirebaseConfigはFirebaseプロジェクト作成後、実際の値に直接書き換えてください。
// (値はクライアント公開情報であり秘匿情報ではないため、コミットして問題ありません)
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDv_zrrw11OrQBo9MllwhUbhX9pi3Eq0Ss',
  authDomain: 'taskmanage-app.firebaseapp.com',
  projectId: 'taskmanage-app',
  storageBucket: 'taskmanage-app.firebasestorage.app',
  messagingSenderId: '494506773459',
  appId: '1:494506773459:web:2e5b8ac6b8c49aaa7ebd26',
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
