import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ClaudeLogin } from '../shared/claudeAccounts'
import { IPC, type AgentSessionsQuery, type AgentTask, type AppLaunchRequest, type GhOutcome, type GitHubPullRequest, type GitHubRepo, type GitHubStatus, type GitHubTask, type GitHubTaskFilter, type GitHubTaskKind, type GitRepoInfo, type GitStatus, type ScmAction, type ScmChecks, type ScmDiff, type ScmState, type ProjectInfo, type ProjectTask, type ResolvedPath,  type TitleBarOverlayPayload, type WidgetAction, type WidgetState, type CommandNotification, type CaptureRect, type MediaInfo, type WorktreeCreateRequest, type WorktreeEntry, type WorktreeOutcome, type WorktreeRemoveOutcome, type WorktreeRemoveRequest, type WorktreeSetupOutcome, type WorktreeSetupRequest, type DirListing, type ResourceSnapshot, type FileSearchQuery, type FileSearchResult, type ProjectCreateResult, type AttentionBadge } from '../shared/ipc'
import type { RemoteCommandReply, RemoteCommandRequest, RemoteDeviceInfo, RemotePairing, RemoteStatus, RemoteTabsState } from '../shared/remote'
import type { AgentHookEvent } from '../shared/agentHooks'
import type { AgentUsage } from '../shared/usage'
import type { AgentUpdateSnapshot } from '../shared/agentUpdate'
import type { AgentEvent, AgentPermissionMode, AgentSession, AgentSessionRef, AppSettings, BackgroundPick, DelegatedTask, OrchestrationStatus, OrchestrationTarget, OrchestrationTestResult, ElevationStatus, MemoryAgent, MemoryConnection, MemoryProject, MemoryStatus, OpenRouterModelList, OpenRouterModelTest, PersistedSession, RenderMode, ShellInfo, SpeakResult, TabAttention, UpdateStatus, VoiceResult } from '../shared/types'

