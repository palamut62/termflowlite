import { app, BrowserWindow, globalShortcut, ipcMain, powerSaveBlocker, protocol, shell } from 'electron'
import { dirname, isAbsolute, join } from 'path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'
import { applyQuakeBounds, applyWindowAppearance, restoreNormalBounds, titleBarOptions } from './window'
import { TerminalManager } from './terminal/TerminalManager'
import { discoverShells, warmPathCache } from './terminal/ShellDiscovery'
import { SettingsStore } from './storage/SettingsStore'
import { registerTerminalIpc } from './ipc/terminal'
import { registerSettingsIpc } from './ipc/settings'
import { registerShellIpc } from './ipc/shell'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerWindowIpc } from './ipc/window'
import { registerMediaIpc } from './ipc/media'
import { handleMediaRequest, MEDIA_SCHEME, unwatchAllMedia } from './media'
import { WIDGET_ACTIONS, WidgetController } from './widget'
import { registerDialogIpc } from './ipc/dialog'
import { registerAlertsIpc } from './ipc/alerts'
import { registerScrollbackIpc } from './ipc/scrollback'
import { ScrollbackStore } from './storage/ScrollbackStore'
import { registerGitIpc } from './ipc/git'
import { registerWorktreeIpc } from './ipc/worktree'
import { registerGithubIpc } from './ipc/github'
import { registerFilesIpc } from './ipc/files'
import { registerTasksIpc } from './ipc/tasks'
import { registerProjectIpc } from './ipc/project'
import { registerAgentSessionsIpc } from './ipc/agentSessions'
import type { TranscriptFollower } from './agentTasks'
import { registerSessionIpc } from './ipc/session'
import { registerUpdaterIpc } from './ipc/updater'
import { registerAgentEventsIpc } from './ipc/agentEvents'
import { registerProviderSecretsIpc } from './ipc/providerSecrets'
import { MEMORY_SECRET_ID, registerMemoryIpc, sendMemoryStatus, startMemoryScheduler } from './ipc/memory'
import { ModelCatalog } from './memory/models'
import { MemoryEngine } from './memory/engine'
import { MemoryStore } from './memory/store'
import { appExecutable, installServerScript, serverLaunch, type ServerLaunch } from './memory/connect'
import { ProviderSecretStore } from './storage/ProviderSecretStore'
import { AgentUpdater } from './agentUpdater'
import { registerProfileHealth } from './ipc/profileHealth'
import { AgentEventStore } from './storage/AgentEventStore'
import { AgentSessionOwnershipStore } from './storage/AgentSessionOwnershipStore'
import { initUpdater, maybeAutoCheck } from './updater'
import { SessionStore } from './storage/SessionStore'
import { configureShellIntegration } from './terminal/shellIntegration'
import { editorFileUrl, pickEditorScheme } from './editorLink'
import { IPC } from '../shared/ipc'
import { parseLaunchRequest } from './launchPath'
import { resolvePathCandidate } from './pathResolver'
import { explorerMenuSignature, syncExplorerContextMenu } from './explorerContextMenu'
import { createTray, destroyTray, isTrayActive, refreshTrayMenu } from './tray'
import { invokeRecorded, recordIpcHandlers } from './remote/ipcRegistry'
import { RemoteController } from './remote/RemoteController'
import { AgentHookServer } from './agentHooks/hookServer'
import { EDITION, PRODUCT } from '../shared/edition'
import { readClaudeUsage, readCodexUsage } from './usage/agentUsage'
import { registerRemoteIpc } from './ipc/remote'
import { ELEVATED_HOST_FLAG, elevationStatus, grantElevation, runElevatedHost } from './terminal/elevation'
import { registerVoiceIpc } from './ipc/voice'
import { registerOrchestrationIpc, sendOrchestrationTasks, type OrchestrationController } from './ipc/orchestration'
import { OrchestrationService } from './orchestration/service'
import { detectInstalledAgents } from './agentDetect'
import { stopStudio } from './voice/speak'
import type { ShellInfo } from '../shared/types'
import { appMemory, readResources } from './resources'

