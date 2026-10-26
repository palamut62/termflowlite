// IPC channel names + payload types (TermFlow Lite)

import type { AgentEvent, AgentSession, AgentSessionRef, AppSettings, RenderMode, ShellInfo, UpdateStatus } from './types'
import type { WorktreeSetupSteps } from './worktreeSetup'

export const IPC = {
  PTY_CREATE: 'pty:create', // (tabId, profileId, cols, rows, cwd?) -> { pid }
  PTY_WRITE: 'pty:write', // (tabId, data)
  PTY_RESIZE: 'pty:resize', // (tabId, cols, rows)
  PTY_KILL: 'pty:kill', // (tabId)
  PTY_MODE: 'pty:mode', // (tabId, mode)
  PTY_RESTART: 'pty:restart', // (tabId) -> { pid } | null
  PTY_RESTART_AT: 'pty:restart-at', // (tabId, cwd) -> { pid } | null
  PTY_BUFFER: 'pty:buffer', // (tabId) -> string
  PTY_DATA: 'pty:data', // main -> renderer { ptyId, data }
  PTY_EXIT: 'pty:exit', // main -> renderer { ptyId, exitCode, durationMs }
  PTY_CWD: 'pty:cwd', // main -> renderer { ptyId, cwd }
  SHELLS_DISCOVER: 'shells:discover', // -> ShellInfo[]
  SETTINGS_GET: 'settings:get', // -> AppSettings
  SETTINGS_SET: 'settings:set', // (patch) -> AppSettings
  SETTINGS_CHANGED: 'settings:changed', // main -> renderer AppSettings (a phone changed them)
  REMOTE_STATUS: 'remote:status', // -> RemoteStatus
  REMOTE_STATUS_EVENT: 'remote:status-event', // main -> renderer RemoteStatus (state, pairing, connections)
  REMOTE_PAIR: 'remote:pair', // -> RemotePairing (QR with a one-time code)
  REMOTE_PAIR_CANCEL: 'remote:pair-cancel', // ()
  REMOTE_DEVICES: 'remote:devices', // -> RemoteDeviceInfo[]
  REMOTE_REVOKE: 'remote:revoke', // (deviceId | null = all)
  REMOTE_TABS: 'remote:tabs', // renderer -> main RemoteTabsState
  REMOTE_COMMAND: 'remote:command', // main -> renderer RemoteCommandRequest
  REMOTE_COMMAND_REPLY: 'remote:command-reply', // renderer -> main RemoteCommandReply
  ELEVATION_STATUS: 'elevation:status', // -> ElevationStatus
  ELEVATION_ENABLE: 'elevation:enable', // (pin) one UAC prompt on the PC
  ELEVATION_DISABLE: 'elevation:disable', // () one UAC prompt on the PC
  PROVIDER_SECRET_STATUS: 'provider-secret:status', // (providerId) -> boolean
  PROVIDER_SECRET_HEALTH: 'provider-secret:health',
  PROFILE_HEALTH: 'profile:health',
  AGENTS_UPDATE_STATUS: 'agents:update-status', // () -> AgentUpdateSnapshot
  AGENTS_UPDATE_RUN: 'agents:update-run', // () -> AgentUpdateSnapshot (hemen kontrol)
  AGENTS_UPDATE_EVENT: 'agents:update-event', // main -> renderer AgentUpdateSnapshot
  AGENTS_DETECT: 'agents:detect', // () -> kurulu yerlesik ajan profil id'leri
  PROVIDER_SECRET_SET: 'provider-secret:set', // (providerId, secret) -> boolean
  PROVIDER_SECRET_DELETE: 'provider-secret:delete', // (providerId) -> void
  SESSION_GET: 'session:get', // -> PersistedSession | null
  SESSION_SAVE: 'session:save', // (PersistedSession) — fire-and-forget, main debounces
  SESSION_CLEAR: 'session:clear', // ()
  CLIPBOARD_READ: 'clipboard:read', // -> string (sandboxed renderer paste fallback)
  CLIPBOARD_READ_PASTE: 'clipboard:read-paste', // -> copied file path or text
  CLIPBOARD_WRITE: 'clipboard:write', // (text) -> boolean; navigator.clipboard.writeText odak/permission'a duyarlı
  WINDOW_TITLEBAR_OVERLAY: 'window:titlebar-overlay', // (TitleBarOverlayPayload) — Windows only
  WINDOW_NOTIFY: 'window:notify', // (CommandNotification) — sistem bildirimi
  WINDOW_FOCUS_TAB: 'window:focus-tab', // main -> renderer (tabId) — bildirime tıklandı
  MEDIA_INSPECT: 'media:inspect', // (path) -> MediaInfo | null — doğrular, izin verir, küçük resim üretir
  MEDIA_WATCH: 'media:watch', // (tabId, dir | null) — sekmenin klasöründe yeni medyayı izle / bırak
  MEDIA_NEW: 'media:new', // main -> renderer (tabIds, MediaInfo) — izlenen klasörde yeni medya
  WINDOW_SAVE_SNAPSHOT: 'window:save-snapshot', // (CaptureRect, defaultName) -> kaydedilen yol | null
  WINDOW_WIDGET: 'window:widget', // (WidgetAction) -> WidgetState — kompakt widget görünümü
  DIALOG_OPEN_DIR: 'dialog:open-dir',
  DIALOG_OPEN_FILE: 'dialog:open-file', // -> seçilen dosya yolu | null
  DIALOG_PICK_BACKGROUND: 'dialog:pick-background', // -> BackgroundPick (küçültülmüş JPEG data URL)
  UPDATE_CHECK: 'update:check', // -> UpdateStatus
  UPDATE_DOWNLOAD: 'update:download', // () — ilerleme UPDATE_STATUS ile akar
  UPDATE_INSTALL: 'update:install', // () — uygulamayı kapatıp kurar
  UPDATE_STATUS: 'update:status', // main -> renderer UpdateStatus
  GIT_STATUS: 'git:status',
  SCM_STATE: 'scm:state', // (cwd) -> ScmState | null
  SCM_RUN: 'scm:run', // (cwd, ScmAction) -> GhOutcome
  SCM_CHECKS: 'scm:checks', // (cwd) -> ScmChecks
  SCM_DIFF: 'scm:diff', // (cwd, base) -> ScmDiff
  SCM_REFS: 'scm:refs', // (cwd) -> string[]
  NOTES_READ: 'notes:read', // (worktreePath) -> string
  NOTES_WRITE: 'notes:write', // (worktreePath, text) -> boolean
  WORKTREE_REPO_INFO: 'worktree:repo-info', // (cwd) -> GitRepoInfo | null
  WORKTREE_LIST: 'worktree:list', // (repoRoot) -> WorktreeEntry[]
  WORKTREE_CREATE: 'worktree:create', // (WorktreeCreateRequest) -> WorktreeOutcome
  WORKTREE_REMOVE: 'worktree:remove', // (WorktreeRemoveRequest) -> { ok } | { ok: false, error }
  WORKTREE_SETUP_SUGGEST: 'worktree:setup-suggest', // (repoRoot) -> { copyFiles, commands }
  WORKTREE_SETUP_RUN: 'worktree:setup-run', // (WorktreeSetupRequest) -> WorktreeSetupOutcome
  WORKTREE_SETUP_CANCEL: 'worktree:setup-cancel', // send (runId)
  WORKTREE_SETUP_OUTPUT: 'worktree:setup-output', // main -> renderer (runId, text)
  GITHUB_STATUS: 'github:status', // () -> GitHubStatus
  GITHUB_REPOS: 'github:repos', // (limit) -> GitHubRepo[]
  GITHUB_CURRENT_REPO: 'github:current-repo', // (cwd) -> 'owner/name' | ''
  GITHUB_PULL_REQUESTS: 'github:pull-requests', // (repo, cwd?) -> GitHubPullRequest[]
  GITHUB_PR_CHECKOUT: 'github:pr-checkout', // (worktreePath, number, repo?) -> GhOutcome
  GITHUB_CLONE: 'github:clone', // (nameWithOwner, targetPath) -> GhOutcome
  GITHUB_TASKS: 'github:tasks', // (kind, filter, search, repo, cwd?) -> GitHubTask[]
  WEATHER_GEOCODE: 'weather:geocode', // (city) -> WeatherPlace | null
  WEATHER_CURRENT: 'weather:current', // (latitude, longitude) -> WeatherReading | null
  FILES_LIST: 'files:list', // (dir, showHidden) -> DirListing | null — one level, read-only
  FILES_SEARCH: 'files:search', // (dir, FileSearchQuery) -> FileSearchResult — git grep
  TASKS_DISCOVER: 'tasks:discover',
  PROJECT_DETECT: 'project:detect',
  CLAUDE_ACCOUNT_LINK: 'claude-account:link', // (configDir) -> { ok, error? } - shares projects/skills with the default account
  CLAUDE_ACCOUNT_DETECT: 'claude-account:detect', // () -> ClaudeLogin[] - signed-in Claude subscriptions
  CLAUDE_ACCOUNT_SUGGEST: 'claude-account:suggest', // (name) -> default config folder path
  PROJECT_CREATE: 'project:create', // (parent, name) -> ProjectCreateResult — mkdir for the New project dialog
  AGENT_SESSIONS_LIST: 'agent-sessions:list',
  AGENT_SESSION_WARNINGS: 'agent-sessions:warnings',
  AGENT_SESSION_HANDOVER: 'agent-sessions:handover',
  AGENT_TASKS_LIST: 'agent-sessions:tasks',
  MEMORY_STATUS: 'memory:status', // -> MemoryStatus
  MEMORY_STATUS_EVENT: 'memory:status-event', // main -> renderer MemoryStatus
  MEMORY_RUN: 'memory:run', // () -> MemoryStatus; elle "Update now"
  MEMORY_PROJECTS: 'memory:projects', // -> MemoryProject[]
  MEMORY_PROJECT: 'memory:project', // (key) -> markdown | null
  MEMORY_FORGET: 'memory:forget', // (key) -> void; projenin hafıza verisini siler
  MEMORY_CLEAR: 'memory:clear', // () -> void
  MEMORY_CONNECTIONS: 'memory:connections', // -> MemoryConnection[]
  MEMORY_CONNECT: 'memory:connect', // (agent) -> MemoryConnection
  MEMORY_DISCONNECT: 'memory:disconnect', // (agent) -> MemoryConnection
  MEMORY_MODELS: 'memory:models', // (force?) -> OpenRouterModelList; 24 saat cache'li
  MEMORY_TEST_MODEL: 'memory:test-model', // (model) -> OpenRouterModelTest
  ORCH_STATUS: 'orchestration:status', // -> OrchestrationStatus
  ORCH_TARGETS: 'orchestration:targets', // -> OrchestrationTarget[]
  ORCH_TASKS: 'orchestration:tasks', // -> DelegatedTask[]
  ORCH_TASKS_EVENT: 'orchestration:tasks-event', // main -> renderer DelegatedTask[]
  ORCH_CANCEL: 'orchestration:cancel', // (id) -> DelegatedTask | null
  ORCH_DISCARD: 'orchestration:discard', // (id) -> { ok, error? }
  ORCH_MODELS: 'orchestration:models', // (targetId, force?) -> OpenRouterModelList; CLI'dan, 24 saat cache
  ORCH_TEST: 'orchestration:test', // (targetId, model) -> OrchestrationTestResult; gecici depoda gercek gorev
  ORCH_CONNECTIONS: 'orchestration:connections', // -> MemoryConnection[] (termflow-agents MCP kaydi)
  ORCH_CONNECT: 'orchestration:connect', // (agent) -> MemoryConnection
  ORCH_DISCONNECT: 'orchestration:disconnect', // (agent) -> MemoryConnection
  VOICE_TRANSCRIBE: 'voice:transcribe', // (wav Uint8Array, VoiceContext) -> VoiceResult
  VOICE_SYNTH: 'voice:synth', // (text) -> SpeakResult; WAV from the local tts-studyo server
  VOICE_TEST: 'voice:test', // (model) -> VoiceResult; a short tone with the stored key
  AGENT_EVENTS_LIST: 'agent-events:list',
  AGENT_EVENTS_APPEND: 'agent-events:append',
  AGENT_EVENTS_CLEAR: 'agent-events:clear',
  /** main -> renderer: ajanin kendi bildirdigi durum (tabId, AgentHookEvent). */
  AGENT_HOOK_EVENT: 'agent-hooks:event',
  /** agent-attention: ozel ses sec / baytlarini al, gorev cubugu rozeti. */
  ALERTS_PICK_SOUND: 'alerts:pick-sound',
  ALERTS_LOAD_SOUND: 'alerts:load-sound',
  ALERTS_PHONE_PUSH: 'alerts:phone-push',
  ALERTS_PHONE_PUSH_TEST: 'alerts:phone-push-test',
  WINDOW_ATTENTION: 'window:attention',
  DIALOG_PICK_THEME: 'dialog:pick-theme',
  /** scrollback-restore */
  SCROLLBACK_SAVE: 'scrollback:save',
  SCROLLBACK_SAVE_ALL_SYNC: 'scrollback:save-all-sync',
  SCROLLBACK_LOAD: 'scrollback:load',
  SCROLLBACK_REMOVE: 'scrollback:remove',
  SCROLLBACK_CLEAR: 'scrollback:clear',
  /** usage-meter: yerel dosyalardan Claude/Codex limitleri. */
  USAGE_GET: 'usage:get',
  APP_LAUNCH_CWD: 'app:launch-cwd',
  APP_LAUNCH_READY: 'app:launch-ready',
  APP_OPEN_PATH: 'app:open-path',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',
  SYSTEM_RESOURCES: 'system:resources', // () -> ResourceSnapshot (surec tablosu + dinlenen portlar)
  SYSTEM_APP_MEMORY: 'system:app-memory', // () -> bytes (yalniz Electron surecleri, ucuz)
  SYSTEM_KEEP_AWAKE: 'system:keep-awake', // (active: boolean) -> void
  // Terminaldeki tıklanabilir dosya/klasör yolları (PRD ek).
  SYSTEM_RESOLVE_PATH: 'system:resolve-path', // (candidate, cwd) -> ResolvedPath | null
  SYSTEM_OPEN_PATH: 'system:open-path', // (path) -> boolean — varsayılan uygulamayla aç
  SYSTEM_REVEAL_IN_FOLDER: 'system:reveal-in-folder', // (path) -> boolean — Explorer'da konum
  SYSTEM_OPEN_IN_EDITOR: 'system:open-in-editor' // (path, line, column?) -> boolean — editörde satırında aç
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface AppLaunchRequest {
  cwd: string
  profileId?: string
}

/** cwd'ye göre çözülmüş ve diskte var olduğu doğrulanmış yol (pathLinks). */
export interface ResolvedPath {
  path: string
  isDirectory: boolean
  /** False for executable/script/shortcut types; clicks reveal them instead of running them. */
  canOpen: boolean
}

// ---- Payload types ----
export interface PtyCreatePayload {
  tabId: string
  profileId: string
  cols: number
  rows: number
}

/** Claude Code arka plan isi: shell gorevinin cikti dosyasi (Bash run_in_background) ya da alt ajan dokumu (JSONL). */
export interface AgentTask {
  id: string
  path: string
  size: number
  mtimeMs: number
  /** Yalniz alt ajan: gorunen ad (aciklama, ajan turu ya da id). */
  label?: string
  /** Shell ciktisini veya alt ajan JSONL'ini canli akitan izleme komutu. */
  command?: string
}

export interface AgentSessionsQuery {
  agents?: AgentSessionRef['agent'][]
  limit?: number
}

export type { AgentSession }
export type { AgentEvent }

export interface PtyWritePayload {
  tabId: string
  data: string
}

export interface PtyResizePayload {
  tabId: string
  cols: number
  rows: number
}

export interface PtyModePayload {
  tabId: string
  mode: RenderMode
}

export interface PtyDataEvent {
  ptyId: string
  data: string
}

export interface PtyExitEvent {
  ptyId: string
  exitCode: number
  durationMs: number
}

export interface PtyCwdEvent {
  ptyId: string
  cwd: string
}

export interface SettingsPatch extends Partial<AppSettings> {}

export interface GitStatus {
  branch: string
  changedFiles: number
}

/** Agent IDE Source Control paneli (PRD 4.9, F2.3). */
export interface ScmFile {
  path: string
  /** `git status --porcelain` X (index) ve Y (calisma agaci) harfleri. */
  index: string
  work: string
}
export interface ScmCommit { hash: string; subject: string; author: string; when: string }
export interface ScmState {
  branch: string
  upstream: string
  ahead: number
  behind: number
  files: ScmFile[]
  commits: ScmCommit[]
}
export type ScmAction =
  | { kind: 'stage' | 'unstage'; paths: string[] }
  | { kind: 'commit'; message: string }
  | { kind: 'push' }
  | { kind: 'create-pr' }
/** Unified diff text (git format) for the review page; `base` = Change Base Ref, empty = HEAD. */
export interface ScmDiff { text: string; truncated?: boolean; base?: string; error?: string }
export interface ScmCheck { name: string; state: string; link: string; workflow: string }
/** `pr: false`: aktif dalin PR'i yok; `error`: gh yok ya da basarisiz. */
export interface ScmChecks { pr: boolean; checks: ScmCheck[]; error?: string }

/** Repository root plus the branch currently checked out there. */
export interface GitRepoInfo {
  root: string
  branch: string
}

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  path: string
  head: string
  /** null while the worktree is on a detached HEAD. */
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
}

