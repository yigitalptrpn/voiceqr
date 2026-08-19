/**
 * Paketlenmis yuk -> ham Opus paketleri -> PCM.
 *
 * Bu kod yabancilarin telefonlarinda calisiyor, bu yuzden iki yolu var:
 *
 *  1. WebCodecs `AudioDecoder` - yerlesik, hizli, ek indirme yok.
 *     (Chrome 94+, Safari 16.4+, Firefox 130+)
 *  2. `opus-decoder` (WASM) - yalnizca 1. yol yoksa TEMBEL yuklenir. Boylece
 *     destekleyen tarayicilar ~200 KB'lik indirmeyi hic yapmaz.
 *
 * Onemli: Opus dahili olarak her zaman 48 kHz'de calisir. Kodlamada 16 kHz
 * secilmis olsa bile cozucu 48 kHz cikis verir - dondurulen `sampleRate`
 * degeri bu yuzden yuktekiyle ayni olmak zorunda degil.
 */

import type { VoicePayload } from './container';
import { buildOpusHead, OPUS_DECODE_RATE, OPUS_PRE_SKIP } from './opusHead';

export interface DecodedAudio {
  /** Kanal basina PCM. Mono icin tek eleman. */
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  durationSeconds: number;
  /** Hangi yolun kullanildigi - tanilama ve testler icin. */
  via: 'webcodecs' | 'wasm';
}

export class DecodeError extends Error {}

export function hasWebCodecsDecoder(): boolean {
  return typeof AudioDecoder !== 'undefined' && typeof EncodedAudioChunk !== 'undefined';
}

function concat(parts: Float32Array[], total: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function decodeWithWebCodecs(payload: VoicePayload): Promise<DecodedAudio> {
  const { packets, channels: channelCount, frameDurationUs, sampleRate } = payload;

  const config: AudioDecoderConfig = {
    codec: 'opus',
    sampleRate,
    numberOfChannels: channelCount,
    description: buildOpusHead(channelCount, sampleRate),
  };

  const support = await AudioDecoder.isConfigSupported(config);
  if (!support.supported) throw new DecodeError('WebCodecs bu Opus ayarını desteklemiyor.');

  const planes: Float32Array[][] = Array.from({ length: channelCount }, () => []);
  let totalFrames = 0;
  let outRate = OPUS_DECODE_RATE;
  let decoderError: Error | null = null;

  const decoder = new AudioDecoder({
    output: (data) => {
      outRate = data.sampleRate;
      for (let c = 0; c < channelCount; c++) {
        const buf = new Float32Array(data.numberOfFrames);
        data.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
        planes[c]!.push(buf);
      }
      totalFrames += data.numberOfFrames;
      data.close();
    },
    error: (err) => {
      decoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    decoder.configure(config);
    for (let i = 0; i < packets.length; i++) {
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round(i * frameDurationUs),
          duration: frameDurationUs,
          data: packets[i]!,
        }),
      );
    }
    await decoder.flush();
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }

  if (decoderError) throw new DecodeError(`Ses çözülemedi: ${(decoderError as Error).message}`);
  if (totalFrames === 0) throw new DecodeError('Çözücü hiç ses üretmedi.');

  return {
    channels: planes.map((p) => concat(p, totalFrames)),
    sampleRate: outRate,
    durationSeconds: totalFrames / outRate,
    via: 'webcodecs',
  };
}

async function decodeWithWasm(payload: VoicePayload): Promise<DecodedAudio> {
  const { OpusDecoder } = await import('opus-decoder');
  const decoder = new OpusDecoder({ channels: payload.channels, preSkip: OPUS_PRE_SKIP });
  await decoder.ready;
  try {
    const result = decoder.decodeFrames(payload.packets.map((p) => new Uint8Array(p)));
    if (result.samplesDecoded === 0) throw new DecodeError('Çözücü hiç ses üretmedi.');
    return {
      channels: result.channelData as Float32Array<ArrayBuffer>[],
      sampleRate: result.sampleRate,
      durationSeconds: result.samplesDecoded / result.sampleRate,
      via: 'wasm',
    };
  } finally {
    decoder.free();
  }
}

export async function decodePayload(payload: VoicePayload): Promise<DecodedAudio> {
  if (hasWebCodecsDecoder()) {
    try {
      return await decodeWithWebCodecs(payload);
    } catch (err) {
      // Yerlesik cozucu takilirsa sessizce WASM'a dus - kullanicinin
      // "ses calmadi" ile karsilasmasindansa 200 KB indirmesi yegdir.
      console.warn('WebCodecs çözücüsü başarısız, WASM yedeğine geçiliyor:', err);
    }
  }
  try {
    return await decodeWithWasm(payload);
  } catch (err) {
    throw new DecodeError(
      `Ses çözülemedi: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
