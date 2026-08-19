import { describe, expect, it } from 'vitest';
import { Base64urlError, decodeBase64url, encodeBase64url } from '../../src/codec/base64url';

function roundtrip(bytes: Uint8Array): void {
  expect(Array.from(decodeBase64url(encodeBase64url(bytes)))).toEqual(Array.from(bytes));
}

describe('base64url', () => {
  it('bos diziyi isler', () => {
    expect(encodeBase64url(new Uint8Array(0))).toBe('');
    expect(decodeBase64url('').length).toBe(0);
  });

  it('artan bayt sayilarinin hepsinde gidip gelir (dolgu sinir durumlari)', () => {
    for (let n = 1; n <= 12; n++) {
      roundtrip(Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff));
    }
  });

  it('tum bayt degerlerini korur', () => {
    roundtrip(Uint8Array.from({ length: 256 }, (_, i) => i));
  });

  it('URL icin guvenli olmayan karakter uretmez', () => {
    const text = encodeBase64url(Uint8Array.from({ length: 3000 }, (_, i) => (i * 251) & 0xff));
    expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
  });

  it('beklenen uzunlugu uretir (3 bayt -> 4 karakter)', () => {
    expect(encodeBase64url(new Uint8Array(3))).toHaveLength(4);
    expect(encodeBase64url(new Uint8Array(1))).toHaveLength(2);
    expect(encodeBase64url(new Uint8Array(2))).toHaveLength(3);
    expect(encodeBase64url(new Uint8Array(2184))).toHaveLength(2912);
  });

  it('rastgele verilerde gidip gelir', () => {
    for (let trial = 0; trial < 50; trial++) {
      const n = 1 + Math.floor(Math.random() * 500);
      roundtrip(Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
    }
  });

  it('bastaki/sondaki bosluklari yok sayar (kamera uygulamalari ekleyebiliyor)', () => {
    const text = encodeBase64url(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(Array.from(decodeBase64url(`  ${text}\n`))).toEqual([1, 2, 3, 4, 5]);
  });

  it('gecersiz karakteri reddeder', () => {
    expect(() => decodeBase64url('AA*A')).toThrow(Base64urlError);
  });

  it('imkansiz uzunlugu reddeder', () => {
    expect(() => decodeBase64url('AAAAA')).toThrow(Base64urlError);
  });
});
