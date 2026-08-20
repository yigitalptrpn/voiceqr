/**
 * Adresin `#` sonrasi: ikili yuk <-> metin.
 *
 * IKI bicim destekleniyor:
 *
 *  - **base43** (guncel): QR'in alfanumerik modunda tasinir, ~%29 daha fazla
 *    ses sigar. Uretici artik yalnizca bunu uretiyor.
 *  - **base64url** (eski): ilk surumun bicimi. Cozme yolu KALICI olarak
 *    duruyor - o bicimle basilmis bir QR duvarda asili olabilir ve calismaya
 *    devam etmeli. Burasi asla kaldirilmamali.
 *
 * Ayrim alfabeden yapiliyor: base43 yalnizca buyuk harf, rakam ve
 * `$*+-./:` kullanir; base64url ise kucuk harf, `_` ve `-` icerir. Kucuk harf
 * ya da `_` goren her yuk kesinlikle base64url'dir.
 *
 * Saf modul - tarayici API'si kullanmaz.
 */

import { decodeBase43, encodeBase43, isBase43 } from './base43';
import { decodeBase64url } from './base64url';

export type FragmentFormat = 'base43' | 'base64url';

/** Uretici bu bicimi kullanir; QR kapasitesini en verimli kullanan bicim. */
export function encodeFragment(bytes: Uint8Array): string {
  return encodeBase43(bytes);
}

/** Bir yukun hangi bicimde oldugunu soyler. */
export function detectFormat(fragment: string): FragmentFormat {
  return isBase43(fragment) ? 'base43' : 'base64url';
}

/**
 * Hangi bicim olursa olsun cozer.
 *
 * Hata mesajlari `src/player.ts` icindeki `friendlyError` tarafindan
 * kullaniciya cevriliyor; oradaki kaliplarla uyumlu kalmali.
 */
export function decodeFragment(fragment: string): Uint8Array {
  return detectFormat(fragment) === 'base43'
    ? decodeBase43(fragment)
    : decodeBase64url(fragment);
}
