import { EDITION } from './edition'
import type { AgentHookState } from './agentHooks'
import type { WorktreeSetupSteps } from './worktreeSetup'
// Shared data models between main and renderer (TermFlow Lite, PRD §14)

export type ShellKind = 'powershell' | 'pwsh' | 'cmd' | 'wsl' | 'gitbash' | 'custom'
export type TabActivity = 'running' | 'waiting' | 'unread' | 'completed' | 'error'
export type AgentKind = 'claude' | 'codex' | 'opencode'
/** Ajanin dikkat istedigi okunmamis olay (agent-attention). */
export type IdeRightTab = 'explorer' | 'agents' | 'delegated' | 'scm' | 'checks'
export interface IdeSettings {
  /** Kullanicinin ekledigi proje klasorleri (depo kokleri), siraya gore. */
  projects: string[]
  sidebarWidth: number
  rightWidth: number
  rightOpen: boolean
  rightTab: IdeRightTab
  sidebarOpen: boolean
  /** Workspace options (Orca): baska araclarin worktree'leri, filtreler, siralama, kart duzeni. */
  showClaudeWorktrees: boolean
  showOtherWorktrees: boolean
  shownWorktrees: string[]
  hideDefaultBranch: boolean
  hideDetached: boolean
  sort: 'activity' | 'name' | 'recent'
  cardLayout: 'detailed' | 'compact'
  groupBy: 'project' | 'status' | 'pr' | 'none'
  hideSleeping: boolean
  /** Show properties (Orca): kartta gizlenen alanlar. */
  hiddenProps: WorktreeProp[]
  /** Worktree basina kullanici verisi; anahtar `worktreeKey(path)`. */
  worktreeMeta: Record<string, WorktreeMeta>
  /** Keep computer awake (Orca): on = hep, agent = bir ajan calisirken, off. */
  keepAwake: 'off' | 'on' | 'agent'
}
export type WorktreeStatus = 'todo' | 'in-progress' | 'in-review' | 'done'
export type WorktreeProp = 'note' | 'link' | 'sessions'
/** Orca "Workspace details" + kart menusu: gorunen ad, bagli is, not, durum, pin, uyku, parent. */
export interface WorktreeMeta {
  name?: string
  link?: string
  note?: string
  status?: WorktreeStatus
  pinned?: boolean
  sleeping?: boolean
  /** Agacta altinda gosterilecegi worktree yolu. */
  parent?: string
}
/** Windows'ta buyuk/kucuk harf ve ayirici farkindan bagimsiz worktree anahtari. */
export const worktreeKey = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
export type TabAttention = 'needs-input' | 'done' | 'error'
export interface AlertChannel { system: boolean; sound: boolean }
export interface AgentAlertSettings {
  needsInput: AlertChannel
  done: AlertChannel
  error: AlertChannel
  /** 0-100 */
  volume: number
  /** userData/sounds altindaki dosya adi; bos = yerlesik ses. */
  soundFile: string
}
export type AgentPermissionMode = 'safe' | 'workspace' | 'full'
export type AgentEventKind = 'session' | 'activity' | 'tool' | 'approval' | 'question' | 'completed' | 'error'

export interface AgentEvent {
  id: string
  tabId: string
  agent: AgentKind
  kind: AgentEventKind
  title: string
  detail?: string
  createdAt: number
  permissionMode: AgentPermissionMode
}

export interface AgentSessionRef {
  agent: AgentKind
  id: string
}

export interface AgentSession extends AgentSessionRef {
  title: string
  cwd?: string
  /** Native session'ın oluşturulma zamanı; TermFlow profil sahipliğini eşlemek için kullanılır. */
  createdAt?: number
  updatedAt: number
  /** Session TermFlow içinden başlatıldıysa kullanılan profil/provider. */
  profileId?: string
}

/**
 * Isolated git checkout backing a tab. Agents that each get their own worktree
 * can work in the same repository without overwriting each other's files.
 */
export interface TabWorktree {
  /** Main working tree the worktree belongs to. */
  repoRoot: string
  /** Absolute path of the isolated checkout (the tab's cwd). */
  path: string
  branch: string
  /** True when TermFlow created it, so closing the tab may offer cleanup. */
  createdByApp: boolean
}

