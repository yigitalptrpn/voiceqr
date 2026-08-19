import { describe, expect, it } from 'vitest';
import {
  HEADER_BYTES,
  MAGIC,
  pack,
  packedSize,
  PayloadError,
  unpack,
  type VoicePayload,
} from '../../src/codec/container';

function packets(count: number, size: number): Uint8Array[] {
  return Array.from({ length: count }, (_, i) =>
    Uint8Array.from({ length: size }, (_, j) => (i * 31 + j * 7) & 0xff),
  );
}

const base: Omit<VoicePayload, 'packets'> = {
  sampleRate: 16000,
  channels: 1,
  frameDurationUs: 60000,
};

describe('yuk konteyneri', () => {
  it('CBR yukunde gidip gelir', () => {
    const payload: VoicePayload = { ...base, packets: packets(48, 45) };
    const out = unpack(pack(payload));

    expect(out.sampleRate).toBe(16000);
    expect(out.channels).toBe(1);
    expect(out.frameDurationUs).toBe(60000);
    expect(out.packets).toHaveLength(48);
    out.packets.forEach((p, i) => expect(Array.from(p)).toEqual(Array.from(payload.packets[i]!)));
  });

  it('CBR modunda paket basina uzunluk bayti harcamaz', () => {
    const bytes = pack({ ...base, packets: packets(48, 45) });
    expect(bytes.length).toBe(HEADER_BYTES + 48 * 45);
    expect(bytes[0]).toBe(MAGIC);
  });

  it('esit olmayan paketlerde VBR moduna gecer ve yine gidip gelir', () => {
    const mixed = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5]), Uint8Array.from([6, 7, 8, 9])];
    const bytes = pack({ ...base, packets: mixed });

    expect(bytes.length).toBe(HEADER_BYTES + 3 + 1 + 2 + 1 + 4 + 1);
    const out = unpack(bytes);
    expect(out.packets.map((p) => Array.from(p))).toEqual(mixed.map((p) => Array.from(p)));
  });

  it('packedSize gercek uzunlukla birebir ayni', () => {
    for (const p of [packets(48, 45), packets(1, 200), [Uint8Array.from([1]), Uint8Array.from([2, 3])]]) {
      expect(packedSize(p)).toBe(pack({ ...base, packets: p }).length);
    }
  });

  it('tum ornekleme hizi ve cerceve suresi kombinasyonlarini korur', () => {
    for (const sampleRate of [8000, 16000, 24000, 48000] as const) {
      for (const frameDurationUs of [10000, 20000, 40000, 60000] as const) {
        const out = unpack(pack({ sampleRate, channels: 1, frameDurationUs, packets: packets(3, 20) }));
        expect([out.sampleRate, out.frameDurationUs]).toEqual([sampleRate, frameDurationUs]);
      }
    }
  });

  it('yabanci veriyi reddeder', () => {
    expect(() => unpack(Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04]))).toThrow(PayloadError);
  });

  it('cok kisa veriyi reddeder', () => {
    expect(() => unpack(Uint8Array.from([MAGIC, 0]))).toThrow(PayloadError);
  });

  it('kirpilmis veriyi -- link kesilmesinin belirtisi -- yakalar', () => {
    const bytes = pack({ ...base, packets: packets(48, 45) });
    expect(() => unpack(bytes.subarray(0, bytes.length - 100))).toThrow(/eksik/i);
  });

  it('bos paket listesini reddeder', () => {
    expect(() => pack({ ...base, packets: [] })).toThrow(PayloadError);
  });
});
