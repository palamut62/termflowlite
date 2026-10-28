> 2026-10-20: Kullanici istegiyle Floating Workspace (F3.3) uygulamadan kaldirildi. Asagidaki ilgili maddeler eski tasarimin tarihsel kaydidir.

# TermFlow Agent IDE - PRD

Durum: ONAYLANDI 2026-10-14 (kararlar bolum 12'de). Faz 0 basladi, dal `feature/agent-ide`.
Referans: Orca (onorca.dev, Stably AI) masaustu uygulamasi v1.4.x, bu PC'de kurulu (`%LOCALAPPDATA%\Programs\orca`).
Gorseller: `docs/agent-ide/img/` (Orca'dan 2026-10-14'te alinan ekran goruntuleri).

> Bu dosya kendi basina yeterli olacak sekilde yazildi. Baska bir oturum/hesap buradan devam edebilir.
> Once "13. Devir notu" bolumunu oku.

---

## 1. Ozet

TermFlow Lite bugun "cok iyi bir terminal". Bu PRD, ayni uygulamanin icine **ikinci bir arayuz modu**
ekler: **Agent IDE**. Kullanici istedigi zaman iki mod arasinda gecer:

| Mod | Kimin icin | Gorunum |
|---|---|---|
| **Terminal (CLI)** | Bugunku kullanicilar, sade terminal isteyenler | Bugunku TermFlow Lite, hicbir sey degismez |
| **Agent IDE** | Birden fazla ajani paralel calistiranlar | Orca benzeri 3 sutun: proje/worktree/ajan agaci + sekmeli terminal + sag panel (dosya, ajan oturumlari, git, kontroller) |

Iki mod **ayni motoru** kullanir (PTY, ajan hook'lari, worktree, limit gostergesi, memory, remote).
Fark yalnizca kabuk (shell UI). Mod degisince calisan terminaller/ajanlar kapanmaz.

Kullanici karari (2026-10-14): "B - ayri bir Agent IDE olacak, ister CLI isterse bu kullanilabilsin."

## 2. Arka plan ve neden

- 1.24.0'da Orca paritesi kapsaminda 8 modul eklendi (agent-hooks, attention, resume, usage-meter,
  jump-palette, worktree-setup, ...). Bkz. `docs/orca-parity/README.md`.
- O dosyada su kalemler **kapsam disi** birakilmisti: diff goruntuleyici / AI diff yorumu, Monaco,
  gomulu Chromium / Design Mode, GitHub-Linear paneller, orchestration, uygulamayi kumanda eden CLI.
  Gerekce: "cok iyi bir terminal cizgisini bozmamak".
- **Bu PRD o karari Terminal modu icin korur, Agent IDE modu icin acar.** Terminal modu sade kalir;
  IDE modundaki ozellikler Terminal modunda gorunmez.
- Motorun cogu zaten var (bkz. bolum 6). Is buyuk olcude yeni bir kabuk + birkac yeni panel.

## 3. Hedefler / hedef olmayanlar

**Hedefler**
1. Tek tikla / tek kisayolla Terminal <-> Agent IDE gecisi; durum kaybi yok.
2. IDE modunda proje > worktree > ajan oturumu hiyerarsisini tek bakista gormek (calisiyor / onay bekliyor / bitti).
3. Yeni worktree + ajan baslatmayi tek modalden yapmak (Orca "Create worktree").
4. Sag panelde dosya agaci, gecmis ajan oturumlari, git durumu, CI kontrolleri.
5. Faz 4'te: AI diff'ini satir satir inceleyip yorumu ajana geri gondermek.

**Hedef olmayanlar**
- Orca'yi birebir kopyalamak. Isim, logo, metin, ikon seti kopyalanmaz; yerlesim ve etkilesim
  kaliplarindan ilham alinir. TermFlow kendi temalarini, karakter motorunu, ASCII arka planini korur.
- Kod editoru (Monaco) ilk fazlarda yok; dosyalar mevcut "editorde ac" akisiyla acilir.
- Hesap degistirici (Orca "Account switcher") yok.
- macOS destegi bu PRD'nin konusu degil (TermFlow Windows/Linux).

## 4. Orca incelemesi (gorselli)

### 4.1 Site
![Orca site hero](img/00-site-hero.jpg)
Pazarlama vurgusu: paralel ajanlar, her gorev ayri worktree, design mode, diff yorumlari, mobil eslik,
27 ajan destegi. Uygulama icinde gorduklerimiz asagida.

### 4.2 Ana kabuk
![Ana kabuk](img/01-ana-kabuk.jpg)
- **Sol kenar cubugu (~250 px):** ust satirda logo, `...` menu, kenar cubugunu daralt, geri/ileri.
  Altinda: Search, Tasks, Artifacts, Automations, Orca Mobile (goz ikonu = kenar cubugundan gizle).
- **Projects** basligi + 4 ikon: bildirimler, filtre/siralama, klasor ekle, `+` yeni worktree.
- **Agac:** proje (ikon + kalin ad) > worktree karti (`master` + `primary` rozeti, alt satir dal adi,
  `1 child` acilir) > alt worktree karti (yesil nokta = aktif, `rename failed` kirmizi rozet,
  `palamut62/gramma` dal) > ajan satiri (durum ikonu + ajan ikonu + "Done - Claude" + "6h").
- **Orta:** sekme cubugu (ajan ikonlu sekme, `+`), sag ustte `Command` ve sag paneli ac/kapat.
  Pane sag ustunde kucuk ikonlar: yorum, not, bol, kapat.
- **Alt durum cubugu:** her saglayici icin limit (`75% used 3d 8h`), yenile; sagda bellek, terminal sayisi.
- **Sag alt yuzen dugme:** Floating Workspace.

### 4.3 Sag panel (4 sekme)
| Explorer | Agents |
|---|---|
| ![Explorer](img/03-sag-panel-explorer.jpg) | ![Agents](img/04-sag-panel-agents.jpg) |
| Source Control | Checks |
| ![Git](img/02-sag-panel-git.jpg) | ![Checks](img/05-sag-panel-checks.jpg) |

- **Explorer:** kok ad + liste gorunumu / yenile / menu; "Find files"; `Names | Contents` segment.
- **Agents:** "Resume past sessions"; `Workspace | Project | All` segment; arama; iskelet yukleme.
- **Source Control:** `Create PR`, dal + upstream (`-> origin/master  ↓30`), bos durum metni,
  `Publish Branch` (bolunmus dugme), altta katlanir `COMMITS`.
- **Checks:** upstream yoksa aciklama + `Publish Branch`.

### 4.4 Arama paleti
![Arama](img/06-arama-paleti.jpg)
Tek kutu: "chats, terminals, worktrees, settings, actions". Gruplar: RECENT CHATS & TERMINALS,
RECENT WORKTREES. Satirda rozetler (`Current Tab`, proje - worktree, `Ctrl 1`). Altta tus ipuclari
(Enter Open, Esc Close, oklar Move, Tab Filter). TermFlow'daki JumpPalette'in genisletilmis hali.

### 4.5 Worktree olusturma
![Create worktree](img/07-worktree-olustur.jpg)
Alanlar: Project (secici + repo adi), Run on (Local Windows / WSL / SSH + yol), Create From
(opsiyonel, base ref secici `origin/master`), sekmeler `Smart | GitHub | Branch | Name`
("Type a name, #1234, branch, GitHub, GitLab, or Jira URL"), Agent (secici + ayar ikonu),
Advanced (katlanir), `Create more` anahtari, `Create worktree  Ctrl Enter`.

### 4.6 Tasks / Automations / Floating / Mobile
| Tasks | Automations |
|---|---|
| ![Tasks](img/08-tasks.jpg) | ![Automations](img/09-automations.jpg) |
| Floating Workspace | Mobile |
| ![Floating](img/10-floating-workspace.jpg) | ![Mobile](img/11-mobile.jpg) |

- **Tasks:** kaynak secici (GitHub / Linear), `Issues | PRs | Projects`, `Open | Assigned to me`,
  Filters + sorgu kutusu (`is:issue is:open`), tablo (ID, TITLE/CONTEXT, ASSIGNEES, STATUS, UPDATED).
- **Automations:** arama, Filters, Runs, `New Automation`; bos durumda **sablon kartlari**
  (Weekday repo audit, Release readiness, Daily change review, Hourly queue check) + `Add new`.
- **Floating Workspace:** pencere icinde surukle-birak mini calisma alani; bos durumda kisayol listesi
  (New Terminal Ctrl+T, New Markdown Note Ctrl+Shift+M, Open Markdown Note, New Browser, Minimize).
- **Mobile:** sol buyuk baslik "Your phone is paired.", eslesmis cihaz karti + sil, `Pair another device`;
  sagda telefon mockup'i.

### 4.7 Ayarlar
| Agents | Orchestration |
|---|---|
| ![Agents ayar](img/12-ayar-agents.jpg) | ![Orchestration](img/13-ayar-orchestration.jpg) |
| Git & Source Control | Terminal |
| ![Git ayar](img/14-ayar-git.jpg) | ![Terminal ayar](img/15-ayar-terminal.jpg) |

![Ayar menusu alt kisim](img/16-ayar-menu-alt.jpg)

- Sol menu gruplu: AI CAPABILITIES (Agents, AI Provider Accounts, Orchestration, Computer Use, Voice),
  SET UP (Account, General, Integrations, Mobile), WORKFLOWS (Automations, Artifacts, Share Skills,
  Agent Session Search, Git & Source Control, Task Sources, Terminal, Quick Commands, Browser,
  Mobile Emulator, Floating Workspace), INTERFACE (Appearance, Input & Editing, Notifications,
  Shortcuts, Stats & Usage), REMOTE HOSTS (SSH Hosts, Remote Servers), PRIVACY, ADVANCED, EXPERIMENTAL.
  Ustte "Search settings Ctrl+F" ve "Onboarding checklist".
- Icerik: ortada ~750 px kart; her satir baslik + gri aciklama + sagda kontrol (toggle, segment, input).
- Agents: varsayilan ajan "chip" izgarasi (ikonlu), runtime `Windows | WSL`, hook toggle'lari.

### 4.8 Hata modali
![Hata modali](img/17-hata-modali.jpg)
Kirmizi ikon + baslik, tek cumle aciklama, "Error details" kod kutusu + kopyala, `Close`.
TermFlow'da native dialog yasak; bu kalip in-app modal olarak uygun.

### 4.9 Detayli inceleme (Orca 1.4.x, bu PC, 2026-10-14)
Her dugmeye basilarak incelendi; ayar degistirilmedi.
- **Sol ust:** logo, `...` uygulama menusu (File: Settings, Exit / Edit / View: Reload, Zoom, Worktree Palette
  Ctrl+Shift+J, Full Screen, Appearance / Window / Help: Report Crash, Getting Started, About, Check for Updates),
  kenar cubugu ac-kapa, geri/ileri (worktree gezinme gecmisi). Kapaliyken bu kume sekme seridinin soluna gecer.
- **Gezinme:** Search (odakta `Ctrl Shift J` ipucu), Tasks (tam sayfa; GitHub/Jira kaynak, Issues/PRs/Projects,
  Open/Assigned/Mine/Needs review, sorgu kutusu, tablo), Artifacts (bos durum), Automations (sablonlar, New Automation
  modali: baslik, prompt, Agent, ek argumanlar, Host, Project, Workspace Worktree/New run, Session Fresh/Reuse,
  Schedule; Runs sayfasi: 4 istatistik karti + tablo), Orca Mobile (gizlenebilir).
- **Projects basligi:** zil (listeyi ajan etkinligine cevirir, Filter kutusu), Workspace options (Group by
  None/Status/PR/Project; Sort by Name/Agent Activity/Recent/Project/Manual; Project order; Card layout
  Detailed/Compact; Show properties; Filters: Hide sleeping / default branch / automation-created / CLI-created /
  detached HEAD), Add a project (Host, Browse folder, Clone from URL, Create new project), `+` Create worktree.
- **Proje satiri:** uzerine gelince ok, `...` (Project Settings, Change Project Icon, Show hidden worktrees,
  New group from project, Remove Project), `+`. Sag tik yok.
- **Non-Orca worktrees:** kaynaga gore (Claude Code `.claude/worktrees/*`, GSD, Other locations) Show/Hide,
  Worktree root ekleme, gizli worktree listesi + tek tek Show. Varsayilan: Orca disi worktree'ler GIZLI.
- **Worktree karti:** yalniz etkin grup cerceveli kart; sag tik: Update (gorunen ad, bagli is, not), Move to Status
  (Todo/In progress/In review/Done), Open in (VS Code, File Explorer), Copy Path, Copy Worktree Name, Pin,
  Mark Unread, Change/Open Parent, Sleep, Delete (Ctrl+Shift+Backspace). Oturum satirinda ayni menu.
- **Alt cubuk (sidebar):** Settings, Help (Keyboard Shortcuts, Feedback, Docs, Changelog, GitHub, Discord, X,
  Check for Updates, Restart), Reveal active workspace, Workspace board (kanban: Pinned + 4 durum sutunu).
- **Sekme seridi:** `+` = aramali menu (yeni terminal turleri, Browser, Markdown, ikonlu ajan listesi, Agent
  settings); sekme sag tik: Split terminal, Pin Tab, Close / Others / Right / Left, Change Title, Tab Color;
  Command = Quick Commands (bossa Add Quick Command: Label, Terminal/Agent, komut, Append Enter); sag panel dugmesi.
- **Pane sag ustu:** Hand off to another agent, Chat gorunumu, Split, Close tab.
- **Sag panel:** ikon sekmeler (Explorer, Agents, Source Control, Checks). Explorer: `...` (Show Dotfiles,
  Show Git Ignored, Open in VS Code, Open in File Explorer), Names | Contents (case, kelime, regex, include/exclude,
  dosyaya gore gruplu sonuc). Agents: host secici, ajan filtresi, projeye gore gruplu kartlar (baslik, onizleme,
  mesaj sayisi, yas, model), "Show more sessions". Source Control: Create PR, `...` (View as tree, Change Base Ref,
  Refresh), Publish Branch, COMMITS. Checks: upstream yoksa Publish Branch.
- **Durum cubugu:** solda saglayici basina ikon + `% used` + sifirlanma (dar pencerede kisalir); tiklayinca SOLA
  hizali popover (Detailed/Compact, saglayici basina 5h/wk cubuklari, %80 ustu kirmizi, Usage details, Manage
  Accounts). Sagda Keep computer awake (On/Agent/Off), Resource Manager (bellek; worktree > terminal CPU/bellek,
  Clean up workspaces, disk taramasi), terminal sayisi, Ports (workspace/external).
- **Floating Workspace:** sag alt dugme; pencere icinde terminal/markdown/browser paneli.
- **Ayarlar:** tam sayfa, "Back to app", Ctrl+F arama, gruplar (AI Capabilities, Set Up, Workflows, Interface,
  Remote Hosts, Privacy, Advanced, Experimental). General: worktree klasoru, kaynak Show/Hide, silmeden once onay,
  Open In Apps. Appearance: sidebar Default/Match Terminal/Tinted, durum cubugu ogeleri. Notifications: Send Test.

### 4.10 Uygulama durumu (4.9'a karsi, 2026-10-14)
Faz 5 (gomulu tarayici, Chat gorunumu, design mode, orchestration) haric her madde.
- [x] Sol ust kume: `...` uygulama menusu, kenar cubugu ac-kapa, geri/ileri; kapaliyken sekme seridinin solunda
- [x] Projects basligi: zil, Workspace options (siralama, kart duzeni, default branch / detached HEAD gizle, kaynak goster)
- [x] Non-Orca worktree'ler varsayilan gizli + "Show hidden worktrees" penceresi; proje satiri hover ok / `...` / `+`
- [x] Worktree menusu: New Terminal Here, Open in VS Code / File Explorer, Copy Path / Name, Mark Unread, Remove
- [x] Alt cubuk: Settings, Help menusu, Reveal active workspace
- [x] Sekme seridi: `+` aramali menu, sag tik (split, rename, renk, Close / Others / Right / Left), Command = Quick Commands
- [x] Pane sag ustu: Hand off, Split, Close; durum cubugu limit popover'i sola hizali, pencereden tasmaz
- [x] Sag panel Source Control (`ScmPanel.tsx`, `src/main/scm.ts`): stage/unstage, commit, Push/Publish, Create PR (`gh pr create --web`), `...` tree/refresh, COMMITS; Ctrl+Shift+G. Dosya tiklamasi ve baslik dugmesi Review sayfasini acar (F4.1)
- [x] Sag panel Checks (`gh pr checks --json`, upstream yoksa Publish Branch); Ctrl+Shift+K
- [x] Explorer `...` (Show Dotfiles, Open in VS Code / File Explorer) + `Names | Contents` (`ContentSearch.tsx`, `src/main/fileSearch.ts` = git grep; case/kelime/regex, include/exclude). Show Git Ignored yok: liste .gitignore'a gore zaten suzmuyor
- [x] Agents paneli: ajan turu filtresi (Select all / Clear), Project/All'da projeye gore gruplu, "Show more sessions" (30'ar). Onizleme/mesaj sayisi/model yok: oturum okuyucusu bu alanlari vermiyor
- [x] Worktree karti: Update modali (`WorktreeDetailsDialog.tsx`: ad, bagli is, not, durum, parent), Move to Status, Pin, Sleep/Wake, Open/Change Parent (dongu korumali `nestChildren`); veri `ide.worktreeMeta`
- [x] Workspace board (`WorkspaceBoard.tsx`: Pinned + 4 durum, surukle-birak + erisilebilir secici, arama)
- [x] Workspace options: Group by Project/Status/Pull Request/None (PR: proje basina tek `gh pr list`, dal adi -> PR), Hide sleeping, Show properties (Notes, Linked work, Agent activity)
- [x] Create worktree modali (F2.1, `WorktreeLauncherModal.tsx`): tek akilli giris (`worktreeTarget.ts`: ad / mevcut dal / #PR / PR-issue URL), ajan secici, Advanced (parent, not, sparse checkout = cone, `validSparsePaths`), Create more, Ctrl+Enter. Run on WSL/SSH yok (karar bekliyor, asagida)
- [x] Arama paleti kaynaklari (F2.2, `JumpPalette.tsx` + `jumpRanking.searchCommands`): IDE'de worktree'ler, ayarlar (anahtar kelimeyle), aksiyonlar; Tab / Shift+Tab ile kaynak suzgeci. Lite paleti degismedi
- [x] Durum cubugu sagi (`IdeStatusExtras.tsx`, `src/main/resources.ts`): Keep computer awake (On/Agent/Off, `powerSaveBlocker`), Resource Manager (uygulama + terminal agaci CPU/bellek), terminal sayisi, Ports (workspace/harici; tiklayinca localhost acilir). Surec taramasi yalniz popover acikken. Clean up workspaces ve disk taramasi yok
- [x] Tasks tam sayfa (F3.1, `pages/TasksPage.tsx` + `github.listTasks`: Issues/PRs, Open/Mine/Needs review/Closed, GitHub arama, Start worktree), Automations (F3.2, `pages/AutomationsPage.tsx`: istatistik, liste, Run now, 4 sablon = duraklatilmis `claude -p`, Runs)
- [x] Floating Workspace (F3.3, `pages/FloatingWorkspace.tsx`: surukle/boyutla; Note / Terminal: terminal `floatingTabId` sekmesi, ana alanda cizilmez, Dock ya da sekme seridi ile ana alana doner), Mobile tam sayfa (F3.4), Artifacts (F4.4, oturumdaki medya). Sayfalar orta sutunda, terminaller altta canli (`pages/IdePage.tsx`)
- [x] Ayarlar tam sayfa (IDE'de `settings-fullpage`: "Back to app", gruplu menu, Ctrl+F), Notifications > Send test notification, Stats & Usage (`StatsSettings.tsx`)
- [x] Review (F4.1-F4.2, `review/ReviewPage.tsx`, `review/diffModel.ts`, `scm.readScmDiff`): dosya listesi, Unified / Side by side, "Compare with" (bos = HEAD, dal = merge-base'e karsi; Change Base Ref), takip edilmeyen dosyalar dahil; satir numarasina tiklayinca Markdown yorum, yorumlar worktree basina birikir; "Send to agent" tek prompt olarak secilen sekmeye bracketed paste ile Enter'siz yapistirir, program bracketed paste acmadiysa (duz kabuk) satirlar calismasin diye panoya kopyalar
- [x] Worktree notu (F4.3, `review/NotesPage.tsx`, `src/main/notes.ts`): worktree basina `userData/notes/<hash>.md`, otomatik kayit; worktree menusu "Open Notes" ve palet. Not ayri sayfa olarak acilir (sekmeler terminal oldugu icin)
- [ ] Create worktree "Run on WSL / SSH": worktree'yi WSL ya da uzak makinenin dosya sisteminde acmak agac, Explorer, SCM ve Review'un uzak yollarla calismasini gerektirir; Faz 5 ile birlikte karar

## 5. Tasarim dili (gozlenen, yaklasik)

Ekran goruntusunden okunmustur; TermFlow tema sistemine token olarak eklenir, sabit renk yazilmaz.

| Token | Orca'da (yaklasik) | Not |
|---|---|---|
| `--ide-bg` | #0b0b0b | Ana zemin (Tasks/Settings icerigi) |
| `--ide-sidebar` | #1f1f1f - #262626 | Sol cubuk ve sag panel |
| `--ide-card` | #2a2a2a, kenar #3a3a3a | Worktree karti, ayar karti |
| `--ide-text` / `--ide-muted` | #e8e8e8 / #8c8c8c | |
| `--ide-ok` / `--ide-err` | #22c55e / #ef4444 | Durum noktasi, rozet |
| Birincil dugme | Beyaz zemin, koyu yazi | `Create worktree`, `New Automation` |
| Font | Inter benzeri sans 13 px; baslik 15-22 px kalin | Terminal monospace ayri |
| Yaricap | Kart 8 px, dugme/segment 6 px, rozet 4 px | |
| Yogunluk | Sidebar satir ~30 px, sekme ~32 px, durum cubugu ~22 px | |

Kaliplar: segment kontrol (`Names | Contents`), rozet (`primary`, `rename failed`), bos durum +
sablon kartlari, iskelet yukleme, tus ipucu "kbd" etiketleri, katlanir bolum (`COMMITS`, `Advanced`).

Hareket: mevcut `settings.motion` kurali gecerli (yalniz transform/opacity, reduced-motion = off).

## 6. Mevcut TermFlow parcalariyla eslesme

| Orca ogesi | TermFlow'da bugun | IDE icin yapilacak |
|---|---|---|
| Sekmeli terminal + split | `tabs/TabBar.tsx`, `terminal/TerminalView.tsx`, `paneUtils.ts` | Aynen kullanilir, IDE kabuguna yerlestirilir |
| Ajan durumu (working/waiting/done) | `shared/agentHooks.ts`, `main/agentHooks/hookServer.ts`, store `applyAgentHook` | Agac satirlarina baglanir |
| Proje/worktree | `main/worktree.ts`, `ipc/worktree.ts`, `store/workspaceStore.ts`, `worktreeSetupStore.ts`, `SessionRail.tsx` | Agac modeli (proje > worktree > oturum) yeni `ideTreeModel.ts` |
| Explorer | `components/FilePanel.tsx`, `filePanelModel.ts`, `main/files.ts` | Sag panel sekmesi; `Contents` aramasi yeni (ana surecte) |
| Agents (gecmis oturumlar) | `main/agentSessions.ts`, `components/AgentSessions.tsx`, `agentSessionStore.ts` | Sag panel sekmesi + Workspace/Project/All filtresi |
| Source Control | `ipc/git.ts` | Yeni panel: durum, dal, upstream, publish, commits; PR `gh` uzerinden |
| Checks | `main/github.ts`, `ipc/github.ts` | Yeni panel: PR check'leri |
| Tasks | `components/GitHubPanel.tsx`, `TaskPalette.tsx`, `ipc/tasks.ts` | Tam sayfa tablo gorunumu |
| Arama paleti | `components/JumpPalette.tsx`, `jumpRanking.ts` | Ayar ve aksiyon kaynaklari eklenir |
| Automations | `store/commandSchedule.ts`, `useCommandScheduler.ts`, `SavedCommands.tsx` (scheduled-prompts spec'i) | Sayfa + sablonlar |
| Limit cubugu | `usage/`, `main/usage/`, `StatusBar.tsx` | IDE durum cubugunda ayni bilesen |
| Mobile | Remote Access (`main/remote/`, `settings/RemoteSettings.tsx`) | IDE'de ayri sayfa olarak da acilir |
| Ajan katalogu | `main/agentDetect.ts` (16 ajan) | Worktree modalindaki Agent secici |
| Bildirim / zil | `attention/`, `AgentInbox.tsx` | Projects basligindaki zil ikonu |
| Diff / satir yorumu | YOK | Faz 4 |
| Markdown not / Artifacts | YOK | Faz 4 |
| Gomulu tarayici / Design mode | YOK | Faz 5 (opsiyonel) |
| Orchestration | `agentHandover.ts`, `HandoverDialog.tsx` (devir) | Faz 5 (opsiyonel) |

## 7. Islevsel gereksinimler

### Faz 0 - Mod altyapisi (surum 1.25.0)
- F0.1 `AppSettings.uiMode: 'terminal' | 'ide'` (varsayilan `terminal`). `src/shared/types.ts` + `DEFAULT_SETTINGS`.
- F0.2 Gecis: Ayarlar > Appearance'ta segment; komut paletinde "Switch to Agent IDE / Terminal";
  kisayol `Ctrl+Shift+I` (cakisma kontrolu `shortcuts.ts`).
- F0.3 `App.tsx` kok seviyede `uiMode`'a gore `<TerminalShell/>` veya `<IdeShell/>` render eder.
  Terminal store'lari (sekmeler, PTY id'leri) kabuktan bagimsiz; gecis PTY'yi yeniden baslatmaz,
  `TerminalView` xterm ornegi yeniden baglanir (scrollback korunur).
- F0.4 Ilk acilista (yeni kurulum) kucuk secim karti: "Terminal" / "Agent IDE". Mevcut kullanici icin
  sorulmaz, varsayilan Terminal.

**Kabul:** mod 5 kez gidip gelince calisan Claude oturumu kesilmez, cikti kaybolmaz (E2E).

### Faz 1 - IDE kabugu (1.25.0)
- F1.1 **Sol kenar cubugu:** Search, Tasks, Automations, Mobile (her biri gizlenebilir); Projects basligi
  (zil, siralama, klasor ekle, yeni worktree); daralt/genislet; genislik suruklenebilir (200-400 px), kalici.
- F1.2 **Proje agaci:** proje > worktree karti (dal, `primary` rozeti, cocuk sayisi) > ajan oturum satiri
  (durum ikonu, ajan ikonu, "Working / Needs input / Done - <Ajan>", gecen sure). Tiklayinca ilgili sekmeye
  gider; worktree'nin sekmesi yoksa yeni sekme o klasorde acilir. Sag tik: Reveal, Copy path, Rename,
  Remove worktree (onayli in-app modal).
- F1.3 **Orta alan:** mevcut sekme cubugu + split. Sekme basliginda ajan ikonu ve durum noktasi.
- F1.4 **Sag panel:** 4 sekme (Explorer, Agents, Source Control, Checks); `Ctrl+Shift+E/A/G/K`;
  genislik suruklenebilir, aktif sekme kalici.
- F1.5 **Durum cubugu:** limit seridi (usage-meter), bellek, terminal sayisi, remote rozeti.
- F1.6 Bos durum: proje yoksa ortada "Add a project folder" + son klasorler.

**Kabul:** 3 worktree'de 3 ajan calisirken agac durumlari 1 sn icinde gunceller; sag panel sekmeleri
aktif worktree'yi izler.

### Faz 2 - Akislar (1.26.0)
- F2.1 **Create worktree modali** (4.5): Project, Run on (Local / WSL / SSH profili), base ref,
  `Smart | GitHub | Branch | Name` girisi (Smart: `#123` -> issue, URL -> issue/PR, aksi halde ad),
  Agent secici (`agentDetect` katalogu, "No agent" dahil), Advanced (kurulum adimlari = worktree-setup),
  `Create more`, `Ctrl+Enter`. Basarili olunca worktree agaca eklenir, ajan sekmesi acilir.
- F2.2 **Arama paleti** (4.4): kaynaklar = acik sekmeler, worktree'ler, gecmis ajan oturumlari,
  ayarlar, aksiyonlar. Tab ile kaynak filtresi. Mevcut JumpPalette genisletilir, ikinci palet yazilmaz.
- F2.3 **Source Control paneli:** degisen/staged/untracked gruplari, stage/unstage, commit mesaji,
  push/publish, `Create PR` (`gh pr create`, gh yoksa yonlendirme). Diff tiklayinca simdilik harici editor.
- F2.4 **Checks paneli:** aktif dalin PR'i varsa check listesi (`gh pr checks`), yoksa bos durum + Publish.

### Faz 3 - Sayfalar (1.27.0)
- F3.1 **Tasks sayfasi** (GitHub; Linear sonra): Issues/PRs, Open/Assigned, sorgu kutusu, tablo;
  satirdan "Start worktree" -> F2.1 modali onceden dolu acilir.
- F3.2 **Automations sayfasi:** scheduled-prompts spec'iyle ayni veri; bos durumda 4 sablon kart; Runs gecmisi.
- F3.3 **Floating Workspace:** pencere icinde tasinabilir, boyutlanabilir panel; New Terminal / New Note /
  Minimize. (New Browser Faz 5'e kadar gizli.)
- F3.4 **Mobile sayfasi:** Remote Access ayarlarinin IDE icindeki tam sayfa gorunumu.

### Faz 4 - Inceleme (1.28.0)
- F4.1 **Diff goruntuleyici:** worktree degisiklikleri yan yana / tek sutun; dosya listesi.
- F4.2 **Satir yorumu:** diff satirina markdown yorum; yorumlar birikir; "Send to agent" tum yorumlari
  tek prompt olarak ilgili ajan sekmesine `term.paste` ile (Enter'siz) ekler.
- F4.3 **Markdown not:** worktree basina `notes/` (projeye yazilmaz; `userData`), sekme olarak acilir.
- F4.4 **Artifacts:** ajanlarin urettigi dosyalarin (ekran goruntusu, rapor) listesi; kaynak = media izleme.

### Faz 5 - Opsiyonel (karar bekliyor)
- Gomulu tarayici (`WebContentsView`) + Design mode (ogeyi tikla -> HTML/CSS/kirpilmis goruntu ajana).
- Orchestration (koordinator ajan -> cocuk ajanlar), uygulamayi kumanda eden CLI (`termflow worktree create`).

## 8. Islevsel olmayan gereksinimler
- **Performans:** IDE modu bos acilista Terminal modundan en fazla +150 ms; 20 worktree + 10 ajanla
  agac guncellemesi < 16 ms/kare. Panel verisi (git, gh) ana surecte, debounce'lu, sekme gorunmezken durur.
- **Guvenlik:** git/gh komutlari `execFile` + arguman dizisi (kabuk yok). Renderer yol/komut uretmez.
  Diff yorumu ajana gonderilirken `secretRedaction` uygulanir. Remote izin listesine yeni kanal eklenmez
  (aksi karar verilmedikce).
- **Erisilebilirlik:** agac `role="tree"`, klavye ile gezilir; tum ikon dugmelerde `aria-label`;
  odak halkasi gorunur.
- **Dil:** uygulama arayuzu Ingilizce (mevcut karar). PRD Turkce.
- **Native dialog yasak:** onaylar in-app modal, bilgi `toastStore`.
- **Urun sahibi atfi:** IDE modundaki About/Ayarlar'da mevcut "Product Owner: Umut Celik" + X + GitHub
  baglantilari gorunur (cogaltilmaz, ayni bilesen).

## 9. Teknik tasarim (oneri)
```
src/renderer/src/
  shells/
    TerminalShell.tsx      # bugunku App govdesi buraya tasinir (davranis ayni)
    ide/
      IdeShell.tsx         # 3 sutun yerlesim + yeniden boyutlama
      Sidebar.tsx          # nav + Projects
      ProjectTree.tsx      # agac (role=tree)
      ideTreeModel.ts      # saf: workspace + worktree + tab + agentHook -> agac dugumleri (+test)
      RightPanel.tsx       # 4 sekme kabugu
      panels/ExplorerPanel.tsx, AgentsPanel.tsx, SourceControlPanel.tsx, ChecksPanel.tsx
      pages/TasksPage.tsx, AutomationsPage.tsx, MobilePage.tsx
      CreateWorktreeModal.tsx
      FloatingWorkspace.tsx
  store/ideStore.ts        # uiMode disindaki IDE durumu: panel genislikleri, aktif sekme, acik sayfa
  styles/ide.css           # --ide-* tokenlari, tema dosyalarina baglanir
src/main/
  git/status.ts            # porcelain v2 ayristirici (+test), ipc/git.ts genisler
  github.ts                # pr checks, pr create eklenir
```
- **Durum:** zustand (mevcut). `ideTreeModel.ts` saf fonksiyon, store'lardan turetilir; ayri kaynak yok.
- **Sayfa yonlendirme:** router eklenmez; `ideStore.page: 'workspace' | 'tasks' | 'automations' | 'mobile' | 'settings'`.
- **Ayarlar:** mevcut `Settings.tsx` IDE modunda tam sayfa acilir (Orca gibi sol menulu); yeni ayarlar
  `AppSettings.ide` altinda.
- **Bagimlilik:** yeni bagimlilik yok (Faz 4 diff icin once `diff` paketi var mi bakilir; yoksa kucuk
  Myers diff kendimiz, testli).

## 10. Test ve dogrulama
- Birim (vitest): `ideTreeModel`, git porcelain ayristirici, Smart giris ayristirici (`#123`, URL, ad),
  arama paleti siralamasi, yorum -> prompt birlestirici.
- E2E (Playwright, `e2e/ide-*.spec.ts`): mod gecisi PTY'yi korur; agacta ajan durumu; Create worktree
  akisi (gecici repo); sag panel sekmeleri; Source Control commit.
- `npm run verify` yesil + ilgili E2E'ler yesil = faz tamam.
- Gorsel: `output/visual-check.mjs` ile IDE ekran goruntuleri, bu PRD'deki Orca goruntuleriyle yan yana.

## 11. Fazlar ve surumler
| Faz | Surum | Icerik | Tahmini buyukluk |
|---|---|---|---|
| 0 | 1.25.0 | uiMode, gecis, kabuk ayrimi | S |
| 1 | 1.25.0 | IDE kabugu, agac, sag panel (Explorer + Agents), durum cubugu | L |
| 2 | 1.26.0 | Create worktree, arama paleti, Source Control, Checks | L |
| 3 | 1.27.0 | Tasks, Automations, Floating, Mobile sayfasi | M |
| 4 | 1.28.0 | Diff + satir yorumu, notlar, Artifacts | L |
| 5 | - | Tarayici/Design mode, orchestration, CLI | karar bekliyor |

Not: `docs/orca-parity` yol haritasindaki 1.25-1.27 surum numaralari bu PRD ile cakisir; kalan parity
modulleri (worktree-note, hibernate, race, scheduled-prompts, remote-attention) ilgili IDE fazina katilir
(worktree-note -> Faz 1 agac karti, agent-race -> Faz 2 "Create more", scheduled-prompts -> Faz 3).

## 12. Kararlar (kullanici, 2026-10-14)
1. **Ayri urun:** ayni repodan ikinci exe, "TermFlow Agent IDE". TermFlow Lite hic degismez (yalniz terminal,
   mod gecisi yok). Agent IDE exe'si iki modlu: IDE gorunumunde acilir, `Ctrl+Shift+I` ile terminal gorunumune gecer.
   Bolum 7'deki F0.1-F0.4 yalniz IDE surumu icin gecerlidir.
   - Ayrim derleme zamaninda: `TERMFLOW_EDITION=ide` -> `__TERMFLOW_EDITION__` (`src/shared/edition.ts`).
   - IDE kimligi: appId `com.palamut62.termflowagentide`, productName "TermFlow Agent IDE", ayri userData (ayarlar,
     oturum, hafiza Lite ile karismaz), ayri tek-ornek kilidi, kurucu adi `TermFlow-Agent-IDE-<surum>-<arch>`, cikti `dist-ide/`.
   - IDE surumunde Explorer sag tik menusu ve otomatik guncelleme simdilik kapali (Lite'in registry anahtarlarini ezmemek;
     yayin reposu henuz yok).
2. **Freeware**, Lite ile ayni lisans.
3. **Faz 5 ertelendi**; Faz 4 bitince yeniden karar.
4. **Linear sonra** (Faz 3 yalniz GitHub).
5. **Ilk acilis karti:** yalniz IDE exe'sinde, yeni kurulumda (Terminal / Agent IDE secimi).
6. **Yayin:** yeni public repo (oneri `palamut62/termflow-agent-ide`); repo ilk yayindan once kullanici onayiyla acilir.

## 12b. Ilerleme (2026-10-14)
- **Faz 0 tamam:** `src/shared/edition.ts` (derleme zamani `TERMFLOW_EDITION`), IDE kimligi (ad, appId, userData,
  kurucu adi, `dist-ide/`), `uiMode` + `uiModeChosen`, `Ctrl+Shift+I`, komut paleti girdisi, ilk acilis karti
  (`shells/uiMode.tsx`). Lite'ta mod gecisi yok, `uiMode` her zaman `terminal` (SettingsStore testi).
- **Tek kabuk:** PRD 9'daki ayri `TerminalShell`/`IdeShell` yerine tek `shells/AppShell.tsx`: `TerminalArea` iki modda da
  `.app-body` icinde ayni sirada, mod gecisinde terminaller yeniden kurulmaz (E2E: 5 gecis, ayni xterm dugumu).
- **Faz 1 tamam (Orca yerlesimi):** kenar cubugu ve sag panel pencere tepesine kadar, sekme seridi orta sutunda;
  gezinme (Search, Tasks = GitHub paneli, Automations = kayitli/zamanli komutlar, Mobile = Remote Access),
  Projects (aktivite zili, klasor ekle, yeni worktree), kart agaci (`ideTreeModel.ts`, primary karti, "N child",
  oturum haplari), sag panel ikon sekmeleri Explorer + Agents, notr alt cubuk (solda limitler).
  Sag tik: New Terminal Here, Reveal, Copy Path, Remove Worktree, Remove from Projects.
- Komutlar: `npm run dev:ide`, `npm run build:ide`, `npm run test:e2e:ide`, `npm run dist:win:ide`.
- Gorsel karsilastirma (`node output/ide-shot.cjs`):

| TermFlow Agent IDE | Orca |
|---|---|
| ![TermFlow IDE Explorer](img/tf-01-ide-explorer.png) | ![Orca Explorer](img/03-sag-panel-explorer.jpg) |
| ![TermFlow IDE Agents](img/tf-02-ide-agents.png) | ![Orca Agents](img/04-sag-panel-agents.jpg) |

- **Faz 2-4 tamam (2026-10-15):** yukaridaki 4.10 listesi. Acik: Run on WSL/SSH ve Faz 5 (karar bekliyor).
- Faz 1'de yapilmayan: kenar cubugu "Artifacts" (Faz 4), Floating Workspace dugmesi (Faz 3), Explorer
  `Names | Contents` icerik aramasi, sag panel Source Control/Checks (Faz 2).

## 13. Devir notu (sonraki oturum icin)
- Repo: `C:\Users\umuti\Projects\termflow-lite\termflow-lite` (kaynak PRIVATE `palamut62/termflow-lite-source`).
  Once `DURUM.md`, sonra `PROJE-REHBER.md` "Hangi istek icin nereye bakilir" tablosu.
- PRD onaylandi (bolum 12). IDE derlemesi: `npm run dev:ide`, `npm run build:ide`, `npm run dist:win:ide`.
- Onaydan sonra: Faz 0 icin spec-driven calis (bu dosya yeterli), sonra `App.tsx` govdesini
  `shells/TerminalShell.tsx`'e davranis degistirmeden tasi ve `npm run verify` + mevcut E2E'leri yesil tut.
  Bu tasima ayri commit olsun ("TerminalShell'e tasi, davranis ayni").
- Orca canli referans: bu PC'de kurulu. Yeni goruntu gerekirse Orca'yi ac, `docs/agent-ide/img/` altina
  `NN-ad.jpg` olarak ekle.
- Orca'da gorulen ama incelenmeyenler: Artifacts sayfasi (bos), Ayarlar > Appearance / Shortcuts /
  Quick Commands / Browser / SSH Hosts icerikleri, sag tik menuleri, diff ve design mode (bu kurulumda
  ornek veri yoktu).
