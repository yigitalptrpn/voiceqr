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
import { BOOST_LABEL, normalizeInPlace, type BoostLevel } from './audio/normalize';
import { concatWithCrossfade } from './audio/splice';
import { findSpeechBounds, trimSelection } from './audio/trim';
import { extractMono, toAudioBuffer } from './audio/resample';
import { computePeaks, drawWaveform, type WaveformPeaks } from './audio/waveform';
import { encodeFragment } from './codec/fragment';
import { encodeToPayload, estimateSeconds, isEncodingSupported, type ContentKind } from './codec/encode';
import type { FrameDurationUs, SampleRate } from './codec/container';
import { EC_LABEL, maxPayloadBytesAlphanumeric, type EcLevel } from './qr/capacity';
import {
  measureQr,
  renderToCanvas,
  toPngBlob,
  toSvgString,
  urlText,
  type QrRenderResult,
  type QrUrl,
} from './qr/render';

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
  /**
   * Secimin ICINDEN atilacak bolum, yine kaynagin 0..1 orani olarak.
   * `null` ise bir sey atilmiyor. Atilan yerin oncesi ve sonrasi
   * birlestirilip tek ses olur.
   */
  cut: { start: number; end: number } | null;
  bitrate: number;
  ec: EcLevel;
  /** Kodlayiciya verilen icerik ipucu; kaliteyi belirgin etkiler. */
  content: ContentKind;
  /** Kodlamadan onceki ses yukseltme seviyesi. */
  boost: BoostLevel;
  /** Uretilmis link ve olcumleri; ayar degisince temizlenir. */
  result: {
    url: string;
    publicUrl: QrUrl;
    qr: QrRenderResult;
    seconds: number;
    truncated: boolean;
    usedVbr: boolean;
  } | null;
  busy: boolean;
  error: string | null;
}

const state: State = {
  file: null,
  buffer: null,
  peaks: null,
  selection: { start: 0, end: 1 },
  cut: null,
  bitrate: 6000,
  ec: 'L',
  content: 'konusma',
  boost: 'orta',
  result: null,
  busy: false,
  error: null,
};

/** Su anki ayarlarla QR'a sigacak azami ham bayt. */
function budgetBytes(): number {
  return maxPayloadBytesAlphanumeric(publicUrlPrefix().length, state.ec);
}

/** Su anki ayarlarla sigacak azami ses suresi (saniye). */
function budgetSeconds(): number {
  return estimateSeconds(budgetBytes(), state.bitrate, FRAME_DURATION);
}

/** Secimin ham genisligi - atilan bolum DAHIL. */
function selectionSpanSeconds(): number {
  if (!state.buffer) return 0;
  return (state.selection.end - state.selection.start) * state.buffer.duration;
}

/** Secimin icinden atilan bolumun suresi. Atilan yoksa 0. */
function cutSeconds(): number {
  if (!state.buffer || !state.cut) return 0;
  const from = Math.max(state.cut.start, state.selection.start);
  const to = Math.min(state.cut.end, state.selection.end);
  return Math.max(0, (to - from) * state.buffer.duration);
}

/**
 * QR'a girecek GERCEK ses suresi: secim eksi atilan bolum.
 *
 * Butce hesaplari hep bunu kullanmali - atilan yer QR'da yer kaplamiyor,
 * dolayisiyla kullanici o kadar daha uzun bir aralik secebilir.
 */
function selectionSeconds(): number {
  return Math.max(0, selectionSpanSeconds() - cutSeconds());
}

function fmt(seconds: number): string {
  return `${seconds.toFixed(2)} sn`;
}

/**
 * Secili sesi mono PCM olarak cikarir; ortadan bir bolum atildiysa kalan iki
 * parcayi birlestirir.
 *
 * Birlestirme duz yapistirma DEGIL: ek yerinde kisa bir capraz gecis var,
 * aksi halde duyulur bir tik olusuyor (bkz. `src/audio/splice.ts`).
 */
