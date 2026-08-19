/**
 * VoiceQR yuk bicimi.
 *
 * Yuk, QR'a sigmasi gereken her baytin degerli oldugu bir ortamda yasiyor
 * (EC-L'de toplam 2184 bayt), bu yuzden basligi 4 bayta sikistiriyoruz.
 *
 *   bayt 0 : sihirli sayi + bicim surumu  (0xV1)
 *   bayt 1 : bayraklar
 *            bit 0-1 : ornekleme hizi indeksi (SAMPLE_RATES)
 *            bit 2-3 : kanal sayisi - 1  (su an hep 0 = mono)
 *            bit 4-5 : cerceve suresi indeksi (FRAME_DURATIONS)
 *            bit 6   : 0 = CBR (sabit paket boyutu), 1 = VBR (uzunluk onekli)
 *            bit 7   : ayrilmis
 *   bayt 2 : CBR paket boyutu (1-255). VBR ise 0.
 *   bayt 3 : paket sayisi >> 8  (ust bayt)
 *   bayt 4 : paket sayisi & 255 (alt bayt)   <- toplam 5 bayt
 *
 * VBR modunda her paketin onunde 1 baytlik uzunluk bulunur. Fizibilite
 * olcumlerinde Chromium CBR'de her zaman sabit boyutlu paket uretti, yani
 * pratikte CBR yolu kullanilacak; VBR yolu baska tarayicilar icin emniyet supabi.
 */

export const MAGIC = 0x51; // 'Q' - bicim surumu 1

export const SAMPLE_RATES = [16000, 24000, 48000, 8000] as const;
export const FRAME_DURATIONS_US = [60000, 40000, 20000, 10000] as const;

export type SampleRate = (typeof SAMPLE_RATES)[number];
export type FrameDurationUs = (typeof FRAME_DURATIONS_US)[number];

export const HEADER_BYTES = 5;

export interface VoicePayload {
  sampleRate: SampleRate;
  channels: number;
  frameDurationUs: FrameDurationUs;
  packets: Uint8Array[];
}

export class PayloadError extends Error {}

function indexOrThrow<T>(list: readonly T[], value: T, what: string): number {
  const i = list.indexOf(value);
  if (i < 0) throw new PayloadError(`Desteklenmeyen ${what}: ${String(value)}`);
  return i;
}

/** Toplam bayt boyutunu, gercekten paketlemeden hesaplar (canli UI geri bildirimi icin). */
export function packedSize(packets: readonly Uint8Array[]): number {
  if (packets.length === 0) return HEADER_BYTES;
  const first = packets[0]!.length;
  const cbr = packets.every((p) => p.length === first);
  const body = cbr
    ? packets.length * first
    : packets.reduce((sum, p) => sum + 1 + p.length, 0);
  return HEADER_BYTES + body;
}

export function pack(payload: VoicePayload): Uint8Array {
  const { sampleRate, channels, frameDurationUs, packets } = payload;

  if (packets.length === 0) throw new PayloadError('Kodlanacak ses verisi yok.');
  if (packets.length > 0xffff) throw new PayloadError('Paket sayısı çok fazla.');
  if (channels < 1 || channels > 4) throw new PayloadError(`Desteklenmeyen kanal sayısı: ${channels}`);

  const srIndex = indexOrThrow(SAMPLE_RATES, sampleRate, 'örnekleme hızı');
  const fdIndex = indexOrThrow(FRAME_DURATIONS_US, frameDurationUs, 'çerçeve süresi');

  const first = packets[0]!.length;
  const cbr = packets.every((p) => p.length === first);
  if (cbr && (first < 1 || first > 255)) {
    throw new PayloadError(`CBR paket boyutu aralığın dışında: ${first}`);
  }
  if (!cbr && packets.some((p) => p.length > 255)) {
    throw new PayloadError('VBR modunda paket boyutu 255 baytı aşamaz.');
  }

  const out = new Uint8Array(packedSize(packets));
  out[0] = MAGIC;
  out[1] = (srIndex & 0b11) | ((channels - 1) << 2) | ((fdIndex & 0b11) << 4) | (cbr ? 0 : 1 << 6);
  out[2] = cbr ? first : 0;
  out[3] = (packets.length >>> 8) & 0xff;
  out[4] = packets.length & 0xff;

  let o = HEADER_BYTES;
  for (const p of packets) {
    if (!cbr) out[o++] = p.length;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function unpack(bytes: Uint8Array): VoicePayload {
  if (bytes.length < HEADER_BYTES) {
    throw new PayloadError('Veri çok kısa — link eksik kopyalanmış olabilir.');
  }
  if (bytes[0] !== MAGIC) {
    throw new PayloadError('Bu bir VoiceQR linki değil (tanınmayan biçim).');
  }

  const flags = bytes[1]!;
  const sampleRate = SAMPLE_RATES[flags & 0b11]!;
  const channels = ((flags >>> 2) & 0b11) + 1;
  const frameDurationUs = FRAME_DURATIONS_US[(flags >>> 4) & 0b11]!;
  const cbr = ((flags >>> 6) & 1) === 0;
  const cbrSize = bytes[2]!;
  const count = (bytes[3]! << 8) | bytes[4]!;

  if (count === 0) throw new PayloadError('Veri boş — ses paketi bulunamadı.');
  if (cbr && cbrSize === 0) throw new PayloadError('Bozuk başlık: CBR paket boyutu sıfır.');

  const packets: Uint8Array[] = [];
  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const len = cbr ? cbrSize : bytes[o++]!;
    if (len === undefined || o + len > bytes.length) {
      throw new PayloadError(
        `Veri eksik: ${count} paket bekleniyordu, ${i} tanesi okunabildi. Link kırpılmış olabilir.`,
      );
    }
    packets.push(bytes.subarray(o, o + len));
    o += len;
  }

  return { sampleRate, channels, frameDurationUs, packets };
}