// Dev: project resources/. Packaged: extraResources under process.resourcesPath.
const APP_ICON = app.isPackaged
  ? join(process.resourcesPath, 'resources', 'icon.ico')
  : join(__dirname, '../../resources/icon.ico')

// Önizleme kartlarının tam görünümü/video oynatması: yalnızca izin verilen
// medya dosyalarını sunan özel şema (src/main/media.ts). ready'den önce kayıt şart.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

// E2E isolation: Playwright launches (TERMFLOW_E2E=1, see e2e/app.spec.ts)
// get a throwaway pid-scoped userData dir so they never touch the real
// settings.json. Must run before any userData use — including the
// single-instance lock below.
// Agent IDE ayri urun: kendi adi ve userData'si (ayarlar, oturum, hafiza Lite ile karismaz, tek-ornek kilidi ayri).
if (EDITION === 'ide') {
  app.setName(PRODUCT.name)
  app.setPath('userData', join(app.getPath('appData'), PRODUCT.name))
}
if (process.env.TERMFLOW_E2E === '1') {
  app.setPath('userData', process.env.TERMFLOW_E2E_USER_DATA || join(app.getPath('temp'), `termflow-lite-e2e-${process.pid}`))
}
// Started elevated by the admin-tab task: relay one shell, no window, no app state.
const elevatedHost = process.argv.includes(ELEVATED_HOST_FLAG)
if (elevatedHost) {
  app.setPath('userData', join(app.getPath('temp'), `${PRODUCT.slug}-elevated-${process.pid}`))
  void runElevatedHost().finally(() => app.exit(0))
}

let mainWindow: BrowserWindow | null = null
let settingsStore: SettingsStore | null = null
/** Compact widget view of the main window; created once settings are loaded. */
let widget: WidgetController | null = null
let sessionStore: SessionStore | null = null
let stopMemoryScheduler: (() => void) | null = null
let manager: TerminalManager | null = null
let remoteController: RemoteController | null = null
let agentHookServer: AgentHookServer | null = null
let orchestration: OrchestrationController | null = null

/** The live main window, or null while it is closed/destroyed. */
function liveWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

// ---- Sistem tepsisi durumu ----
/**
 * Gerçek çıkış talebi verildi mi. `close` handler'ı pencereyi yalnızca bu bayrak
 * kapalıyken gizler; tepsideki "Quit" (ve app.quit çağıran her yol) bunu açar.
 */
let isQuitting = false

function hideMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  refreshTrayMenu()
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

/** Tepsi ayarı canlı uygulanır: kapalıysa ikon kaldırılır. */
function applyTrayConfig(settings: AppSettings): void {
  // E2E koşusunda tepsi kapalı kalır: gizlenen pencere Playwright'ı asar.
  if (!settings.closeToTray || process.env.TERMFLOW_E2E === '1') {
    destroyTray()
    // Ayar pencere gizliyken kapatılırsa uygulama erişilemez kalırdı.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) showMainWindow()
    return
  }
  createTray(APP_ICON, {
    onShow: showMainWindow,
    onHide: hideMainWindow,
    onQuit: quitApp,
    isWindowVisible: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
  })
}

/** Sistem başlangıcında açılma; dev/E2E koşusunda kayıt yapılmaz (electron.exe'yi kaydederdi). */
function applyLoginItem(settings: AppSettings): void {
  if (!app.isPackaged || process.env.TERMFLOW_E2E === '1') return
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
}

// ---- Quake (açılır) mod durumu ----
/** Kayıtlı global kısayol; null = quake kapalı veya kayıt başarısız. */
let quakeShortcut: string | null = null
/** Pencere şu an quake yerleşiminde mi (resize persist'i bunu atlar). */
let quakeActive = false

