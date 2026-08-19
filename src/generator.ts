/**
 * Uretici ekrani: ses dosyasi -> sesi icinde tasiyan QR kod.
 *
 * Ekranin butun mantigi tek bir kurala dayaniyor: QR'in bayt butcesi sabit,
 * dolayisiyla kullanicinin yapabilecegi her secim (bit hizi, hata duzeltme
 * seviyesi, secilen aralik) dogrudan "kac saniye ses sigar" sorusunu etkiler.
 * Bu yuzden butce her degisiklikte yeniden hesaplanip ekranda gosteriliyor.
 */

import { currentUrlPrefix, publicUrlPrefix } from './config';
import { getAudioContext, loadAudioFile, resumeAudioContext } from './audio/loadFile';
import { extractMono } from './audio/resample';
import { computePeaks, drawWaveform, type WaveformPeaks } from './audio/waveform';
import { encodeBase64url } from './codec/base64url';
import { encodeToPayload, estimateSeconds, isEncodingSupported } from './codec/encode';
import type { FrameDurationUs, SampleRate } from './codec/container';
import { EC_LABEL, maxPayloadBytes, type EcLevel } from './qr/capacity';
import { measureQr, renderToCanvas, toPngBlob, toSvgString, type QrRenderResult } from './qr/render';

const SAMPLE_RATE: SampleRate = 16000;
const FRAME_DURATION: FrameDurationUs = 60000;
const WAVE_BUCKETS = 600;

const BITRATES = [6000, 8000, 10000, 12000, 16000, 24000, 32000] as const;

interface State {
  file: File | null;
  buffer: AudioBuffer | null;
  peaks: WaveformPeaks | null;
  /** Secim, kaynak sesin 0..1 orani olarak. */
  selection: { start: number; end: number };
  bitrate: number;
  ec: EcLevel;
  /** Uretilmis link ve olcumleri; ayar degisince temizlenir. */
  result: { url: string; publicUrl: string; qr: QrRenderResult; seconds: number; truncated: boolean } | null;
  busy: boolean;
  error: string | null;
}

const state: State = {
  file: null,
  buffer: null,
  peaks: null,
  selection: { start: 0, end: 1 },
  bitrate: 6000,
  ec: 'L',
  result: null,
  busy: false,
  error: null,
};

/** Su anki ayarlarla QR'a sigacak azami ham bayt. */
function budgetBytes(): number {
  return maxPayloadBytes(publicUrlPrefix().length, state.ec);
}

/** Su anki ayarlarla sigacak azami ses suresi (saniye). */
function budgetSeconds(): number {
  return estimateSeconds(budgetBytes(), state.bitrate, FRAME_DURATION);
}

function selectionSeconds(): number {
  if (!state.buffer) return 0;
  return (state.selection.end - state.selection.start) * state.buffer.duration;
}

function fmt(seconds: number): string {
  return `${seconds.toFixed(2)} sn`;
}

// --- Ses onizleme -----------------------------------------------------------

let preview: AudioBufferSourceNode | null = null;

function stopPreview(): void {
  if (preview) {
    try {
      preview.stop();
    } catch {
      /* zaten durmus */
    }
    preview = null;
  }
}

async function playSelection(): Promise<void> {
  if (!state.buffer) return;
  stopPreview();
  await resumeAudioContext();

  const ctx = getAudioContext();
  const node = ctx.createBufferSource();
  node.buffer = state.buffer;
  node.connect(ctx.destination);
  node.onended = () => {
    if (preview === node) preview = null;
  };

  const start = state.selection.start * state.buffer.duration;
  node.start(0, start, Math.max(0.01, selectionSeconds()));
  preview = node;
}

// --- QR uretimi -------------------------------------------------------------

