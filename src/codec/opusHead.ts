/**
 * OpusHead kimlik basligi (RFC 7845 §5.1).
 *
 * Chromium ham Opus paketlerini `description` olmadan da coziyor, ancak bu
 * davranis tarayicilar arasinda garanti degil. 19 bayt kucuk bir bedel oldugu
 * icin `AudioDecoder.configure`'a her zaman aciklama veriyoruz - ve bu bayt
 * dizisi YUKUN ICINDE TASINMIYOR, cozme aninda yeniden uretiliyor.
 *
 *   0-7   sihirli imza "OpusHead"
 *   8     surum (1)
 *   9     cikis kanal sayisi
 *   10-11 on-bosluk (pre-skip), little-endian
 *   12-15 orijinal ornekleme hizi, little-endian
 *   16-17 cikis kazanci (Q7.8), little-endian
 *   18    kanal esleme ailesi (0 = mono/stereo)
 */

/** Opus'un 48 kHz'de standart on-boslugu. */
export const OPUS_PRE_SKIP = 312;

/** Opus dahili olarak her zaman 48 kHz'de calisir ve cozucu bu hizda cikis verir. */
export const OPUS_DECODE_RATE = 48000;

export function buildOpusHead(channels: number, inputSampleRate: number): Uint8Array {
  if (channels < 1 || channels > 2) {
    throw new RangeError(`OpusHead icin desteklenmeyen kanal sayisi: ${channels}`);
  }

  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);

  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, OPUS_PRE_SKIP, true);
  view.setUint32(12, inputSampleRate, true);
  view.setInt16(16, 0, true); // kazanc duzeltmesi yok
  head[18] = 0;

  return head;
}
