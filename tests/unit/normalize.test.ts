import { describe, expect, it } from 'vitest';
import {
  DECODER_OVERSHOOT,
  BOOST_TARGETS,
  normalizationGain,
  normalizeInPlace,
  peakOf,
  rmsOf,
} from '../../src/audio/normalize';

/** Genligi sabit, tepesi tek bir ani vurus olan sinyal - gercek kayitlara benziyor. */
function vurusluSinyal(taban: number, vurus: number, uzunluk = 1000): Float32Array {
  const s = new Float32Array(uzunluk).fill(taban);
  s[uzunluk - 1] = vurus;
  return s;
}

describe('olcumler', () => {
  it('peakOf en buyuk mutlak degeri bulur', () => {
    expect(peakOf(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
  });

  it('bos dizide ikisi de 0 doner', () => {
    expect(peakOf(new Float32Array(0))).toBe(0);
    expect(rmsOf(new Float32Array(0))).toBe(0);
  });

  it('rmsOf sabit genlikte genligin kendisini verir', () => {
    expect(rmsOf(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
  });
});

describe('normalizationGain', () => {
  it('kisik sesi RMS hedefine cekecek carpani verir', () => {
    const s = new Float32Array(1000).fill(0.02);
    // Tepe = RMS oldugu icin tavan degil RMS hedefi baglayici.
    expect(normalizationGain(s, BOOST_TARGETS.orta)).toBeCloseTo(BOOST_TARGETS.orta.rms / 0.02);
  });

  it('ani vurusu tam olcege carptirmaz - tepe tavani baglayici olur', () => {
    // Taban cok kisik, tepe yuksek: RMS hedefi devasa bir carpan isterdi.
    const s = vurusluSinyal(0.004, 0.5);
    const gain = normalizationGain(s, BOOST_TARGETS.orta);
    expect(peakOf(s) * gain).toBeLessThanOrEqual(BOOST_TARGETS.orta.peakCeiling + 1e-6);
  });

  it('zaten gur olan sesi KISMAZ', () => {
    const s = new Float32Array(1000).fill(0.6);
    expect(normalizationGain(s, BOOST_TARGETS.orta)).toBe(1);
  });

  it('tamamen sessiz girdide 1 doner (sifira bolme yok)', () => {
    const gain = normalizationGain(new Float32Array(100), BOOST_TARGETS.orta);
    expect(gain).toBe(1);
    expect(Number.isFinite(gain)).toBe(true);
  });

  it('seviye yukseldikce carpan buyur', () => {
    const s = new Float32Array(1000).fill(0.01);
    const hafif = normalizationGain(s, BOOST_TARGETS.hafif);
    const orta = normalizationGain(s, BOOST_TARGETS.orta);
    const guclu = normalizationGain(s, BOOST_TARGETS.guclu);
    expect(hafif).toBeLessThan(orta);
    expect(orta).toBeLessThan(guclu);
  });
});

describe('normalizeInPlace', () => {
  it('kapali seviyede sese dokunmaz', () => {
    const s = new Float32Array([0.01, -0.02]);
    expect(normalizeInPlace(s, 'kapali')).toBe(1);
    expect(s[0]).toBeCloseTo(0.01);
  });

  it('oranlari korur - sadece olcekler', () => {
    const s = new Float32Array(1000).fill(0.02);
    s[0] = -0.04;
    normalizeInPlace(s, 'orta');
    expect(s[0]! / s[1]!).toBeCloseTo(-2);
  });

  it('vuruslu sinyalde tavani asmaz', () => {
    const s = vurusluSinyal(0.004, 0.5);
    normalizeInPlace(s, 'guclu');
    expect(peakOf(s)).toBeLessThanOrEqual(BOOST_TARGETS.guclu.peakCeiling + 1e-6);
  });
});

describe('cozucu tasma payi', () => {
  it('hicbir tavan, tasma payiyla carpildiginda tam olcegi asmaz', () => {
    // Bu testin varlik sebebi: tavanlar bir kez 0.95'e ayarlanmisti ve
    // cikista kirpma yapiyordu. Tavani yukseltmek isteyen bu testi gorsun.
    for (const [ad, hedef] of Object.entries(BOOST_TARGETS)) {
      expect(hedef.peakCeiling * DECODER_OVERSHOOT, `${ad} seviyesi cikista kirpar`).toBeLessThanOrEqual(1);
    }
  });

  it('seviyeler tavan olarak da artan sirada', () => {
    expect(BOOST_TARGETS.hafif.peakCeiling).toBeLessThan(BOOST_TARGETS.orta.peakCeiling);
    expect(BOOST_TARGETS.orta.peakCeiling).toBeLessThan(BOOST_TARGETS.guclu.peakCeiling);
  });
});