async function generate(): Promise<void> {
  if (!state.buffer || state.busy) return;

  state.busy = true;
  state.error = null;
  state.result = null;
  render();

  try {
    const pcm = await extractMono(state.buffer, {
      startSeconds: state.selection.start * state.buffer.duration,
      durationSeconds: selectionSeconds(),
      targetSampleRate: SAMPLE_RATE,
    });

    const encoded = await encodeToPayload(pcm, {
      bitrate: state.bitrate,
      frameDurationUs: FRAME_DURATION,
      sampleRate: SAMPLE_RATE,
      maxBytes: budgetBytes(),
    });

    const fragment = encodeBase64url(encoded.bytes);
    const publicUrl = publicUrlPrefix() + fragment;
    const localUrl = currentUrlPrefix() + fragment;

    // QR her zaman YAYINDAKI adresi tasir - kullanici yerelde uretse bile
    // basilan kod herkes icin calismali.
    //
    // Burada yalnizca OLCULUYOR; cizim, sonuc paneli DOM'a girdikten sonra
    // render() icinde yapiliyor (tuval o ana kadar mevcut degil).
    const qr = measureQr(publicUrl, state.ec);

    state.result = {
      url: localUrl,
      publicUrl,
      qr,
      seconds: encoded.encodedSeconds,
      truncated: encoded.truncated,
    };
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busy = false;
    render();
  }
}

