import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const SR = 16000;
function wav(seconds, freq) {
  const n = Math.round(seconds * SR);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.5 * i / SR);
    data.writeInt16LE(Math.round(0.6 * env * Math.sin(2 * Math.PI * freq * i / SR) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 1400 }, deviceScaleFactor: 2 });
const base = 'http://127.0.0.1:4173/voiceqr/';

await page.goto(base);
await page.setInputFiles('#file', { name: 'ornek-ses.wav', mimeType: 'audio/wav', buffer: wav(8, 440) });
await page.waitForSelector('#wave-canvas');
await page.getByRole('button', { name: 'QR kodu üret' }).click();
await page.waitForSelector('#qr-canvas');
await page.waitForTimeout(500);
writeFileSync('/tmp/shot-generator.png', await page.screenshot({ fullPage: true }));
console.log('uretici ekrani yakalandi');

const href = await page.getAttribute('a.button[href*="#"]', 'href');
await page.goto(href);
await page.waitForSelector('#play');
await page.waitForTimeout(400);
writeFileSync('/tmp/shot-player.png', await page.screenshot({ fullPage: true }));
console.log('oynatici ekrani yakalandi');

await browser.close();
