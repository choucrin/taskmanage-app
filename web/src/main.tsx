import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

/**
 * 更新を確認する間隔であり、チェックの最短間隔でもある。
 *
 * タブを切り替えるたびにチェックすると入力の途中で不意に自動リロードが走りやすいので間引くが、
 * 長くしすぎると「デプロイしたのにバージョンが上がらない」時間が延びる。
 * 定期チェックと間引きの下限を同じ値にすることで、どんな経路でも最大この間隔で更新に追いつく。
 */
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * Service Workerを登録し、更新を検知したら自動でページを再読み込みする。
 *
 * このimportが無いと injectRegister: 'auto' がscriptモードにフォールバックし、
 * 生成される registerSW.js は navigator.serviceWorker.register() を呼ぶだけになる。
 * その場合 registerType: 'autoUpdate' を指定していても、新しいSWが制御を奪うだけで
 * 表示中のページは再読み込みされず、画面右下のバージョン番号が旧のまま残ってしまう。
 * それでは「番号を見てアップデート反映を確認する」という運用が成立しないため、
 * ここで virtual:pwa-register を明示的に使い、更新の有効化時にリロードが走るようにしている。
 * (このimportがあると registerSW.js の注入は自動的に無効になるため、二重登録にはならない)
 */
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return

    let lastCheckedAt = Date.now()
    const checkForUpdate = () => {
      const now = Date.now()
      if (now - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return
      lastCheckedAt = now
      // オフライン時などは reject するが、次回のチェックで拾えるので握りつぶす
      registration.update().catch(() => {})
    }

    // ホーム画面のPWAを復帰させただけだと load イベントが発火せず更新を取りこぼすため、
    // 画面が再び表示されたタイミングでも確認する。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    // 長時間開きっぱなしの場合に備えた定期チェック
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
