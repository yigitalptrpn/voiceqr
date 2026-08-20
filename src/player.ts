/**
 * Oynatici ekrani: QR'i okuyan kisinin gordugu sayfa.
 *
 * Bu kod tanimadigimiz cihazlarda calisiyor, bu yuzden iki sey onemli:
 *
 *  1. Ses, sayfa acilir acilmaz ARKA PLANDA cozulur. Kullanici "Cal"a
 *     bastiginda beklemesin.
 *  2. iOS Safari (ve mobil Chrome) kullanici dokunusu olmadan ses calmaya
 *     izin vermez. Otomatik oynatma denenir; engellenirse buyuk bir dugme
 *     gosterilir - bu bir hata degil, beklenen davranistir.
 */

import { decodeFragment } from './codec/fragment';
import { unpack } from './codec/container';
import { decodePayload, type DecodedAudio } from './codec/decode';
import { getAudioContext, resumeAudioContext } from './audio/loadFile';
import { toAudioBuffer } from './audio/resample';
import { encodeWav } from './audio/wav';

type Status =
  | { kind: 'decoding' }
  | { kind: 'ready'; audio: DecodedAudio; buffer: AudioBuffer }
  | { kind: 'error'; message: string };

let status: Status = { kind: 'decoding' };
let playing = false;
let source: AudioBufferSourceNode | null = null;
let root: HTMLElement | null = null;

function fmt(seconds: number): string {
  return `${seconds.toFixed(2)} sn`;
}

function stop(): void {
  if (source) {
    try {
      source.stop();
    } catch {
      /* zaten durmus */
    }
    source = null;
  }
  playing = false;
}

async function play(): Promise<void> {
  if (status.kind !== 'ready') return;
  stop();
  await resumeAudioContext();

  const ctx = getAudioContext();
  const node = ctx.createBufferSource();
  node.buffer = status.buffer;
  node.connect(ctx.destination);
  node.onended = () => {
    if (source === node) {
      source = null;
      playing = false;
      render();
    }
  };
  node.start();
  source = node;
  playing = true;
  render();
}

function downloadWav(): void {
  if (status.kind !== 'ready') return;
  const blob = encodeWav(status.audio.channels, status.audio.sampleRate);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'voiceqr.wav';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Hatalari kullanicinin anlayabilecegi cumlelere cevirir. QR'i okuyan kisi
 * teknik detayi degil, ne yapmasi gerektigini bilmek ister.
 */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/geçersiz karakter|geçersiz uzunluk/i.test(message)) {
    return 'Link bozuk görünüyor. QR kodu tekrar okutmayı deneyin — bazı kamera uygulamaları uzun adresleri kırpabiliyor.';
  }
  if (/VoiceQR linki değil/i.test(message)) {
    return 'Bu adres bir VoiceQR sesi içermiyor.';
  }
  if (/eksik/i.test(message)) {
    return 'Ses verisi eksik geldi — link tam kopyalanmamış olabilir. QR kodu baştan okutun.';
  }
  return message;
}

function render(): void {
  if (!root) return;

  let body: string;

  if (status.kind === 'decoding') {
    body = `
      <div class="player-state">
        <div class="spinner" role="status" aria-label="Ses hazırlanıyor"></div>
        <p>Ses hazırlanıyor...</p>
      </div>`;
  } else if (status.kind === 'error') {
    body = `
      <div class="player-state">
        <p class="error">${status.message}</p>
        <a class="button" href="${import.meta.env.BASE_URL}">Kendi QR kodunu üret</a>
      </div>`;
  } else {
    body = `
      <div class="player-state">
        <button type="button" id="play" class="play ${playing ? 'playing' : ''}"
                aria-label="${playing ? 'Durdur' : 'Çal'}">
          ${playing ? '&#9632;' : '&#9654;'}
        </button>
        <p class="player-meta">${fmt(status.audio.durationSeconds)}</p>
        <div class="actions">
          <button type="button" id="wav" class="ghost">WAV indir</button>
          <a class="button ghost" href="${import.meta.env.BASE_URL}">Kendi QR'ını üret</a>
        </div>
      </div>`;
  }

  root.innerHTML = `
    <main class="wrap player">
      <header class="head">
        <h1>VoiceQR</h1>
      </header>
      ${body}
      <footer class="foot">
        <p>Bu ses QR kodun kendi içinde taşınıyordu; hiçbir sunucudan indirilmedi.</p>
      </footer>
    </main>
  `;
}

async function prepare(fragment: string): Promise<void> {
  try {
    const payload = unpack(decodeFragment(fragment));
    const audio = decodePayload(payload);
    const decoded = await audio;
    const buffer = toAudioBuffer(getAudioContext(), decoded.channels, decoded.sampleRate);
    status = { kind: 'ready', audio: decoded, buffer };
    render();

    // Otomatik oynatmayi dene. Engellenirse sessizce dugmede kal -
    // kullanici zaten dokunmak uzere.
    try {
      await play();
    } catch {
      /* tarayici izin vermedi; dugme hazir */
    }
  } catch (err) {
    status = { kind: 'error', message: friendlyError(err) };
    render();
  }
}

export function mountPlayer(container: HTMLElement, fragment: string): void {
  root = container;
  status = { kind: 'decoding' };
  render();

  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#play')) {
      if (playing) {
        stop();
        render();
      } else {
        void play();
      }
    }
    if (target.closest('#wav')) downloadWav();
  });

  void prepare(fragment);
}