export interface WorktreeCreateRequest {
  repoRoot: string
  branch: string
  baseRef?: string
  path?: string
  /** Check out detached, leaving the branch choice to a later step. */
  detach?: boolean
  /** Sparse checkout (cone mode) folders; validated in main. */
  sparsePaths?: string[]
}

export interface WorktreeRemoveRequest {
  repoRoot: string
  path: string
  force?: boolean
  deleteBranch?: boolean
  branch?: string
}

export type WorktreeOutcome = { ok: true; worktree: WorktreeEntry } | { ok: false; error: string }
export type WorktreeRemoveOutcome = { ok: true } | { ok: false; error: string }

export interface WorktreeSetupRequest {
  runId: string
  repoRoot: string
  worktreePath: string
  steps: WorktreeSetupSteps
}

/** `step` 0 = dosya kopyalama, 1..n = komutlar. */
export type WorktreeSetupOutcome = { ok: true } | { ok: false; step: number; error: string }

/**
 * Availability of the user's GitHub CLI. TermFlow stores no token of its own:
 * `gh` owns the credentials, exactly as OpenSSH owns SSH keys.
 */
/** One entry of a folder listing (file panel). */
export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

/** One folder level: entries (folders first), whether it was cut at the cap, and how many were hidden. */
export interface DirListing {
  path: string
  entries: DirEntry[]
  truncated: boolean
  hidden: number
}

