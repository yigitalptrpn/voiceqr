import { describe, expect, it } from 'vitest';
import { encodeBase43 } from '../../src/codec/base43';
import { encodeBase64url } from '../../src/codec/base64url';
import { decodeFragment, detectFormat, encodeFragment } from '../../src/codec/fragment';

function ornekBaytlar(len: number): Uint8Array {
  let seed = 987;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed >> 8) & 0xff;
  }
  return out;
}

describe('bicim secimi', () => {
  it('uretici base43 uretir', () => {
    const bytes = ornekBaytlar(60);
    expect(encodeFragment(bytes)).toBe(encodeBase43(bytes));
    expect(detectFormat(encodeFragment(bytes))).toBe('base43');
  });

  it('base64url yuku base64url olarak taninir', () => {
    // Kucuk harf ya da `_` iceren her yuk eski bicimdir.
    expect(detectFormat('abc_def')).toBe('base64url');
    expect(detectFormat('aGVsbG8')).toBe('base64url');
  });
});

describe('gidis donusu', () => {
  it('base43 yuku birebir cozulur', () => {
    for (const len of [1, 2, 3, 47, 500, 2822]) {
      const bytes = ornekBaytlar(len);
      expect(decodeFragment(encodeFragment(bytes)), `uzunluk ${len}`).toEqual(bytes);
    }
  });

  /**
   * Bu testin varlik sebebi: eski bicimle basilmis bir QR duvarda asili
   * olabilir. base64url cozme yolu kaldirilirsa o kodlar oler.
   */
  it('ESKI base64url yuku hala cozulur', () => {
    for (const len of [1, 2, 3, 47, 500, 2184]) {
      const bytes = ornekBaytlar(len);
      expect(decodeFragment(encodeBase64url(bytes)), `uzunluk ${len}`).toEqual(bytes);
    }
  });

  it('iki bicim ayni baytlar icin ayni sonucu verir', () => {
    const bytes = ornekBaytlar(300);
    expect(decodeFragment(encodeBase43(bytes))).toEqual(decodeFragment(encodeBase64url(bytes)));
  });
});

describe('bozuk yuk', () => {
  it('anlamsiz metin hata firlatir', () => {
    // Alfabede olmayan karakter iceriyor - iki bicim de kabul etmemeli.
    expect(() => decodeFragment('!!!!')).toThrow();
  });

  it('kirpilmis base43 yuku hata firlatir', () => {
    const tam = encodeFragment(ornekBaytlar(60));
    // Uzunlugu 3'e bolundugunde 1 kalan bir kirpma gecersiz.
    expect(() => decodeFragment(tam.slice(0, 40))).toThrow();
  });
});