export interface TerminalTab {
  id: string
  title: string
  profileId: string
  /** True while the tab's PTY process is alive. */
  running: boolean
  activity: TabActivity
  startedAt: number
  cwd?: string
  /** Immutable working directory override used only for the initial spawn. */
  launchCwd?: string
  /** Existing CLI conversation to resume when this tab's PTY starts. */
  resumeSession?: AgentSessionRef
  /** New terminal açıldığında yalnızca bir kez çalıştırılan kayıtlı komut. */
  launchCommand?: string
  /** Ajan başlatılırken sabitlenen güvenlik profili. */
  permissionMode?: AgentPermissionMode
  model?: string
  /** Isolated git checkout this tab runs in, when one was requested. */
  worktree?: TabWorktree
  /** Sekmenin son "meşgul" dönemi: running/unread'e geçtiği ve çıktığı an (widget süresi). */
  busySince?: number
  busyUntil?: number
  /** Shell integration'ın bildirdiği son biten komut (sekme parıltısı için). */
  lastCommand?: { exitCode: number; durationMs: number; finishedAt: number }
  /** Ajanin kendi bildirdigi durum (agent-hooks); varken cikti tahmini sekme durumunu degistirmez. */
  agentHook?: { state: AgentHookState; sessionId?: string; detail?: string; at: number }
  /** Gorulmemis ajan olayi: sekme noktasi, zil, gorev cubugu rozeti. */
  attention?: TabAttention
  /** Sekme rengi (Agent IDE sekme menusu, Orca "Tab Color"): #rrggbb. */
  color?: string
  /** Telefondan PIN ile onaylanan yonetici sekmesi; oturum geri yuklenince normal acilir. */
  elevated?: boolean
}

export interface TerminalProfile {
  id: string
  name: string
  /** Boş bırakılırsa profil, platformun varsayılan kabuğunda açılır. */
  command: string
  args?: string[]
  cwd?: string
  icon?: string
  env?: Record<string, string>
  /** Kabuk hazır olunca terminale yazılacak komut (CLI ajan profilleri). */
  startupCommand?: string
  /** CLI model passed with --model; empty lets the CLI choose its own default. */
  model?: string
  /** Sekme/menü rengi (#rrggbb). */
  color?: string
  /** Undefined is treated as enabled for command profiles. */
  fullPermissions?: boolean
  /** CLI-specific arguments appended when fullPermissions is enabled. */
  fullPermissionArgs?: string
}

export interface ProviderProfile {
  id: string
  name: string
  /** CLI command started inside the platform default shell. */
  command: string
  model?: string
  /** Selectable model ids shown in Settings; model is the active one. */
  models?: string[]
  baseUrl?: string
  /** Environment variable exposed only to this provider's CLI process. */
  apiKeyEnv?: string
  modelEnv?: string
  baseUrlEnv?: string
  color?: string
  fullPermissions?: boolean
  fullPermissionArgs?: string
}

/**
 * Kayıtlı SSH bağlantısı. Kendi SSH istemcimiz YOK: sistemdeki OpenSSH `ssh`
 * binary'si PTY içinde spawn edilir (known_hosts, ~/.ssh/config, host key
 * doğrulaması OpenSSH'ta kalır). PAROLA ASLA SAKLANMAZ — kimlik doğrulama
 * anahtar / ssh-agent / ~/.ssh/config üzerinden yapılır.
 */
export interface SshConnection {
  id: string
  name: string
  host: string
  user?: string
  port?: number          // boş = 22
  /** Özel anahtar dosyası yolu (-i). Boş = ssh-agent / ~/.ssh/config. */
  identityFile?: string
  /** ProxyJump (-J) hedefi, ör. 'user@bastion'. */
  jumpHost?: string
  /** Bağlanır bağlanmaz uzak kabukta çalıştırılacak komut. */
  remoteCommand?: string
  /** Bağlantı sonrası cd edilecek uzak dizin. */
  remoteCwd?: string
  /** -A: agent forwarding. Varsayılan kapalı (güvenlik). */
  forwardAgent?: boolean
  /** Ek ham ssh argümanları (boşlukla ayrılmış). */
  extraArgs?: string
  color?: string
  /**
   * Kalıcı uzak oturum: bağlantı uzak makinede bir terminal çoklayıcı (tmux /
   * screen) oturumuna bağlanır. Bağlantı koparsa ya da pencere kapanırsa uzak
   * işler ÇALIŞMAYA DEVAM EDER; yeniden bağlanınca aynı oturuma dönülür.
   * Çoklayıcının uzak makinede kurulu olması gerekir.
   */
  persistentSession?: boolean
  /** Kullanılacak çoklayıcı; varsayılan 'tmux'. */
  multiplexer?: 'tmux' | 'screen'
  /** Uzak oturum adı; boşsa 'termflow'. Yalnızca [A-Za-z0-9_-]. */
  sessionName?: string
}

