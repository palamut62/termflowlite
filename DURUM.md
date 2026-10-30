# TermFlow Lite - Durum

guncel: 2026-10-30

> Bu dosya projeye giren her yapay zeka aracinin ilk okudugu yerdir. Kisa tutulur (en fazla ~80 satir).
> Kalici bilgi (mimari, kararlar, ayrintili gecmis) `PROJE-REHBER.md`'de (varsa) / README'de.

## Ne bu proje
Minimal, hizli, cok ozellestirilebilir capraz platform (Windows/Linux) terminal; gelistiriciler ve CLI ajan kullanicilari icin.
Stack: Electron (electron-vite), React, TypeScript, xterm.js, node-pty. Surum 1.30.0 (freeware, kapali kaynak).
Kaynak repo PRIVATE `palamut62/termflow-lite-source`; release'ler PUBLIC `palamut62/termflow-lite`. Site: termflowlite.lol (Vercel, `website/`).

## Calistir / test et
- `npm run dev` (gelistirme), `npm run verify` (vitest + tsc + build)
- `npm test` (birim), `npm run test:e2e` (Playwright, ~8 dk)
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

## Son oturum (2026-10-30, son arac: Claude Code, dal main)
- **Dis denetim raporu incelendi (surum artmadi):** 3 madde duzeltildi. (1) Orchestration hedef id'si artik tek kaynaktan: `shared/types.ts` `DELEGATE_AGENT_KINDS` + `ORCHESTRATION_TARGET_ID`; `SettingsStore`, `ipc/orchestration.ts`, `agentRunner`, `manager` (etiketler artik `Record<DelegateAgentKind,string>`, eksik ajan derlemede hata) ve MCP `delegate_task` aciklamasi bundan uretiliyor - oncesinde 6 ajanin ayari sessizce siliniyordu. (2) "Open in VS Code" klasorde calisiyor: `SYSTEM_OPEN_IN_EDITOR` artik klasoru reddetmiyor, `editorFileUrl` satir verilmezse konum eklemiyor. (3) `resolveLaunchProfile` (App.tsx) `mergeProfiles` ile dogruluyor - Explorer sag tik menusundeki yerlesik ajanlar (`--profile gemini` vb.) artik PowerShell'e dusmuyor.
- Denetim raporunun ANSI regex maddesi (agentRunner `parsePlainOutput`) yanlis alarm: ESC karakteri yerinde, dokunulmadi. Dogrulanmamis kalan maddeler: iOS SharedStore eslestirme, yetim worktree temizligi, `restart/restartAt`, telefon UI, `AgentEventStore` senkron I/O, `media.ts` 0 bayt, `transcriptFollow` sinirsiz buffer, `icacls /T`, `screenBridge` backpressure, site `1.15.0` fallback + kaldirilmis "Agent characters" karti.
- verify yesil (872 test), 2 yeni birim test. Gozle denenmedi.
- Site: yedek surum 1.15.0 -> 1.30.1, kaldirilmis "Ajan karakterleri" karti silindi (index.html + i18n.js + styles.css olu yorum), Vercel prod.
- **1.30.1 (kullanici karari):** duzeltme olmasina ragmen surum artirildi, cunku kurulu uygulama 1.30.0 icindeki duzeltmeleri oto-guncellemeyle goremiyordu. `npm run release:tag` -> CI yayinladi (v1.30.1 Lite + IDE, 7 varlik); yerel 1.30.0 derlemesi kurulmadi. Kullanici uygulama icinden guncelledi, calisti (2026-10-30).
- **1.30.2 yayinda (denetim raporu 2. tur):** 8 madde daha duzeltildi - `updater.ts` Turkce metin Ingilizce; `media.ts` kirpilmis dosyada `RangeError` yerine bos govde; `transcriptFollow` okumasi 1 MB tavanli + ilk okuma dosyanin sonundan; `elevation.ts` `icacls /T`; `screenBridge` backpressure (WS kuyrugu 4 MB'i gecince VNC akisi duraklar); zsh `print -rn --` + `$'\\e'` ve bash/zsh'de `%` kodlamasi (icinde `%` olan klasorde cwd takibi kopuyordu); telefon profil duzenleyicisinde kapanmamis tirnak artik toast gosteriyor; telefon dikey modda klavye acilinca yanlislikla tam ekrana gecmiyor (yon `window.innerWidth/Height`'ten); `opencode.cmd` sabiti kalkti, `executablePath` .exe/.cmd/.bat deniyor (Scoop/WinGet kurulumlari). 3 yeni birim test, verify yesil (875 test). CI Release yesil (run 41015362542), Lite + IDE v1.30.2, site yedek surum 1.30.2, Vercel prod. Kullanici uygulama icinden guncelledi, calisti.
- **1.31.0 yayinda - genis ajan tespiti:** `shared/profiles.ts` `agentCliForCommand/agentCliForProfile` - yerlesik katalogdaki her ajan CLI'ini adiyla tanir (`ollama serve` haric). `agentForProfile` (AgentKind: hook/izin kipi/kullanim sayaci) degismedi, yanina eklendi. Boylece 13 ajanda da: sesli giris dogal dil prompt'u uretir ve "gonder" ile Enter calisir, Shift+Enter yeni satir ekler (claude disinda LF, denenmedi), IDE agaci/durum cubugu "Working" gosterir, telefon ve iOS widget sekmeyi ajan sayar, cikti tahmini Agent Inbox'a ve widget'in "needs you" satirina duser (`AgentEvent.agent` artik string). Etiketler `BUILTIN_PROFILES`'tan. 2 yeni birim test, verify yesil (877 test). CI Release yesil (run 41017877625), Lite + IDE v1.31.0, site yedek surum 1.31.0, Vercel prod. Kullanici kurulu surumde denedi, calisti. Karar PROJE-REHBER "Ajan tespiti iki katmanli".
- **1.31.1 yayinda - AgentEventStore + yetim worktree:** olay yazimi asenkron ve sirali (`fs/promises`, kuyruk + tek yazici; bekleyenler `list()`'e dahil, kapanista `flushSync`, before-quit'e baglandi) - 4000 olayli test ~25 sn yerine ~2 sn. `validEvent` artik `isAgentCliName` kullaniyor: 1.31.0'da katalog ajanlarinin olaylari ana surecte sessizce ELENIYORDU (canli oturumda gorunuyordu ama diske yazilmiyordu), duzeldi. Orchestration: worktree yolu olusur olusmaz `tasks.json`'a yaziliyor (`onWorktree`), `trim()` listeden dusen kaydin worktree'sini siliyor, `cancel()` ajan bittikten sonra baslayan `checkCommand` surecini de olduruyor. 3 yeni birim test, verify yesil (880 test). CI Release yesil (run 41032280185), Lite + IDE v1.31.1, site yedek surum 1.31.1, Vercel prod. Kullanici kurulu surumde denedi, Agent Inbox kayitlari kaliyor.
- Site: Wrapped gorseli sunucuda zaten temizdi; tarayici 7 gunluk `max-age` ile eskisini gosteriyordu, `?v=2` ile URL yenilendi (assets uzun cache'li: gorsel degisince surum eki sart).
- **1.32.0 yayinda - denetim raporunun kalani:** (1) `executablePath` varsayilan arama yolu artik `currentSearchPath()` (kayit defteri onbellegi) + profilin kendi PATH'i - uygulama acikken kurulan CLI bulunuyor. (2) `TerminalManager` acilis argumanlarini sakliyor, `restart/restartAt` profili bastan cozuyor (eski `--dir <cwd>` ve tek seferlik prompt tekrar gitmiyor); yonetici sekmesinde telefon onayi yoksa sekme oldurulmeden uyariliyor (`hasElevationGrant`). (3) `withRecordLock`: `elevation.json` surecler arasi kilitli, paralel host'lar PIN sayacini ezmiyor. (4) MemoryEngine: zamanlanmis tur sirasinda "Run now" yutulmuyor (siraya alinir), `clear/forget` suren turun yazimlarini iptal ediyor (generation sayaci). (5) Telefonda kapanmis sekmenin bildirimi bos ekran yerine toast + acik sekme. (6) `claudeConfigDirs`: alt ajan listesi, kabuk gorevi dokumu ve status line coklu Claude hesabini goruyor. (7) iOS (`termflow-lite-ios`, ea3a7d7): cihaz anahtari eslestirmeden hemen sonra App Group'a yaziliyor. 6 yeni birim test, verify yesil (884 test). CI Release yesil (run 41035720756), Lite + IDE v1.32.0, site yedek surum 1.32.0, Vercel prod. iOS tarafi derlenmedi.
- Bos Enter'da sahte `133;D` maddesi incelendi, sorun degil: `shellIntegration.onCommandEnd` komutsuz blogu zaten cizmiyor.

## Onceki oturum (2026-10-29, son arac: Claude Code, dal main)
- **1.29.0 yayinda:** ajan karakteri (Ember/Miso/Piko) uygulamadan ve siteden kaldirildi - AgentCompanion/characterEngine/characterState, `fun/agentActivity.ts`, `fun/weather.ts`, `main/weather*`, hava IPC + preload, Appearance ayarlari ve `settings` alanlari, site bolumu + `build:site`. Open-Meteo entegrasyonu da gitti; artik disariya hava istegi yok.
- **1.29.1 yayinda:** Agent IDE sidebar ust ogeleri (Search/Tasks/Artifacts/Automations/Mobile) gercek uygulamada tek tek denendi, hepsi calisiyor. Iki eksik duzeltildi: Tasks depo disinda ham git hatasi yerine yol gosteriyor; Automations'ta Edit ve sablon kaydi dogrudan duzenleyiciye yukluyor (`savedCommandStore.show(editId)` + `clearEdit`, 1 birim test).
- Site: Wrapped bolumunun gorseli yenilendi (eski gorselde karakter paneli vardi), `output/wrapped-shot.mjs` ile cekildi. Vercel prod iki kez guncellendi.
- Her iki surum de CI'da yesil (7 asset), Agent IDE 1.29.1 sessiz kuruldu. Kurulu surumde gozle denenmedi.
- **1.30.0 Eller serbest ses:** Elchi (Handy fork'u) incelemesinden: `Ctrl+Shift+Space` kilitli kayit + sessizlikte bitirme (`voice/handsFree.ts`), ajan sekmelerinde "gönder/send/enter" ile Enter (`sendWord`, varsayilan kapali), Terms listesi. Ayarlar > Voice, `docs/voice-input.md` "Eller serbest". verify yesil, yeni birim testler. Gercek mikrofonla denenmedi.
- **1.30.0 Broadcast gorunurlugu:** broadcast acikken girdi alan split panelleri kirmizi cerceveli (`isBroadcastTarget`, `PaneLeaf.tsx`), SSH panellerinde kosede host etiketi (`sshTarget`), rozet hedef sayisini ya da "this tab only" gosteriyor (aktif sekme split disindaysa). 1 birim test. Gozle denenmedi.
- Site: f9 (eller serbest, "gönder", terimler) ve Toplu girdi (cerceve + SSH host) metinleri EN/TR, Vercel prod. Yerel onizleme portu 4185 (4173 Windows ayrilmis).

## Daha onceki oturum (2026-10-28, dal feature/phone-push)
- **1.28.0 yayinda (2026-10-28):** dal main'e birlestirildi (verify yesil), `v1.28.0` etiketi itildi, Release + verify-release 7/7 yesil (run 40665062742). Site: Remote bolumune ekran paylasimi maddesi (EN/TR), Vercel prod; indirme linkleri main.js'te GitHub API'den geldigi icin elle surum guncellemesi gerekmiyor.
- **Ekran paylasimi (tam PC telefonda):** telefon istemcisine Screen sekmesi (noVNC), masaustunde Ayarlar > Remote Access > Screen (`remote.screen {enabled,port=5900}`). Yakalama/girdi TermFlow'a yazilmadi: bilgisayarda bir VNC servisi kosar, TermFlow boru (`screenBridge.ts`, `POST /api/screen-ticket` -> tek kullanimlik bilet -> `ws /vnc` -> `127.0.0.1:port`). Kilit ekrani/UAC bu yuzden calisir. Karar + akis `docs/remote-access.md` sonunda. verify yesil (8 yeni test).
- Ekran paylasimi gercek telefonda calisti (UltraVNC servis, 2026-10-28). Eklendi: telefon cevrilince yeniden olceklenme (noVNC yalniz pencere resize'ini dinliyor, iOS klavye/donme icin onu her zaman tetiklemiyor -> visualViewport + orientationchange), yatayda otomatik tam ekran, yapiskan klavye (PC'ye dokununca kapanmaz). VNC parolasi saklanmaz, telefonda sorulur.
- Acik: PC'deki UltraVNC'de `LoopbackOnly=0` ve `HTTPConnect=1` - 5900 aga acik, 5800 dinliyor. Kullanici Settings'ten duzeltmeli.
- Caret (yeni sekme) menusunden acilan sekmeler sidebar agacinda gorunmuyordu: renderer `cwd` vermedigi icin `tabPath` bos kaliyordu. `PtyCore.create` artik klasor verilmemisse cozulen cwd'yi bir kez `cwd` olayiyla bildiriyor (mevcut onCwd -> setTabCwd hatti, yeni IPC yok). 2 birim test eklendi.
- verify yesil; Lite + Agent IDE 1.27.1 derlendi, Agent IDE sessiz kuruldu. Kurulu surumde gozle denenmedi; surum artmadi, yayinlanmadi.
- Not: SSH sekmeleri de artik yerel home projesi altinda gorunur (onceden hic gorunmuyordu); istenmezse ayrilabilir.

## Yarim kalan / siradaki adim
- **Denetim raporu kapandi (2026-10-30):** tek acik is iOS tarafinin gercek cihazda denenmesi (`xtool dev build`, eslestirme sonrasi widget/Share Extension). Windows'ta Swift derlenemedi.
- **1.30.0 (2026-10-29):** kurulu surumde gercek mikrofonla dene (Ctrl+Shift+Space, sessizlik esigi 0.015 RMS uygun mu, Claude Code'da "gönder" Enter'i) ve split'te broadcast cercevesi + SSH etiketini gozle kontrol et; esik gerekirse `voice/handsFree.ts` SPEECH_LEVEL
- **Ekran paylasimi (2026-10-28):** PC'ye UltraVNC/TightVNC *servis* olarak kurulmali (parola + varsayilan port, mumkunse yalniz loopback), sonra Ayarlar > Remote Access > Screen acilip telefonda Screen sekmesi denenmeli: baglanma, parola, dokunma-fare, klavye tusu, Ctrl+Alt+Del, tam ekran, kilit ekraninda sifre girme. Yeni ozellik: surum artar, CI yayinlar
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
