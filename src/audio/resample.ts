/**
 * Sesi Opus'a verilmeden once mono'ya indirger ve hedef ornekleme hizina
 * cevirir. `OfflineAudioContext` kullanildigi icin yeniden ornekleme
 * tarayicinin kendi (kaliteli) filtresiyle yapilir.
 */

export interface ExtractOptions {
  /** Kaynaktaki baslangic saniyesi. */
  startSeconds: number;
  /** Cikarilacak sure (saniye). */
  durationSeconds: number;
  targetSampleRate: number;
}

/**
 * Secilen araligi mono, `targetSampleRate` hizinda PCM olarak dondurur.
 *
 * `Float32Array<ArrayBuffer>` dondurur cunku `AudioData` paylasimli bellek
 * kabul etmiyor (bkz. `src/codec/encode.ts`).
 */
export async function extractMono(
  source: AudioBuffer,
  { startSeconds, durationSeconds, targetSampleRate }: ExtractOptions,
): Promise<Float32Array<ArrayBuffer>> {
  const start = Math.max(0, Math.min(startSeconds, source.duration));
  const duration = Math.max(0, Math.min(durationSeconds, source.duration - start));
  const frames = Math.round(duration * targetSampleRate);
  if (frames <= 0) return new Float32Array(0);

  const offline = new OfflineAudioContext(1, frames, targetSampleRate);

  const node = offline.createBufferSource();
  node.buffer = source;

  // Cok kanalliyi mono'ya indirmek: kanallari toplayip kanal sayisina bolmek.
  // ChannelMergerNode yerine dogrudan gain ile karistiriyoruz ki tarayicinin
  // varsayilan "downmix" kurallarina takilmayalim.
  const merger = offline.createGain();
  merger.channelCount = 1;
  merger.channelCountMode = 'explicit';
  merger.channelInterpretation = 'speakers';

  node.connect(merger);
  merger.connect(offline.destination);
  node.start(0, start, duration);

  const rendered = await offline.startRendering();

  // getChannelData'nin dondurdugu dizi AudioBuffer'a bagli; kopyalayarak
  // bagimsiz ve `ArrayBuffer` destekli bir dizi uretiyoruz.
  const out = new Float32Array(rendered.length);
  out.set(rendered.getChannelData(0));
  return out;
}

/** Cozulmus PCM'i calinabilir bir `AudioBuffer`a sarar. */
export function toAudioBuffer(
  ctx: BaseAudioContext,
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number,
): AudioBuffer {
  const frames = channels[0]?.length ?? 0;
  const buffer = ctx.createBuffer(channels.length, Math.max(1, frames), sampleRate);
  channels.forEach((data, i) => buffer.copyToChannel(data, i));
  return buffer;
}
