/**
 * Tek giris noktasi.
 *
 * Ayni sayfa hem uretici hem oynatici; hangisi oldugunu adresteki `#`
 * fragmentinin dolu olup olmamasindan anlar. Ekranlar DINAMIK import edilir:
 * QR'i okuyan yabancinin telefonu, hic kullanmayacagi uretici kodunu
 * (dalga formu, QR uretimi) indirmez.
 */

import './styles.css';

const app = document.getElementById('app');

function payloadFromLocation(): string {
  // `location.hash` bastaki '#' ile gelir.
  return decodeURIComponent(location.hash.slice(1)).trim();
}

async function route(): Promise<void> {
  if (!app) return;
  const payload = payloadFromLocation();

  if (payload.length > 0) {
    const { mountPlayer } = await import('./player');
    mountPlayer(app, payload);
  } else {
    const { mountGenerator } = await import('./generator');
    mountGenerator(app);
  }
}

// Kullanici uretilen linki "oynaticida dene" ile actiginda ya da geri
// tusuna bastiginda ekranin degismesi gerekir.
window.addEventListener('hashchange', () => {
  location.reload();
});

void route();
