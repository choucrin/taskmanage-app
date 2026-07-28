import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pagesでリポジトリ名がサブパスになる場合は VITE_BASE_PATH="/リポジトリ名/" を指定してビルドする
const basePath = process.env.VITE_BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // firebase-messaging-sw.js はFCMのバックグラウンド受信用に別途 public/ に配置し、
      // vite-plugin-pwa 生成のSWと競合しないよう injectManifest は使わずデフォルトのgenerateSWを使う
      manifest: {
        name: '日課管理アプリ',
        short_name: '日課管理',
        description: '目標達成のための日課タスク管理PWA',
        theme_color: '#aa3bff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: basePath,
        scope: basePath,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // firebase-messaging-sw.jsは別スコープで独立動作するFCM専用SWであり、
        // PWA本体のプリキャッシュ対象に含める必要がないため除外する
        globIgnores: ['firebase-messaging-sw.js'],
      },
    }),
  ],
})
