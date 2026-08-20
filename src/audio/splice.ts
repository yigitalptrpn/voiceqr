/**
 * Iki ses parcasini uc uca ekler.
 *
 * Neden ayri bir modul: ortadan bir bolum atildiginda kalan iki parca
 * birlestiriliyor. Bunu duz duz yapistirmak DUYULUR bir tik sesi cikarir -
 * birinci parcanin son ornegi ile ikincinin ilk ornegi arasinda ani bir
 * siçrama olur ve kulak bunu darbe olarak duyar. Cozum, ek yerinde kisa bir
 * capraz gecis: birinci parca sonerken ikincisi aciliyor.
 *
 * Gecis suresi kasten kisa (varsayilan 8 ms). Daha uzunu heceleri birbirine
 * karistirir; daha kisasi tiki tam bastiramaz.
 *
 * Saf modul - tarayici API'si kullanmaz, birim testlerinde dogrudan kosar.
 */

export const DEFAULT_CROSSFADE_MS = 8;

/**
 * `a` ve `b`'yi birlestirir, ek yerinde capraz gecis uygular.
 *
 * Gecis, iki parcanin KISASINDAN uzun olamaz - aksi halde bir parca tamamen
 * gecise gomulur. Parcalardan biri bossa digeri oldugu gibi doner.
 */
export function concatWithCrossfade(
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
  fadeMs = DEFAULT_CROSSFADE_MS,
): Float32Array<ArrayBuffer> {
  if (a.length === 0) return copyOf(b);
  if (b.length === 0) return copyOf(a);

  const fade = Math.min(
    Math.max(0, Math.round((fadeMs / 1000) * sampleRate)),
    a.length,
    b.length,
  );

  // Gecis bolgesi ortak kullanildigi icin toplam uzunluk `fade` kadar kisalir.
  const out = new Float32Array(a.length + b.length - fade);
  out.set(a.subarray(0, a.length - fade), 0);

  const joint = a.length - fade;
  for (let i = 0; i < fade; i++) {
    // Esit guclu gecis: iki parca da yarim yolda -3 dB'de bulusur, boylece
    // birlesme noktasinda ses seviyesi cokmez.
    const t = (i + 0.5) / fade;
    const gainOut = Math.cos((t * Math.PI) / 2);
    const gainIn = Math.sin((t * Math.PI) / 2);
    out[joint + i] = a[a.length - fade + i]! * gainOut + b[i]! * gainIn;
  }

  out.set(b.subarray(fade), joint + fade);
  return out;
}

function copyOf(source: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(source.length);
  out.set(source);
  return out;
}
