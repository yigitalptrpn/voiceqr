/**
 * QR uretimi. `qrcode` kutuphanesini sarar ve UI'nin ihtiyac duydugu
 * olcum bilgilerini (surum, modul sayisi, doluluk) birlikte dondurur.
 *
 * URL tek parca bir metin olarak degil, IKI SEGMENT olarak veriliyor:
 * onek bayt modunda, ses yuku alfanumerik modda. Alfanumerik mod iki
 * karakteri 11 bite paketledigi icin ayni QR'a ~%29 daha fazla ses siginiyor
 * (bkz. `src/codec/base43.ts`). Onek bayt modunda kalmak zorunda: `#` ve
 * kucuk harfli yol alfanumerik alfabede yok.
 */

import QRCode, { type QRCodeSegment } from 'qrcode';
import { isBase43 } from '../codec/base43';
import { maxAlphanumericChars, recommendedPrintSizeMm, type EcLevel } from './capacity';

export interface QrRenderResult {
  /** QR surumu (1-40). Yogunlugun gostergesi. */
  version: number;
  /** Kenardaki modul sayisi. */
  modules: number;
  /** Bu EC seviyesindeki azami kapasiteye gore doluluk orani (0-1). */
  fillRatio: number;
  /** Guvenilir okuma icin onerilen asgari basim kenar uzunlugu (mm). */
  recommendedPrintMm: number;
}

export class QrRenderError extends Error {}

/**
 * QR'a yazilacak adres. Ayri tutuluyor cunku iki parca farkli QR modunda
 * kodlaniyor - birlestirilmis metin kutuphaneye verilirse tamami bayt moduna
 * duser ve kapasite kazanci kaybolur.
 */
export interface QrUrl {
  /** Sabit on ek, `#` dahil. Bayt modunda kodlanir. */
  prefix: string;
  /** base43 ses yuku. Alfanumerik modda kodlanir. */
  payload: string;
}

export function urlText({ prefix, payload }: QrUrl): string {
  return prefix + payload;
}

/**
 * Yuk alfanumerik alfabedeyse iki segment, degilse tek bayt segmenti uretir.
 *
 * Tek segmente dusme yolu eski base64url yuklerini elle uretmek isteyen
 * cagiranlar icin duruyor; uretici artik her zaman base43 kullaniyor.
 */
function segmentsFor({ prefix, payload }: QrUrl): QRCodeSegment[] {
  // Bayt modu segmenti bayt bekliyor; onek tamamen ASCII oldugu icin
  // UTF-8 kodlamasi birebir ayni uzunlukta cikiyor.
  const asBytes = (text: string) => new TextEncoder().encode(text);

  if (payload.length > 0 && isBase43(payload)) {
    return [
      { data: asBytes(prefix), mode: 'byte' },
      { data: payload, mode: 'alphanumeric' },
    ];
  }
  return [{ data: asBytes(prefix + payload), mode: 'byte' }];
}

function measure(url: QrUrl, ec: EcLevel): QrRenderResult {
  const qr = QRCode.create(segmentsFor(url), { errorCorrectionLevel: ec });
  const version = qr.version;
  const capacity = maxAlphanumericChars(url.prefix.length, ec);

  return {
    version,
    modules: 17 + 4 * version,
    fillRatio: capacity > 0 ? url.payload.length / capacity : 1,
    recommendedPrintMm: recommendedPrintSizeMm(17 + 4 * version),
  };
}

function wrapError(err: unknown, url: QrUrl, ec: EcLevel): QrRenderError {
  const message = err instanceof Error ? err.message : String(err);
  if (/too (big|long)|code length overflow/i.test(message)) {
    const capacity = maxAlphanumericChars(url.prefix.length, ec);
    return new QrRenderError(
      `Veri QR koda sığmadı (${url.payload.length} karakter, ${ec} seviyesinde azami ${capacity}). ` +
        'Sesi kısaltın, bit hızını düşürün veya hata düzeltme seviyesini L yapın.',
    );
  }
  return new QrRenderError(`QR oluşturulamadı: ${message}`);
}

/**
 * QR'i cizmeden yalnizca olcer. Uretici, sonuc panelini (ve dolayisiyla
 * tuvali) ancak olcum elde edildikten sonra DOM'a koydugu icin bu ikisinin
 * ayri olmasi gerekiyor.
 */
export function measureQr(url: QrUrl, ec: EcLevel): QrRenderResult {
  try {
    return measure(url, ec);
  } catch (err) {
    throw wrapError(err, url, ec);
  }
}

export async function renderToCanvas(
  canvas: HTMLCanvasElement,
  url: QrUrl,
  ec: EcLevel,
): Promise<QrRenderResult> {
  try {
    const info = measure(url, ec);
    await QRCode.toCanvas(canvas, segmentsFor(url), {
      errorCorrectionLevel: ec,
      margin: 4,
      scale: 4,
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
    return info;
  } catch (err) {
    throw wrapError(err, url, ec);
  }
}

/** Yuksek cozunurluklu PNG - basim icin. */
export async function toPngBlob(url: QrUrl, ec: EcLevel, pixelsPerModule = 12): Promise<Blob> {
  try {
    const dataUrl = await QRCode.toDataURL(segmentsFor(url), {
      errorCorrectionLevel: ec,
      margin: 4,
      scale: pixelsPerModule,
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
    const response = await fetch(dataUrl);
    return await response.blob();
  } catch (err) {
    throw wrapError(err, url, ec);
  }
}

/** Olcekten bagimsiz SVG - buyuk basim icin en iyisi. */
export async function toSvgString(url: QrUrl, ec: EcLevel): Promise<string> {
  try {
    return await QRCode.toString(segmentsFor(url), {
      type: 'svg',
      errorCorrectionLevel: ec,
      margin: 4,
    });
  } catch (err) {
    throw wrapError(err, url, ec);
  }
}
