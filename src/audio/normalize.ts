/**
 * Sesi kodlamadan once yukseltir.
 *
 * Neden gerekli: QR'a sigan butce ~2200 bayt. Kaynak kayit kisiksa (telefon
 * kayitlarinda tepe cogu zaman 0.15 civarinda kaliyor) sonuc telefon
 * hoparlorunde zor duyulur.
 *
 * Neden TEPEYE gore degil: konusma kayitlarinda tepe genelde tek bir ani
 * vurusa (kapi, nefes, "p" sesi) aittir. Tepeyi tam olcege cekmek o vurusu
 * patlatir, geri kalan her seyi kisik birakir - olculen bir ornekte 100 ms
 * icinde 0.04'ten 0.97'ye ziplayan bir ses cikmisti. Bu yuzden hedef ORTALAMA
 * gurluk (RMS); tepe yalnizca asilmamasi gereken bir tavan.
 *
 * Saf fonksiyon - tarayici API'si kullanmaz, birim testlerinde dogrudan kosar.
 */

export type BoostLevel = 'kapali' | 'hafif' | 'orta' | 'guclu';

export interface BoostTarget {
  /** Hedeflenen ortalama gurluk. */
  rms: number;
  /** Asilmayacak tepe degeri; ani vuruslarin tam olcege carpmasini onler. */
  peakCeiling: number;
}

/**
 * Tavanlar neden bu kadar dusuk: burada olculen tepe GIRDININ tepesi, ama
 * kullanicinin duydugu sey Opus'tan gecmis CIKIS. Cozucu dalgayi bir miktar
 * asirtiyor - besli bir ornek kumesinde olculen tasma ~1.25 kat oldu
 * (girdi tavani 0.95 -> cikista 1.00, yani kirpma). Bu yuzden her tavan,
 * cikisin ~0.9'u asmayacagi sekilde paylı secildi.
 *
 * Seviyeler kulakla secilecek diye kademeli; `orta` konusma icin rahat bir
 * dinleme seviyesi verir.
 */
export const BOOST_TARGETS: Record<Exclude<BoostLevel, 'kapali'>, BoostTarget> = {
  hafif: { rms: 0.06, peakCeiling: 0.55 },
  orta: { rms: 0.09, peakCeiling: 0.65 },
  guclu: { rms: 0.14, peakCeiling: 0.75 },
};

/**
 * Opus cozucusunun cikista dalgayi asirtma pay: olculen en kotu durum.
 * `BOOST_TARGETS` tavanlari bununla carpildiginda 1.0'i asmamali.
 */
export const DECODER_OVERSHOOT = 1.25;

export const BOOST_LABEL: Record<BoostLevel, string> = {
  kapali: 'Kapalı — kaydı olduğu gibi bırak',
  hafif: 'Hafif',
  orta: 'Orta (önerilen)',
  guclu: 'Güçlü — en gür, vuruşlar sertleşebilir',
};

/** Dizideki en buyuk mutlak deger. Bos dizide 0. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Karesel ortalamanin koku - algilanan gurlugun kaba olcusu. */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/**
 * Uygulanacak carpani hesaplar: RMS hedefine gore yukselt, ama tepe tavanini
 * asma. Ikisinin KUCUGU alinir.
 *
 * Sonuc asla 1'in altina inmez - sesi yalnizca yukseltiriz, kismayiz. Boylece
 * bilincli olarak gur kaydedilmis bir dosya bozulmaz.
 */
export function normalizationGain(samples: Float32Array, target: BoostTarget): number {
  const rms = rmsOf(samples);
  const peak = peakOf(samples);
  if (rms <= 0 || peak <= 0) return 1;

  return Math.max(1, Math.min(target.rms / rms, target.peakCeiling / peak));
}

/**
 * Yerinde yukseltir ve uygulanan carpani dondurur. Girdi dizisi degistirilir -
 * cagiran zaten taze bir kopyayla calisiyor (bkz. `extractMono`).
 */
export function normalizeInPlace(samples: Float32Array, level: BoostLevel): number {
  if (level === 'kapali') return 1;

  const gain = normalizationGain(samples, BOOST_TARGETS[level]);
  if (gain === 1) return 1;
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * gain;
  return gain;
}
