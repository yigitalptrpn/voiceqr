/**
 * Mono PCM -> ham Opus paketleri -> paketlenmis yuk.
 *
 * Tarayicinin yerlesik WebCodecs `AudioEncoder`'ini kullanir; harici kodek
 * kutuphanesi gerekmez. Uretici ekrani yalnizca kullanicinin kendi
 * makinesinde calistigi icin burada WASM yedegi tutmuyoruz - destek yoksa
 * anlasilir bir hata veriyoruz.
 */

import {
  HEADER_BYTES,
  pack,
  packedSize,
  type FrameDurationUs,
  type SampleRate,
  type VoicePayload,
} from './container';

/**
 * Kodlayicinin gecikme telafisi icin ekledigi fazladan paket sayisi.
 * `estimateSeconds` bunu butceden pesinen duser.
 */
const ENCODER_PADDING_PACKETS = 1;

/**
 * Opus'un neyi kodladigini bilmesi kaliteyi belirgin degistirir - ozellikle
 * 6 kbps gibi asiri dusuk hizlarda.
 *
 * `konusma`: SILK konusma katmanini zorlar. Insan sesi cok daha anlasilir
 *   cikar; muzikte ise bogurtu yapar.
 * `muzik`: genel amacli mod. Tarayicinin varsayilani buydu.
 */
export type ContentKind = 'konusma' | 'muzik';

export interface EncodeOptions {
  /** Hedef bit hizi (bit/saniye). 6000 en uzun sesi, 24000 en temiz sesi verir. */
  bitrate: number;
  /** Kodlayiciya ne kodladigini soyler. Bkz. `ContentKind`. */
  content: ContentKind;
  frameDurationUs: FrameDurationUs;
  sampleRate: SampleRate;
  /** QR'a sigacak azami paketlenmis boyut. Asilirsa sondaki paketler atilir. */
  maxBytes: number;
}

export interface EncodeResult {
  payload: VoicePayload;
  /** Paketlenmis, base64url'e hazir baytlar. */
  bytes: Uint8Array;
  /** Yuke gercekten giren ses suresi (saniye). */
  encodedSeconds: number;
  /** Butceye sigmadigi icin ses kirpildi mi? */
  truncated: boolean;
}

export class EncodeError extends Error {}

export function isEncodingSupported(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
}

function encoderConfig(o: EncodeOptions): AudioEncoderConfig {
  return {
    codec: 'opus',
    sampleRate: o.sampleRate,
    numberOfChannels: 1,
    bitrate: o.bitrate,
    // Sabit bit hizi sayesinde her paket ayni boyutta cikar; boylece yukte
    // paket basina uzunluk bayti tasimamiza gerek kalmaz (~%2 tasarruf).
    bitrateMode: 'constant',
    opus: {
      frameDuration: o.frameDurationUs,
      complexity: 10,
      // `application` kodlayicinin ic mimarisini secer, `signal` ise ayni
      // yonde bir ipucu. Ikisi birlikte veriliyor cunku tek basina `signal`
      // modu degistirmiyor - yalnizca ayar oynuyor.
      ...(o.content === 'konusma'
        ? { application: 'voip', signal: 'voice' }
        : { application: 'audio', signal: 'music' }),
    },
  } as AudioEncoderConfig;
}

export async function isConfigUsable(o: EncodeOptions): Promise<boolean> {
  if (!isEncodingSupported()) return false;
  try {
    const s = await AudioEncoder.isConfigSupported(encoderConfig(o));
    return s.supported === true;
  } catch {
    return false;
  }
}

/**
 * `pcm`, `options.sampleRate` hizinda mono ornekler olmali
 * (bkz. `src/audio/resample.ts`). `Float32Array<ArrayBuffer>` istenmesinin
 * sebebi `AudioData`'nin paylasimli bellek kabul etmemesi.
 */
export async function encodeToPayload(pcm: Float32Array<ArrayBuffer>, options: EncodeOptions): Promise<EncodeResult> {
  if (!isEncodingSupported()) {
    throw new EncodeError(
      'Bu tarayıcı ses kodlamayı (WebCodecs) desteklemiyor. Güncel Chrome, Edge veya Safari deneyin.',
    );
  }
  if (pcm.length === 0) throw new EncodeError('Kodlanacak ses seçilmedi.');

  const config = encoderConfig(options);
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new EncodeError(
      `Bu tarayıcı Opus @ ${options.bitrate / 1000} kbps ayarını desteklemiyor. Farklı bir bit hızı seçin.`,
    );
  }

  const packets: Uint8Array[] = [];
  let encoderError: Error | null = null;

  const encoder = new AudioEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      packets.push(buf);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  try {
    encoder.configure(config);
    encoder.encode(
      new AudioData({
        format: 'f32-planar',
        sampleRate: options.sampleRate,
        numberOfFrames: pcm.length,
        numberOfChannels: 1,
        timestamp: 0,
        data: pcm,
      }),
    );
    await encoder.flush();
  } catch (err) {
    throw new EncodeError(`Ses kodlanamadı: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (encoderError) throw new EncodeError(`Ses kodlanamadı: ${(encoderError as Error).message}`);
  if (packets.length === 0) throw new EncodeError('Kodlayıcı hiç ses verisi üretmedi.');

  // Butceye sigdir: sondan paket atarak kus. CBR'de paketler sabit boyutlu
  // oldugu icin bu islem tam ve ongorulebilir.
  const total = packets.length;
  let kept = packets;
  while (kept.length > 0 && packedSize(kept) > options.maxBytes) {
    kept = kept.slice(0, kept.length - 1);
  }
  if (kept.length === 0) {
    throw new EncodeError(
      'Seçilen ses bu ayarlarla QR koda hiç sığmıyor. Bit hızını düşürün veya hata düzeltme seviyesini L yapın.',
    );
  }

  const payload: VoicePayload = {
    sampleRate: options.sampleRate,
    channels: 1,
    frameDurationUs: options.frameDurationUs,
    packets: kept,
  };

  return {
    payload,
    bytes: pack(payload),
    encodedSeconds: (kept.length * options.frameDurationUs) / 1e6,
    truncated: kept.length < total,
  };
}

/**
 * Bir baytlik butcenin kac saniye SESE (girdi suresine) denk geldigini kestirir.
 *
 * Opus kodlayici kendi gecikmesini telafi etmek icin girdinin sonuna dolgu
 * ekler; bu yuzden N kare uzunlugundaki bir girdi N+1 paket uretebilir.
 * Olculen davranis: sure kare boyutuna TAM bolundugunde daima bir fazla paket
 * cikiyor. Bu yuzden butceden bir paket pesinen ayriliyor - aksi halde uretici
 * "sigar" deyip sesi sondan kirpmak zorunda kaliyor.
 */
export function estimateSeconds(maxBytes: number, bitrate: number, frameDurationUs: FrameDurationUs): number {
  const bytesPerPacket = Math.round((bitrate * (frameDurationUs / 1e6)) / 8);
  if (bytesPerPacket <= 0) return 0;

  const packetBudget = Math.floor((maxBytes - HEADER_BYTES) / bytesPerPacket);
  const usablePackets = packetBudget - ENCODER_PADDING_PACKETS;
  return Math.max(0, (usablePackets * frameDurationUs) / 1e6);
}
