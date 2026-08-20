import { describe, expect, it } from 'vitest';
import { findSpeechBounds, trimSelection } from '../../src/audio/trim';

const RATE = 16000;

/**
 * `bolumler` = [saniye, genlik] ciftleri. Genlik 0 sessizlik demek.
 * Gercek kayitlarin yapisini taklit ediyor: sessizlik - ses - sessizlik.
 */
function sinyal(bolumler: [number, number][]): Float32Array {
  const toplam = bolumler.reduce((s, [sn]) => s + sn, 0);
  const out = new Float32Array(Math.round(toplam * RATE));
  let i = 0;
  for (const [sn, genlik] of bolumler) {
    const n = Math.round(sn * RATE);
    for (let k = 0; k < n && i < out.length; k++, i++) {
      // Sinus - sabit deger RMS olcumunu yaniltmasin.
      out[i] = genlik * Math.sin((2 * Math.PI * 300 * k) / RATE);
    }
  }
  return out;
}

describe('findSpeechBounds', () => {
  it('bastaki sessizligi bulur', () => {
    const s = sinyal([[1.0, 0], [1.0, 0.5]]);
    const { startSeconds } = findSpeechBounds(s, RATE);
    // 60 ms pay birakiliyor, o yuzden tam 1.0 degil.
    expect(startSeconds).toBeGreaterThan(0.9);
    expect(startSeconds).toBeLessThanOrEqual(1.0);
  });

  it('sondaki sessizligi bulur', () => {
    const s = sinyal([[1.0, 0.5], [1.0, 0]]);
    const { endSeconds } = findSpeechBounds(s, RATE);
    expect(endSeconds).toBeGreaterThanOrEqual(1.0);
    expect(endSeconds).toBeLessThan(1.15);
  });

  it('iki yandaki sessizligi birlikte kirpar', () => {
    const s = sinyal([[0.9, 0], [1.0, 0.4], [0.9, 0]]);
    const { startSeconds, endSeconds } = findSpeechBounds(s, RATE);
    expect(startSeconds).toBeGreaterThan(0.8);
    expect(endSeconds).toBeLessThan(2.05);
    expect(endSeconds - startSeconds).toBeGreaterThan(0.9);
  });

  it('KISIK bir kaydi tamamen sessiz saymaz', () => {
    // Esik en gur pencereye GORE; mutlak olsaydi bu kayit tamamen silinirdi.
    const s = sinyal([[0.5, 0], [1.0, 0.01], [0.5, 0]]);
    const { startSeconds, endSeconds } = findSpeechBounds(s, RATE);
    expect(endSeconds - startSeconds).toBeGreaterThan(0.9);
    expect(startSeconds).toBeGreaterThan(0.4);
  });

  it('tamamen sessiz kaydi OLDUGU GIBI birakir', () => {
    const s = sinyal([[2.0, 0]]);
    expect(findSpeechBounds(s, RATE)).toEqual({ startSeconds: 0, endSeconds: 2 });
  });

  it('bastan sona dolu kayitta neredeyse hic kirpmaz', () => {
    const s = sinyal([[2.0, 0.5]]);
    const { startSeconds, endSeconds } = findSpeechBounds(s, RATE);
    expect(startSeconds).toBe(0);
    expect(endSeconds).toBe(2);
  });

  it('bos girdide cokmez', () => {
    expect(findSpeechBounds(new Float32Array(0), RATE)).toEqual({ startSeconds: 0, endSeconds: 0 });
  });

  it('sonuc her zaman kaydin icinde kalir', () => {
    const s = sinyal([[0.05, 0.5]]);
    const { startSeconds, endSeconds } = findSpeechBounds(s, RATE);
    expect(startSeconds).toBeGreaterThanOrEqual(0);
    expect(endSeconds).toBeLessThanOrEqual(s.length / RATE);
  });
});

describe('trimSelection', () => {
  it('secimin disina TASMAZ', () => {
    // Ses 0-3 sn arasi dolu; kullanici 1-2 arasini secmis.
    const s = sinyal([[3.0, 0.5]]);
    const r = trimSelection(s, RATE, { startSeconds: 1, endSeconds: 2 });
    expect(r.startSeconds).toBeGreaterThanOrEqual(1);
    expect(r.endSeconds).toBeLessThanOrEqual(2);
  });

  it('secimin kenarindaki sessizligi iceri dogru kirpar', () => {
    // Sessiz - ses - sessiz; kullanici tamamini secmis.
    const s = sinyal([[1.0, 0], [1.0, 0.5], [1.0, 0]]);
    const r = trimSelection(s, RATE, { startSeconds: 0, endSeconds: 3 });
    expect(r.startSeconds).toBeGreaterThan(0.8);
    expect(r.endSeconds).toBeLessThan(2.15);
  });

  it('zaten dolu bir secimi degistirmez', () => {
    const s = sinyal([[3.0, 0.5]]);
    const r = trimSelection(s, RATE, { startSeconds: 0.5, endSeconds: 2.5 });
    expect(r.startSeconds).toBeCloseTo(0.5, 2);
    expect(r.endSeconds).toBeCloseTo(2.5, 2);
  });

  it('tamamen sessiz secimi oldugu gibi birakir', () => {
    const s = sinyal([[1.0, 0.5], [1.0, 0]]);
    const r = trimSelection(s, RATE, { startSeconds: 1.2, endSeconds: 1.8 });
    expect(r.startSeconds).toBeCloseTo(1.2, 2);
    expect(r.endSeconds).toBeCloseTo(1.8, 2);
  });

  it('ters/bozuk secimde cokmez', () => {
    const s = sinyal([[1.0, 0.5]]);
    const r = trimSelection(s, RATE, { startSeconds: 0.8, endSeconds: 0.2 });
    expect(r.endSeconds).toBeGreaterThanOrEqual(r.startSeconds);
  });
});
