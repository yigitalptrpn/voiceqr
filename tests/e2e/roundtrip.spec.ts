import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readBarcodesFromImageFile, setZXingModuleOverrides } from 'zxing-wasm/reader';
import { maxAlphanumericChars } from '../../src/qr/capacity';
import { dominantFrequency, makeWav, parseWav, rms, tone } from './helpers';

const require = createRequire(import.meta.url);

/**
 * zxing'in WASM'ini yerelden yukle - test kosarken agdan indirmeye
 * bagimli olmayalim.
 */
test.beforeAll(async () => {
  const wasmPath = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
  const wasm = await readFile(wasmPath);
  setZXingModuleOverrides({
    wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
  });
});

const SAMPLE_RATE = 16000;
const URL_PREFIX = 'https://yigitalptrpn.github.io/voiceqr/#';

async function uploadTone(page: Page, frequency: number, seconds: number): Promise<void> {
  await page.goto('./');
  await page.setInputFiles('#file', {
    name: 'test-tonu.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(tone(frequency, seconds, SAMPLE_RATE), SAMPLE_RATE),
  });
  await expect(page.locator('#wave-canvas')).toBeVisible();
}

async function setBitrate(page: Page, bitrate: number): Promise<void> {
  await page.selectOption('#bitrate', String(bitrate));
}

async function generate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'QR kodu üret' }).click();
  await expect(page.locator('#qr-canvas')).toBeVisible({ timeout: 20_000 });
}

/** Uretilen QR PNG'ini indirip GERCEKTEN tarar; icindeki adresi dondurur. */
async function scanGeneratedQr(page: Page): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG indir' }).click(),
  ]).then(([d]) => d);

  const path = await download.path();
  const png = await readFile(path);

  const results = await readBarcodesFromImageFile(new Blob([png], { type: 'image/png' }), {
    formats: ['QRCode'],
    tryHarder: true,
  });

  expect(results.length, 'QR kod taranamadi').toBeGreaterThan(0);
  return results[0]!.text;
}

/** Oynatici sayfasindan WAV indirip cozer. */
async function playbackAudio(page: Page, fragment: string) {
  await page.goto(`./#${fragment}`);
  await expect(page.locator('#play')).toBeVisible({ timeout: 20_000 });

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'WAV indir' }).click(),
  ]).then(([d]) => d);

  return parseWav(await readFile(await download.path()));
}

test.describe('Ses -> QR -> ses gidis donusu', () => {
  test('uretilen QR gercekten taranabilir ve dogru adresi tasir', async ({ page }) => {
    await uploadTone(page, 440, 5);
    await generate(page);

    const scanned = await scanGeneratedQr(page);

    // QR, yerel adresi degil YAYINDAKI adresi tasimali - basilan kod
    // herkeste calismali.
    expect(scanned).toContain(URL_PREFIX);

    // Yuk alfanumerik segmentte tasindigi icin adres, bayt modunun 2953
    // karakterlik sinirini ASABILIR - QR'in alfanumerik kapasitesi daha genis.
    // Sinir, kapasite matematiginin ilan ettigi kadar olmali.
    const limit = URL_PREFIX.length + maxAlphanumericChars(URL_PREFIX.length, 'L');
    expect(scanned.length).toBeLessThanOrEqual(limit);
    expect(scanned.length).toBeGreaterThan(2953);

    const shown = await page.locator('.url-details summary').textContent();
    expect(shown).toContain(String(scanned.length));
  });

  test('taranan QR dogru sesi geri veriyor (16 kbps, tam frekans)', async ({ page }) => {
    // 16 kbps'te Opus saf sinusu birebir korur; boylece "ses gercekten dogru
    // ses mi" sorusunu kesin olarak yanitlayabiliyoruz.
    await uploadTone(page, 440, 5);
    await setBitrate(page, 16000);
    await generate(page);

    const scanned = await scanGeneratedQr(page);
    const fragment = scanned.split('#')[1]!;

    const { channels, sampleRate } = await playbackAudio(page, fragment);
    const signal = channels[0]!;

    expect(channels).toHaveLength(1);
    expect(sampleRate).toBe(48000); // Opus her zaman 48 kHz'de cozer

    // Basi ve sonu atlayarak kararli bolgeyi olc.
    const middle = signal.subarray(Math.floor(signal.length * 0.3), Math.floor(signal.length * 0.7));
    expect(dominantFrequency(middle, sampleRate)).toBeGreaterThan(430);
    expect(dominantFrequency(middle, sampleRate)).toBeLessThan(450);
    expect(rms(middle)).toBeGreaterThan(0.2);
  });

  test('varsayilan ayar (6 kbps / EC-L) yaklasik 3.7 saniye ses tasiyor', async ({ page }) => {
    await uploadTone(page, 440, 10);
    await generate(page);

    // Uretici, butceye sigan sureyi bastan sectigi icin kirpma uyarisi cikmamali.
    await expect(page.locator('.result .warn')).toHaveCount(0);

    const scanned = await scanGeneratedQr(page);
    const { channels, sampleRate } = await playbackAudio(page, scanned.split('#')[1]!);

    // base43 + alfanumerik QR modu kapasiteyi ~%29 buyuttu: eskiden 2.9 sn
    // olan bu deger 3.7 sn'ye cikti. Gerileme olursa bu test yakalar.
    const seconds = channels[0]!.length / sampleRate;
    expect(seconds).toBeGreaterThan(3.5);
    expect(seconds).toBeLessThan(3.9);
    expect(rms(channels[0]!)).toBeGreaterThan(0.05);
  });

  test('hata duzeltme seviyesi yukseldikce ses kisalir', async ({ page }) => {
    const durations: number[] = [];

    for (const ec of ['L', 'H']) {
      await uploadTone(page, 440, 10);
      await page.selectOption('#ec', ec);
      await generate(page);

      const scanned = await scanGeneratedQr(page);
      const { channels, sampleRate } = await playbackAudio(page, scanned.split('#')[1]!);
      durations.push(channels[0]!.length / sampleRate);
    }

    expect(durations[1]!).toBeLessThan(durations[0]!);
  });
});

test.describe('Oynatici hata durumlari', () => {
  test('bozuk fragment anlasilir bir mesaj gosterir', async ({ page }) => {
    await page.goto('./#bu-gecerli-bir-yuk-degil');
    await expect(page.locator('.error')).toBeVisible();
    await expect(page.locator('.error')).toContainText(/VoiceQR|bozuk|eksik/i);
  });

  test('kirpilmis link kullaniciya tekrar okutmasini soyler', async ({ page }) => {
    await uploadTone(page, 440, 5);
    await generate(page);
    const scanned = await scanGeneratedQr(page);
    const fragment = scanned.split('#')[1]!;

    await page.goto(`./#${fragment.slice(0, Math.floor(fragment.length / 2))}`);
    await expect(page.locator('.error')).toBeVisible();
    await expect(page.locator('.error')).toContainText(/eksik|bozuk/i);
  });

  test('fragment yoksa uretici acilir', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: '1. Ses dosyası seçin' })).toBeVisible();
  });
});
