/**
 * Sessizlik kirpma: sesin gercekten NEREDE oldugunu bulur.
 *
 * Neden onemli: QR'a sigan butce ~2800 bayt. Telefon kayitlarinin basinda
 * cogu zaman kayit dugmesine basmayla konusmanin baslamasi arasinda bir
 * sessizlik oluyor - olculen bir ornekte 2.87 saniyelik kaydin ilk 0.9
 * saniyesi bostu, yani butcenin %31'i hiclik kodlamaya gidiyordu.
 *
 * Yontem: kisa pencerelerin RMS'i alinir, en gur pencereye GORE bir esik
 * belirlenir (mutlak degil - kayit kisik olabilir), esigi asan ilk ve son
 * pencere bulunur, iki yana biraz pay birakilir.
 *
 * Saf modul - tarayici API'si kullanmaz, birim testlerinde dogrudan kosar.
 */

export interface TrimOptions {
  /** Analiz penceresi. 20 ms konusma hecelerini kacirmayacak kadar kisa. */
  windowMs?: number;
  /**
   * En gur pencerenin kac dB altina kadar "ses var" sayilacagi.
   * -30 dB, nefes ve oda gurultusunu disarida birakip heceleri tutuyor.
   */
  thresholdDb?: number;
  /** Mutlak taban: bunun altindaki her sey sessizlik sayilir. */
  floor?: number;
  /** Bulunan sinirlarin iki yanina birakilan pay - kelime baslari kesilmesin. */
  padMs?: number;
}

export interface TrimBounds {
  startSeconds: number;
  endSeconds: number;
}

const DEFAULTS: Required<TrimOptions> = {
  windowMs: 20,
  thresholdDb: -30,
  floor: 0.0005,
  padMs: 60,
};

/**
 * Sesin dolu oldugu araligi dondurur.
 *
 * Hicbir pencere esigi asmiyorsa (tamamen sessiz kayit) tum aralik dondurulur:
 * kullanicinin elindekini kirpip yok etmektense oldugu gibi birakmak dogru.
 */
export function findSpeechBounds(
  samples: Float32Array,
  sampleRate: number,
  options: TrimOptions = {},
): TrimBounds {
  const { windowMs, thresholdDb, floor, padMs } = { ...DEFAULTS, ...options };
  const total = samples.length / sampleRate;
  if (samples.length === 0 || sampleRate <= 0) return { startSeconds: 0, endSeconds: 0 };

  const windowSize = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const windowCount = Math.ceil(samples.length / windowSize);

  const energies = new Float32Array(windowCount);
  let loudest = 0;
  for (let w = 0; w < windowCount; w++) {
    const from = w * windowSize;
    const to = Math.min(samples.length, from + windowSize);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / (to - from));
    energies[w] = rms;
    if (rms > loudest) loudest = rms;
  }

  const threshold = Math.max(loudest * Math.pow(10, thresholdDb / 20), floor);

  let first = -1;
  let last = -1;
  for (let w = 0; w < windowCount; w++) {
    if (energies[w]! >= threshold) {
      if (first < 0) first = w;
      last = w;
    }
  }

  // Tamamen sessiz: dokunma.
  if (first < 0) return { startSeconds: 0, endSeconds: total };

  const pad = padMs / 1000;
  return {
    startSeconds: Math.max(0, (first * windowSize) / sampleRate - pad),
    endSeconds: Math.min(total, ((last + 1) * windowSize) / sampleRate + pad),
  };
}

/**
 * Var olan bir secimin KENARLARINDAKI sessizligi kirpar.
 *
 * Kullanicinin elle sectigi aralik korunur - sinirlarin disina tasilmaz,
 * yalnizca iceri dogru daraltilir. Kullanici bir yeri bilerek sectiginde
 * arac onu baska bir yere kaydirmamali.
 */
export function trimSelection(
  samples: Float32Array,
  sampleRate: number,
  selection: TrimBounds,
  options: TrimOptions = {},
): TrimBounds {
  const total = samples.length / sampleRate;
  const start = Math.max(0, Math.min(selection.startSeconds, total));
  const end = Math.max(start, Math.min(selection.endSeconds, total));

  const from = Math.floor(start * sampleRate);
  const to = Math.min(samples.length, Math.ceil(end * sampleRate));
  if (to <= from) return { startSeconds: start, endSeconds: end };

  const inner = findSpeechBounds(samples.subarray(from, to), sampleRate, options);
  return {
    startSeconds: start + inner.startSeconds,
    endSeconds: Math.min(end, start + inner.endSeconds),
  };
}