/** Agent IDE Resource Manager + Ports. memory: bytes; cpu: % of all cores over the last poll interval. */
export interface ResourceSnapshot {
  app: { memory: number; cpu: number }
  terminals: { id: string; memory: number; cpu: number; processes: number }[]
  /** terminalId: portu dinleyen surec bir terminalin agacindaysa (workspace portu); yoksa harici. */
  ports: { port: number; address: string; pid: number; terminalId?: string }[]
}

/** Explorer "Contents" search (Agent IDE). include/exclude: comma separated globs. */
export interface FileSearchQuery { text: string; caseSensitive?: boolean; word?: boolean; regex?: boolean; include?: string; exclude?: string }
export interface FileSearchFile { path: string; absolute: string; matches: { line: number; text: string }[] }
export type ProjectCreateResult = { ok: true; path: string } | { ok: false; error: string }
export interface FileSearchResult { files: FileSearchFile[]; truncated: boolean; error?: string }

/** A city resolved for live weather (coordinates rounded to two decimals). */
export interface WeatherPlace {
  name: string
  latitude: number
  longitude: number
}

/** Current conditions from Open-Meteo: WMO weather code, °C, km/h. */
export interface WeatherReading {
  code: number
  temperature: number
  windSpeed: number
  isDay: boolean
}

