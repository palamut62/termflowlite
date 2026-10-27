# Remote Access (mobil web) - Spec

Durum: onaylandi 2026-10-09. Dal: `feature/remote-access`.

## Amac
Telefondan, Tailscale agi uzerinden, masaustundeki TermFlow Lite'i tam kontrol etmek:
sekmeleri canli izlemek ve yazmak, sekme acmak/kapatmak, shell/profil/provider/SSH ve
tum ayarlari yonetmek, ajan oturumlarini surdurmek, proje/git/memory islemleri.
Telefon ayri bir kopya degil, masaustunun uzaktan kumandasidir: iki ekran ayni durumu gorur.

## Verilen kararlar
- Sunucu Electron ana surecinde gomulu; yalnizca Tailscale IPv4 adresine (100.64.0.0/10) baglanir.
  LAN ve internet dinlenmez. Tailscale yoksa sunucu acilmaz, durum "no-tailscale" olur.
  Aktarim HTTP + WebSocket (Tailscale WireGuard ile sifreli).
- Varsayilan kapali (`settings.remote.enabled=false`). Ayarlar > Remote'tan acilir.
- Eslestirme: masaustu QR gosterir: `http://<100.x>:<port>/#pair=<kod>`. Kod 32 bayt rastgele,
  5 dk gecerli, tek kullanimlik. Telefon kodu `POST /api/pair` ile uzun omurlu cihaz anahtarina
  cevirir (32 bayt); anahtar tarayicida (localStorage) saklanir, masaustunde yalnizca SHA-256'si
  (`userData/remote-devices.json`, atomik yazim).
- Eslestirme kodu 10 karakter Crockford base32 (QR yaninda elle yazilabilir, 50 bit, tek kullanim,
  5 dk, IP basina dakikada 10 deneme). Telefonda "Scan QR code": HTTP'de canli kamera yok, fotograf
  (`input capture`) + jsQR ile okunur (CSP `img-src blob:`). Masaustunde cihaz satirinda "Reconnect":
  o cihaza bagli kod; okutulunca ayni kayit yeni anahtar alir, eski anahtar ve soketleri kapanir
  (iPhone ana ekran uygulamasi Safari/Edge deposunu goremez).
- Telefon istemcisi sabit dosya adlariyla derlenir (`assets/app.js`) ve her dosya ETag ile yeniden
  dogrulanir: ana ekran uygulamasinin onbellekteki eski index.html'i guncellemeden sonra da calisir.
- Oturum suresizdir; yalnizca masaustu "Disconnect" / "Disconnect all" ile biter. Iptal edilen
  cihazin soketleri aninda kapanir.
