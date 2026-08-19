/**
 * Uretilen QR'lar bu adresi ICLERINDE tasir. Adres degisirse eskiden basilmis
 * tum QR'lar calismaz hale gelir - bu yuzden tek noktada tutuluyor ve
 * degistirilmesi bilincli bir karar olmali.
 *
 * `import.meta.env.BASE_URL` Vite'in `base` ayarindan gelir ('/voiceqr/').
 */
const SITE_ORIGIN = 'https://yigitalptrpn.github.io';

/** QR'a yazilan URL'in `#` dahil sabit onu. Her bayti QR kapasitesinden yer. */
export function publicUrlPrefix(): string {
  return `${SITE_ORIGIN}${import.meta.env.BASE_URL}#`;
}

/**
 * Onizleme/test icin: kullanicinin su an actigi adres. Yerelde `npm run dev`
 * ile calisirken uretilen linkin denenebilmesi icin gerekli.
 */
export function currentUrlPrefix(): string {
  return `${location.origin}${import.meta.env.BASE_URL}#`;
}