export interface GitHubStatus {
  installed: boolean
  authenticated: boolean
  /** Logged-in account login, when `gh auth status` reported one. */
  account: string
  /** Human-readable reason the integration is unavailable, else ''. */
  error: string
}

export interface GitHubRepo {
  nameWithOwner: string
  name: string
  description: string
  isPrivate: boolean
  updatedAt: string
}

export interface GitHubPullRequest {
  number: number
  title: string
  author: string
  headRefName: string
  isDraft: boolean
  updatedAt: string
}

export type GhOutcome = { ok: true } | { ok: false; error: string }

/** Agent IDE Tasks sayfasi (PRD F3.1): issue ya da PR satiri. */
export type GitHubTaskKind = 'issues' | 'prs'
export type GitHubTaskFilter = 'open' | 'mine' | 'review' | 'closed'
export interface GitHubTask {
  number: number
  title: string
  author: string
  assignees: string[]
  state: string
  updatedAt: string
  url: string
  labels: string[]
  /** Yalniz PR. */
  branch?: string
  draft?: boolean
}

export interface ProjectTask {
  id: string
  label: string
  command: string
  source: 'package.json' | 'python' | 'cargo' | 'go' | 'docker' | 'git'
}

export interface ProjectInfo {
  root: string
  technologies: string[]
  tasks: ProjectTask[]
}

