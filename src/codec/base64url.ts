/**
 * base64url (RFC 4648 §5) - dolgu `=` karakteri olmadan.
 *
 * Neden base64url: yuk, URL'in `#` fragment kisminda tasiniyor. Standart
 * base64'un `+` ve `/` karakterleri URL'de yeniden yorumlanabilir; `=` dolgusu
 * ise bosuna yer kaplar. QR'in "alphanumeric" modu daha verimli olurdu ama o
 * mod kucuk harf ve `#` icermedigi icin URL'li bir yukte kullanilamiyor.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP = /*@__PURE__*/ (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function encodeBase64url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >>> 18) & 63]! + ALPHABET[(n >>> 12) & 63]! + ALPHABET[(n >>> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >>> 18) & 63]! + ALPHABET[(n >>> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >>> 18) & 63]! + ALPHABET[(n >>> 12) & 63]! + ALPHABET[(n >>> 6) & 63]!;
  }
  return out;
}

export class Base64urlError extends Error {}

export function decodeBase64url(text: string): Uint8Array {
  // Bazi kamera uygulamalari URL'i cozerken sona bosluk/yeni satir ekleyebiliyor.
  const s = text.trim();
  if (s.length % 4 === 1) {
    throw new Base64urlError('Kodlanmış veri eksik veya bozuk (geçersiz uzunluk).');
  }

  const outLen = Math.floor((s.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let acc = 0;
  let bits = 0;

  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code]! : -1;
    if (v < 0) {
      throw new Base64urlError(`Kodlanmış veride geçersiz karakter: "${s[i]}"`);
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}