// Windows OS build number (e.g. 26200 for current Win11). xterm's windowsPty
// option keys its reflow behaviour on this; fall back to a modern build when
// the API is unavailable.
function osBuildNumber(): number {
  try {
    const v = process.getSystemVersion()
    const n = parseInt(v.split('.')[2] ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : 21376
  } catch {
    return 21376
  }
}

const api = {
  // ---- System ----
  system: {
    osBuildNumber: osBuildNumber(),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.SYSTEM_OPEN_EXTERNAL, url),
    resources: (): Promise<ResourceSnapshot> => ipcRenderer.invoke(IPC.SYSTEM_RESOURCES),
    appMemory: (): Promise<number> => ipcRenderer.invoke(IPC.SYSTEM_APP_MEMORY),
    keepAwake: (active: boolean): Promise<void> => ipcRenderer.invoke(IPC.SYSTEM_KEEP_AWAKE, active),
    /** Terminaldeki tıklanabilir yollar: adayı tab cwd'sine göre çöz, var mı döndür. */
    resolvePath: (candidate: string, cwd: string): Promise<ResolvedPath | null> =>
      ipcRenderer.invoke(IPC.SYSTEM_RESOLVE_PATH, candidate, cwd),
    /** Dosyayı/klasörü varsayılan uygulamayla aç (dosya çalışır, klasör Explorer'da). */
    openPath: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.SYSTEM_OPEN_PATH, path),
    /** Dosyayı Explorer'da konumuyla göster (Open File Location). */
    revealInFolder: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.SYSTEM_REVEAL_IN_FOLDER, path),
    openInEditor: (path: string, line: number, column?: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_IN_EDITOR, path, line, column),
    // Blur (acrylic) yalnızca Windows'ta desteklenir — UI buna göre uyarlanır.
    platform: process.platform as NodeJS.Platform,
    /**
     * Sürükle-bırak edilen bir File'ın gerçek disk yolu. Renderer'da `file.path`
     * artık yok; tek yol webUtils. API kullanılamazsa boş string döner ve çağıran
     * o dosyayı sessizce atlar (yol asla loglanmaz — PRD §72).
     */
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  // ---- PTY ----
  pty: {
    create: (tabId: string, profileId: string, cols: number, rows: number, cwd?: string, resumeSession?: AgentSessionRef, launchCommand?: string, permissionMode?: AgentPermissionMode, model?: string, elevated?: boolean): Promise<{ pid: number }> =>
      ipcRenderer.invoke(IPC.PTY_CREATE, tabId, profileId, cols, rows, cwd, resumeSession, launchCommand, permissionMode, model, elevated),
    write: (tabId: string, data: string): void => ipcRenderer.send(IPC.PTY_WRITE, tabId, data),
    resize: (tabId: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.PTY_RESIZE, tabId, cols, rows),
    kill: (tabId: string): void => ipcRenderer.send(IPC.PTY_KILL, tabId),
    setMode: (tabId: string, mode: RenderMode): void => ipcRenderer.send(IPC.PTY_MODE, tabId, mode),
    restart: (tabId: string): Promise<{ pid: number } | null> => ipcRenderer.invoke(IPC.PTY_RESTART, tabId),
    restartAt: (tabId: string, cwd: string): Promise<{ pid: number } | null> => ipcRenderer.invoke(IPC.PTY_RESTART_AT, tabId, cwd),
    buffer: (tabId: string): Promise<string> => ipcRenderer.invoke(IPC.PTY_BUFFER, tabId),
    onData: (cb: (payload: { ptyId: string; data: string }) => void): (() => void) => {
      const h = (_e: unknown, payload: { ptyId: string; data: string }): void => cb(payload)
      ipcRenderer.on(IPC.PTY_DATA, h)
      return () => ipcRenderer.removeListener(IPC.PTY_DATA, h)
    },
    onExit: (cb: (payload: { ptyId: string; exitCode: number; durationMs: number }) => void): (() => void) => {
      const h = (_e: unknown, payload: { ptyId: string; exitCode: number; durationMs: number }): void =>
        cb(payload)
      ipcRenderer.on(IPC.PTY_EXIT, h)
      return () => ipcRenderer.removeListener(IPC.PTY_EXIT, h)
    },
    onCwd: (cb: (payload: { ptyId: string; cwd: string }) => void): (() => void) => {
      const h = (_e: unknown, payload: { ptyId: string; cwd: string }): void => cb(payload)
      ipcRenderer.on(IPC.PTY_CWD, h)
      return () => ipcRenderer.removeListener(IPC.PTY_CWD, h)
    }
  },
  // ---- Shells ----
  shells: {
    discover: (): Promise<ShellInfo[]> => ipcRenderer.invoke(IPC.SHELLS_DISCOVER)
  },
  // ---- Settings ----
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
    /** Settings changed from a paired phone. */
    onChanged: (cb: (settings: AppSettings) => void): (() => void) => {
      const h = (_e: unknown, settings: AppSettings): void => cb(settings)
      ipcRenderer.on(IPC.SETTINGS_CHANGED, h)
      return () => ipcRenderer.removeListener(IPC.SETTINGS_CHANGED, h)
    }
  },
  /** Remote Access: phones paired over Tailscale (docs/remote-access.md). */
  remote: {
    status: (): Promise<RemoteStatus> => ipcRenderer.invoke(IPC.REMOTE_STATUS),
    /** deviceId: a QR that renews that paired phone instead of adding a new one. */
    pair: (deviceId?: string): Promise<RemotePairing> => ipcRenderer.invoke(IPC.REMOTE_PAIR, deviceId),
    cancelPair: (): Promise<void> => ipcRenderer.invoke(IPC.REMOTE_PAIR_CANCEL),
    devices: (): Promise<RemoteDeviceInfo[]> => ipcRenderer.invoke(IPC.REMOTE_DEVICES),
    /** null disconnects every device. */
    revoke: (deviceId: string | null): Promise<void> => ipcRenderer.invoke(IPC.REMOTE_REVOKE, deviceId),
    publishTabs: (state: RemoteTabsState): void => ipcRenderer.send(IPC.REMOTE_TABS, state),
    reply: (reply: RemoteCommandReply): void => ipcRenderer.send(IPC.REMOTE_COMMAND_REPLY, reply),
    elevationStatus: (): Promise<ElevationStatus> => ipcRenderer.invoke(IPC.ELEVATION_STATUS),
    enableElevation: (pin: string): Promise<void> => ipcRenderer.invoke(IPC.ELEVATION_ENABLE, pin),
    disableElevation: (): Promise<void> => ipcRenderer.invoke(IPC.ELEVATION_DISABLE),
    onCommand: (cb: (request: RemoteCommandRequest) => void): (() => void) => {
      const h = (_e: unknown, request: RemoteCommandRequest): void => cb(request)
      ipcRenderer.on(IPC.REMOTE_COMMAND, h)
      return () => ipcRenderer.removeListener(IPC.REMOTE_COMMAND, h)
    },
    onStatus: (cb: (status: RemoteStatus) => void): (() => void) => {
      const h = (_e: unknown, status: RemoteStatus): void => cb(status)
      ipcRenderer.on(IPC.REMOTE_STATUS_EVENT, h)
      return () => ipcRenderer.removeListener(IPC.REMOTE_STATUS_EVENT, h)
    }
  },
  providerSecrets: {
    status: (id: string): Promise<'missing' | 'ready' | 'unavailable' | 'recovery-required'> => ipcRenderer.invoke(IPC.PROVIDER_SECRET_HEALTH, id),
    has: (providerId: string): Promise<boolean> => ipcRenderer.invoke(IPC.PROVIDER_SECRET_STATUS, providerId),
    set: (providerId: string, secret: string): Promise<boolean> => ipcRenderer.invoke(IPC.PROVIDER_SECRET_SET, providerId, secret),
    delete: (providerId: string): Promise<void> => ipcRenderer.invoke(IPC.PROVIDER_SECRET_DELETE, providerId)
  },
  agentUpdates: {
    status: (): Promise<AgentUpdateSnapshot> => ipcRenderer.invoke(IPC.AGENTS_UPDATE_STATUS),
    run: (): Promise<AgentUpdateSnapshot> => ipcRenderer.invoke(IPC.AGENTS_UPDATE_RUN),
    onChanged: (cb: (s: AgentUpdateSnapshot) => void): (() => void) => {
      const h = (_e: unknown, s: AgentUpdateSnapshot): void => cb(s)
      ipcRenderer.on(IPC.AGENTS_UPDATE_EVENT, h)
      return () => ipcRenderer.removeListener(IPC.AGENTS_UPDATE_EVENT, h)
    }
  },
  detectAgents: (): Promise<string[]> => ipcRenderer.invoke(IPC.AGENTS_DETECT),
  profileHealth: (id: string, connection = false): Promise<{ label: string; ok: boolean; detail: string }[]> => ipcRenderer.invoke(IPC.PROFILE_HEALTH, id, connection),
  // ---- Session (tab + split layout restore) ----
  session: {
    get: (): Promise<PersistedSession | null> => ipcRenderer.invoke(IPC.SESSION_GET),
    save: (session: PersistedSession): void => ipcRenderer.send(IPC.SESSION_SAVE, session),
    clear: (): void => ipcRenderer.send(IPC.SESSION_CLEAR)
  },
  dialog: {
    openDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR),
    openFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE),
    pickBackground: (): Promise<BackgroundPick> => ipcRenderer.invoke(IPC.DIALOG_PICK_BACKGROUND)
  },
  // ---- Auto update ----
  updater: {
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    download: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const h = (_e: unknown, status: UpdateStatus): void => cb(status)
      ipcRenderer.on(IPC.UPDATE_STATUS, h)
      return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, h)
    }
  },
  git: {
    status: (cwd: string): Promise<GitStatus | null> => ipcRenderer.invoke(IPC.GIT_STATUS, cwd),
    scm: (cwd: string): Promise<ScmState | null> => ipcRenderer.invoke(IPC.SCM_STATE, cwd),
    scmRun: (cwd: string, action: ScmAction): Promise<GhOutcome> => ipcRenderer.invoke(IPC.SCM_RUN, cwd, action),
    checks: (cwd: string): Promise<ScmChecks> => ipcRenderer.invoke(IPC.SCM_CHECKS, cwd),
    diff: (cwd: string, base = ''): Promise<ScmDiff> => ipcRenderer.invoke(IPC.SCM_DIFF, cwd, base),
    refs: (cwd: string): Promise<string[]> => ipcRenderer.invoke(IPC.SCM_REFS, cwd)
  },
  /** Agent IDE worktree notes (userData, never the project). */
  notes: {
    read: (worktreePath: string): Promise<string> => ipcRenderer.invoke(IPC.NOTES_READ, worktreePath),
    write: (worktreePath: string, text: string): Promise<boolean> => ipcRenderer.invoke(IPC.NOTES_WRITE, worktreePath, text)
  },
  /** Per-agent git worktree isolation. */
  worktree: {
    repoInfo: (cwd: string): Promise<GitRepoInfo | null> => ipcRenderer.invoke(IPC.WORKTREE_REPO_INFO, cwd),
    list: (repoRoot: string): Promise<WorktreeEntry[]> => ipcRenderer.invoke(IPC.WORKTREE_LIST, repoRoot),
    create: (request: WorktreeCreateRequest): Promise<WorktreeOutcome> => ipcRenderer.invoke(IPC.WORKTREE_CREATE, request),
    remove: (request: WorktreeRemoveRequest): Promise<WorktreeRemoveOutcome> => ipcRenderer.invoke(IPC.WORKTREE_REMOVE, request),
    suggestSetup: (repoRoot: string): Promise<{ copyFiles: string[]; commands: string[] }> => ipcRenderer.invoke(IPC.WORKTREE_SETUP_SUGGEST, repoRoot),
    runSetup: (request: WorktreeSetupRequest): Promise<WorktreeSetupOutcome> => ipcRenderer.invoke(IPC.WORKTREE_SETUP_RUN, request),
    cancelSetup: (runId: string): void => ipcRenderer.send(IPC.WORKTREE_SETUP_CANCEL, runId),
    onSetupOutput: (cb: (runId: string, text: string) => void): (() => void) => {
      const h = (_e: unknown, runId: string, text: string): void => cb(runId, text)
      ipcRenderer.on(IPC.WORKTREE_SETUP_OUTPUT, h)
      return () => ipcRenderer.removeListener(IPC.WORKTREE_SETUP_OUTPUT, h)
    }
  },
  /** GitHub through the user's own gh CLI; TermFlow stores no token. */
  github: {
    status: (): Promise<GitHubStatus> => ipcRenderer.invoke(IPC.GITHUB_STATUS),
    repos: (limit = 50): Promise<GitHubRepo[]> => ipcRenderer.invoke(IPC.GITHUB_REPOS, limit),
    currentRepo: (cwd: string): Promise<string> => ipcRenderer.invoke(IPC.GITHUB_CURRENT_REPO, cwd),
    pullRequests: (repo: string, cwd?: string): Promise<GitHubPullRequest[]> => ipcRenderer.invoke(IPC.GITHUB_PULL_REQUESTS, repo, cwd),
    checkoutPr: (worktreePath: string, number: number, repo?: string): Promise<GhOutcome> => ipcRenderer.invoke(IPC.GITHUB_PR_CHECKOUT, worktreePath, number, repo),
    clone: (nameWithOwner: string, targetPath: string): Promise<GhOutcome> => ipcRenderer.invoke(IPC.GITHUB_CLONE, nameWithOwner, targetPath),
    tasks: (kind: GitHubTaskKind, filter: GitHubTaskFilter, search: string, repo: string, cwd?: string): Promise<GitHubTask[]> => ipcRenderer.invoke(IPC.GITHUB_TASKS, kind, filter, search, repo, cwd)
  },
  /** Read-only folder listing for the file panel. */
  files: {
    list: (dir: string, showHidden: boolean): Promise<DirListing | null> => ipcRenderer.invoke(IPC.FILES_LIST, dir, showHidden),
    search: (dir: string, query: FileSearchQuery): Promise<FileSearchResult> => ipcRenderer.invoke(IPC.FILES_SEARCH, dir, query),
    linkClaudeAccount: (dir: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.CLAUDE_ACCOUNT_LINK, dir),
    detectClaudeLogins: (): Promise<ClaudeLogin[]> => ipcRenderer.invoke(IPC.CLAUDE_ACCOUNT_DETECT),
    suggestClaudeDir: (name: string): Promise<string> => ipcRenderer.invoke(IPC.CLAUDE_ACCOUNT_SUGGEST, name),
    createProject: (parent: string, name: string): Promise<ProjectCreateResult> => ipcRenderer.invoke(IPC.PROJECT_CREATE, parent, name)
  },
  tasks: {
    discover: (cwd: string): Promise<ProjectTask[]> => ipcRenderer.invoke(IPC.TASKS_DISCOVER, cwd)
  },
  project: {
    detect: (cwd: string): Promise<ProjectInfo | null> => ipcRenderer.invoke(IPC.PROJECT_DETECT, cwd)
  },
  agentSessions: {
    warnings: (): Promise<string[]> => ipcRenderer.invoke(IPC.AGENT_SESSION_WARNINGS),
    list: (query: AgentSessionsQuery = {}): Promise<AgentSession[]> => ipcRenderer.invoke(IPC.AGENT_SESSIONS_LIST, query),
    handover: (session: AgentSessionRef): Promise<string> => ipcRenderer.invoke(IPC.AGENT_SESSION_HANDOVER, session),
    tasks: (sessionId: string): Promise<AgentTask[]> => ipcRenderer.invoke(IPC.AGENT_TASKS_LIST, sessionId)
  },
  /** Agent Memory: 30-day per-project memory and the agent MCP connections. */
  memory: {
    status: (): Promise<MemoryStatus> => ipcRenderer.invoke(IPC.MEMORY_STATUS),
    run: (): Promise<MemoryStatus> => ipcRenderer.invoke(IPC.MEMORY_RUN),
    projects: (): Promise<MemoryProject[]> => ipcRenderer.invoke(IPC.MEMORY_PROJECTS),
    project: (key: string): Promise<string | null> => ipcRenderer.invoke(IPC.MEMORY_PROJECT, key),
    forget: (key: string): Promise<void> => ipcRenderer.invoke(IPC.MEMORY_FORGET, key),
    clear: (): Promise<void> => ipcRenderer.invoke(IPC.MEMORY_CLEAR),
    connections: (): Promise<MemoryConnection[]> => ipcRenderer.invoke(IPC.MEMORY_CONNECTIONS),
    connect: (agent: MemoryAgent): Promise<MemoryConnection | null> => ipcRenderer.invoke(IPC.MEMORY_CONNECT, agent),
    disconnect: (agent: MemoryAgent): Promise<MemoryConnection | null> => ipcRenderer.invoke(IPC.MEMORY_DISCONNECT, agent),
    /** Tüm OpenRouter modelleri; 24 saat cache'li, force ile yeniden çekilir. */
    models: (force = false): Promise<OpenRouterModelList> => ipcRenderer.invoke(IPC.MEMORY_MODELS, force),
    /** Modeli kayıtlı anahtarla kısa bir json_schema isteğiyle dener. */
    testModel: (model: string): Promise<OpenRouterModelTest> => ipcRenderer.invoke(IPC.MEMORY_TEST_MODEL, model),
    onStatus: (callback: (status: MemoryStatus) => void): (() => void) => {
      const handler = (_event: unknown, status: MemoryStatus): void => callback(status)
      ipcRenderer.on(IPC.MEMORY_STATUS_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.MEMORY_STATUS_EVENT, handler)
    }
  },
  /** Orchestration (Agent IDE): ajanlarin baska ajanlara devrettigi gorevler ve termflow-agents MCP kaydi. */
  orchestration: {
    status: (): Promise<OrchestrationStatus> => ipcRenderer.invoke(IPC.ORCH_STATUS),
    targets: (): Promise<OrchestrationTarget[]> => ipcRenderer.invoke(IPC.ORCH_TARGETS),
    tasks: (): Promise<DelegatedTask[]> => ipcRenderer.invoke(IPC.ORCH_TASKS),
    cancel: (id: string): Promise<DelegatedTask | null> => ipcRenderer.invoke(IPC.ORCH_CANCEL, id),
    discard: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.ORCH_DISCARD, id),
    /** Hedefin CLI'indan model listesi; 24 saat cache'li, force ile yeniden. */
    models: (targetId: string, force = false): Promise<OpenRouterModelList> => ipcRenderer.invoke(IPC.ORCH_MODELS, targetId, force),
    /** Gecici depoda gercek kucuk bir gorev (dosya yaz), sure ve maliyetle. */
    test: (targetId: string, model: string): Promise<OrchestrationTestResult> => ipcRenderer.invoke(IPC.ORCH_TEST, targetId, model),
    connections: (): Promise<MemoryConnection[]> => ipcRenderer.invoke(IPC.ORCH_CONNECTIONS),
    connect: (agent: MemoryAgent): Promise<MemoryConnection | null> => ipcRenderer.invoke(IPC.ORCH_CONNECT, agent),
    disconnect: (agent: MemoryAgent): Promise<MemoryConnection | null> => ipcRenderer.invoke(IPC.ORCH_DISCONNECT, agent),
    onTasks: (callback: (tasks: DelegatedTask[]) => void): (() => void) => {
      const handler = (_event: unknown, tasks: DelegatedTask[]): void => callback(tasks)
      ipcRenderer.on(IPC.ORCH_TASKS_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.ORCH_TASKS_EVENT, handler)
    }
  },
  /** Voice input: hold Space and speak (docs/voice-input.md). */
  voice: {
    transcribe: (wav: Uint8Array, context: { kind: 'agent' | 'shell'; name: string }): Promise<VoiceResult> =>
      ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, wav, context),
    test: (model: string): Promise<VoiceResult> => ipcRenderer.invoke(IPC.VOICE_TEST, model),
    /** Local tts-studyo: text -> WAV (read aloud). */
    synth: (text: string): Promise<SpeakResult> => ipcRenderer.invoke(IPC.VOICE_SYNTH, text)
  },
  agentEvents: {
    list: (limit = 500): Promise<AgentEvent[]> => ipcRenderer.invoke(IPC.AGENT_EVENTS_LIST, limit),
    append: (event: AgentEvent): void => ipcRenderer.send(IPC.AGENT_EVENTS_APPEND, event),
    clear: (): void => ipcRenderer.send(IPC.AGENT_EVENTS_CLEAR)
  },
  alerts: {
    pickSound: (): Promise<{ file: string } | { error: string } | null> => ipcRenderer.invoke(IPC.ALERTS_PICK_SOUND),
    loadSound: (file: string): Promise<Uint8Array | null> => ipcRenderer.invoke(IPC.ALERTS_LOAD_SOUND, file),
    setBadge: (badge: AttentionBadge): void => ipcRenderer.send(IPC.WINDOW_ATTENTION, badge),
    /** ntfy push to the phone; server and topic come from main-process settings. */
    pushPhone: (event: { tabId: string; kind: TabAttention; title: string; body: string }): void => ipcRenderer.send(IPC.ALERTS_PHONE_PUSH, event),
    /** Sends a test push; resolves to an error text or null. */
    testPhonePush: (): Promise<string | null> => ipcRenderer.invoke(IPC.ALERTS_PHONE_PUSH_TEST)
  },
  scrollback: {
    save: (tabId: string, data: string): void => ipcRenderer.send(IPC.SCROLLBACK_SAVE, tabId, data),
    /** Pencere kapanirken: yazma bitene kadar bekler. */
    saveAllSync: (entries: [string, string][]): void => { ipcRenderer.sendSync(IPC.SCROLLBACK_SAVE_ALL_SYNC, entries) },
    load: (tabId: string): Promise<string | null> => ipcRenderer.invoke(IPC.SCROLLBACK_LOAD, tabId),
    remove: (tabId: string): void => ipcRenderer.send(IPC.SCROLLBACK_REMOVE, tabId),
    clear: (): void => ipcRenderer.send(IPC.SCROLLBACK_CLEAR)
  },
  usage: {
    get: (): Promise<AgentUsage[]> => ipcRenderer.invoke(IPC.USAGE_GET)
  },
  themes: {
    pick: (): Promise<{ name: string; text: string } | { error: string } | null> => ipcRenderer.invoke(IPC.DIALOG_PICK_THEME)
  },
  agentHooks: {
    onEvent: (callback: (tabId: string, event: AgentHookEvent) => void): (() => void) => {
      const handler = (_event: unknown, tabId: string, hookEvent: AgentHookEvent): void => callback(tabId, hookEvent)
      ipcRenderer.on(IPC.AGENT_HOOK_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_HOOK_EVENT, handler)
    }
  },
  appLaunch: {
    request: (): Promise<AppLaunchRequest | null> => ipcRenderer.invoke(IPC.APP_LAUNCH_CWD),
    onOpenPath: (callback: (request: AppLaunchRequest) => void): (() => void) => {
      const handler = (_event: unknown, request: AppLaunchRequest): void => callback(request)
      ipcRenderer.on(IPC.APP_OPEN_PATH, handler)
      ipcRenderer.send(IPC.APP_LAUNCH_READY)
      return () => ipcRenderer.removeListener(IPC.APP_OPEN_PATH, handler)
    }
  },
  // ---- Window ----
  window: {
    /** Tema değişince Windows Controls Overlay renklerini bildir (PRD §68). */
    setTitleBarOverlay: (overlay: TitleBarOverlayPayload): void =>
      ipcRenderer.send(IPC.WINDOW_TITLEBAR_OVERLAY, overlay),
    notify: (notification: CommandNotification): void => ipcRenderer.send(IPC.WINDOW_NOTIFY, notification),
    /** Compact widget view: enter/exit, collapse/expand, pin/unpin. The main process owns the geometry. */
    widget: (action: WidgetAction): Promise<WidgetState> => ipcRenderer.invoke(IPC.WINDOW_WIDGET, action),
    saveSnapshot: (rect: CaptureRect, defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.WINDOW_SAVE_SNAPSHOT, rect, defaultName),
    onFocusTab: (callback: (tabId: string) => void): (() => void) => {
      const handler = (_event: unknown, tabId: string): void => callback(tabId)
      ipcRenderer.on(IPC.WINDOW_FOCUS_TAB, handler)
      return () => ipcRenderer.removeListener(IPC.WINDOW_FOCUS_TAB, handler)
    }
  },
  // ---- Media previews ----
  media: {
    inspect: (path: string): Promise<MediaInfo | null> => ipcRenderer.invoke(IPC.MEDIA_INSPECT, path),
    watch: (tabId: string, dir: string | null): void => ipcRenderer.send(IPC.MEDIA_WATCH, tabId, dir),
    /** Tam görünüm adresi; yalnızca inspect edilmiş dosyalar açılır. */
    url: (path: string): string => `termflow-media://file/${encodeURIComponent(path)}`,
    onNew: (callback: (tabIds: string[], info: MediaInfo) => void): (() => void) => {
      const handler = (_event: unknown, tabIds: string[], info: MediaInfo): void => callback(tabIds, info)
      ipcRenderer.on(IPC.MEDIA_NEW, handler)
      return () => ipcRenderer.removeListener(IPC.MEDIA_NEW, handler)
    }
  },
  // ---- Clipboard ----
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke(IPC.CLIPBOARD_READ),
    readPaste: (): Promise<{ kind: 'file' | 'text'; value: string }> => ipcRenderer.invoke(IPC.CLIPBOARD_READ_PASTE),
    /** Yazma main üzerinden; navigator.clipboard.writeText odak/permission duyarlı olduğundan (PRD ek). */
    writeText: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text)
  }
}

contextBridge.exposeInMainWorld('termflow', api)

export type TermflowApi = typeof api