async function extractSelection(): Promise<Float32Array<ArrayBuffer>> {
  if (!state.buffer) return new Float32Array(0);
  const duration = state.buffer.duration;
  const from = state.selection.start * duration;
  const to = state.selection.end * duration;

  const cut = effectiveCut();
  if (!cut) {
    return extractMono(state.buffer, {
      startSeconds: from,
      durationSeconds: to - from,
      targetSampleRate: SAMPLE_RATE,
    });
  }

  const [once, sonra] = await Promise.all([
    extractMono(state.buffer, {
      startSeconds: from,
      durationSeconds: Math.max(0, cut.start * duration - from),
      targetSampleRate: SAMPLE_RATE,
    }),
    extractMono(state.buffer, {
      startSeconds: cut.end * duration,
      durationSeconds: Math.max(0, to - cut.end * duration),
      targetSampleRate: SAMPLE_RATE,
    }),
  ]);

  return concatWithCrossfade(once, sonra, SAMPLE_RATE);
}

/**
 * Atilan bolumun kaydiraclarda gosterilecek konumu.
 *
 * Kaydiraclar kaynagin tamamina gore degil SECIME gore calisiyor: kullanici
 * secimi daralttiginda atilan bolumun kaydiraci da onunla birlikte olceklensin,
 * yoksa kaydirac secimin disina isaret ederdi.
 */
function cutRatioInSelection(value: number): number {
  const span = state.selection.end - state.selection.start;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (value - state.selection.start) / span));
}

function cutWidthInSelection(): number {
  const span = state.selection.end - state.selection.start;
  if (span <= 0 || !state.cut) return 0;
  return Math.max(0, Math.min(1, (state.cut.end - state.cut.start) / span));
}