function toggleQuakeWindow(): void {
  if (!settingsStore) return
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!mainWindow) return
  const settings = settingsStore.get()
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
    return
  }
  quakeActive = true
  if (mainWindow.isMinimized()) mainWindow.restore()
  applyQuakeBounds(mainWindow, settings)
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Quake ayarları canlı uygulanır: kısayol yeniden kaydedilir, mod kapanınca
 * pencere normal ölçüsüne döner. Kısayol başka bir uygulamada kayıtlıysa
 * (register false döner) yalnızca loglanır — uygulama çalışmaya devam eder.
 */
function applyQuakeConfig(settings: AppSettings): void {
  if (quakeShortcut) {
    globalShortcut.unregister(quakeShortcut)
    quakeShortcut = null
  }
  if (!settings.quakeMode) {
    if (quakeActive && mainWindow && !mainWindow.isDestroyed()) {
      restoreNormalBounds(mainWindow, settings)
      if (!mainWindow.isVisible()) mainWindow.show()
    }
    quakeActive = false
    return
  }
  const hotkey = (settings.quakeHotkey || DEFAULT_SETTINGS.quakeHotkey).trim()
  try {
    if (globalShortcut.register(hotkey, toggleQuakeWindow)) quakeShortcut = hotkey
    else console.warn(`[quake] global shortcut already in use: ${hotkey}`)
  } catch (err) {
    console.warn(`[quake] could not register global shortcut ${hotkey}:`, err)
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    quakeActive = true
    applyQuakeBounds(mainWindow, settings)
  }
}

let initialLaunchRequest = parseLaunchRequest(process.argv)
const pendingLaunchRequests: NonNullable<ReturnType<typeof parseLaunchRequest>>[] = []
let launchListenerReady = false

function flushLaunchRequests(): void {
  if (!launchListenerReady || !mainWindow || mainWindow.isDestroyed()) return
  while (pendingLaunchRequests.length > 0) {
    mainWindow.webContents.send(IPC.APP_OPEN_PATH, pendingLaunchRequests.shift())
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  refreshTrayMenu()
}

// Single-instance: focus the existing window instead of spawning a second
// process that would fight over the userData/cache locks.
const gotLock = !elevatedHost && app.requestSingleInstanceLock({ launchRequest: initialLaunchRequest })
if (elevatedHost) {
  // no lock: it runs next to the normal app
} else if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const forwarded = (additionalData as { launchRequest?: unknown } | undefined)?.launchRequest
    const launchData = forwarded && typeof forwarded === 'object' ? forwarded as { cwd?: unknown; profileId?: unknown } : null
    const request = launchData && typeof launchData.cwd === 'string'
      ? parseLaunchRequest([
          process.execPath,
          ...(typeof launchData.profileId === 'string' ? ['--profile', launchData.profileId] : []),
          launchData.cwd
        ])
      : parseLaunchRequest(argv)
    showMainWindow()
    if (request) pendingLaunchRequests.push(request)
    flushLaunchRequests()
  })
}

