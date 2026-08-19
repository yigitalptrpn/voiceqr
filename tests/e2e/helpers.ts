/** Uctan uca testler icin ses uretme ve cozumleme yardimcilari. */

/** 16-bit mono WAV baytlari uretir. */
export function makeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/** Saf sinus tonu. */
export function tone(frequency: number, seconds: number, sampleRate: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}

/** 16-bit mono/stereo WAV'i cozer. */
export function parseWav(buffer: Buffer): { channels: Float32Array[]; sampleRate: number } {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV degil');
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 1;
  let bitsPerSample = 16;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      channelCount = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bitsPerSample !== 16) throw new Error(`Beklenmeyen bit derinligi: ${bitsPerSample}`);
      const frames = Math.floor(size / 2 / channelCount);
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelCount; c++) {
          channels[c]![i] = buffer.readInt16LE(body + (i * channelCount + c) * 2) / 32768;
        }
      }
      return { channels, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV icinde data parcasi yok');
}

/** Goertzel algoritmasiyla tek bir frekanstaki gucu olcer. */
function power(signal: Float32Array, frequency: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Verilen aralikta en guclu frekansi bulur. */
export function dominantFrequency(
  signal: Float32Array,
  sampleRate: number,
  { min = 100, max = 2000, step = 1 } = {},
): number {
  let best = -Infinity;
  let bestFrequency = 0;
  for (let f = min; f <= max; f += step) {
    const p = power(signal, f, sampleRate);
    if (p > best) {
      best = p;
      bestFrequency = f;
    }
  }
  return bestFrequency;
}

export function rms(signal: Float32Array): number {
  let sum = 0;
  for (const v of signal) sum += v * v;
  return Math.sqrt(sum / signal.length);
}
