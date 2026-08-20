import { describe, expect, it } from 'vitest';
import { concatWithCrossfade, DEFAULT_CROSSFADE_MS } from '../../src/audio/splice';

const RATE = 16000;
const FADE = Math.round((DEFAULT_CROSSFADE_MS / 1000) * RATE);

const sabit = (len: number, deger: number) => new Float32Array(len).fill(deger);

/** Ardisik ornekler arasindaki en buyuk siçrama - tik sesinin olcusu. */
function enBuyukSicrama(s: Float32Array): number {
  let max = 0;
  for (let i = 1; i < s.length; i++) {
    const d = Math.abs(s[i]! - s[i - 1]!);
    if (d > max) max = d;
  }
  return max;
}

describe('uzunluk', () => {
  it('gecis bolgesi ortak oldugu icin toplam kisalir', () => {
    const out = concatWithCrossfade(sabit(1000, 0.5), sabit(1000, 0.5), RATE);
    expect(out.length).toBe(2000 - FADE);
  });

  it('bos parca digerini oldugu gibi dondurur', () => {
    const a = sabit(100, 0.3);
    expect(Array.from(concatWithCrossfade(a, new Float32Array(0), RATE))).toEqual(Array.from(a));
    expect(Array.from(concatWithCrossfade(new Float32Array(0), a, RATE))).toEqual(Array.from(a));
  });

  it('iki bos parca bos doner', () => {
    expect(concatWithCrossfade(new Float32Array(0), new Float32Array(0), RATE)).toHaveLength(0);
  });

  it('gecis, parcalarin kisasindan uzun olamaz', () => {
    // 3 ornekli parca, 8 ms'lik gecis isteniyor - gecis 3'e kirpilmali.
    const out = concatWithCrossfade(sabit(3, 0.5), sabit(1000, 0.5), RATE);
    expect(out.length).toBe(1000);
    expect(Number.isFinite(out[0]!)).toBe(true);
  });
});

describe('tik sesi', () => {
  /**
   * Bu testin varlik sebebi: ortadan bolum atildiginda kalan iki parca
   * birlestiriliyor ve duz yapistirma DUYULUR bir darbe cikariyor.
   */
  it('zit isaretli parcalarin ek yerinde ani siçrama BIRAKMAZ', () => {
    const a = sabit(2000, 0.8);
    const b = sabit(2000, -0.8);

    const capraz = concatWithCrossfade(a, b, RATE);

    // Duz yapistirma 1.6'lik bir siçrama uretirdi.
    const duz = new Float32Array(4000);
    duz.set(a, 0);
    duz.set(b, 2000);

    expect(enBuyukSicrama(duz)).toBeCloseTo(1.6, 1);
    expect(enBuyukSicrama(capraz)).toBeLessThan(0.05);
  });

  it('gecis her zaman parcalarin arasinda kalir', () => {
    const out = concatWithCrossfade(sabit(500, 1), sabit(500, -1), RATE);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-6);
  });
});

describe('icerik korunmasi', () => {
  it('gecis disindaki ornekler degismez', () => {
    const a = new Float32Array(1000).map((_, i) => Math.sin(i / 10));
    const b = new Float32Array(1000).map((_, i) => Math.cos(i / 10));
    const out = concatWithCrossfade(a, b, RATE);

    // Birinci parcanin gecise girmeyen kismi
    for (let i = 0; i < a.length - FADE; i++) expect(out[i]!).toBeCloseTo(a[i]!, 6);
    // Ikinci parcanin gecisten sonraki kismi
    for (let i = FADE; i < b.length; i++) {
      expect(out[a.length - FADE + i]!).toBeCloseTo(b[i]!, 6);
    }
  });

  it('ayni sinyalin iki yarisi birlestirilince seviye cokmez', () => {
    // Esit guclu gecis: ortada -3 dB'de bulusuluyor, toplam guc korunuyor.
    const yarim = sabit(2000, 0.5);
    const out = concatWithCrossfade(yarim, yarim, RATE);
    const joint = 2000 - FADE;
    for (let i = 0; i < FADE; i++) {
      expect(out[joint + i]!).toBeGreaterThan(0.49);
      expect(out[joint + i]!).toBeLessThan(0.72);
    }
  });

  it('gecis suresi sifir verilirse duz yapistirir', () => {
    const out = concatWithCrossfade(sabit(10, 1), sabit(10, -1), RATE, 0);
    expect(out.length).toBe(20);
    expect(out[9]).toBe(1);
    expect(out[10]).toBe(-1);
  });
});
