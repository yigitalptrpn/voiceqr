import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { estimateSeconds } from '../../src/codec/encode';
import {
  base64urlLength,
  bytesFromBase64urlLength,
  maxPayloadBytes,
  QR_V40_BYTE_CAPACITY,
  QR_V40_MODULES,
  recommendedPrintSizeMm,
  type EcLevel,
} from '../../src/qr/capacity';

const EC_LEVELS: EcLevel[] = ['L', 'M', 'Q', 'H'];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function filler(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += B64[(i * 37 + (i >> 3) * 11) % 64];
  return s;
}

describe('QR kapasite matematigi', () => {
  it('base64url uzunluk hesaplari birbirinin tersi', () => {
    for (let n = 0; n <= 300; n++) {
      expect(bytesFromBase64urlLength(base64urlLength(n))).toBe(n);
    }
  });

  // Bu, tablodaki sabitlerin GERCEK QR kutuphanesiyle uyustugunu dogrular.
  // Sabitler yanlis olsaydi uretici "sigar" deyip uretim aninda patlardi.
  it.each(EC_LEVELS)('%s seviyesinde ilan edilen kapasite tam dolar', (ec) => {
    const cap = QR_V40_BYTE_CAPACITY[ec];
    const qr = QRCode.create(filler(cap), { errorCorrectionLevel: ec });

    expect(qr.version).toBe(40);
    expect(17 + 4 * qr.version).toBe(QR_V40_MODULES);
  });

  it.each(EC_LEVELS)('%s seviyesinde bir bayt fazlasi tasar', (ec) => {
    expect(() => QRCode.create(filler(QR_V40_BYTE_CAPACITY[ec] + 1), { errorCorrectionLevel: ec })).toThrow();
  });

  it('URL onunu kapasiteden duser', () => {
    const prefixLength = 'https://yigitalptrpn.github.io/voiceqr/#'.length;
    expect(prefixLength).toBe(40);
    expect(maxPayloadBytes(prefixLength, 'L')).toBe(2184);
    expect(maxPayloadBytes(prefixLength, 'H')).toBe(924);
  });

  it('sigmayacak kadar uzun onde sifir dondurur', () => {
    expect(maxPayloadBytes(5000, 'L')).toBe(0);
  });

  // Fizibilite olcumlerinden (Chromium, Opus CBR 60 ms) gelen gercek rakamlar.
  it('6 kbps ve EC-L yaklasik 2.9 saniye verir', () => {
    const seconds = estimateSeconds(maxPayloadBytes(40, 'L'), 6000, 60000);
    expect(seconds).toBeGreaterThan(2.8);
    expect(seconds).toBeLessThan(3.0);
  });

  it('bit hizi arttikca sure azalir', () => {
    const budget = maxPayloadBytes(40, 'L');
    const durations = [6000, 8000, 12000, 16000, 24000].map((br) => estimateSeconds(budget, br, 60000));

    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]!).toBeLessThan(durations[i - 1]!);
    }
    expect(durations.at(-1)!).toBeGreaterThan(0.5);
  });

  it('hata duzeltme seviyesi yukseldikce sure azalir', () => {
    const durations = EC_LEVELS.map((ec) => estimateSeconds(maxPayloadBytes(40, ec), 6000, 60000));
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]!).toBeLessThan(durations[i - 1]!);
    }
  });

  // Opus kodlayici, girdi kare boyutuna tam bolundugunde bir fazla paket
  // uretir. Bu ayrilmasaydi uretici "sigar" deyip sesi sondan kirpardi -
  // uctan uca test bu hatayi bir kez yakaladi.
  it('kodlayicinin fazladan paketi icin butceden yer ayirir', () => {
    const budget = maxPayloadBytes(40, 'L');
    const bytesPerPacket = 45; // 6 kbps @ 60 ms
    const packetBudget = Math.floor((budget - 5) / bytesPerPacket);

    const seconds = estimateSeconds(budget, 6000, 60000);
    const packetsNeeded = Math.ceil(seconds / 0.06) + 1;

    expect(packetsNeeded).toBeLessThanOrEqual(packetBudget);
  });

  it('butce bir pakete bile yetmiyorsa sifir dondurur', () => {
    expect(estimateSeconds(10, 6000, 60000)).toBe(0);
    expect(estimateSeconds(0, 6000, 60000)).toBe(0);
  });

  it('v40 icin makul bir basim boyutu onerir', () => {
    const mm = recommendedPrintSizeMm(QR_V40_MODULES);
    expect(mm).toBeGreaterThanOrEqual(70);
    expect(mm).toBeLessThanOrEqual(120);
  });
});
