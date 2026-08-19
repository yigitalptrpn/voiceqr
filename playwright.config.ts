import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Uçtan uca testler gerçek Chromium'da, gerçek derlenmiş siteye karşı koşar.
 *
 * Bu ortamda Chromium hazır kurulu; CI'da ise Playwright kendi tarayıcısını
 * indirir. Hazır tarayıcı varsa onu kullan, yoksa Playwright'ın kendi
 * indirdiğine bırak - böylece `playwright install` gereksiz yere koşmaz.
 */
const preinstalledChromium = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const executablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/voiceqr/',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/voiceqr/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
