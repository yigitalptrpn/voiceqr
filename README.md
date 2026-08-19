# VoiceQR

Ses dosyasından, **sesi kendi içinde taşıyan** QR kod üretir. Kodu bir yere basıp
yapıştırırsınız; herhangi biri telefonunun **yerleşik kamerasıyla** okuttuğunda ses
onun cihazında çalar.

Hiçbir sunucuya ses yüklenmez. Ses, adresin `#` fragment kısmında taşınır ve
fragment tarayıcıdan sunucuya hiç gönderilmez.

## Nasıl çalışıyor?

```
ses dosyası
   │  seçilen ~2.8 sn'lik bölüm
   ▼
mono 16 kHz PCM ──► Opus @ 6 kbps (WebCodecs) ──► ham paketler
                                                     │
                                    5 baytlık başlık + paketler
                                                     │
                                                 base64url
                                                     ▼
              https://<site>/#<yük>  ──►  QR kod (v40)
                                                     │
   telefonun yerleşik kamerası bu adresi açar ────────┘
                                                     ▼
                          aynı sayfa yükü çözer ve sesi çalar
```

Tek bir sayfa hem üretici hem oynatıcıdır; hangisi olduğunu adreste `#` olup
olmamasından anlar. Oynatıcı ekranı ayrı bir parça olarak yüklenir (~5 kB), yani
QR'ı okuyan kişi üretici kodunu indirmez.

## Kısıtlar — önce bunları okuyun

**1. Ses en fazla ~2.8 saniye.** Bu bir tercih değil, QR'ın fiziksel kapasitesi.
Sürüm 40 bir QR en fazla 2953 bayt taşır; adres öneki 40 baytını alır, kalan
base64url ile kodlandığında 2184 ham bayt eder. Opus'un en düşük kullanışlı hızı
6 kbps = 750 bayt/saniye.

| Hata düzeltme | QR kapasitesi | Ham ses baytı | Süre (6 kbps) |
|---|---|---|---|
| **L** (varsayılan) | 2953 | 2184 | **~2.8 sn** |
| M | 2331 | 1718 | ~2.2 sn |
| Q | 1663 | 1217 | ~1.6 sn |
| H | 1273 | 924 | ~1.2 sn |

Yani bu araçla bir şarkı çalamazsınız. Elde ettiğiniz şey konuşma kalitesinde,
kısa bir ses: sesli not, jingle, ses efekti, nakarat kırpıntısı. Müzik için ses
boğuk olur — daha temiz istiyorsanız bit hızını yükseltin, süre kısalır.

**2. QR yoğun, büyük basılmalı.** Varsayılan ayarda kod 177×177 modül içerir.
Sıradan bir telefon kamerasının okuyabilmesi için kenarını **en az 7-8 cm**
basın. Uygulama her üretimde önerilen boyutu ekranda söyler.

**3. Site yayında olmalı.** Ses linkin içinde olsa da, sayfanın kendisi bir
yerde durmalı ki kamera açtığında bir şey bulsun. Adres değişirse **eskiden
basılmış tüm QR'lar çalışmaz hale gelir** — adres tek bir yerde,
`src/config.ts` içinde tutulur.

**4. Uzun adres.** Üretilen link ~2950 karakterdir. Bazı kamera uygulamaları
bunu kısaltarak gösterir; nadiren kırpabilirler. Oynatıcı kırpılmış linki fark
edip kullanıcıya tekrar okutmasını söyler.

## Geliştirme

```bash
npm install
npm run dev          # geliştirme sunucusu
npm test             # birim testleri (vitest)
npm run test:e2e     # uçtan uca testler (Playwright + Chromium)
npm run build        # tip denetimi + üretim derlemesi
```

### Testler ne doğruluyor?

Birim testleri saf katmanı kapsıyor: base64url gidiş-dönüşü, yük başlığının
paketlenmesi, OpusHead'in spesifikasyona uygunluğu ve kapasite matematiği —
sonuncusu tablodaki sabitleri **gerçek `qrcode` kütüphanesine karşı** doğrular.

Uçtan uca testler tam döngüyü koşar: test tonu → üretici → QR PNG'i indir →
**PNG'i gerçekten ZXing ile tara** → çıkan adrese git → oynatıcıdan WAV indir →
çözülen sesin süresini ve baskın frekansını ölç. Yani "bir şey çaldı" değil,
"doğru ses çaldı" doğrulanıyor.

## Yayınlama

`main` dalına push edildiğinde `.github/workflows/deploy.yml` testleri koşar ve
geçerse GitHub Pages'e yayınlar.

**Tek seferlik elle adım:** Depo ayarlarından **Settings → Pages → Source**
kısmını **GitHub Actions** olarak ayarlayın. Bu yapılmadan iş akışı yayınlayamaz.

Adresi değiştirmek isterseniz `src/config.ts` içindeki `SITE_ORIGIN` ile
`vite.config.ts` içindeki `BASE` birlikte güncellenmelidir.

## Tarayıcı desteği

| | Üretici | Oynatıcı |
|---|---|---|
| Chrome / Edge 94+ | ✅ | ✅ |
| Safari 16.4+ | ✅ | ✅ |
| Firefox 130+ | ✅ | ✅ |
| Daha eskiler | ❌ uyarı gösterir | ✅ WASM çözücüye düşer |

Oynatıcı, WebCodecs bulamazsa `opus-decoder` (WASM) paketini **tembel** yükler —
destekleyen tarayıcılar bu ~87 kB'ı hiç indirmez.

Not: iOS Safari kullanıcı dokunuşu olmadan ses çalmaya izin vermez. Oynatıcı
otomatik oynatmayı dener, engellenirse büyük "çal" düğmesi bekler.
