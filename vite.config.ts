import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages alt yolu. Ozel alan adina gecilirse burasi ve src/config.ts
// birlikte guncellenmeli - aksi halde eskiden uretilmis QR'lar bozulur.
const BASE = '/voiceqr/';

export default defineConfig({
  base: BASE,
  build: {
    target: 'es2022',
    // Oynatici sayfasini acan yabanci, uretici kodunu indirmemeli.
    // main.ts hash'e bakip dogru modulu dinamik import eder.
    chunkSizeWarningLimit: 700,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'VoiceQR — Sesi içinde taşıyan QR',
        short_name: 'VoiceQR',
        description: 'Ses dosyasından, sesi kendi içinde taşıyan QR kod üretir.',
        lang: 'tr',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        // WASM cozucu yalnizca WebCodecs'i olmayan tarayicilarda gerekiyor.
        // Onu da onbellege almak, kullanicilarin buyuk cogunlugunun hic
        // ihtiyac duymayacagi ~87 KB'i mobil veriden indirmesi demek olurdu.
        globIgnores: ['**/opus-decoder-*.js'],
        // QR'i okuyan kisi cevrimdisi olsa bile kabuk acilsin.
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
});
