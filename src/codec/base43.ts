/**
 * base43 - QR'in ALFANUMERIK modunda tasinabilen ikili kodlama.
 *
 * Neden var: QR'in bayt modu her karakteri 8 bit yazar, alfanumerik modu ise
 * iki karakteri 11 bite paketler (5.5 bit/karakter). base64url kucuk harf
 * icerdigi icin QR'i bayt moduna dusuruyor, yani karakter basina 6 bit tasiyip
 * 8 bit yer harciyorduk - dortte biri israf. Alfanumerik alfabede kalirsak
 * ayni QR'a ~%29 daha fazla ses sigiyor.
 *
 * QR'in alfanumerik alfabesi 45 karakter: 0-9 A-Z bosluk $ % * + - . / :
 * Bunlardan BOSLUK ve % disarida birakildi - bosluk URL'de kodlanmak zorunda,
 * % ise yuzde-kodlamayi baslatir ve oynaticinin `decodeURIComponent` cagrisi
 * yuku bozardi. Geriye 43 karakter kaliyor; hepsi RFC 3986'ya gore fragmentte
 * serbest.
 *
 * Paketleme base45'in (RFC 9285) yontemi: 2 bayt -> 3 karakter (43^3 = 79507,
 * 65536'yi kapsar), artan tek bayt -> 2 karakter (43^2 = 1849, 256'yi kapsar).
 *
 * Saf modul - tarayici API'si kullanmaz, birim testlerinde dogrudan kosar.
 */

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
export const BASE = ALPHABET.length; // 43

/** Cozme icin ters tablo; ALPHABET'te olmayan her kod -1. */
const VALUE_OF: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export class Base43Error extends Error {}

/** `byteCount` baytin kodlandiginda kac karakter tutacagi. */
export function encodedLength(byteCount: number): number {
  return Math.floor(byteCount / 2) * 3 + (byteCount % 2 === 1 ? 2 : 0);
}

/** `charCount` karakterlik bir base43 dizesinin cozuldugunde verecegi bayt sayisi. */
export function decodedLength(charCount: number): number {
  return Math.floor(charCount / 3) * 2 + (charCount % 3 === 2 ? 1 : 0);
}

export function encodeBase43(bytes: Uint8Array): string {
  let out = '';
  let i = 0;

  for (; i + 1 < bytes.length; i += 2) {
    let value = bytes[i]! * 256 + bytes[i + 1]!;
    // Dusuk basamak once - RFC 9285 ile ayni sira.
    out += ALPHABET[value % BASE];
    value = Math.floor(value / BASE);
    out += ALPHABET[value % BASE];
    out += ALPHABET[Math.floor(value / BASE)];
  }

  if (i < bytes.length) {
    const value = bytes[i]!;
    out += ALPHABET[value % BASE];
    out += ALPHABET[Math.floor(value / BASE)];
  }
  return out;
}

export function decodeBase43(text: string): Uint8Array {
  if (text.length % 3 === 1) {
    throw new Base43Error(`Geçersiz uzunluk: ${text.length}`);
  }

  const out = new Uint8Array(decodedLength(text.length));
  let o = 0;
  let i = 0;

  const digit = (at: number): number => {
    const code = text.charCodeAt(at);
    const value = code < 128 ? VALUE_OF[code]! : -1;
    if (value < 0) throw new Base43Error(`Geçersiz karakter: ${JSON.stringify(text[at])}`);
    return value;
  };

  for (; i + 2 < text.length; i += 3) {
    const value = digit(i) + digit(i + 1) * BASE + digit(i + 2) * BASE * BASE;
    if (value > 0xffff) throw new Base43Error('Bozuk üçlü: değer 16 bite sığmıyor');
    out[o++] = value >> 8;
    out[o++] = value & 0xff;
  }

  if (i < text.length) {
    const value = digit(i) + digit(i + 1) * BASE;
    if (value > 0xff) throw new Base43Error('Bozuk ikili: değer 8 bite sığmıyor');
    out[o++] = value;
  }
  return out;
}

/**
 * Metnin tamami base43 alfabesinde mi?
 *
 * Oynatici hangi bicimle karsilastigini bununla ayirir: base64url kucuk harf,
 * `_` ve `-` icerir; base43 yalnizca buyuk harf ve rakam kullanir. Boylece
 * eskiden basilmis base64url QR'lar calismaya devam eder.
 */
export function isBase43(text: string): boolean {
  if (text.length === 0 || text.length % 3 === 1) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 128 || VALUE_OF[code]! < 0) return false;
  }
  return true;
}
