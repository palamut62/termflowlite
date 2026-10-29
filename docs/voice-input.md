# Voice Input (bas-konus) - Spec

Durum: onaylandi 2026-10-09. Surum 1.23.0.

## Amac
Aktif terminalde Space'i basili tutup konusmak; birakinca konusma yaziya cevrilip duzeltilmis
metin imlecin oldugu yere eklenir (Enter'a basilmaz). Shell ve ajan (Claude Code, Codex, OpenCode)
girdilerinde ayni calisir.

## Verilen kararlar
- Tus: Space uzun basis (varsayilan 400 ms, ayardan 250-1000). Kisa basis normal bosluk yazar;
  Space basiliyken baska tusa gecilirse once bosluk yazilir, kayit baslamaz. Kayit sirasinda Esc
  iptal eder. Pencere odagi kaybolursa kayit iptal edilir; en fazla 60 sn.
- Motor: OpenRouter, ses kabul eden model (`architecture.input_modalities` icinde `audio`), tek
  istekte yaziya cevirme + duzeltme. Varsayilan `google/gemini-2.5-flash-lite`. Anahtar Memory ile
  ortak (`ProviderSecretStore` id `termflow-memory`), renderer'a gitmez.
- Ses bicimi: OpenRouter webm kabul etmez; renderer 16 kHz mono 16-bit WAV kaydeder
  (`src/shared/wav.ts`), base64 `input_audio` olarak gider.
- Duzeltme: "Metni temizle" (varsayilan acik): noktalama/yazim, dolgu sozcukleri atilir, teknik
  terimler dogru yazilir, dil ve anlam korunur. Kapaliyken yalniz noktalama. Istege aktif sekmenin
  turu (shell / ajan adi) baglam olarak eklenir. Konusma yoksa bos doner, hicbir sey yazilmaz.
- Ekleme: `term.paste()` (bracketed paste'e uyar), Enter yok.
- Ayarlar > Voice: varsayilan kapali, acarken sesin OpenRouter'a gidecegini soyleyen in-app onay;
  model secici yalniz ses kabul eden modeller (24 saat cache, Refresh), Test gercek ses istegi
  (sure + maliyet), basili tutma suresi, dil (otomatik/Turkce/Ingilizce).
- Telefon istemcisine eklenmez (telefon klavyesinin kendi dikte dugmesi var).

## Eller serbest (2026-10-29)
Elchi (elchi.xyz, Handy fork'u) incelemesinden alindi; wake word / surekli dinleme ve canli metin
bilincli olarak yok (sesin surekli OpenRouter'a gitmesi, OpenRouter'da akisli STT yok).
- `Ctrl+Shift+Space` kaydi kilitler, tus basili tutulmaz. Space ya da tekrar `Ctrl+Shift+Space`
  bitirir, Esc iptal eder, odak kaybi iptal eder, en fazla 60 sn.
- Sessizlikte bitirme: konusma duyulduktan sonra `silenceMs` (varsayilan 1500; 1000/2500/4000;
  0 = yalniz Space) sessizlik olunca kayit biter ve yaziya cevrilir. Konusma esigi RMS 0.015;
  10 sn hic konusma yoksa kayit gonderilmeden iptal edilir (`voice/handsFree.ts`).
- "Gonder" ile onay (`sendWord`, varsayilan kapali): yalniz ajan sekmelerinde, metin "gönder",
  "send" ya da "enter" ile biterse kelime silinir, metin yapistirilir, 80 ms sonra Enter. Shell'de
  hic calismaz (gorulmeden komut calistirmasin). Istege kelimeyi korumasi soylenir.
- Terimler (`terms`, en fazla 50): istege "bu adlari tam boyle yaz" olarak eklenir.

## Test
- Birim: WAV kodlayici, basili tutma durum makinesi, istek govdesi/yanit ayrıstirma (fetch mock),
  model katalogunda ses bayragi.
- E2E: Chromium sahte mikrofonu + sahte OpenRouter sunucusu (`TERMFLOW_E2E_OPENROUTER_URL`).
- Canli: Windows konusma sentezinden WAV, gercek anahtarla tek istek.

## Sesli okuma (Read Aloud)
- Terminalde metin sec, sag tik > "Read Aloud"; durdurmak icin menu ya da ekrandaki Stop. Ayarlar > Voice > Read Aloud ile acilir (varsayilan kapali).
- Motor: yerel tts-studyo (`C:\Users\umuti\Projects\tts-studyo`, Antalia-2 Mini / EMA Lightning, Turkce, CPU, cevrimdisi). Sunucu kapaliysa `src/main/voice/speak.ts` onu `.venv` python'u ile 127.0.0.1:8765'te baslatir, uygulama kapaninca durdurur.
- Metin cumle cumle `/api/tts` ile uretilir, renderer Web Audio ile kesintisiz calar (`renderer/voice/speak.ts`). En fazla 5000 karakter.
- Dikteyle ilgisi yok: bu modeller yalniz metinden ses uretir (TTS), konusmayi yaziya cevirmez.
