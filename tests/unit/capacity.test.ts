import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { estimateSeconds } from '../../src/codec/encode';
import { encodeBase43 } from '../../src/codec/base43';
import {
  base64urlLength,
  bytesFromBase64urlLength,
  maxAlphanumericChars,
  maxPayloadBytes,
  maxPayloadBytesAlphanumeric,
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

/**
 * Karisik mod kapasitesi. Bu blogun tamami sabitleri degil, TURETILEN
 * matematigi gercek `qrcode` kutuphanesine karsi dogruluyor - kapasite bir
 * karakter bile fazla ilan edilirse uretici "sigar" deyip uretim aninda
 * patlar, hem de yalnizca en uzun seslerde.
 */
describe('karisik mod (bayt onek + alfanumerik yuk) kapasitesi', () => {
  const ONEK = 'https://yigitalptrpn.github.io/voiceqr/#';

  function mixedQr(prefix: string, alnumChars: number, ec: EcLevel) {
    return QRCode.create(
      [
        { data: new TextEncoder().encode(prefix), mode: 'byte' },
        { data: 'A'.repeat(alnumChars), mode: 'alphanumeric' },
      ],
      { errorCorrectionLevel: ec },
    );
  }

  it.each(EC_LEVELS)('%s: ilan edilen karakter sayisi tam sigar', (ec) => {
    const chars = maxAlphanumericChars(ONEK.length, ec);
    expect(mixedQr(ONEK, chars, ec).version).toBe(40);
  });

  it.each(EC_LEVELS)('%s: bir karakter fazlasi tasar', (ec) => {
    const chars = maxAlphanumericChars(ONEK.length, ec);
    expect(() => mixedQr(ONEK, chars + 1, ec)).toThrow();
  });

  it.each(EC_LEVELS)('%s: base43 yuku ilan edilen bayt kadar gercekten sigar', (ec) => {
    const bytes = maxPayloadBytesAlphanumeric(ONEK.length, ec);
    const payload = encodeBase43(new Uint8Array(bytes).fill(0xab));
    expect(mixedQr(ONEK, payload.length, ec).version).toBe(40);
  });

  it.each(EC_LEVELS)('%s: base64url yerine base43 daha cok ses tasir', (ec) => {
    const eski = maxPayloadBytes(ONEK.length, ec);
    const yeni = maxPayloadBytesAlphanumeric(ONEK.length, ec);
    expect(yeni).toBeGreaterThan(eski);
    // Olculen kazanc her seviyede ~%29; gerilemeyi yakalamak icin alt sinir.
    expect(yeni / eski).toBeGreaterThan(1.25);
  });

  it('onek uzadikca kapasite duser', () => {
    const kisa = maxPayloadBytesAlphanumeric(20, 'L');
    const uzun = maxPayloadBytesAlphanumeric(60, 'L');
    expect(uzun).toBeLessThan(kisa);
  });
});
