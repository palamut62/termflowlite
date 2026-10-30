import { useEffect, useRef } from 'react'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { mergeProfiles } from '../../shared/profiles'
import { resolveDefaultProfileId, useSettingsStore } from './store/settingsStore'
import { dataHandlers, exitHandlers, resolveStartupCwd, useTerminalStore } from './store/terminalStore'
import { WorktreeCleanupDialog } from './tabs/WorktreeCleanupDialog'
import { WorktreeSetupDialog } from './tabs/WorktreeSetupDialog'
import { Settings } from './settings/Settings'
import { useFilePanelStore } from './store/filePanelStore'
import { AppShell } from './shells/AppShell'
import { LayoutChoice, toggleRightPanel, toggleUiMode } from './shells/uiMode'
import { CommandHistory } from './components/CommandHistory'
import { useCommandHistoryStore } from './store/commandHistoryStore'
import { TaskPalette } from './components/TaskPalette'
import { useTaskPaletteStore } from './store/taskPaletteStore'
import { JumpPalette } from './components/JumpPalette'
import { trackTabRecency, useJumpPaletteStore } from './store/jumpPaletteStore'
import { AgentSessions } from './components/AgentSessions'
import { useAgentSessionStore } from './store/agentSessionStore'
import { matchShortcut } from './shortcuts'
import type { AppLaunchRequest } from '../../shared/ipc'
import { SavedCommands } from './components/SavedCommands'
import { useSavedCommandStore } from './store/savedCommandStore'
import { useCommandScheduler } from './store/useCommandScheduler'
import { AgentInbox } from './components/AgentInbox'
import { useAgentEventStore } from './store/agentEventStore'
import { useHandoverStore } from './store/handoverStore'
import { HandoverDialog } from './components/HandoverDialog'
import { Toasts } from './components/Toasts'
import { Wrapped } from './components/Wrapped'
import { TipCard } from './components/TipCard'
import { MediaViewer } from './components/MediaViewer'
import { useMediaStore } from './store/mediaStore'
import { useStatsStore } from './store/statsStore'
import { useToastStore } from './store/toastStore'
import { listenForKonami } from './fun/konami'
import { WidgetView } from './widget/WidgetView'
import { useWidgetStore } from './widget/widgetStore'
import { startRemoteBridge } from './remoteBridge'
import { VoiceIndicator } from './components/VoiceIndicator'
import { subscribeAgentHooks } from './terminal/agentHookEvents'
import { startAttention } from './attention/alerts'
import { startTabHistory } from './shells/ide/tabHistory'
import { startScrollbackAutosave } from './terminal/scrollbackRestore'
import { persistedResume } from './terminal/agentResume'
import { startAgentDetection } from './agentDetect'

// StrictMode double-mounts effects in dev — the boot sequence must run once.
let bootStarted = false

