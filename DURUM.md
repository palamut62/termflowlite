# TermFlow Lite - Durum

guncel: 2026-10-27

> Bu dosya projeye giren her yapay zeka aracinin ilk okudugu yerdir. Kisa tutulur (en fazla ~80 satir).
> Kalici bilgi (mimari, kararlar, ayrintili gecmis) `PROJE-REHBER.md`'de (varsa) / README'de.

## Ne bu proje
Minimal, hizli, cok ozellestirilebilir capraz platform (Windows/Linux) terminal; gelistiriciler ve CLI ajan kullanicilari icin.
Stack: Electron (electron-vite), React, TypeScript, xterm.js, node-pty. Surum 1.27.0 (freeware, kapali kaynak).
Kaynak repo PRIVATE `palamut62/termflow-lite-source`; release'ler PUBLIC `palamut62/termflow-lite`. Site: termflowlite.lol (Vercel, `website/`).

## Calistir / test et
- `npm run dev` (gelistirme), `npm run verify` (vitest + tsc + build)
- `npm test` (birim), `npm run test:e2e` (Playwright, ~8 dk), `npm run build:site` (site karakter demosu)
- Paket: `npm run dist:win` / `dist:linux`; yayin: `npm run release:tag` (CI yayinlar, bkz. `docs/releasing.md`)

## Asama
- [x] 1.9-1.13: motion, Mica/Acrylic, OSC 133 shell integration, komut bloklari, ASCII karakter motoru
- [x] 1.15-1.17: dosya paneli, medya onizleme kartlari, profil basina ASCII arka plan
- [x] Site EN/TR dil destegi, Buy Me a Coffee butonu
- [x] 1.17.2: kapali kaynaga gecis (freeware); CI/RELEASES_TOKEN akisi uctan uca dogrulandi
- [x] 1.18.0 Agent Memory: 30 gunluk session hafizasi + yerel MCP, Ayarlar > Memory. Spec `docs/agent-memory.md`, 8/8 dilim
- [x] 1.19.0 Secimin uzerine yazma: cift tikla secilen kelime yazilan metinle yerinde degisir
- [x] 1.19.1 Resim yapistirma: panodaki resim PNG olarak kaydedilip yolu yapistirilir
- [x] 1.20.0 Secim duzeltmesi: Claude Code caret'i, tum input secilip Delete ile temizleme
- [x] 1.20.0 Memory model katalogu: OpenRouter'dan tum modeller, 24 saat cache, Refresh + Test
- [x] 1.20.1 Model secici: datalist yerine `settings/ModelPicker.tsx`; acilinca tum modeller, All/Free filtresi, ucretsizler yesil
- [x] 1.21.0 Remote Access: Tailscale + QR ile telefondan tam kontrol; spec `docs/remote-access.md`, 3/3 faz; site f8 (EN/TR)
- [x] 1.21.1 Telefon klavyesi (dokununca acilir, canli yazma, IME uyumlu), cift terminal cevabi giderildi, sekme cubugunda bagli telefon simgesi
- [x] 1.22.0 Telefon: eslestirme ekraninda QR tarama (fotograf + jsQR), elle yazilabilir kod, masaustunde cihaz basina Reconnect QR (ayni kayit, yeni anahtar), ana ekran uygulamasi icin sabit dosya adlari + ETag
- [x] 1.23.0 Voice Input: Space basili tut-konus, OpenRouter ses modeliyle yaziya cevirme + temizleme, Enter'siz ekleme; spec `docs/voice-input.md`; site f9 (EN/TR, `assets/voice.webp`), f8 Remote metni ayna/Fit ve QR tarama ile guncellendi, Vercel prod
- [x] 1.26.0 (yayinlanmadi) IDE Orchestration: ajanlar isi baska ajanlara devreder (termflow-agents MCP, worktree + `deleg/` dali, Delegated paneli); spec `docs/agent-ide/orchestration.md`, 6/6 dilim
- [x] 1.24.0 Orca paritesi (8 modul + agent-detect): yayinda, Release + verify-release yesil, bu PC'ye kuruldu, site `#agents` bolumu (EN/TR, `assets/agents.webp`) Vercel prod. Kalan Orca modulleri: worktree-note, agent-hibernate, agent-race, scheduled-prompts, remote-attention (`docs/orca-parity/`)

