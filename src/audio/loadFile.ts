/**
 * Kullanicinin sectigi dosyayi cozulmus sese cevirir.
 * `decodeAudioData` tarayicinin desteklediği her bicimi kabul eder
 * (mp3, m4a, wav, ogg, flac...), yani ayrica bir cozucuye gerek yok.
 */

export class AudioLoadError extends Error {}

/** Uygulama boyunca tek bir AudioContext yeniden kullanilir. */
let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext();
  return sharedContext;
}

/** iOS ve Chrome, kullanici etkilesimi olmadan sesi askiya alir. */
export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
}

export async function loadAudioFile(file: File): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) throw new AudioLoadError('Dosya boş.');

  try {
    return await getAudioContext().decodeAudioData(bytes);
  } catch {
    throw new AudioLoadError(
      `"${file.name}" çözülemedi. Desteklenen bir ses dosyası seçin (mp3, m4a, wav, ogg...).`,
    );
  }
}