export interface CreateTerminalInput {
  kind: ShellKind
  shell?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  /** Environment values that must be masked from terminal output and scrollback. */
  secretEnvNames?: string[]
  cols?: number
  rows?: number
  /** PTY spawn edildikten kısa süre sonra kabuğa yazılacak komut. */
  startupCommand?: string
  /** Shell/profile hazırlandıktan sonra yalnızca bir kez yazılacak komut. */
  launchCommand?: string
  /** Desteklenen kabuklara OSC 133 shell integration enjekte edilsin mi. */
  shellIntegration?: boolean
  /** Kabuk yonetici gorevi uzerinden acilir (src/main/terminal/elevation.ts). */
  elevated?: boolean
}

/** Telefondan onayli yonetici sekmeleri: unsupported = Windows degil. */
export type ElevationStatus = 'unsupported' | 'off' | 'on'

/**
 * Full 20-color terminal palette (PRD §27). Shared with the renderer theme
 * system so `settings.customTheme` can live in the persisted AppSettings.
 */
export interface ThemeColors {
  background: string
  foreground: string
  cursor: string
  selection: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/**
 * Uygulama kabuğunun (title bar, sekmeler, paneller, menüler, butonlar,
 * inputlar) VS Code workbench renkleri. Temalar bunu isteğe bağlı verir;
 * vermeyenler için terminal paletinden tek bir yerde türetilir
 * (themes.ts → deriveUiColors).
 */
export interface ThemeUiColors {
  titleBarBackground: string
  titleBarForeground: string
  tabActiveBackground: string
  tabInactiveBackground: string
  tabActiveForeground: string
  tabInactiveForeground: string
  tabBorder: string
  /** VS Code'un aktif sekme üst vurgu çizgisi. */
  activeTabTopBorder: string
  panelBackground: string
  sideBarBackground: string
  inputBackground: string
  inputForeground: string
  inputBorder: string
  buttonBackground: string
  buttonForeground: string
  buttonHoverBackground: string
  focusBorder: string
  menuBackground: string
  menuForeground: string
  menuSelectionBackground: string
  statusBarBackground: string
  statusBarForeground: string
  widgetBorder: string
}

export interface ShellInfo {
  /** 'powershell' | 'pwsh' | 'cmd' | 'wsl' | 'gitbash' | 'bash' | 'sh' */
  id: string
  /** Görünen ad: 'PowerShell', 'PowerShell Core', 'Command Prompt', 'WSL', 'Git Bash', 'Bash', 'Shell' */
  name: string
  kind: ShellKind
  /** executable path */
  command: string
  args: string[]
  icon?: string
}

export type RenderMode = 'active' | 'passive' | 'buffer'

export type PtyEvent =
  | { kind: 'data'; ptyId: string; data: string }
  | { kind: 'exit'; ptyId: string; exitCode: number; durationMs: number }
  | { kind: 'cwd'; ptyId: string; cwd: string }

export interface AppSettings {
  themeId: string
  /** Custom 20-color palette; null = use the 'dark-plus' fallback (PRD §27). */
  customTheme: ThemeColors | null
  /** Cursor color override; '' = theme default (PRD §32). */
  cursorColor: string
  cursorWidth: number
  fontWeight: string
  fontFamily: string
  fontSize: number
  fontLigatures: boolean
  lineHeight: number
  letterSpacing: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  /** İmleç hareket efekti (overlay canvas); hareket ayarı kapalıyken çizilmez. */
  cursorEffect: CursorEffect
  scrollback: number
  /** WebGL renderer: 'auto'/'on' dener, 'off' DOM renderer'da kalır. */
  gpuAcceleration: 'auto' | 'on' | 'off'
  /** Sixel + iTerm2 satır içi görsel protokolü. */
  imageSupport: boolean
  terminalPadding: number
  /** 0-100, 100 = opak */
  opacity: number
  /** Eski acrylic anahtarı; normalize sırasında `backdrop: 'acrylic'`a taşınır. */
  blur: boolean
  /** Windows 11 sistem arka plan malzemesi; 'none' dışındakiler yüzeyleri yarı saydam yapar. */
  backdrop: BackdropMaterial
  /** Backdrop açıkken uygulama yüzeylerinin opaklığı (%). */
  backdropTint: number
  /** Pencere içeriğine 1px kenarlık çizer (PRD §30). */
  windowBorder: boolean
  /** İç yüzey köşe yuvarlaklığı, 0-20 px (PRD §30). */
  cornerRadius: number
  tabHeight: number
  copyOnSelect: boolean
  rightClickBehavior: 'context-menu' | 'paste'
  /** Terminal çıktısındaki mevcut dosya/klasör yollarını tıklanabilir yap. */
  clickablePaths: boolean
  /** Yol üzerinde sağ tıkta Open / Open File Location / Copy Path menüsü. */
  pathContextMenu: boolean
  confirmBeforeClose: boolean
  bell: boolean
  defaultProfileId: string
  startupDirectory: 'home' | 'last' | 'custom'
  customStartupDirectory: string
  shortcuts: Record<string, string>
  profiles: TerminalProfile[]
  providerProfiles: ProviderProfile[]
  /** Kayıtlı SSH bağlantıları (parola içermez). */
  sshConnections: SshConnection[]
  lastActiveProfileId?: string
  /** Son kullanılan çalışma dizini (PRD §38: startupDirectory 'last'). */
  lastCwd?: string
  windowWidth: number
  windowHeight: number
  /** Açık sekmeler + split düzeni yeniden açılışta geri yüklenir (userData/session.json). */
  restoreSession: boolean
  /**
   * Sol kenardaki oturum rail'i: sekmeleri depo -> oturum ağacı olarak listeler.
   * Uzun ömürlü ajan oturumları tab bar'a sığmadığında okunabilirliği korur.
   */
  showSessionRail: boolean
  /** Yerlesim: terminal (Lite'in kendisi) ya da Agent IDE. Lite surumunde her zaman 'terminal'. */
  uiMode: 'terminal' | 'ide'
  /** Agent IDE ilk acilis karti cevaplandi (yalniz IDE surumu, yeni kurulum). */
  uiModeChosen: boolean
  /** Agent IDE yerlesimi (PRD F1): eklenen projeler, panel genislikleri, sag panel sekmesi. */
  ide: IdeSettings
  /** Rail genişliği (px), sürüklenerek ayarlanır. */
  sessionRailWidth: number
  /**
   * Pencere kapatıldığında uygulama sistem tepsisinde çalışmaya devam eder;
   * gerçek çıkış yalnızca tepsi menüsündeki "Quit" ile yapılır.
   */
  closeToTray: boolean
  /** Windows oturumu açılınca uygulama otomatik başlar. */
  launchAtLogin: boolean
  /** Npm ile kurulu ajan CLI'larini acilista ve gunde bir arka planda guncelle. */
  autoUpdateAgents: boolean
  /** Quake (açılır) mod: global kısayolla ekranın üstünden inen pencere. */
  quakeMode: boolean
  /** Electron accelerator formatında global kısayol (ör. 'F12'). */
  quakeHotkey: string
  /** Odak kaybında pencereyi gizle. */
  quakeHideOnBlur: boolean
  /** Quake penceresinin çalışma alanına oranı (%). */
  quakeHeightPercent: number
  /** Açılışta sessizce güncelleme kontrolü yap (yalnızca kurulu sürümde). */
  autoCheckUpdates: boolean
  /** Yeni ajan sekmelerinin varsayılan güvenlik profili. */
  defaultAgentPermissionMode: AgentPermissionMode
  /** Son taramada kurulu bulunan yerlesik ajan profilleri; undefined = hic taranmadi (hepsi gorunur). */
  installedAgents?: string[]
  /**
   * Arayüz animasyon yoğunluğu. 'off' tüm geçişleri kapatır; sistemin
   * "reduce motion" tercihi her zaman 'off' gibi davranır.
   */
  motion: MotionLevel
  /** Terminal üstü retro katman: tarama çizgileri ya da CRT (çizgi + vinyet + ışıma). */
  terminalEffect: TerminalEffect
  /** Test/build komutu başarıyla bitince konfeti (hareket açıkken). */
  celebrate: boolean
  /** Tuş/zil sesleri (WebAudio sentezi); varsayılan kapalı. */
  soundTheme: SoundTheme
  /** İlk açılıştaki ipucu kartı; "Got it" ile kalıcı olarak kapanır. */
  showTips: boolean
  /** Konami koduyla açılan gizli retro temalar. */
  retroUnlocked: boolean
  /**
   * PowerShell / Git Bash / bash / zsh oturumlarına OSC 133 shell integration
   * ekler: komut blokları, exit code, süre, komutlar arası gezinme.
   */
  shellIntegration: boolean
  /** Geçmişten gri satır içi komut önerisi (→ ile kabul); shell integration gerekir. */
  inlineSuggestions: boolean
  /**
   * Resim/video önizleme kartları: 'off' kapalı, 'manual' yalnızca sürükle-bırak
   * ve yapıştırma, 'all' ayrıca aktif klasörde yeni beliren medya dosyaları.
   */
  mediaPreviews: MediaPreviewMode
  /** Arka planda uzun süren bir komut bitince sistem bildirimi göster. */
  commandNotifications: boolean
  /** Ajan durumunu ajanin kendisinden oku: Claude HTTP hook'lari (--settings), Codex OSC 9. Kullanici dosyalarina yazilmaz. */
  agentHooks: boolean
  /** When a Claude account hits its usage limit, resume the session on another signed-in account. Needs agentHooks. */
  autoSwitchClaudeAccount: boolean
  /** Ajan bitti / seni bekliyor / hata: kategori basina sistem bildirimi ve ses. */
  agentAlerts: AgentAlertSettings
  /** Depo basina worktree kurulum adimlari; anahtar `setupKey(repoRoot)`. */
  worktreeSetup: Record<string, WorktreeSetupSteps>
  /** Yeniden acilista her sekmenin son ciktisini geri getir (userData/scrollback, anahtarlar maskeli). */
  restoreScrollback: boolean
  /** Yeniden acilista ajan sekmeleri kendi konusmasiyla surer (yalniz { agent, id } kaydedilir). */
  resumeAgentsOnRestore: boolean
  /** Durum cubugunda ajan limitleri: kullanilan ya da kalan yuzde. */
  usageDisplay: 'off' | 'used' | 'remaining'
  /** Claude limitleri icin status line yardimcisi (Claude'un alt bilgi ipuclarini gizler; istege bagli). */
  claudeUsage: boolean
  /** Limit gostergesi varsayilanlari (Claude acik, kalan %) bir kez uygulandi; sonraki secimler korunur. */
  limitDefaultsApplied: boolean
  /** 1.25.0 tek seferlik gecis: limitler Claude Code gibi % kullanilan. */
  limitClaudeStyleApplied: boolean
  /** Aktif ajanin limitlerini terminalin sag ustunde kart olarak goster. */
  usageCard: boolean
  /** OSC 52: terminal programlari (SSH/tmux icindeki TUI'ler dahil) panoya yazabilir; okuma hep kapali. */
  osc52Clipboard: boolean
  /** Ajan sekmesinde Shift+Enter gondermek yerine yeni satir ekler. */
  shiftEnterNewline: boolean
  /** xterm minimumContrastRatio: 1 = kapali, 4.5 = WCAG AA. */
  minimumContrastRatio: number
  /** Ajan sekmelerinin sağında, ajan durumuna göre değişen karakter animasyonu. */
  agentCompanion: boolean
  /** Animasyon stili: gözleriyle tepki veren ASCII yüz ya da piksel-art sahneler. */
  agentAnimationStyle: AgentAnimationStyle
  /** Karakter: 'auto' ajana göre seçer (Claude -> Ember, Codex -> Miso, OpenCode -> Piko). */
  agentCharacter: AgentCharacter
  /** Weather around the character: off, a changing demo sky, or live weather for `weatherPlace`. */
  agentWeather: AgentWeather
  /** City for live weather, resolved once to rounded coordinates. */
  weatherPlace: { name: string; latitude: number; longitude: number } | null
  /** Per-profile picture drawn as ASCII behind the terminal text (key = profile id). */
  asciiBackgrounds: Record<string, AsciiBackground>
  /** Agent Memory: 30-day per-project memory built from local agent sessions (opt-in). */
  memory: MemorySettings
  /** Remote Access: phone control over Tailscale (docs/remote-access.md). Off by default. */
  remote: RemoteSettings
  /** Voice input: hold Space and speak (docs/voice-input.md). Off by default. */
  voice: VoiceSettings
  /** Orchestration: ajanlar isi baska ajanlara devreder (docs/agent-ide/orchestration.md). Yalniz Agent IDE. */
  orchestration: OrchestrationSettings
  /** Widget görünümünün son konumu (null = sağ üst köşe), daraltılmış ve üstte tutma durumu. */
  widgetX: number | null
  widgetY: number | null
  widgetCollapsed: boolean
  widgetPinned: boolean
}

export type MotionLevel = 'off' | 'subtle' | 'full'
export type MediaPreviewMode = 'off' | 'manual' | 'all'
export type BackdropMaterial = 'none' | 'mica' | 'acrylic' | 'tabbed'
export type CursorEffect = 'none' | 'trail' | 'blaze'
export type TerminalEffect = 'none' | 'scanlines' | 'crt'
export type SoundTheme = 'off' | 'mechanical' | 'soft'
export type AgentAnimationStyle = 'face' | 'scenes'
export type AgentCharacter = 'auto' | 'ember' | 'miso' | 'piko'
export type AgentWeather = 'off' | 'cycle' | 'live'

export type VoiceLanguage = 'auto' | 'tr' | 'en'

export interface VoiceSettings {
  enabled: boolean
  /** OpenRouter model that accepts audio input. */
  model: string
  /** How long Space is held before recording starts (ms). */
  holdMs: number
  /** Fix punctuation, drop filler words and spell technical terms; off keeps the words as spoken. */
  cleanup: boolean
  language: VoiceLanguage
  /** Read selected terminal text aloud with a local Turkish voice (tts-studyo). */
  speak: SpeakSettings
}

export type SpeakModel = 'antalia' | 'ema'

export interface SpeakSettings {
  enabled: boolean
  model: SpeakModel
  /** 0.5-2.0; 1 is normal speed. */
  speed: number
  /** tts-studyo folder; empty = ~/Projects/tts-studyo. Started on demand when it is not running. */
  studioDir: string
}

/** One synthesized piece of speech (WAV) from the local tts-studyo server. */
export interface SpeakResult {
  ok: boolean
  wav?: Uint8Array
  error?: string
}

/** Result of one dictation or of a model test. */
export interface VoiceResult {
  ok: boolean
  text: string
  model: string
  latencyMs: number
  cost?: number
  error?: string
}

export interface RemoteSettings {
  enabled: boolean
  /** TCP port on the Tailscale address. */
  port: number
  /** Agent alerts pushed to the phone through ntfy, also when TermFlow Remote is closed. */
  push: PhonePushSettings
  /** The whole desktop on the phone, through a VNC server on this computer. */
  screen: RemoteScreenSettings
}

export interface RemoteScreenSettings {
  enabled: boolean
  /** Port of the VNC server on this computer; 5900 is the standard one. */
  port: number
}

export interface PhonePushSettings {
  enabled: boolean
  /** ntfy server, e.g. https://ntfy.sh or a self-hosted one. */
  server: string
  /** Secret topic; generated when push is turned on. */
  topic: string
}

/** Hafiza ne siklikla yeni session arar (yeni session yoksa model cagrilmaz). */
export type MemoryInterval = 'hourly' | 'daily' | 'weekly'
export const MEMORY_INTERVAL_MS: Record<MemoryInterval, number> = { hourly: 60 * 60_000, daily: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000 }

export interface OrchestrationTargetSettings {
  enabled: boolean
  /** Bos: CLI'in kendi varsayilani (saglayici profilinde profilin modeli). */
  model: string
}

export interface OrchestrationSettings {
  /** Yerel API'yi ve termflow-agents MCP'sini acar. */
  enabled: boolean
  /** Ayni anda calisan gorev siniri (OpenCode ayrica tek tek calisir). */
  maxConcurrent: number
  timeoutMinutes: number
  /** Claude 5 saatlik kullanimi bu yuzdeyi gecince list_agents ucretsiz hedefleri onerir; 0 = kapali. */
  claudeThreshold: number
  /** Anahtar: hedef id ('opencode', 'codex', 'grok', 'claude', 'provider:<id>'). Kaydi olmayan hedef acik sayilir. */
  targets: Record<string, OrchestrationTargetSettings>
}

export type DelegateAgentKind = 'opencode' | 'codex' | 'grok' | 'claude' | 'agy' | 'gemini' | 'qwen' | 'copilot' | 'kimi' | 'droid'

/** Is verilebilecek hedef: kurulu ajan CLI'i ya da `claude` ile calisan saglayici profili. */
export interface OrchestrationTarget {
  id: string
  label: string
  agent: DelegateAgentKind
  installed: boolean
  enabled: boolean
  model: string
  providerId?: string
  /** Saglayici profilinde anahtar kayitli mi (degeri hic gonderilmez). */
  hasCredential?: boolean
}

export type DelegatedTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout' | 'cancelled'

export interface DelegatedTask {
  id: string
  target: string
  label: string
  model?: string
  prompt: string
  repoRoot: string
  /** MCP istemcisinin adi (initialize clientInfo), orn. 'claude-code'. */
  requestedBy?: string
  checkCommand?: string
  status: DelegatedTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  worktreePath?: string
  branch: string
  lastMessage: string
  cost?: number
  tokens?: number
  exitCode: number | null
  diffStat: string
  changedFiles: string[]
  commit?: string
  check?: { code: number | null; timedOut: boolean; output: string }
  outputTail: string
}

export interface OrchestrationStatus {
  running: boolean
  error?: string
}

export interface OrchestrationTestResult {
  ok: boolean
  status: DelegatedTaskStatus
  latencyMs: number
  cost?: number
  error?: string
  lastMessage?: string
}

export interface MemorySettings {
  enabled: boolean
  updateEvery: MemoryInterval
  /** OpenRouter model id. */
  model: string
  /** Project keys (normalized git roots) that are never read or sent. */
  excludedProjects: string[]
}

export interface MemoryStatus {
  state: 'disabled' | 'no-key' | 'idle' | 'running' | 'error'
  projects: number
  done?: number
  total?: number
  lastRunAt?: number
  lastError?: string
  usage?: { promptTokens: number; completionTokens: number; requests: number; cost?: number }
}

export interface MemoryProject {
  key: string
  path: string
  lastSessionAt: number
  generatedAt: number
  sessions: number
  status: string
}

/** OpenRouter model kataloğundan, cache'e yazılan sade kayıt. */
export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  /** USD per 1M tokens; null: değişken ya da bilinmiyor. */
  inputPrice: number | null
  outputPrice: number | null
  /** json_schema structured output destekler (memory özeti buna dayanır). */
  structured: boolean
  /** Accepts audio input (voice dictation needs it). */
  audio: boolean
  /** USD per 1M audio input tokens, when OpenRouter reports it. */
  audioPrice?: number | null
}