export default function App(): React.JSX.Element {
  const loaded = useSettingsStore((s) => s.loaded)
  const widgetActive = useWidgetStore((s) => s.active)
  const widgetFrozen = useWidgetStore((s) => s.frozen)
  const uiMode = useSettingsStore((s) => s.settings.uiMode)
  const themeId = useSettingsStore((s) => s.settings.themeId)
  const settingsOpen = useSettingsStore((s) => s.settingsOpen)
  const pendingCloseTabId = useTerminalStore((s) => s.pendingCloseTabId)
  const splitTabIds = useTerminalStore((s) => s.splitTabIds)
  const historyOpen = useCommandHistoryStore((s) => s.open)
  const taskPaletteOpen = useTaskPaletteStore((s) => s.open)
  const jumpPaletteOpen = useJumpPaletteStore((s) => s.open)
  const agentSessionsOpen = useAgentSessionStore((s) => s.open)
  const savedCommandsOpen = useSavedCommandStore((s) => s.open)
  const agentInboxOpen = useAgentEventStore((s) => s.open)
  const handover = useHandoverStore(s => s.pending)
  const wrappedOpen = useStatsStore((s) => s.open)

  useCommandScheduler()

  // Boot: settings + shells yükle, sonra default profile ile ilk tab'ı aç.
  useEffect(() => {
    if (bootStarted) return
    bootStarted = true
    void (async () => {
      const st = useSettingsStore.getState()
      if (!st.loaded) await st.load()
      useSettingsStore.getState().applyTheme()
      const { settings, shells } = useSettingsStore.getState()
      const request = await window.termflow.appLaunch.request()
      // Oturum geri yükleme: kayıt varsa ilk tab'ı açmak yerine sekmeler +
      // pane düzeni geri gelir. Komut satırından gelen launch request her
      // zaman öncelikli — restore'dan SONRA ek sekme olarak açılır.
      let restored = false
      if (settings.restoreSession) {
        const session = await window.termflow.session.get()
        if (session) restored = useTerminalStore.getState().hydrateSession(session)
      }
      if (!restored || request) {
        useTerminalStore.getState().addTab(resolveLaunchProfile(request, settings, shells), true, request?.cwd)
      }
    })()
  }, [])

  // Easter egg: Konami kodu gizli retro temaları açar ve CRT katmanını yakar.
  useEffect(() => listenForKonami(() => {
    void useSettingsStore.getState().update({ retroUnlocked: true, themeId: 'retro-matrix', terminalEffect: 'crt' })
    useToastStore.getState().show('Retro mode unlocked: Matrix and Amber CRT themes are now in Settings > Appearance.', 'success')
  }), [])

  // Claude Code hook olaylari (agent-hooks): sekme durumunu ajanin kendisi bildirir.
  useEffect(() => subscribeAgentHooks(), [])
  // agent-attention: gorunen sekmenin isaretini temizle, gorev cubugu rozeti.
  useEffect(() => startAttention(), [])
  // Agent IDE geri/ileri: aktif sekme gecmisi.
  useEffect(() => startTabHistory(), [])
  // scrollback-restore: degisen sekmeleri dakikada bir, hepsini kapanista kaydet.
  useEffect(() => startScrollbackAutosave(), [])
  // jump-palette: "son aktif sekmeler" sirasi.
  useEffect(() => trackTabRecency(), [])

  // Önizleme kartları: izlenen klasörlerde yeni beliren medya, sekme kapanınca temizlik.
  useEffect(() => window.termflow.media.onNew((tabIds, info) => {
    if (useSettingsStore.getState().settings.mediaPreviews !== 'all') return
    const open = new Set(useTerminalStore.getState().tabs.map((t) => t.id))
    for (const tabId of tabIds) if (open.has(tabId)) useMediaStore.getState().add(tabId, info, 'new')
  }), [])

  // Her sekmenin klasörünü izle; klasör değişince ya da ayar kapanınca bırak.
  useEffect(() => {
    const watched = new Map<string, string | null>()
    const sync = (): void => {
      const all = useSettingsStore.getState().settings.mediaPreviews === 'all'
      const tabs = useTerminalStore.getState().tabs
      for (const tab of tabs) {
        const dir = all ? tab.cwd || tab.launchCwd || null : null
        if (watched.get(tab.id) === dir) continue
        watched.set(tab.id, dir)
        window.termflow.media.watch(tab.id, dir)
      }
      for (const id of [...watched.keys()]) {
        if (tabs.some((t) => t.id === id)) continue
        watched.delete(id)
        window.termflow.media.watch(id, null)
        useMediaStore.getState().clearTab(id)
      }
    }
    sync()
    const unsubTabs = useTerminalStore.subscribe(sync)
    const unsubSettings = useSettingsStore.subscribe(sync)
    return () => {
      unsubTabs()
      unsubSettings()
    }
  }, [])

  // Komut bildirimine tıklanınca ilgili sekmeyi öne al.
  useEffect(() => window.termflow.window.onFocusTab((tabId) => {
    if (useTerminalStore.getState().tabs.some((t) => t.id === tabId)) useTerminalStore.getState().setActiveTab(tabId)
  }), [])

  // Sekme/split düzenini kalıcı hale getir (main zaten debounce ediyor).
  useEffect(() => useTerminalStore.subscribe((state) => {
    if (!useSettingsStore.getState().settings.restoreSession) return
    window.termflow.session.save({
      version: 1,
      tabs: state.tabs.map((tab) => ({ id: tab.id, title: tab.title, profileId: tab.profileId, cwd: tab.cwd || tab.launchCwd, model: tab.model, permissionMode: tab.permissionMode, resumeSession: persistedResume(tab, useSettingsStore.getState().settings), worktree: tab.worktree, color: tab.color })),
      activeTabId: state.activeTabId,
      paneTree: state.paneTree,
      splitDirection: state.splitDirection,
      splitRatio: state.splitRatio,
      workspaceCwd: state.workspaceCwd
    })
  }), [])

  useEffect(() => window.termflow.appLaunch.onOpenPath((request) => {
    const { settings, shells } = useSettingsStore.getState()
    useTerminalStore.getState().addTab(resolveLaunchProfile(request, settings, shells), true, request.cwd)
  }), [])

  // Klavye kısayolları (PRD §39): CAPTURE fazında — xterm'in textarea'sından
  // önce çalışır. Sadece eşleşen kısayollarda preventDefault; xterm'e giden
  // diğer tuşlar etkilenmez.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Settings modal açıkken kısayollar sessize alınır — yoksa Ctrl+W gibi
      // bağlamalar ayarları düzenlerken tab kapatabilir (KeyboardSettings
      // kayıt modu zaten document capture'da yakalayıp yutar).
      if (useSettingsStore.getState().settingsOpen) return
      if (useHandoverStore.getState().pending) return
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === '\\') {
        useTerminalStore.getState().splitActive(e.shiftKey ? 'horizontal' : 'vertical')
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.ctrlKey && e.altKey && splitTabIds) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') useTerminalStore.getState().focusSplitPane('first')
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') useTerminalStore.getState().focusSplitPane('second')
        else return
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'p') {
        useTaskPaletteStore.getState().toggle()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // Agent IDE: Ctrl+Shift+E / A / G / K sag paneli Explorer / Agents / Source Control / Checks sekmesinde acar-kapatir.
      const rightTab = ({ e: 'explorer', a: 'agents', g: 'scm', k: 'checks' } as const)[e.key.toLowerCase() as 'e']
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && useSettingsStore.getState().settings.uiMode === 'ide' && rightTab) {
        toggleRightPanel(rightTab)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // Ctrl+Shift+E: the file panel for the active tab's folder.
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'e') {
        useFilePanelStore.getState().toggle()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'h') {
        useCommandHistoryStore.getState().toggle()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key === 'Escape' && useCommandHistoryStore.getState().open) {
        useCommandHistoryStore.getState().hide()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key === 'Escape' && useSavedCommandStore.getState().open) {
        useSavedCommandStore.getState().hide()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key === 'Escape' && useAgentSessionStore.getState().open) {
        useAgentSessionStore.getState().hide()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const action = matchShortcut(e, useSettingsStore.getState().settings.shortcuts)
      if (!action) return

      const termStore = useTerminalStore.getState()
      switch (action) {
        case 'new-tab': {
          const { settings, shells } = useSettingsStore.getState()
          termStore.addTab(resolveDefaultProfileId(settings, shells))
          break
        }
        case 'close-tab': {
          const id = termStore.activeTabId
          if (id) termStore.requestCloseTab(id)
          break
        }
        case 'next-tab':
        case 'prev-tab': {
          const { tabs, activeTabId } = termStore
          if (tabs.length === 0) break
          const idx = Math.max(0, tabs.findIndex((t) => t.id === activeTabId))
          const dir = action === 'next-tab' ? 1 : -1
          termStore.setActiveTab(tabs[(idx + dir + tabs.length) % tabs.length].id)
          break
        }
        case 'font-increase':
        case 'font-decrease': {
          const fontSize = useSettingsStore.getState().settings.fontSize
          const step = action === 'font-increase' ? 1 : -1
          void useSettingsStore.getState().update({
            fontSize: Math.max(8, Math.min(32, fontSize + step))
          })
          break
        }
        case 'font-reset':
          void useSettingsStore.getState().update({ fontSize: DEFAULT_SETTINGS.fontSize })
          break
        case 'search': {
          // Aktif tab'ın search bar'ını aç (TerminalView uiSearchTabId'yi dinler).
          const id = termStore.activeTabId
          if (id) useSettingsStore.getState().openSearch(id)
          break
        }
        case 'toggle-broadcast':
          termStore.toggleBroadcastInput()
          break
        case 'settings':
          useSettingsStore.getState().openSettings()
          break
        case 'jump-palette':
          useJumpPaletteStore.getState().toggle()
          break
        case 'toggle-ui-mode':
          toggleUiMode()
          break
        default:
          return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [splitTabIds])

  // PTY stream listeners: tek global onData/onExit/onCwd kaydı, per-tab
  // handler'lara dağıtım (TerminalView kendi handler'ını kaydeder).
  useEffect(() => {
    const unData = window.termflow.pty.onData(({ ptyId, data }) => dataHandlers.get(ptyId)?.(data))
    const unExit = window.termflow.pty.onExit(({ ptyId, exitCode, durationMs }) => {
      exitHandlers.get(ptyId)?.(exitCode, durationMs)
      useSavedCommandStore.getState().finishRun(ptyId, exitCode, durationMs)
    })
    // cwd her prompt'ta gelebilir; son kullanılan dizini en fazla 2s'de 1 kez
    // persist et (PRD §38 — startupDirectory 'last' için settings.lastCwd).
    let lastCwdWrite = 0
    const unCwd = window.termflow.pty.onCwd(({ ptyId, cwd }) => {
      useTerminalStore.getState().setTabCwd(ptyId, cwd)
      const now = Date.now()
      if (now - lastCwdWrite >= 2000) {
        lastCwdWrite = now
        void useSettingsStore.getState().update({ lastCwd: cwd })
      }
    })
    return () => {
      unData()
      unExit()
      unCwd()
    }
  }, [])

  // Remote Access: phones see the tab list and drive tabs through this bridge.
  useEffect(() => {
    if (loaded) return startRemoteBridge()
  }, [loaded])

  // Kurulu ajan CLI'lari: profiller kurulum degistikce kendiliginden guncellenir.
  useEffect(() => {
    if (loaded) return startAgentDetection()
  }, [loaded])

  // NOT: Pencere boyutu persistency'sinin tek sahibi main process'tir
  // (BrowserWindow 'resize' -> settings.json); renderer boyut yazmaz.

  // Tema değişince CSS variable'ları yeniden uygula.
  useEffect(() => {
    if (loaded) useSettingsStore.getState().applyTheme()
  }, [themeId, loaded])

  return (
    <>
    {/* Widget view: the full app stays mounted at its last size, off screen,
        so terminals never refit and their PTYs/agents keep running. */}
    <div
      className={uiMode === 'ide' ? 'app ui-ide' : 'app'}
      aria-hidden={widgetFrozen ? true : undefined}
      style={widgetFrozen ? { position: 'fixed', left: -100000, top: 0, width: widgetFrozen.width, height: widgetFrozen.height, visibility: 'hidden' } : undefined}
    >
      <AppShell />
      {historyOpen && <CommandHistory />}
      {savedCommandsOpen && <SavedCommands />}
      {agentSessionsOpen && <AgentSessions />}
      {agentInboxOpen && <AgentInbox />}
      {taskPaletteOpen && <TaskPalette />}
      {jumpPaletteOpen && <JumpPalette />}
      {settingsOpen && <Settings />}
      {pendingCloseTabId && <CloseTabConfirm />}
      {handover && <HandoverDialog />}
      {wrappedOpen && <Wrapped />}
      {loaded && <TipCard />}
      {loaded && <LayoutChoice />}
      <MediaViewer />
      <Toasts />
      <VoiceIndicator />
      <WorktreeCleanupDialog />
      <WorktreeSetupDialog />
    </div>
    {widgetActive && <WidgetView />}
    </>
  )
}

