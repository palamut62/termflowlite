# remote-attention - Telefonda ajan bildirimleri

Durum: Faz B ntfy ile UYGULANDI 2026-10-26 (dal `feature/phone-push`, yayinlanmadi); Faz A taslak. Bagimli: agent-attention. Ortak kurallar: [README.md](README.md), [../remote-access.md](../remote-access.md).

## Amac
Masa basinda degilken "ajan bitti / onay bekliyor" bilgisini telefonda gormek ve oradan cevap vermek.
Remote Access (Tailscale + QR) zaten canli terminal ve yazma sagliyor; eksik olan dikkat sinyali.

## Teknik sinir (karar gerektirir)
Gercek push (uygulama kapaliyken bildirim) Service Worker + Web Push ister; bunlar guvenli baglam (HTTPS) ister.
Remote sunucu bugun `http://100.x.y.z` uzerinden calisiyor (Tailscale WireGuard sifreli ama tarayici icin
"guvenli baglam" degil). Bu yuzden iki faz:

### Faz A - Uygulama acikken (HTTPS gerektirmez)
- WebSocket'e yeni mesaj `attention{tabId, kind: 'needs-input'|'done'|'error', title, at}` ve `tabs`
  listesine `attention` alani. Telefon: ust bant ("Claude Code needs you - Open"), sekme listesinde nokta,
  baslik cubugunda sayi, Android'de `navigator.vibrate` (iOS desteklemez), istege bagli kisa ses.
- Telefon gorunur degilken (`visibilitychange`) gelen olaylar biriktirilir, geri donulunce ozet bant.
- Telefonda bir sekmeyi acmak masaustundeki okunmadi durumunu da temizler (iki yonlu).
- Ayarlar > Remote Access: "Send attention to phones" (varsayilan acik).

### Faz B - Uygulama kapaliyken (ONAY GEREKLI)
- `tailscale serve` ile `https://<makine>.<tailnet>.ts.net` uzerinden sunmak (Tailscale'in kendi sertifikasi;
  yalniz tailnet icinden erisilir, mevcut "LAN/internete acilmaz" kararini bozmaz) + Service Worker + Web Push (VAPID,
  anahtarlar `userData`'da). iOS'ta yalniz ana ekrana eklenmis uygulamada calisir.
- Kullanicinin tailnet'inde HTTPS sertifikalarinin acik olmasi gerekir; degilse Faz A ile kalinir.

## Basari olcutleri
- Faz A: telefonda TermFlow acikken arka plandaki Claude sekmesi izin isteyince 1 sn icinde bant gorunur,
  "Open" dogru sekmeye gider; masaustundeki nokta temizlenir.
- Faz B: telefon uygulamasi kapaliyken sistem bildirimi gelir, tiklayinca o sekme acilir.

## Test
- Birim: hub `attention` yayini (fake soket), telefon tarafi biriktirme/ozet mantigi.
- E2E: `e2e/remote.spec.ts`'e sahte hook olayi -> telefon gorunumunde bant.
- Canli: gercek iPhone ve Android (DURUM.md'deki bekleyen telefon denemesiyle birlikte).

## Dilimler
1. Protokol + hub yayini + telefon bandi ve noktalari (Faz A).
2. Iki yonlu okunmadi temizligi + ayar.
3. Faz B (onaydan sonra ayri spec guncellemesi).

## Faz B karari (kullanici, 2026-10-26): ntfy
- Web Push yerine ntfy: TermFlow iPhone uygulamasi (`../termflow-lite-ios`, xtool ile WKWebView kabugu) ucretsiz
  Apple ID ile APNs alamaz. Masaustu olay olunca ntfy sunucusuna JSON yayinlar, telefondaki ntfy uygulamasi bildirimi gosterir.
- Gonderilen: baslik (`alertTitle`) + sekme adi, oncelik, etiket, `click: termflow://tab/<id>`. Ajan mesaji / terminal ciktisi GITMEZ.
- Ne zaman: `raiseAttention` isaret koydugunda (sekme gorunmuyor ya da pencere odakta degil) ve `remote.push.enabled`.
- Ayar: `remote.push {enabled, server (varsayilan https://ntfy.sh), topic}`; konu acilinca main'de uretilir
  (`termflow-` + 15 bayt base64url) ve korunur; "New topic" eskisini gecersiz kilar. Sunucu/konu yalniz main'den okunur,
  telefon `remote` ayarini degistiremez (DESKTOP_ONLY_SETTINGS). Ayarlar > Remote > Phone notifications (+ Send test).
- Bildirime dokununca: ntfy `termflow://tab/<id>` acar -> iOS uygulamasi `origin/#tab=<id>` yukler -> istemci
  `takeTabLink` ile sekmeye gecer (hashchange, sayfa yenilenmez).
- Kod: `src/main/remote/phonePush.ts` (+test), `ipc/alerts.ts` (ALERTS_PHONE_PUSH, _TEST), `attention/alerts.ts`,
  `settings/RemoteSettings.tsx`, `src/remote/src/App.tsx`.
- Sinir: kendi ntfy sunucusunda iOS aninda bildirim icin sunucuda `upstream-base-url: https://ntfy.sh` gerekir.

## Bildirimden onay (2026-10-27, dal `feature/phone-push`, yayinlanmadi)
- "needs-input" bildirimi Remote Access calisirken iki ntfy `http` aksiyonu tasir: Approve (Enter) / Reject (Esc).
  ntfy iOS uygulamasi butona basinca `POST http://<100.x>:<port>/api/push-action {token}` yapar (uygulama acilmaz).
- Kimlik: cihaz anahtari ntfy'a GITMEZ. Her bildirime iki tek kullanimlik 24 baytlik token (`PushActionTokens`):
  biri kullanilinca digeri yanar, ayni sekmeye yeni bildirim eskileri gecersiz kilar, 10 dk omur, sekme kapaliysa 410.
  Endpoint Origin istemez (ntfy uygulamasi tarayici degil), IP basina dakikada 10 deneme. Sunucu yalniz Tailscale IP'sinde.
- Sinir: iOS ntfy `clear:true`'yu http aksiyonlarinda yok sayar (bildirim ekranda kalir). Enter/Esc Claude Code ve Codex
  izin isteminde varsayilan secenegi onaylar/reddeder; baska bir istemde ayni tuslar gider.