export interface OpenRouterModelList {
  models: OpenRouterModel[]
  /** Listenin OpenRouter'dan çekildiği an; 0: hiç çekilemedi. */
  fetchedAt: number
  source: 'cache' | 'network' | 'none'
  /** Yenileme başarısız oldu; varsa eski cache dönülmüştür. */
  error?: string
}

export interface OpenRouterModelTest {
  ok: boolean
  model: string
  latencyMs: number
  reply?: string
  cost?: number
  error?: string
}

export type MemoryAgent = 'claude' | 'codex' | 'opencode'

export interface MemoryConnection {
  agent: MemoryAgent
  /** missing: CLI not installed; outdated: registered with another app path. */
  state: 'missing' | 'disconnected' | 'connected' | 'outdated' | 'error'
  detail?: string
}
export type AsciiCharset = 'dots' | 'ascii' | 'blocks'

export interface AsciiBackground {
  /** Downscaled JPEG data URL made by the main process; never a file path. */
  image: string
  /** Character cell width in px; smaller draws a finer picture. */
  density: number
  /** Glyph opacity in percent. */
  opacity: number
  charset: AsciiCharset
}

export type BackgroundPick =
  | { status: 'ok'; image: string }
  | { status: 'canceled' }
  | { status: 'invalid'; reason: string }

