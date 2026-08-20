/**
 * Dalga formu cizimi. Kutuphane yerine dogrudan canvas kullaniliyor -
 * ihtiyac duyulan tek sey kanal verisinin min/max zarfini cizmek.
 */

export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
}

/**
 * Sesi `buckets` adet sutuna indirger. Bu is dosya yuklendiginde BIR KEZ
 * yapilir; secim surukleneride her karede yeniden hesaplanmaz.
 */
export function computePeaks(buffer: AudioBuffer, buckets: number): WaveformPeaks {
  const data = buffer.getChannelData(0);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const per = data.length / buckets;

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(data.length, Math.floor((b + 1) * per));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = data[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

export interface DrawOptions {
  peaks: WaveformPeaks;
  /** Secilen aralik, 0..1 orani olarak. */
  selection: { start: number; end: number };
  /** Secimin icinden ATILAN aralik; yoksa `null`. */
  cut?: { start: number; end: number } | null;
  waveColor: string;
  selectedWaveColor: string;
  selectionFill: string;
  /** Atilan bolumun dalga rengi - secilinin aksine soluk. */
  cutWaveColor?: string;
  cutFill?: string;
}

export function drawWaveform(canvas: HTMLCanvasElement, options: DrawOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (cssWidth === 0 || cssHeight === 0) return;

  if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const { peaks, selection } = options;
  const buckets = peaks.min.length;
  const mid = cssHeight / 2;
  const scale = cssHeight / 2 - 2;

  const selStartPx = selection.start * cssWidth;
  const selEndPx = selection.end * cssWidth;

  ctx.fillStyle = options.selectionFill;
  ctx.fillRect(selStartPx, 0, selEndPx - selStartPx, cssHeight);

  const cut = options.cut ?? null;
  const cutStartPx = cut ? cut.start * cssWidth : 0;
  const cutEndPx = cut ? cut.end * cssWidth : 0;
  if (cut && options.cutFill) {
    ctx.fillStyle = options.cutFill;
    ctx.fillRect(cutStartPx, 0, cutEndPx - cutStartPx, cssHeight);
  }

  const barWidth = cssWidth / buckets;
  for (let b = 0; b < buckets; b++) {
    const x = b * barWidth;
    const barCenter = x + barWidth / 2;
    const inSelection = barCenter >= selStartPx && barCenter <= selEndPx;
    const inCut = cut !== null && barCenter >= cutStartPx && barCenter <= cutEndPx;
    ctx.fillStyle = inCut
      ? (options.cutWaveColor ?? options.waveColor)
      : inSelection
        ? options.selectedWaveColor
        : options.waveColor;
    const top = mid - peaks.max[b]! * scale;
    const bottom = mid - peaks.min[b]! * scale;
    ctx.fillRect(x, top, Math.max(barWidth - 0.5, 0.5), Math.max(bottom - top, 1));
  }
}