function resolveLaunchProfile(request: AppLaunchRequest | null, settings: typeof DEFAULT_SETTINGS, shells: ReturnType<typeof useSettingsStore.getState>['shells']): string {
  if (!request?.profileId) return resolveDefaultProfileId(settings, shells)
  // mergeProfiles: Explorer menusu kurulu tum yerlesik ajanlari listeliyor, bu yuzden
  // dogrulama da yerlesikleri kapsamali (yoksa `--profile gemini` sessizce kabuga duser).
  const available = shells.some((shell) => shell.id === request.profileId) ||
    mergeProfiles(settings.profiles).some((profile) => profile.id === request.profileId) ||
    settings.providerProfiles.some((provider) => `provider:${provider.id}` === request.profileId)
  return available ? request.profileId : resolveDefaultProfileId(settings, shells)
}

/**
 * Uygulama içi kapatma onayı (PRD §36 confirmBeforeClose). Native
 * window.confirm renderer'ı bloke ettiği için kullanılmaz: Escape/dışa tık
 * iptal eder, Enter onaylar.
 */
function CloseTabConfirm(): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      useTerminalStore.getState().cancelCloseTab()
    } else if (e.key === 'Enter') {
      e.stopPropagation()
      useTerminalStore.getState().confirmCloseTab()
    }
  }

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) useTerminalStore.getState().cancelCloseTab()
      }}
    >
      <div
        ref={panelRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Close terminal tab"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="confirm-dialog-text">Close this terminal tab?</div>
        <div className="confirm-dialog-actions">
          <button className="settings-btn" onClick={() => useTerminalStore.getState().cancelCloseTab()}>
            Cancel
          </button>
          <button
            className="settings-btn settings-btn-primary"
            onClick={() => useTerminalStore.getState().confirmCloseTab()}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