function createWindow(): void {
  if (!settingsStore) return
  const settings = settingsStore.get()

  mainWindow = new BrowserWindow({
    width: settings.windowWidth,
    height: settings.windowHeight,
    minWidth: 640,
    minHeight: 400,
    show: false,
    // Custom title bar (PRD §68): sekme barı title bar ile birleşir. Windows'ta
    // Controls Overlay ile native düğmeler korunur, Linux'ta native bar kalır.
    ...titleBarOptions(settings),
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Sandboxed renderer: the preload only uses contextBridge/ipcRenderer
      // (no direct Node APIs), so the full Chromium sandbox can stay on.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Show the window reliably. `ready-to-show` can fail to fire on some Windows
  // configurations, leaving the process running with a hidden window — the app
  // appears "not to open". Show on both events plus a hard fallback timer.
  const reveal = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
  applyWindowAppearance(mainWindow, settings)

  mainWindow.once('ready-to-show', reveal)
  mainWindow.webContents.once('did-finish-load', reveal)
  mainWindow.webContents.on('did-start-loading', () => { launchListenerReady = false })
  setTimeout(reveal, 3000)

  // Kapatma tepsiye gizler: PTY'ler ve ajan oturumları yaşamaya devam eder.
  // Bayrak açıkken (tepsi "Quit", app.quit) normal kapanış yolu işler.
  mainWindow.on('close', (event) => {
    if (isQuitting || !settingsStore?.get().closeToTray) return
    if (!isTrayActive()) return // tepsi oluşturulamadıysa pencereyi hapsetme
    event.preventDefault()
    hideMainWindow()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    refreshTrayMenu()
  })

  mainWindow.on('show', refreshTrayMenu)
  // Widget dragged by its header: remember where the user put it.
  mainWindow.on('moved', () => widget?.onMoved())
  mainWindow.on('hide', refreshTrayMenu)

  // Quake: odak kaybında gizle. Ayarlar penceresi/dialog açıkken sinir bozucu
  // olmasın diye yalnızca uygulamanın HİÇBİR penceresi odakta değilken gizlenir.
  mainWindow.on('blur', () => {
    if (!quakeActive || !settingsStore) return
    if (!settingsStore.get().quakeMode || !settingsStore.get().quakeHideOnBlur) return
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isFocused() || BrowserWindow.getFocusedWindow()) return
      mainWindow.hide()
    }, 0)
  })

  // Persist the window size so the next launch restores it. Tek sahip main
  // process'tir (renderer boyut yazmaz). Maximize/fullscreen ölçüsü kalıcı
  // olmasın diye o durumlarda yazma atlanır.
  mainWindow.on('resize', () => {
    if (!settingsStore || !mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return
    // Quake ve widget yerleşimleri geçicidir; normal pencere ölçüsünü ezmemeli.
    if (quakeActive || widget?.isActive()) return
    const [width, height] = mainWindow.getSize()
    settingsStore.update({ windowWidth: width, windowHeight: height })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') shell.openExternal(url.toString())
    } catch {
      // Invalid and non-web URLs stay blocked.
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (elevatedHost) return
  // Remote Access reuses the validated IPC handlers; record them before any registration.
  recordIpcHandlers()
  // Windows bildirimleri kısayoldaki AppUserModelID ile eşleşmeli (electron-builder appId).
  if (process.platform === 'win32') app.setAppUserModelId(PRODUCT.appId)
  configureShellIntegration(app.isPackaged
    ? join(process.resourcesPath, 'resources', 'shell-integration')
    : join(__dirname, '../../resources/shell-integration'))
  // Warm the registry PATH cache off the critical path so the first terminal
  // never pays for a `reg query` round trip.
  warmPathCache()

  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  sessionStore = new SessionStore(join(app.getPath('userData'), 'session.json'))
  const providerSecrets = new ProviderSecretStore(join(app.getPath('userData'), 'provider-secrets.json'))
  const agentSessionOwnership = new AgentSessionOwnershipStore(join(app.getPath('userData'), 'agent-session-owners.json'))
  const mgr = new TerminalManager(
    () => mainWindow,
    () => (settingsStore ? settingsStore.get() : DEFAULT_SETTINGS),
    (providerId) => providerSecrets.get(providerId),
    (record) => agentSessionOwnership.recordLaunch(record)
  )
  manager = mgr
  // Ajan durum hook'lari (agent-hooks): pencere ilk sekmeyi acmadan hazir olur.
  const hookServer = new AgentHookServer(join(app.getPath('userData'), 'agent-hooks', 'claude-settings.json'), (tabId, event) => {
    liveWindow()?.webContents.send(IPC.AGENT_HOOK_EVENT, tabId, event)
  })
  agentHookServer = hookServer
  mgr.setAgentHooks(() => hookServer.current())
  hookServer.start().catch((error) => console.warn('[agent-hooks] server failed to start:', error))
  // usage-meter: Codex yerel oturum dosyasindan, Claude status line'dan (bu oturum ya da son kayit).
  const claudeUsageFile = join(app.getPath('userData'), 'agent-hooks', 'usage', 'claude.json')
  const readUsage = async () => {
    const [codex, claude] = await Promise.all([readCodexUsage(), hookServer.claudeUsage() ?? readClaudeUsage(claudeUsageFile)])
    return [claude, codex].filter((usage): usage is NonNullable<typeof usage> => Boolean(usage))
  }
  ipcMain.handle(IPC.USAGE_GET, readUsage)
  // WSL distro enumeration makes discovery async — the renderer re-queries
  // via SHELLS_DISCOVER anyway, so the warm value is only a fallback.
  let currentShells: Awaited<ReturnType<typeof discoverShells>> = []
  // Registry yalnızca menüyü etkileyen veri (profiller/shell listesi) gerçekten
  // değiştiğinde yeniden yazılır. Koşulsuz sync, lastCwd gibi sık güncellenen
  // ayarlarla her SETTINGS_SET'te ~30-50 reg.exe'lik bir storm başlatıyordu.
  // İmza yalnızca BAŞARILI sync sonrası güncellenir — hatalı deneme tekrarlanır.
  let lastMenuSignature: string | null = null
  const refreshContextMenu = (): void => {
    if (!app.isPackaged || !settingsStore) return
    const signature = explorerMenuSignature(settingsStore.get(), currentShells)
    if (signature === lastMenuSignature) return
    void syncExplorerContextMenu(process.execPath, process.resourcesPath, settingsStore.get(), currentShells)
      .then(() => { lastMenuSignature = signature })
      .catch((error) => console.warn('Explorer context menu sync failed:', error))
  }
  void discoverShells().then((shells) => {
    currentShells = shells
    mgr.setShells(shells)
    refreshContextMenu()
  })

  // Agent Memory: kullanıcıya özel, userData/memory altında. Sunucu betiği sabit
  // bir yola kopyalanır ki ajan kayıtları güncellemelerden sonra da çalışsın.
  const memoryDir = join(app.getPath('userData'), 'memory')
  const memoryStore = new MemoryStore(memoryDir)
  const memoryEngine = new MemoryEngine({
    store: memoryStore,
    getConfig: () => (settingsStore ? settingsStore.get() : DEFAULT_SETTINGS).memory,
    getApiKey: () => providerSecrets.get(MEMORY_SECRET_ID),
    onStatus: (status) => sendMemoryStatus(mainWindow, status)
  })
  let memoryLaunch: ServerLaunch | null = null
  try {
    const script = installServerScript(join(app.getAppPath(), 'out', 'mcp', 'memory-server.cjs'), join(app.getPath('userData'), 'mcp'))
    memoryLaunch = serverLaunch(appExecutable(), script, memoryDir)
  } catch (error) {
    console.warn('[memory] MCP server script could not be installed:', error)
  }
  registerMemoryIpc({
    engine: memoryEngine,
    store: memoryStore,
    launch: memoryLaunch,
    catalog: new ModelCatalog(join(app.getPath('userData'), 'cache', 'openrouter-models.json')),
    getApiKey: () => providerSecrets.get(MEMORY_SECRET_ID)
  })
  stopMemoryScheduler = startMemoryScheduler(memoryEngine, () => (settingsStore ? settingsStore.get() : DEFAULT_SETTINGS).memory.updateEvery)
  // Voice input shares the OpenRouter key with Memory (docs/voice-input.md).
  registerVoiceIpc({
    getSettings: () => (settingsStore ? settingsStore.get() : DEFAULT_SETTINGS),
    getApiKey: () => providerSecrets.get(MEMORY_SECRET_ID),
    url: process.env.TERMFLOW_E2E === '1' ? process.env.TERMFLOW_E2E_OPENROUTER_URL : undefined
  })
  let memoryWasEnabled = settingsStore.get().memory.enabled

  // Orchestration (docs/agent-ide/orchestration.md): yalniz Agent IDE; API ayarla acilir/kapanir.
  const orchestrationDir = join(app.getPath('userData'), 'orchestration')
  let agentsLaunch: ServerLaunch | null = null
  if (EDITION === 'ide') {
    try {
      const script = installServerScript(join(app.getAppPath(), 'out', 'mcp', 'agents-server.cjs'), join(app.getPath('userData'), 'mcp'), 'agents-server.cjs')
      agentsLaunch = { command: appExecutable(), args: [script, '--endpoint-file', join(orchestrationDir, 'endpoint.json')], env: { ELECTRON_RUN_AS_NODE: '1' } }
    } catch (error) {
      console.warn('[orchestration] MCP server script could not be installed:', error)
    }
  }
  const orchestrationService = EDITION === 'ide'
    ? new OrchestrationService({
      dir: orchestrationDir,
      getSettings: () => (settingsStore ? settingsStore.get() : DEFAULT_SETTINGS),
      detectInstalled: detectInstalledAgents,
      getSecret: (providerId) => providerSecrets.get(providerId),
      readUsage,
      onTasks: (tasks) => sendOrchestrationTasks(liveWindow(), tasks)
    })
    : null
  orchestration = registerOrchestrationIpc({ service: orchestrationService, endpointFile: join(orchestrationDir, 'endpoint.json'), launch: agentsLaunch }, settingsStore.get())

  // Ayar değişince main tarafında uygulanacaklar: explorer menüsü + quake.
  const onSettingsChanged = (settings: AppSettings): void => {
    refreshContextMenu()
    applyQuakeConfig(settings)
    applyTrayConfig(settings)
    applyLoginItem(settings)
    if (settings.memory.enabled && !memoryWasEnabled) void memoryEngine.run().catch(() => undefined)
    memoryWasEnabled = settings.memory.enabled
    remoteController?.settingsChanged(settings)
    orchestration?.settingsChanged(settings)
  }

  registerTerminalIpc(manager)
  registerSettingsIpc(settingsStore, mgr, () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    onSettingsChanged
  )
  registerProviderSecretsIpc(providerSecrets)
  registerProfileHealth(settingsStore, providerSecrets)
  registerShellIpc()
  registerClipboardIpc()
  registerWindowIpc(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))
  registerMediaIpc(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
  widget = new WidgetController(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null), settingsStore)
  ipcMain.handle(IPC.WINDOW_WIDGET, (_event, action: unknown) => {
    if (!widget) return { active: false, collapsed: false, pinned: true }
    return WIDGET_ACTIONS.includes(action as never) ? widget.handle(action as (typeof WIDGET_ACTIONS)[number]) : widget.state()
  })
  registerDialogIpc(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))
  registerAlertsIpc(
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    () => settingsStore?.get().remote.push ?? null,
    (tabId) => remoteController?.pushActions(tabId)
  )
  // scrollback-restore: yalniz geri yuklenecek oturumun sekmeleri kalir, gerisi silinir.
  const scrollbackStore = new ScrollbackStore(join(app.getPath('userData'), 'scrollback'))
  const scrollbackEnabled = (): boolean => Boolean(settingsStore?.get().restoreScrollback && settingsStore.get().restoreSession)
  if (scrollbackEnabled()) scrollbackStore.prune(sessionStore?.get()?.tabs.map((tab) => tab.id) ?? [])
  else scrollbackStore.clear()
  registerScrollbackIpc(scrollbackStore, scrollbackEnabled)
  registerGitIpc()
  registerWorktreeIpc()
  registerGithubIpc()
  registerFilesIpc()
  registerTasksIpc()
  registerProjectIpc()
  let follower: TranscriptFollower | null = null
  try {
    const script = installServerScript(join(app.getAppPath(), 'out', 'mcp', 'follow-transcript.cjs'), join(app.getPath('userData'), 'mcp'), 'follow-transcript.cjs')
    follower = { exe: appExecutable(), script }
  } catch (error) {
    console.warn('[agent-tasks] transcript follower could not be installed:', error)
  }
  registerAgentSessionsIpc(agentSessionOwnership, follower)
  registerSessionIpc(sessionStore)
  registerUpdaterIpc()
  registerAgentEventsIpc(new AgentEventStore(app.getPath('userData')))
  initUpdater(
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    () => (settingsStore ? settingsStore.get() : DEFAULT_SETTINGS)
  )
  ipcMain.handle(IPC.APP_LAUNCH_CWD, () => {
    const request = initialLaunchRequest
    initialLaunchRequest = null
    return request
  })
  // Agent IDE durum cubugu: Resource Manager, Ports, Keep computer awake.
  ipcMain.handle(IPC.SYSTEM_RESOURCES, async () => readResources(manager?.pids() ?? []))
  ipcMain.handle(IPC.SYSTEM_APP_MEMORY, () => appMemory())
  let awakeId: number | null = null
  ipcMain.handle(IPC.SYSTEM_KEEP_AWAKE, (_event, active: unknown) => {
    if (active === true && awakeId === null) awakeId = powerSaveBlocker.start('prevent-app-suspension')
    if (active !== true && awakeId !== null) { powerSaveBlocker.stop(awakeId); awakeId = null }
  })
  ipcMain.handle(IPC.SYSTEM_OPEN_EXTERNAL, async (_event, value: unknown): Promise<boolean> => {
    if (typeof value !== 'string' || value.length > 8192) return false
    try {
      const url = new URL(value)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      await shell.openExternal(url.toString())
      return true
    } catch {
      return false
    }
  })
  // Terminaldeki tıklanabilir yollar: renderer yalnızca aday + cwd gönderir;
  // çözümleme ve fs doğrulaması burada tek yerde yapılır (sandbox uyumlu).
  ipcMain.handle(IPC.SYSTEM_RESOLVE_PATH, (_event, candidate: unknown, cwd: unknown) => {
    if (typeof candidate !== 'string' || typeof cwd !== 'string') return null
    return resolvePathCandidate(candidate, cwd)
  })
  ipcMain.handle(IPC.SYSTEM_OPEN_PATH, async (_event, value: unknown): Promise<boolean> => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || !isAbsolute(value)) return false
    try {
      const resolved = resolvePathCandidate(value, dirname(value))
      if (!resolved) return false
      if (!resolved.canOpen) {
        shell.showItemInFolder(resolved.path)
        return true
      }
      return (await shell.openPath(resolved.path)) === '' // '' = başarılı
    } catch {
      return false
    }
  })
  // `dosya:42:7` gibi konumlar: kayıtlı VS Code ailesi editör protokolüyle
  // satırında açılır; editör yoksa dosya varsayılan uygulamayla açılır.
  ipcMain.handle(IPC.SYSTEM_OPEN_IN_EDITOR, async (_event, value: unknown, line: unknown, column: unknown): Promise<boolean> => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || !isAbsolute(value)) return false
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > 10_000_000) return false
    const col = typeof column === 'number' && Number.isInteger(column) && column > 0 && column < 100_000 ? column : undefined
    try {
      const resolved = resolvePathCandidate(value, dirname(value))
      if (!resolved || resolved.isDirectory) return false
      const scheme = pickEditorScheme((name) => app.getApplicationNameForProtocol(`${name}://`) !== '')
      if (!scheme || !resolved.canOpen) {
        if (!resolved.canOpen) shell.showItemInFolder(resolved.path)
        else return (await shell.openPath(resolved.path)) === ''
        return true
      }
      await shell.openExternal(editorFileUrl(scheme, resolved.path, line, col))
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle(IPC.SYSTEM_REVEAL_IN_FOLDER, (_event, value: unknown): boolean => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || !isAbsolute(value)) return false
    try {
      const resolved = resolvePathCandidate(value, dirname(value))
      if (!resolved) return false
      shell.showItemInFolder(resolved.path)
      return true
    } catch {
      return false
    }
  })
  ipcMain.on(IPC.APP_LAUNCH_READY, () => {
    launchListenerReady = true
    flushLaunchRequests()
  })

  // Remote Access: phone control over Tailscale (docs/remote-access.md).
  const store = settingsStore
  remoteController = new RemoteController({
    devicesFile: join(app.getPath('userData'), 'remote-devices.json'),
    staticDir: join(__dirname, '../remote'),
    uploadDir: join(app.getPath('downloads'), 'TermFlow Uploads'),
    terminals: mgr,
    invokeIpc: invokeRecorded,
    getSettings: () => store.get(),
    getShells: async () => (await invokeRecorded(IPC.SHELLS_DISCOVER, [])) as ShellInfo[],
    sendToRenderer: (request) => {
      const win = liveWindow()
      if (!win) return false
      win.webContents.send(IPC.REMOTE_COMMAND, request)
      return true
    },
    pushSettings: (settings) => liveWindow()?.webContents.send(IPC.SETTINGS_CHANGED, settings),
    pushStatus: (status) => liveWindow()?.webContents.send(IPC.REMOTE_STATUS_EVENT, status),
    platform: process.platform,
    version: app.getVersion(),
    elevation: { status: elevationStatus, grant: grantElevation },
    // E2E only: bind to a loopback address instead of requiring Tailscale.
    findAddress: process.env.TERMFLOW_E2E === '1' && process.env.TERMFLOW_E2E_REMOTE_HOST
      ? () => process.env.TERMFLOW_E2E_REMOTE_HOST ?? null
      : undefined
  })
  registerRemoteIpc(remoteController)

  // Ajan CLI'lari arka planda guncellenir (acilista + gunde bir); E2E'de kapali.
  const agentUpdater = new AgentUpdater((snapshot) => liveWindow()?.webContents.send(IPC.AGENTS_UPDATE_EVENT, snapshot))
  ipcMain.handle(IPC.AGENTS_UPDATE_STATUS, () => agentUpdater.snapshot())
  ipcMain.handle(IPC.AGENTS_UPDATE_RUN, () => agentUpdater.run())
  if (process.env.TERMFLOW_E2E !== '1') agentUpdater.schedule(() => settingsStore?.get().autoUpdateAgents !== false)

  createWindow()
  void remoteController.apply(settingsStore.get())
  applyQuakeConfig(settingsStore.get())
  applyTrayConfig(settingsStore.get())
  applyLoginItem(settingsStore.get())

  // Sessiz güncelleme kontrolü: pencere yüklendikten ~10 sn SONRA, bir kez.
  // Açılış hızını etkilememesi için kritik yolun dışında tutulur.
  if (app.isPackaged && settingsStore.get().autoCheckUpdates && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => maybeAutoCheck(), 10_000)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Tepsi aktifken pencere yokluğu "çıkış" demek değildir — uygulama arka
  // planda yaşar ve tepsiden geri çağrılır.
  if (isTrayActive() && !isQuitting) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  settingsStore?.flush() // write any debounced settings mutations
  sessionStore?.flush() // write the debounced tab/split layout
  manager?.shutdown() // kill every live PTY
  unwatchAllMedia()
  stopMemoryScheduler?.()
  stopStudio()
  void remoteController?.shutdown()
  agentHookServer?.stop()
  orchestration?.shutdown()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  destroyTray()
})
