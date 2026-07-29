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
  // notificationフィールド付きのメッセージは、バックグラウンド時にブラウザ側が自動で1通表示する。
  // そこで更に showNotification() を呼ぶと同一内容の通知が2件並ぶため、ここでは何もしない。
  // Functions側は data限定メッセージを送るので、通常この分岐には入らない。
  if (payload.notification) return;

  const data = payload.data ?? {};
  const title = data.title || '日課管理アプリ';
  const options = {
    body: data.body || '',
    // GitHub Pagesはサブパス配信(/リポジトリ名/)のため、絶対パス'/'始まりだとアイコンが404になる
    icon: '__VITE_BASE_PATH__icons/icon-192.png',
    // 同じtagの通知は積み上がらず置き換えられる。万一二重送信されても表示は1件に保たれる。
    tag: data.tag || undefined,
  };
  self.registration.showNotification(title, options);
});

// 通知をタップしたときにアプリを開く。
// 自前で showNotification() しているため、FCM SDK側のタップ処理は動かず、
// このハンドラがないとタップしても何も起きない。
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const appUrl = new URL('__VITE_BASE_PATH__', self.location.origin).href;
  // 末尾スラッシュなしのURL(例: /taskmanage-app)で開かれている場合も取りこぼさない
  const appUrlPrefix = appUrl.replace(/\/$/, '');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 既にアプリのタブが開いていればそれを前面に出し、なければ新しく開く
      for (const client of clientList) {
        if (client.url.startsWith(appUrlPrefix) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(appUrl);
    }),
  );
});