async function download(kind: 'png' | 'svg'): Promise<void> {
  if (!state.result) return;
  const base = (state.file?.name ?? 'voiceqr').replace(/\.[^.]+$/, '');

  const blob =
    kind === 'png'
      ? await toPngBlob(state.result.publicUrl, state.ec)
      : new Blob([await toSvgString(state.result.publicUrl, state.ec)], { type: 'image/svg+xml' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}-voiceqr.${kind}`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Dosya yukleme ----------------------------------------------------------

async function acceptFile(file: File): Promise<void> {
  state.busy = true;
  state.error = null;
  state.result = null;
  render();

  try {
    const buffer = await loadAudioFile(file);
    state.file = file;
    state.buffer = buffer;
    state.peaks = computePeaks(buffer, WAVE_BUCKETS);

    // Baslangicta bastan itibaren sigacak kadarini sec - kullanici
    // hicbir sey yapmadan da gecerli bir secimle karsilassin.
    const fits = Math.min(budgetSeconds(), buffer.duration);
    state.selection = { start: 0, end: fits / buffer.duration };
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    state.file = null;
    state.buffer = null;
    state.peaks = null;
  } finally {
    state.busy = false;
    render();
  }
}

/** Secimi butceye sigdirir; bitrate/EC degisince cagrilir. */
function clampSelectionToBudget(): void {
  if (!state.buffer) return;
  const maxRatio = Math.min(1, budgetSeconds() / state.buffer.duration);
  const width = state.selection.end - state.selection.start;
  if (width > maxRatio) {
    state.selection.end = state.selection.start + maxRatio;
  }
}

// --- Cizim ------------------------------------------------------------------

function redrawWaveform(): void {
  const canvas = document.getElementById('wave-canvas') as HTMLCanvasElement | null;
  if (!canvas || !state.peaks) return;
  drawWaveform(canvas, {
    peaks: state.peaks,
    selection: state.selection,
    waveColor: '#3a4152',
    selectedWaveColor: '#7cc4ff',
    selectionFill: 'rgba(124, 196, 255, 0.12)',
  });
}

function statusLine(): string {
  const budget = budgetBytes();
  const maxSec = budgetSeconds();
  const selected = selectionSeconds();
  const over = selected > maxSec + 0.001;

  return `
    <div class="metrics">
      <div class="metric">
        <span class="metric-label">Seçili</span>
        <strong class="${over ? 'over' : ''}">${fmt(selected)}</strong>
      </div>
      <div class="metric">
        <span class="metric-label">QR'a sığan</span>
        <strong>${fmt(maxSec)}</strong>
      </div>
      <div class="metric">
        <span class="metric-label">Bayt bütçesi</span>
        <strong>${budget}</strong>
      </div>
    </div>
    ${over ? '<p class="warn">Seçim bütçeyi aşıyor — üretim sırasında sondan kırpılacak.</p>' : ''}
  `;
}

function resultPanel(): string {
  const r = state.result;
  if (!r) return '';

  return `
    <section class="panel result">
      <h2>3. QR kodunuz hazır</h2>
      <div class="qr-wrap"><canvas id="qr-canvas" aria-label="Üretilen QR kod"></canvas></div>
      <div class="metrics">
        <div class="metric"><span class="metric-label">Ses</span><strong>${fmt(r.seconds)}</strong></div>
        <div class="metric"><span class="metric-label">QR sürümü</span><strong>v${r.qr.version} (${r.qr.modules}×${r.qr.modules})</strong></div>
        <div class="metric"><span class="metric-label">Doluluk</span><strong>%${Math.round(r.qr.fillRatio * 100)}</strong></div>
      </div>
      ${r.truncated ? '<p class="warn">Ses bütçeye sığmadığı için sondan kırpıldı.</p>' : ''}
      <p class="print-note">
        <strong>Baskı boyutu önemli.</strong> Bu QR ${r.qr.modules}×${r.qr.modules} modül içeriyor.
        Sıradan bir telefon kamerasının okuyabilmesi için kenarını
        <strong>en az ${r.qr.recommendedPrintMm} mm</strong> basın. Küçük basılırsa okunmaz.
      </p>
      <div class="actions">
        <button type="button" data-action="png">PNG indir</button>
        <button type="button" data-action="svg">SVG indir (baskı için)</button>
        <button type="button" data-action="copy">Linki kopyala</button>
        <a class="button" href="${r.url}" target="_blank" rel="noopener">Oynatıcıda dene</a>
      </div>
      <details class="url-details">
        <summary>QR'ın içindeki adres (${r.publicUrl.length} karakter)</summary>
        <code class="url">${r.publicUrl.slice(0, 120)}...</code>
        <p class="hint">
          Bu adres <code>${publicUrlPrefix()}</code> ile başlıyor. Site bu adreste
          yayında olmadıkça basılan QR çalışmaz.
        </p>
      </details>
    </section>
  `;
}

function render(): void {
  const root = document.getElementById('app');
  if (!root) return;

  const hasAudio = state.buffer !== null;

  root.innerHTML = `
    <main class="wrap">
      <header class="head">
        <h1>VoiceQR</h1>
        <p class="tagline">Sesi kendi içinde taşıyan QR kod. Sunucu yok — ses linkin içinde.</p>
      </header>

      ${
        isEncodingSupported()
          ? ''
          : `<p class="error">Bu tarayıcı ses kodlamayı (WebCodecs) desteklemiyor.
             QR üretmek için güncel Chrome, Edge veya Safari kullanın.</p>`
      }

      <section class="panel">
        <h2>1. Ses dosyası seçin</h2>
        <div id="drop" class="drop ${hasAudio ? 'has-file' : ''}" tabindex="0" role="button">
          <input type="file" id="file" accept="audio/*" hidden />
          ${
            hasAudio
              ? `<strong>${state.file?.name ?? 'ses'}</strong>
                 <span>${fmt(state.buffer!.duration)} · ${state.buffer!.numberOfChannels} kanal ·
                 ${state.buffer!.sampleRate} Hz</span>
                 <span class="hint">Değiştirmek için tıklayın veya yeni dosya bırakın</span>`
              : `<strong>Dosyayı buraya bırakın</strong>
                 <span>ya da tıklayıp seçin (mp3, m4a, wav, ogg...)</span>`
          }
        </div>
      </section>

      ${
        hasAudio
          ? `
      <section class="panel">
        <h2>2. Çalacak bölümü seçin</h2>
        <canvas id="wave-canvas" class="wave"></canvas>
        <div class="range-row">
          <label for="start">Başlangıç</label>
          <input type="range" id="start" min="0" max="1000" step="1"
                 value="${Math.round(state.selection.start * 1000)}" />
          <span class="range-value">${fmt(state.selection.start * state.buffer!.duration)}</span>
        </div>
        <div class="range-row">
          <label for="length">Uzunluk</label>
          <input type="range" id="length" min="1" max="1000" step="1"
                 value="${Math.round((state.selection.end - state.selection.start) * 1000)}" />
          <span class="range-value">${fmt(selectionSeconds())}</span>
        </div>

        ${statusLine()}

        <div class="settings">
          <div class="field">
            <label for="bitrate">Ses kalitesi</label>
            <select id="bitrate">
              ${BITRATES.map(
                (b) =>
                  `<option value="${b}" ${b === state.bitrate ? 'selected' : ''}>
                     ${b / 1000} kbps — ${fmt(estimateSeconds(budgetBytes(), b, FRAME_DURATION))} sığar
                   </option>`,
              ).join('')}
            </select>
            <p class="hint">Düşük kbps = daha uzun ama daha boğuk ses.</p>
          </div>
          <div class="field">
            <label for="ec">Hata düzeltme</label>
            <select id="ec">
              ${(['L', 'M', 'Q', 'H'] as EcLevel[])
                .map((e) => `<option value="${e}" ${e === state.ec ? 'selected' : ''}>${EC_LABEL[e]}</option>`)
                .join('')}
            </select>
            <p class="hint">Yüksek seviye yıpranmış baskıya dayanıklı ama sesi kısaltır.</p>
          </div>
        </div>

        <div class="actions">
          <button type="button" data-action="preview">Seçimi dinle</button>
          <button type="button" data-action="generate" class="primary" ${state.busy ? 'disabled' : ''}>
            ${state.busy ? 'Üretiliyor...' : 'QR kodu üret'}
          </button>
        </div>
      </section>`
          : ''
      }

      ${state.error ? `<p class="error">${state.error}</p>` : ''}
      ${resultPanel()}

      <footer class="foot">
        <p>
          QR kodun içinde bir adres ve sesin tamamı bulunur. Telefonun yerleşik
          kamerasıyla okutulunca bu sayfa açılır ve ses cihazda çözülüp çalınır —
          hiçbir sunucuya ses gönderilmez.
        </p>
      </footer>
    </main>
  `;

  redrawWaveform();
  if (state.result) {
    // innerHTML tuvali sifirladi; QR'i yeniden ciz.
    const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement | null;
    if (canvas) void renderToCanvas(canvas, state.result.publicUrl, state.ec);
  }
}

// --- Olay baglama -----------------------------------------------------------

function bind(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('#drop')) {
      (document.getElementById('file') as HTMLInputElement | null)?.click();
      return;
    }

    const action = target.closest('[data-action]')?.getAttribute('data-action');
    if (!action) return;

    if (action === 'preview') void playSelection();
    if (action === 'generate') void generate();
    if (action === 'png') void download('png');
    if (action === 'svg') void download('svg');
    if (action === 'copy' && state.result) {
      void navigator.clipboard.writeText(state.result.publicUrl).then(
        () => {
          (target as HTMLButtonElement).textContent = 'Kopyalandı';
          setTimeout(() => ((target as HTMLButtonElement).textContent = 'Linki kopyala'), 1500);
        },
        () => {
          state.error = 'Link panoya kopyalanamadı.';
          render();
        },
      );
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;

    if (target.id === 'file') {
      const file = (target as HTMLInputElement).files?.[0];
      if (file) void acceptFile(file);
    }
    if (target.id === 'bitrate') {
      state.bitrate = Number((target as HTMLSelectElement).value);
      state.result = null;
      clampSelectionToBudget();
      render();
    }
    if (target.id === 'ec') {
      state.ec = (target as HTMLSelectElement).value as EcLevel;
      state.result = null;
      clampSelectionToBudget();
      render();
    }
  });

  // Kaydiraclar surukleme sirasinda anlik geri bildirim vermeli; tam
  // yeniden cizim yerine sadece dalga formunu ve rakamlari guncelliyoruz.
  root.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (!state.buffer) return;

    if (target.id === 'start' || target.id === 'length') {
      const startEl = document.getElementById('start') as HTMLInputElement | null;
      const lengthEl = document.getElementById('length') as HTMLInputElement | null;
      if (!startEl || !lengthEl) return;

      const start = Number(startEl.value) / 1000;
      const width = Number(lengthEl.value) / 1000;

      state.selection.start = Math.min(start, 0.999);
      state.selection.end = Math.min(1, state.selection.start + Math.max(0.001, width));
      state.result = null;

      redrawWaveform();
      const rows = root.querySelectorAll('.range-value');
      if (rows[0]) rows[0].textContent = fmt(state.selection.start * state.buffer.duration);
      if (rows[1]) rows[1].textContent = fmt(selectionSeconds());
      const metrics = root.querySelector('.metrics strong');
      if (metrics) {
        metrics.textContent = fmt(selectionSeconds());
        metrics.classList.toggle('over', selectionSeconds() > budgetSeconds() + 0.001);
      }
    }
  });

  for (const type of ['dragover', 'dragenter'] as const) {
    root.addEventListener(type, (event) => {
      event.preventDefault();
      document.getElementById('drop')?.classList.add('over');
    });
  }
  root.addEventListener('dragleave', () => document.getElementById('drop')?.classList.remove('over'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    document.getElementById('drop')?.classList.remove('over');
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) void acceptFile(file);
  });

  window.addEventListener('resize', redrawWaveform);
}

export function mountGenerator(root: HTMLElement): void {
  render();
  bind(root);
}