- WebSocket: ilk mesaj `auth` olmali (anahtar URL'de tasinmaz), Origin = Host kontrolu,
  eslestirme denemelerine hiz siniri (IP basina dakikada 10).
- Provider API anahtarlari telefona asla gitmez; telefon yalnizca yeni anahtar yazar/siler.
  `asciiBackgrounds` (buyuk resimler) telefona gonderilmez.
- PTY boyutu (2026-10-09 revize, kullanici karari): varsayilan AYNA modu; telefon PTY boyutuna
  dokunmaz, masaustu genisligindeki goruntuyu ekrana olcekler (Zoom 1x-3x, yakinlasinca kaydirilir),
  masaustu yeniden boyutlaninca `size` mesajiyla izler. Telefonda "Fit" (`termflow.remote.fitPhone`)
  acilirsa eski davranis: PTY telefon boyutuna gecer, telefon ayrilinca masaustu boyutu geri gelir.
- Cikti telefona `PtyCore` ham dokunusundan gider; masaustundeki render modundan (buffer) bagimsizdir.
- Sekme durumu renderer'da kalir. Renderer sekme listesini ana surece yayinlar (`remote:tabs`);
  telefonun sekme komutlari (ac/kapat/yeniden adlandir/one al/ajan surdur/kayitli komut)
  ana surec uzerinden renderer'a iletilir ve sonucu beklenir.
- Ana surecin `ipcMain.handle` kanallari bir kayit defterine alinir; telefon yalnizca izin
  listesindeki kanallari cagirabilir (dialog, pencere, pano, sistem acma kanallari kapali).
- Telefondan ayar degisince masaustune `settings:changed` gider; masaustu degisikligi de
  tum telefonlara yayinlanir.
- Mobil arayuz ayri Vite girisi (`src/remote/` -> `out/remote/`), React + xterm.js, Ingilizce
  (uygulama arayuzu karari). Urun sahibi atfi About'ta.

## Protokol (JSON, WebSocket `/ws`)
Istemci -> sunucu: `auth{token}`, `call{id,method,params}`, `sub{tabId,cols,rows}`,
`unsub{tabId}`, `input{tabId,data}`, `resize{tabId,cols,rows}`.
Sunucu -> istemci: `hello{device,tabs,activeTabId,settings,shells,platform,version}`,
`result{id,ok,value|error}`, `tabs{tabs,activeTabId}`, `settings{settings}`,
`snapshot{tabId,data}`, `data{tabId,data}`, `exit{tabId,exitCode}`, `revoked`.
Metotlar: `ipc` (izin listeli kanal), `tab.open|close|rename|focus|restart`,
`agent.resume`, `saved.list|run`, `device.forget` (telefon kendi kaydini siler).

## Fazlar
1. Cekirdek: sunucu, eslestirme, cihaz yonetimi, sekme listesi, canli terminal, boyut devralma,
   sekme ac/kapat, mobil tus cubugu (Esc/Tab/Ctrl/Alt/oklar/^C) ve yazma kutusu.
2. Ayarlar: genel ayarlar, shell/profil/provider (anahtar yazma dahil)/SSH yonetimi.
3. Kalanlar: ajan oturumlari (surdur), kayitli komutlar, proje (git/gorevler/dosyalar), Memory.

## Test
- Birim: tailscale IP secimi, cihaz deposu (tek kullanim, sure, hash), protokol dogrulama,
  izin listesi, boyut hakemligi (TerminalManager), hub (fake soket + fake renderer).
- Entegrasyon: gercek http+ws sunucusu 127.0.0.1'de (test kancasiyla) eslestirme + auth + akis.
- Canli: Tailscale IP'sinden yerlesik tarayicida mobil gorunum.

## Yonetici sekmeleri (2026-10-15, kullanici karari)
- Windows hicbir uygulamanin UAC penceresine tiklamasina izin vermez (guvenli masaustu), bu yuzden
  "PC'deki herhangi bir UAC'yi telefondan onayla" yapilmaz. Yerine: telefonda PIN ile onaylanan yonetici sekmesi.
- Kurulum masaustunde, bir kez UAC ile: Ayarlar > Remote > "Administrator tabs from the phone", PIN (6-12 rakam).
  Yukseltilmis PowerShell `%ProgramData%\<slug>\elevation.json`'a scrypt PIN hash'ini yazar (klasor ACL'i yalniz
  Administrators + SYSTEM) ve "<urun> Elevated" adli, tetikleyicisiz, "en yuksek yetkiyle" calisan gorev kaydeder
  (`<exe> --termflow-elevated-host`). Kapatma/PIN degistirme yine UAC ister.
- Kullanim: telefonda New tab > "Run as administrator" + PIN. Hub `tab.open{elevated,pin}` gorev kurulu degilse
  reddeder; PIN 60 sn'lik tek kullanimlik onay olarak ana surecte bekler, sekme `elevated` bayragiyla acilir,
  PtyCore `spawnElevated` ile gorevi `schtasks /run` ile baslatir. Yukseltilmis host PIN'i kendisi dogrular
  (5 yanlis -> 15 dk kilit), kabugu node-pty ile acar ve named pipe (`\.\pipe\<slug>-elevate-<kullanici hash>`)
  uzerinden JSON satirlariyla aktarir. Yanlis PIN / kurulum yok / baglanti yok sekmeye kirmizi yazilip sekme kapanir.
- Sekme basligi `Admin: ...` (masaustu, IDE, widget ve telefon ayni isaret). Oturum geri yuklenince ve yeniden
  baslatmada yonetici sekmesi kendiliginden yukselmez: yeniden baslatma yeni telefon onayi ister.
- DURUM (2026-10-15): YAYINLANMADI. Kullanici basina kurulumda uygulama dosyalari kullanici yazilabilir klasorde;
  PIN kontrolu bu dosyalarin icinde oldugu icin tasarim su haliyle UAC'yi zayiflatir. Yayin oncesi yukseltilmis
  hostun korumali bir konumdan calismasi (ya da imzali servis) gerekir; karar bekliyor.

## Telefondan dosya yukleme (2026-10-22)
- Terminal ekranindaki key bar'da ataç (Paperclip) butonu: telefon dosya secici (galeri/kamera/dosyalar, coklu secim).
- `POST /api/upload`: ham govde, `Authorization: Bearer <cihaz anahtari>`, `X-File-Name` (URI-encoded), Origin = Host.
  Yalniz eslesmis cihaz; govde diske akar (bellege alinmaz), sinir 200 MB (413). Ayni ad varsa `ad (1).uzanti`, uzerine yazilmaz.
- Kayit yeri: `<Downloads>/TermFlow Uploads/` (`uploadDir`). Ad guvenli hale getirilir (`uploads.ts safeUploadName`: yol, kontrol
  karakteri, Windows ozel adlari).
- Basarili yuklemede dosya yolu (bosluk varsa tirnakli) aktif sekmeye yazilir; ajan dosyayi bu yoldan okur. Enter gonderilmez.
- Kapsam disi: yuklemeden ilerleme cubugu, kesilen yuklemeyi surdurme, PC'den telefona indirme.

## iPhone uygulamasi koprusu (2026-10-27)
- TermFlow iPhone uygulamasi (`../termflow-lite-ios`, WKWebView) `window.webkit.messageHandlers.termflow` saglar; telefon
  istemcisi `src/remote/src/native.ts` ile kullanir, duz tarayicida hepsi devre disi. Uygulama yalniz kayitli sunucu kokenindeki
  ana cerceveden mesaj kabul eder.
- Sayfa -> uygulama: copy, paste (iPhone panosu), awake (bir sekme `running` iken ekran kapanmaz), haptic (en az 5 sn calisan
  sekme durunca / girdi isteyince, 4 sn aralik), dictate (mikrofon tusu basili tut: Apple konusma tanima, metin mesaj kutusuna),
  lock (Face ID kilidi; acip kapatmak da kimlik ister), computers (kayitli bilgisayarlar arasinda gecis).
- Uygulama -> sayfa (`window.termflowNative.receive`): text (Kisayol `termflow://send?text=..&enter=0`, yapistirma, paylasilan
  dosya yolu), dictation, info (kilit, biyometri, imza bitis tarihi), notice. `token()` paylasilan dosyayi uygulamanin
  `/api/upload`'a kendisinin gondermesi icin.
- Telefon istemcisinde herkes icin: Quick prompts (Zap tusu, telefonda saklanan hazir promptlar), sekme menusu > Copy text
  (son 300 satir secilebilir metin), Project > Review changes (`scm:diff` izin listesine eklendi, salt okunur).