/**
 * Otomatik güncelleme durumu (electron-updater). Main tarafından üretilir,
 * IPC.UPDATE_STATUS ile renderer'a push edilir.
 */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  percent?: number
  error?: string
}

/**
 * Oturum geri yükleme için ayarlardan AYRI tutulan kalıcı durum
 * (userData/session.json). Yalnızca serileştirilebilir alanlar; ajan
 * konuşma referansı (resumeSession) bilinçli olarak yazılmaz.
 */
export interface PersistedSession {
  version: 1
  tabs: { id: string; title: string; profileId: string; cwd?: string; permissionMode?: AgentPermissionMode; model?: string; resumeSession?: AgentSessionRef; worktree?: TabWorktree; color?: string }[]
  activeTabId: string | null
  paneTree: unknown | null
  splitDirection: 'vertical' | 'horizontal' | null
  splitRatio: number
  workspaceCwd?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeId: 'dark-plus',
  customTheme: null,
  cursorColor: '',
  cursorWidth: 2,
  fontWeight: 'normal',
  fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
  fontSize: 13,
  fontLigatures: false,
  lineHeight: 1.0,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  cursorEffect: 'none',
  scrollback: 10000,
  gpuAcceleration: 'auto',
  imageSupport: true,
  terminalPadding: 8,
  opacity: 100,
  blur: false,
  backdrop: 'none',
  backdropTint: 78,
  windowBorder: false,
  cornerRadius: 0,
  tabHeight: 36,
  copyOnSelect: false,
  rightClickBehavior: 'context-menu',
  clickablePaths: true,
  pathContextMenu: true,
  confirmBeforeClose: true,
  bell: true,
  defaultProfileId: 'powershell',
  startupDirectory: 'home',
  customStartupDirectory: '',
  shortcuts: {
    'ctrl+shift+t': 'new-tab',
    'ctrl+shift+w': 'close-tab',
    'ctrl+tab': 'next-tab',
    'ctrl+shift+tab': 'prev-tab',
    'ctrl+shift+f': 'search',
    'ctrl+,': 'settings',
    'ctrl+=': 'font-increase',
    'ctrl+-': 'font-decrease',
    'ctrl+0': 'font-reset',
    'ctrl+alt+b': 'toggle-broadcast',
    'ctrl+shift+j': 'jump-palette',
    ...(EDITION === 'ide' ? { 'ctrl+shift+i': 'toggle-ui-mode' } : {})
  },
  profiles: [],
  providerProfiles: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      command: 'claude',
      model: 'deepseek-v4-pro',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
      modelEnv: 'ANTHROPIC_MODEL',
      baseUrlEnv: 'ANTHROPIC_BASE_URL',
      color: '#111827',
      fullPermissions: false,
      fullPermissionArgs: '--dangerously-skip-permissions'
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      command: 'claude',
      model: 'openrouter/auto',
      models: ['openrouter/auto', '~openai/gpt-latest', 'anthropic/claude-opus-4.5'],
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
      modelEnv: 'ANTHROPIC_MODEL',
      baseUrlEnv: 'ANTHROPIC_BASE_URL',
      color: '#6467f2',
      fullPermissions: false,
      fullPermissionArgs: '--dangerously-skip-permissions'
    },
    {
      id: 'ollama-local',
      name: 'Ollama Local',
      command: 'ollama run gemma3',
      model: 'gemma3',
      models: ['gemma3', 'deepseek-r1', 'qwen2.5-coder'],
      baseUrl: 'http://127.0.0.1:11434',
      modelEnv: 'OLLAMA_MODEL',
      baseUrlEnv: 'OLLAMA_HOST',
      color: '#b48ead',
      fullPermissions: false,
      fullPermissionArgs: ''
    }
  ],
  sshConnections: [],
  windowWidth: 1100,
  windowHeight: 700,
  restoreSession: true,
  showSessionRail: false,
  uiMode: EDITION === 'ide' ? 'ide' : 'terminal',
  uiModeChosen: false,
  ide: { projects: [], sidebarWidth: 260, rightWidth: 300, rightOpen: true, rightTab: 'explorer', sidebarOpen: true, showClaudeWorktrees: false, showOtherWorktrees: false, shownWorktrees: [], hideDefaultBranch: false, hideDetached: false, sort: 'activity', cardLayout: 'detailed', groupBy: 'project', hideSleeping: false, hiddenProps: [], worktreeMeta: {}, keepAwake: 'off' },
  sessionRailWidth: 220,
  closeToTray: true,
  launchAtLogin: false,
  autoUpdateAgents: true,
  quakeMode: false,
  quakeHotkey: 'F12',
  quakeHideOnBlur: true,
  quakeHeightPercent: 50,
  autoCheckUpdates: true,
  defaultAgentPermissionMode: 'workspace',
  motion: 'subtle',
  terminalEffect: 'none',
  retroUnlocked: false,
  celebrate: false,
  soundTheme: 'off',
  showTips: true,
  shellIntegration: true,
  inlineSuggestions: true,
  mediaPreviews: 'all',
  commandNotifications: true,
  agentHooks: true,
  autoSwitchClaudeAccount: true,
  restoreScrollback: true,
  resumeAgentsOnRestore: true,
  usageDisplay: 'used',
  claudeUsage: true,
  limitDefaultsApplied: true,
  limitClaudeStyleApplied: true,
  usageCard: true,
  osc52Clipboard: true,
  shiftEnterNewline: true,
  minimumContrastRatio: 1,
  agentAlerts: {
    needsInput: { system: true, sound: true },
    done: { system: true, sound: false },
    error: { system: true, sound: false },
    volume: 60,
    soundFile: ''
  },
  worktreeSetup: {},
  agentCompanion: true,
  agentAnimationStyle: 'face',
  agentCharacter: 'auto',
  agentWeather: 'cycle',
  weatherPlace: null,
  asciiBackgrounds: {},
  memory: { enabled: false, updateEvery: 'hourly', model: 'deepseek/deepseek-v4-flash', excludedProjects: [] },
  remote: { enabled: false, port: 47321, push: { enabled: false, server: 'https://ntfy.sh', topic: '' }, screen: { enabled: false, port: 5900 } },
  voice: { enabled: false, model: 'google/gemini-2.5-flash-lite', holdMs: 400, cleanup: true, language: 'auto', speak: { enabled: false, model: 'antalia', speed: 1, studioDir: '' } },
  // Dilim 0 olcumunde en hizli gecen ucretsiz model; listede yoksa kullanici secer.
  orchestration: { enabled: false, maxConcurrent: 2, timeoutMinutes: 10, claudeThreshold: 70, targets: { opencode: { enabled: true, model: 'opencode/deepseek-v4.1-flash-free' } } },
  widgetX: null,
  widgetY: null,
  widgetCollapsed: false,
  widgetPinned: true
}
