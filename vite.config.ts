/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages에서는 /<저장소 이름>/ 아래에 놓인다. 배포 워크플로가 BASE_PATH를 넘겨준다.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: '영화 우표 메이커',
        short_name: '영화우표',
        description: '영화 포스터로 코닥 미니 3 레트로용 우표 시트를 만들어요',
        lang: 'ko',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#f4efe6',
        theme_color: '#f4efe6',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 화면은 오프라인에서도 열리게 미리 캐시하고, 한 번 받은 포스터도 기기에 남겨 둔다
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://image.tmdb.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 },
              // 불투명(opaque) 응답은 출력용 CORS fetch에 쓸 수 없으니 캐시하지 않는다
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