## Ek (2026-10-17)
- **1.26.0 yayinda (2026-10-17):** Lite + Agent IDE Release ve verify yesil (run 39047141362, GitHub odeme sorunu cozuldu), site Vercel prod (indirme linkleri v1.26.0). Kural: her degisiklikte iki surum derlenir, yalniz Agent IDE sessiz kurulur
- Orchestration iscileri: + agy, gemini, qwen, copilot, kimi, droid (duz metin cikti). Canli: agy gecti; gemini bu PC'de hesap/proje hatasi
- Ayarlar > Terminal > "Launch at Startup" (`launchAtLogin`, main `applyLoginItem`, yalniz paketli uygulamada). Test edilmedi: kurulu surumde elle dene.
- Ajan CLI oto-guncelleme: `main/agentUpdater.ts` (acilis +20 sn, sonra 24 saatte bir; yalniz npm global: claude/codex/opencode/gemini/qwen/copilot/pi/codebuff), ayar `autoUpdateAgents`, durum Ayarlar > Profiller satirlarinda + "Check now". Native kurulumlar (grok/droid/kimi...) dokunulmaz. Paketlenip kurulmadi.

## Son oturum (2026-10-27, son arac: Claude Code, dal feature/phone-push)
- ntfy "needs you" bildirimine Approve (Enter) / Reject (Esc) butonlari: tek kullanimlik token, `POST /api/push-action` (`phonePush.ts PushActionTokens`, `RemoteController.pushActions`). Spec `docs/orca-parity/remote-attention.md` sonu.
- Telefon istemcisi: iPhone uygulamasi koprusu `src/remote/src/native.ts` (pano, ekran acik, haptik, basili tut-konus, Face ID, bilgisayarlar), Quick prompts, Copy text, Project > Review changes (`scm:diff` izin listesinde). `docs/remote-access.md` sonu. iOS tarafi `../termflow-lite-ios` (commit b764c6b).
- verify yesil. Yayinlanmadi, surum artmadi. Gercek iPhone + ntfy ile denenmedi.

## Onceki oturum (2026-10-26 aksam, dal feature/phone-push)
- iPhone uygulamasi `../termflow-lite-ios` (xtool, WKWebView kabugu) + telefon bildirimi (ntfy, `termflow://tab/<id>`). Telefonda calistigi dogrulandi (2026-10-27).
- Teshis notu: Claude Code fare raporlama ACMIYOR (`?1000/1002/1006` yok), imleci gizliyor (`?25l`) - sorun fare modu degil caret bulmaydi. Kalan sinir: cok satirli prompt kutusunda caret secimin fiziksel satirinda degilse `planSelectionEdit` hala reddediyor (ok sayisi kutu cercevesi yuzunden yanlis cikardi).


## Yarim kalan / siradaki adim
- **Telefon bildirimi + iOS uygulamasi (2026-10-27):** paketle + kur (asagidaki kural), iPhone'a yeni iOS surumunu `xtool dev` ile kur, gercek telefonla dene: ntfy Approve/Reject, native tuslar, Face ID, Kisayol linkleri, Review changes. Sonra surum + CHANGELOG + yayin karari. Detay `docs/orca-parity/remote-attention.md`, `docs/remote-access.md`
- **Telefondan dosya yukleme (2026-10-23, commitlendi, yayinlanmadi):** kod + birim test tamam (`remote/uploads.ts`, `POST /api/upload`, key bar ataç butonu; `docs/remote-access.md`). Gercek telefonla denenmedi; paketlenip kurulmadi (yeni ozellik: surum artar, CI yayinlar)
- **Orchestration (IDE):** kod tamam, kurulu; varsayilan KAPALI. Gercek koordinatorden deneme kullanicida: Ayarlar > Orchestration > Enable + Connect (Claude/Codex/OpenCode MCP kaydi). Linux elle denenmedi; `opencode serve --attach` paralelligi olculmedi. Site bolumu yok
- IDE yayin reposu acildi: PUBLIC `palamut62/termflow-agent-ide` (README + LICENSE). CI'da `release-ide-*` isleri ona yukler; `RELEASES_TOKEN` (fine-grained) bu repoya da Contents: write almali, kullanici token'a repoyu eklemeli, yoksa IDE isleri 403. IDE updater acildi, `.deb`/updater adi `termflow-agent-ide` (extraMetadata). IDE notlari `CHANGELOG-IDE.md`
- **Agent IDE:** Faz 0-4 + orchestration tamam (PRD 4.10/12b). Karar bekleyen: Faz 5 kalan (tarayici/design mode, CLI) ve Create worktree 'Run on WSL/SSH' (uzak calisma alani modeli gerekir). IDE Explorer sag tik menusu hala kapali
- E2E IDE review testi yuk altinda bir kez kirildi (worktree listesi yuklenmedi), tekrarda 3/3 gecti
- Memory guncelleme sikligi (Ayarlar > Memory > Update: saatlik/gunluk/haftalik, varsayilan saatlik; zamani gelince yalniz yeni/degisen session analiz edilir, yoksa model cagrilmaz, onceki kullanim bilgisi korunur). Surum 1.24.0 kaldi, yerel kurulum
- Elle dogrulanmadi: Windows gorev cubugu rozeti/flashFrame, gercek sistem bildirimi; Cursor Agent/Amp/Aider/Crush bayraklari (kurulu degil)
- Remote Access gercek telefonla (iOS Safari + Android Chrome) denenmeli: Windows Guvenlik Duvari izni, yazilim klavyesi/visualViewport, iOS'ta localStorage silinmesi (ana ekrana ekleyince kalici)
- 1.22.0 / 1.23.0 yayinda (2026-10-09), bu PC'ye kuruldu. Elle denenmeli: iPhone ana ekran uygulamasinda 'Scan QR code' / Reconnect (gercek telefon); Voice Input gercek sesle (OpenRouter'a kredi eklenince Ayarlar > Voice > Test + Space basili tut)
- Gercek ajan kaydi (Memory Connect) yalniz testlerde mock'landi; kurulu surumle Claude/Codex/OpenCode'da elle denenmeli