export type MediaKind = 'image' | 'video'

/** Terminal önizleme kartının bilgisi; `thumbnail` data URL (boş olabilir). */
export interface MediaInfo {
  path: string
  name: string
  kind: MediaKind
  size: number
  modifiedAt: number
  thumbnail: string
  width?: number
  height?: number
}

/** Pencere içeriğinden PNG olarak kaydedilecek dikdörtgen (CSS px). */
export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

/** Arka planda biten komut için sistem bildirimi. */
export interface CommandNotification {
  tabId: string
  title: string
  body: string
}

/** Windows Controls Overlay renkleri/yüksekliği (#rrggbb — PRD §68). */
/** Widget view transitions; the main process owns the window geometry. */
export type WidgetAction = 'enter' | 'exit' | 'collapse' | 'expand' | 'pin' | 'unpin'

export interface WidgetState {
  active: boolean
  collapsed: boolean
  pinned: boolean
}

export interface TitleBarOverlayPayload {
  color: string
  symbolColor: string
  height?: number
}

export type { ShellInfo, UpdateStatus }

/** Gorev cubugu rozeti: okunmamis ajan olayi sayisi; Windows'ta renderer'in cizdigi PNG. */
export interface AttentionBadge {
  count: number
  needsInput: boolean
  icon?: string
}
