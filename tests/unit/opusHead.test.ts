import { describe, expect, it } from 'vitest';
import { buildOpusHead, OPUS_PRE_SKIP } from '../../src/codec/opusHead';

describe('OpusHead (RFC 7845 §5.1)', () => {
  it('mono 16 kHz icin beklenen bayt dizisini uretir', () => {
    const head = buildOpusHead(1, 16000);

    expect(head).toHaveLength(19);
    expect(Array.from(head)).toEqual([
      0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
      0x01, // surum
      0x01, // kanal
      0x38, 0x01, // on-bosluk 312, little-endian
      0x80, 0x3e, 0x00, 0x00, // 16000, little-endian
      0x00, 0x00, // kazanc 0
      0x00, // esleme ailesi
    ]);
  });

  it('imza dogru', () => {
    expect(new TextDecoder().decode(buildOpusHead(1, 48000).subarray(0, 8))).toBe('OpusHead');
  });

  it('kanal sayisi ve ornekleme hizini little-endian yazar', () => {
    const head = buildOpusHead(2, 48000);
    const view = new DataView(head.buffer);

    expect(head[9]).toBe(2);
    expect(view.getUint16(10, true)).toBe(OPUS_PRE_SKIP);
    expect(view.getUint32(12, true)).toBe(48000);
  });

  it('desteklenmeyen kanal sayisini reddeder', () => {
    expect(() => buildOpusHead(0, 48000)).toThrow(RangeError);
    expect(() => buildOpusHead(3, 48000)).toThrow(RangeError);
  });
});