## Acik sorunlar / bilinen sinirlar
- Sekme durumu Claude Code / Codex'te artik ajanin kendi olayindan (agent-hooks); OpenCode ve yeni katalog ajanlarinda hala cikti tahmini
- E2E derleme sonrasi ilk acilista ara sira 30 sn `.tab` bekleme zaman asimi; tekrarda geciyor
- E2E `app.spec` "pastes ..." iki testi gercek OS panosuna yazar; pano kilitliyken (2026-10-07) degisiklikten bagimsiz kirilir
- CI E2E `afterEach app.close()` 60 sn teardown zaman asimi (1.6.1'den beri, kararsiz)
- Birim testlerde bir test ara sira 5 sn zaman asimina dusuyor (tekrarda geciyor); `@vitest/coverage-v8` kurulu degil
- PSReadLine 2.1+ cift oneri korumasi yalniz script ile test edildi (makinede 2.0)
- zsh shim'i Linux'ta elle dogrulanmali
- README ekran goruntuleri yeni gorselleri icermiyor

## Dokunma (verilmis kararlar)
- Detay `PROJE-REHBER.md` "Verilmis kararlar"da; ozet:
- Native dialog yasak; bilgi icin `toastStore`
- Backdrop'ta `transparent:true` kullanilmaz (Mica/Acrylic `setBackgroundMaterial`)
- Shell integration kullanicinin `$PROFILE`'ina yazmaz; CMD/WSL desteklenmez
- Yeni sekme her zaman `resolveStartupCwd()` ile acilir; `workspaceCwd` miras verilmez
- Karakter durumu cikti metninden tahmin edilmez; yalniz ajan spinner'i ve acik zaman kurallari
- Hava durumu: IP ile konum yok; yalniz yuvarlanmis koordinat gider
- Yayin yalniz CI uzerinden; lokal exe release'e yuklenmez; public repo adi degismez
- Surum kurali (kullanici, 2026-10-09): mevcut ozellik duzeltmesinde surum ARTMAZ; ayni surum yerelde derlenip (`npm run build && npm run dist:win`) bu PC'ye sessiz kurulur (Git Bash'te `MSYS_NO_PATHCONV=1 ./dist/TermFlow-Lite-<v>-x64.exe /S --force-run`; yoksa /S `S:/` olur ve sihirbaz acilir). Yeni ozellikte surum artar ve CI ile yayinlanir
- IDE kapsami (kullanici, 2026-10-15): Agent IDE, Lite'in TUM ozelliklerini kapsar; IDE yerlesimi bir Lite ozelligini gizleyemez (karsiligi yoksa gorunur kalir). Regresyon: e2e ide-workspace 'everything the Lite status bar...'
- Kurulum kurali (kullanici, 2026-10-15): her duzeltme/gelistirmeden sonra YALNIZ Agent IDE yerelde derlenip (dist:win:ide) bu PC'ye sessiz kurulur (onay sorulmaz; acik uygulama kapanir)
- Site dili: `website/i18n.js`; uygulama arayuzu yalniz Ingilizce
