/**
 * Cozulmus PCM'i 16-bit WAV dosyasina cevirir.
 * Oynaticidaki "WAV indir" icin gerekli - tarayici Opus paketlerini
 * dogrudan dosya olarak veremiyor.
 */

export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * channelCount * 2;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM alt-parca boyutu
  view.setUint16(20, 1, true); // PCM bicimi
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true); // bayt/saniye
  view.setUint16(32, channelCount * 2, true); // blok hizalamasi
  view.setUint16(34, 16, true); // bit/ornek
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]![i]!));
      view.setInt16(offset, Math.round(sample * 32767), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
