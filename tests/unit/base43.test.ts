import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  BASE,
  Base43Error,
  decodeBase43,
  decodedLength,
  encodeBase43,
  encodedLength,
  isBase43,
} from '../../src/codec/base43';

describe('alfabe', () => {
  it('43 benzersiz karakter icerir', () => {
    expect(BASE).toBe(43);
    expect(new Set(ALPHABET).size).toBe(43);
  });

  it('QR alfanumerik alfabesinin alt kumesidir', () => {
    const qrAlnum = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    for (const ch of ALPHABET) expect(qrAlnum, `${ch} QR alfanumerik degil`).toContain(ch);
  });

  it('URL fragmentini bozacak karakterleri DISLAR', () => {
    // Bosluk URL'de kodlanmak zorunda; % yuzde-kodlamayi baslatir.
    expect(ALPHABET).not.toContain(' ');
    expect(ALPHABET).not.toContain('%');
  });

  it('decodeURIComponent alfabeyi degistirmez', () => {
    // Oynatici hash'e decodeURIComponent uyguluyor; yuk bundan sag cikmali.
    expect(decodeURIComponent(ALPHABET)).toBe(ALPHABET);
  });
});

describe('gidis donusu', () => {
  it('bos girdi', () => {
    expect(encodeBase43(new Uint8Array(0))).toBe('');
    expect(decodeBase43('')).toEqual(new Uint8Array(0));
  });

  it('tek bayt - tek sayili artik yolu', () => {
    for (const b of [0, 1, 42, 128, 255]) {
      const encoded = encodeBase43(new Uint8Array([b]));
      expect(encoded).toHaveLength(2);
      expect(decodeBase43(encoded)).toEqual(new Uint8Array([b]));
    }
  });

  it('16 bitlik degerler ikili olarak korunur', () => {
    for (let v = 0; v <= 0xffff; v += 97) {
      const bytes = new Uint8Array([v >> 8, v & 0xff]);
      expect(decodeBase43(encodeBase43(bytes))).toEqual(bytes);
    }
  });

  it('rastgele uzunluklarda birebir doner', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 0xff;
    for (const len of [1, 2, 3, 5, 16, 255, 1000, 2821, 2822]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = rnd();
      expect(decodeBase43(encodeBase43(bytes)), `uzunluk ${len}`).toEqual(bytes);
    }
  });
});

describe('uzunluk hesabi', () => {
  it('encodedLength gercek ciktiyla ayni', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 99, 100, 2822]) {
      expect(encodedLength(len)).toBe(encodeBase43(new Uint8Array(len)).length);
    }
  });

  it('decodedLength encodedLength ile tutarli', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 99, 2822]) {
      expect(decodedLength(encodedLength(len))).toBe(len);
    }
  });

  it('QR icinde base64url dan az yer kaplar', () => {
    // base43 daha COK karakter uretir ama QR onlari alfanumerik modda
    // 5.5 bit ile yazar; base64url ise bayt modunda 8 bit ile. Kazanc burada.
    const bytes = 1000;
    const base64urlChars = Math.ceil((bytes * 4) / 3);
    const base43Chars = encodedLength(bytes);
    expect(base43Chars).toBeGreaterThan(base64urlChars);
    expect(base43Chars * 5.5).toBeLessThan(base64urlChars * 8);
  });
});

describe('hatali girdi', () => {
  it('gecersiz karakter reddedilir', () => {
    expect(() => decodeBase43('AB!')).toThrow(Base43Error);
    expect(() => decodeBase43('ab0')).toThrow(Base43Error);
  });

  it('gecersiz uzunluk reddedilir', () => {
    expect(() => decodeBase43('A')).toThrow(Base43Error);
    expect(() => decodeBase43('ABCD')).toThrow(Base43Error);
  });

  it('16 biti asan uclu reddedilir', () => {
    // ':::' = 42 + 42*43 + 42*1849 = 79506 > 65535
    expect(() => decodeBase43(':::')).toThrow(Base43Error);
  });
});

describe('isBase43', () => {
  it('base43 dizesini tanir', () => {
    expect(isBase43(encodeBase43(new Uint8Array([1, 2, 3, 4])))).toBe(true);
  });

  it('base64url yukunu base43 SANMAZ', () => {
    // Eskiden basilmis QR'lar bu ayrimla calismaya devam ediyor.
    expect(isBase43('abc_def-ghi')).toBe(false);
  });

  it('bos dizeyi ve gecersiz uzunlugu reddeder', () => {
    expect(isBase43('')).toBe(false);
    expect(isBase43('A')).toBe(false);
  });
});