/** Atilan bolumun secimle kesisen kismi; kesisim yoksa `null`. */
function effectiveCut(): { start: number; end: number } | null {
  if (!state.cut) return null;
  const start = Math.max(state.cut.start, state.selection.start);
  const end = Math.min(state.cut.end, state.selection.end);
  return end > start ? { start, end } : null;
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

/**
 * Onizleme, QR'a girecek sesin AYNISINI calar: secili aralik, ortadan atilan
 * bolum cikarilmis ve ek yeri capraz gecisle birlestirilmis halde. Kullanici
 * "atilan yer dogru mu" sorusunu ancak boyle yanitlayabilir.
 */
async function playSelection(): Promise<void> {
  if (!state.buffer) return;
  stopPreview();
  await resumeAudioContext();

  const pcm = await extractSelection();
  if (pcm.length === 0) return;

  const ctx = getAudioContext();
  const node = ctx.createBufferSource();
  node.buffer = toAudioBuffer(ctx, [pcm], SAMPLE_RATE);
  node.connect(ctx.destination);
  node.onended = () => {
    if (preview === node) preview = null;
  };

  // Tampon zaten yalnizca calinacak sesi iceriyor - atlama/kirpma gerekmiyor.
  node.start();
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
    const pcm = await extractSelection();

    // Kisik kayit telefon hoparlorunde duyulmaz. Yukseltme ortalama gurluge
    // gore yapiliyor; ayrintisi ve neden tepeye gore olmadigi normalize.ts'te.
    normalizeInPlace(pcm, state.boost);

    const encoded = await encodeToPayload(pcm, {
      bitrate: state.bitrate,
      content: state.content,
      preferVbr: true,
      frameDurationUs: FRAME_DURATION,
      sampleRate: SAMPLE_RATE,
      maxBytes: budgetBytes(),
    });

    const fragment = encodeFragment(encoded.bytes);
    const publicUrl: QrUrl = { prefix: publicUrlPrefix(), payload: fragment };
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
      usedVbr: encoded.usedVbr,
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
    // Onceki kaydin atilan bolumu yeni kayda uymaz.
    state.cut = null;

    // Baslangic secimi sifirdan degil, SESIN BASLADIGI yerden. Telefon
    // kayitlarinin basinda cogu zaman bir sessizlik oluyor; sifirdan
    // baslamak butcenin buyuk bir kismini hiclik kodlamaya harciyordu.
    const speech = findSpeechBounds(buffer.getChannelData(0), buffer.sampleRate);
    const fits = Math.min(budgetSeconds(), Math.max(0.01, buffer.duration - speech.startSeconds));
    state.selection = {
      start: speech.startSeconds / buffer.duration,
      end: (speech.startSeconds + fits) / buffer.duration,
    };
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

/**
 * Kullanicinin sectigi pencerenin KENARLARINDAKI sessizligi atar.
 *
 * Secimin disina tasmaz - kullanici bir yeri bilerek sectiyse arac onu baska
 * bir yere kaydirmamali. Kirpma sonrasi yer acilirsa butce izin verdigi
 * olcude sondan uzatiyoruz, boylece kazanilan sure sese donusuyor.
 */
function trimCurrentSelection(): void {
  if (!state.buffer) return;
  const duration = state.buffer.duration;

  const trimmed = trimSelection(state.buffer.getChannelData(0), state.buffer.sampleRate, {
    startSeconds: state.selection.start * duration,
    endSeconds: state.selection.end * duration,
  });

  const maxSeconds = Math.min(budgetSeconds(), duration - trimmed.startSeconds);
  const end = Math.min(trimmed.startSeconds + maxSeconds, Math.max(trimmed.endSeconds, trimmed.startSeconds + 0.01));

  state.selection = { start: trimmed.startSeconds / duration, end: end / duration };
  state.result = null;
  render();
}

/**
 * Ortadan atmayi acar/kapatir.
 *
 * Acilirken atilan bolum secimin ortasina, secimin besde biri genisliginde
 * yerlestiriliyor - kullanici sifir genislikte bir kaydiracla ugrasmasin,
 * dogrudan gorunur bir sey bulsun ve oradan tasisin.
 */
function toggleCut(): void {
  if (!state.buffer) return;

  if (state.cut) {
    state.cut = null;
  } else {
    const { start, end } = state.selection;
    const width = (end - start) / 5;
    const center = (start + end) / 2;
    state.cut = { start: center - width / 2, end: center + width / 2 };
  }

  state.result = null;
  render();
}

/** Secimi butceye sigdirir; bitrate/EC degisince cagrilir. */
function clampSelectionToBudget(): void {
  if (!state.buffer) return;
  // Atilan bolum QR'da yer kaplamadigi icin secim onun kadar daha genis
  // olabilir; sinir ham genislige degil, GERCEK sese konuyor.
  const allowedSpan = budgetSeconds() + cutSeconds();
  const maxRatio = Math.min(1, allowedSpan / state.buffer.duration);
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
    cut: effectiveCut(),
    waveColor: '#3a4152',
    selectedWaveColor: '#7cc4ff',
    selectionFill: 'rgba(124, 196, 255, 0.12)',
    cutWaveColor: '#6b4a5a',
    cutFill: 'rgba(255, 120, 140, 0.14)',
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
        <div class="metric">
          <span class="metric-label">Kodlama</span>
          <strong>${r.usedVbr ? 'VBR' : 'CBR'}</strong>
        </div>
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
        <summary>QR'ın içindeki adres (${urlText(r.publicUrl).length} karakter)</summary>
        <code class="url">${urlText(r.publicUrl).slice(0, 120)}...</code>
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
          <!-- Video de kabul ediliyor: decodeAudioData, mp4/mov icindeki ses
               parcasini cozer, telefon kayitlari cogunlukla bu bicimde gelir. -->
          <input type="file" id="file" accept="audio/*,video/*" hidden />
          ${
            hasAudio
              ? `<strong>${state.file?.name ?? 'ses'}</strong>
                 <span>${fmt(state.buffer!.duration)} · ${state.buffer!.numberOfChannels} kanal ·
                 ${state.buffer!.sampleRate} Hz</span>
                 <span class="hint">Değiştirmek için tıklayın veya yeni dosya bırakın</span>`
              : `<strong>Dosyayı buraya bırakın</strong>
                 <span>ya da tıklayıp seçin (mp3, m4a, wav, ogg, mp4...)</span>`
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
        <div class="actions trim-row">
          <button type="button" class="ghost" data-action="trim">Sessizliği kırp</button>
          <button type="button" class="ghost" data-action="cut-toggle">
            ${state.cut ? 'Ortadan atmayı iptal et' : 'Ortadan parça at'}
          </button>
          <span class="hint">Seçimin başındaki ve sonundaki boşluğu atar — bütçe sese kalır.</span>
        </div>
        ${
          state.cut
            ? `
        <div class="cut-block">
          <div class="range-row">
            <label for="cut-start">Atılan başlangıç</label>
            <input type="range" id="cut-start" min="0" max="1000" step="1"
                   value="${Math.round(cutRatioInSelection(state.cut.start) * 1000)}" />
            <span class="range-value">${fmt(state.cut.start * state.buffer!.duration)}</span>
          </div>
          <div class="range-row">
            <label for="cut-length">Atılan uzunluk</label>
            <input type="range" id="cut-length" min="0" max="1000" step="1"
                   value="${Math.round(cutWidthInSelection() * 1000)}" />
            <span class="range-value">${fmt(cutSeconds())}</span>
          </div>
          <p class="hint">
            Kırmızı bölge QR'a girmez; öncesi ve sonrası birleştirilir.
            Birleşme yerinde tıklama olmaması için kısa bir geçiş uygulanır.
            <strong>Dinle</strong> ile sonucu duyabilirsiniz.
          </p>
        </div>`
            : ''
        }

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
            <label for="boost">Ses yükseltme</label>
            <select id="boost">
              ${(['kapali', 'hafif', 'orta', 'guclu'] as BoostLevel[])
                .map(
                  (b) =>
                    `<option value="${b}" ${b === state.boost ? 'selected' : ''}>${BOOST_LABEL[b]}</option>`,
                )
                .join('')}
            </select>
            <p class="hint">Kısık kayıtları duyulur hale getirir. Sesi yalnızca yükseltir, hiç kısmaz.</p>
          </div>
          <div class="field">
            <label for="content">İçerik</label>
            <select id="content">
              <option value="konusma" ${state.content === 'konusma' ? 'selected' : ''}>Konuşma / insan sesi</option>
              <option value="muzik" ${state.content === 'muzik' ? 'selected' : ''}>Müzik / diğer</option>
            </select>
            <p class="hint">Konuşma modu insan sesini belirgin netleştirir, müzikte boğuklaştırır.</p>
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

    if (action === 'trim') trimCurrentSelection();
    if (action === 'cut-toggle') toggleCut();
    if (action === 'preview') void playSelection();
    if (action === 'generate') void generate();
    if (action === 'png') void download('png');
    if (action === 'svg') void download('svg');
    if (action === 'copy' && state.result) {
      void navigator.clipboard.writeText(urlText(state.result.publicUrl)).then(
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
    if (target.id === 'boost') {
      state.boost = (target as HTMLSelectElement).value as BoostLevel;
      state.result = null;
      render();
    }
    if (target.id === 'content') {
      state.content = (target as HTMLSelectElement).value as ContentKind;
      state.result = null;
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

    if (target.id === 'cut-start' || target.id === 'cut-length') {
      const startEl = document.getElementById('cut-start') as HTMLInputElement | null;
      const lengthEl = document.getElementById('cut-length') as HTMLInputElement | null;
      if (!startEl || !lengthEl) return;

      // Atilan bolum secimin ICINDE kalmali - disari tasan kisim zaten
      // QR'a girmiyor, kullaniciyi yaniltmayalim.
      const sel = state.selection;
      const start = sel.start + (Number(startEl.value) / 1000) * (sel.end - sel.start);
      const width = (Number(lengthEl.value) / 1000) * (sel.end - sel.start);

      state.cut = {
        start: Math.min(start, sel.end),
        end: Math.min(sel.end, start + width),
      };
      state.result = null;
      render();
      return;
    }

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
