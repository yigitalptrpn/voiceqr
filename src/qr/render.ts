/**
 * QR uretimi. `qrcode` kutuphanesini sarar ve UI'nin ihtiyac duydugu
 * olcum bilgilerini (surum, modul sayisi, doluluk) birlikte dondurur.
 */

import QRCode from 'qrcode';
import { QR_V40_BYTE_CAPACITY, recommendedPrintSizeMm, type EcLevel } from './capacity';

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
 * QR'i cizmeden yalnizca olcer. Uretici, sonuc panelini (ve dolayisiyla
 * tuvali) ancak olcum elde edildikten sonra DOM'a koydugu icin bu ikisinin
 * ayri olmasi gerekiyor.
 */
export function measureQr(text: string, ec: EcLevel): QrRenderResult {
  try {
    return measure(text, ec);
  } catch (err) {
    throw wrapError(err, text, ec);
  }
}

function measure(text: string, ec: EcLevel): QrRenderResult {
  const qr = QRCode.create(text, { errorCorrectionLevel: ec });
  const version = qr.version;
  return {
    version,
    modules: 17 + 4 * version,
    fillRatio: text.length / QR_V40_BYTE_CAPACITY[ec],
    recommendedPrintMm: recommendedPrintSizeMm(17 + 4 * version),
  };
}

function wrapError(err: unknown, text: string, ec: EcLevel): QrRenderError {
  const message = err instanceof Error ? err.message : String(err);
  if (/too (big|long)|code length overflow/i.test(message)) {
    return new QrRenderError(
      `Veri QR koda sığmadı (${text.length} bayt, ${ec} seviyesinde azami ${QR_V40_BYTE_CAPACITY[ec]} bayt). ` +
        'Sesi kısaltın, bit hızını düşürün veya hata düzeltme seviyesini L yapın.',
    );
  }
  return new QrRenderError(`QR oluşturulamadı: ${message}`);
}

export async function renderToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  ec: EcLevel,
): Promise<QrRenderResult> {
  try {
    const info = measure(text, ec);
    await QRCode.toCanvas(canvas, text, {
      errorCorrectionLevel: ec,
      margin: 4,
      scale: 4,
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
    return info;
  } catch (err) {
    throw wrapError(err, text, ec);
  }
}

/** Yuksek cozunurluklu PNG - basim icin. */
export async function toPngBlob(text: string, ec: EcLevel, pixelsPerModule = 12): Promise<Blob> {
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      errorCorrectionLevel: ec,
      margin: 4,
      scale: pixelsPerModule,
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
    const response = await fetch(dataUrl);
    return await response.blob();
  } catch (err) {
    throw wrapError(err, text, ec);
  }
}

/** Olcekten bagimsiz SVG - buyuk basim icin en iyisi. */
export async function toSvgString(text: string, ec: EcLevel): Promise<string> {
  try {
    return await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: ec, margin: 4 });
  } catch (err) {
    throw wrapError(err, text, ec);
  }
}
