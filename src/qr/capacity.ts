/**
 * QR kapasite matematigi. Tamamen saf - tarayici API'si kullanmaz, boylece
 * birim testlerinde dogrudan calisir.
 *
 * Rakamlar QR spesifikasyonundan (surum 40, byte modu) gelir ve
 * `tests/unit/capacity.test.ts` icinde gercek `qrcode` kutuphanesine karsi
 * dogrulanir.
 */

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

/** QR surum 40, byte modu, hata duzeltme seviyesine gore azami bayt. */
export const QR_V40_BYTE_CAPACITY: Record<EcLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
};

/** Surum 40 QR'in kenar uzunlugu (modul sayisi): 17 + 4 * 40. */
export const QR_V40_MODULES = 177;

export const EC_LABEL: Record<EcLevel, string> = {
  L: 'L — Düşük (%7) — en uzun ses',
  M: 'M — Orta (%15)',
  Q: 'Q — Yüksek (%25)',
  H: 'H — En yüksek (%30) — en dayanıklı',
};

/**
 * base64url kodlamasinda `n` bayt kac karakter tutar (dolgu `=` atilmis halde).
 * 3 bayt -> 4 karakter; artan 1 bayt -> 2 karakter, 2 bayt -> 3 karakter.
 */
export function base64urlLength(byteCount: number): number {
  return Math.ceil((byteCount * 4) / 3);
}

/** `chars` karakterlik bir base64url dizesinin cozuldugunde verecegi bayt sayisi. */
export function bytesFromBase64urlLength(chars: number): number {
  return Math.floor((chars * 3) / 4);
}

/**
 * Verilen URL onu ve EC seviyesi icin QR'a sigacak AZAMI HAM BAYT sayisi.
 * URL onunun her karakteri 1 bayt yer (hepsi ASCII).
 */
export function maxPayloadBytes(urlPrefixLength: number, ec: EcLevel): number {
  const chars = QR_V40_BYTE_CAPACITY[ec] - urlPrefixLength;
  if (chars <= 0) return 0;
  return bytesFromBase64urlLength(chars);
}

/**
 * Basim boyutu onerisi. Yogun bir v40 QR'da her modulun en az ~0.4 mm olmasi
 * gerekir ki siradan bir telefon kamerasi cozebilsin.
 */
export function recommendedPrintSizeMm(modules: number = QR_V40_MODULES): number {
  const MIN_MODULE_MM = 0.4;
  const QUIET_ZONE_MODULES = 8; // her iki yanda 4'er modul
  return Math.ceil((modules + QUIET_ZONE_MODULES) * MIN_MODULE_MM);
}
