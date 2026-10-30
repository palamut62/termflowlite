import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { ImageAddon } from '@xterm/addon-image'
import { ligatureJoiner } from './ligatures'
import { resolveDefaultProfileId, useSettingsStore } from '../store/settingsStore'
import { broadcastTargetIds, dataHandlers, exitHandlers, pasteHandlers, restartHandlers, searchAddons, useTerminalStore } from '../store/terminalStore'
import { useCommandHistoryStore } from '../store/commandHistoryStore'
import { resolveTheme } from '../themes/themes'
import { backdropActive, isLightColor, terminalTheme } from '../backdrop'
import { CursorFx } from './cursorFx'
import { recordInput, recordOutput } from '../fun/outputMeter'
import { burstConfetti, shouldCelebrate } from '../fun/confetti'
import { useStatsStore } from '../store/statsStore'
import { playCue } from '../fun/sounds'
import { ShellIntegration, formatDuration, type FinishedCommand } from './shellIntegration'
import { SelectionEdit } from './selectionEdit'
import { InlineSuggest } from './inlineSuggest'
import { motionEnabled } from '../motion'
import { formatDroppedPaths } from './dropPaths'
import { getPathAtMouse, getUrlAtMouse, registerPathLinkProvider, type PathMenuInfo } from './pathLinks'
import { parseOsc52, shiftEnterSequence } from './terminalExtras'
import { SerializeAddon } from '@xterm/addon-serialize'
import { markScrollbackDirty, registerSerializer, restoreScrollback } from './scrollbackRestore'
import { useToastStore } from '../store/toastStore'
import { PaneToolbar } from '../shells/ide/PaneToolbar'
import { TerminalContextMenu } from './TerminalContextMenu'
import { TerminalSearch } from './TerminalSearch'
import { AsciiBackdrop } from './AsciiBackdrop'
import { AgentWorkPanel } from '../components/AgentWorkPanel'
import { UsageStrip } from '../usage/UsageStrip'
import { MediaCards } from '../components/MediaCards'
import { reportMedia } from '../store/mediaStore'
import { redactApiKeys } from '../../../shared/secretRedaction'
import { agentKindForCommand, parseAgentOutput } from '../../../shared/agentEvents'
import { codexOscEvent, codexTitleWorking } from '../../../shared/agentHooks'
import { applyHookEvent, hasAgentHook, HOOK_OWNED_KINDS } from './agentHookEvents'
import { agentCliForCommand, mergeProfiles, providerFromProfileId } from '../../../shared/profiles'
import { useAgentEventStore } from '../store/agentEventStore'
import { useSavedCommandStore } from '../store/savedCommandStore'
import { useHandoverStore } from '../store/handoverStore'
import { useVoiceStore } from '../store/voiceStore'
import { speak, stopSpeaking } from '../voice/speak'
import { createVoiceInput } from '../voice/voiceInput'

interface Props {
  tabId: string
  active: boolean
  visible?: boolean
  splitPane?: 'first' | 'second'
  splitDirection?: 'vertical' | 'horizontal' | null
}

interface ExitInfo {
  exitCode: number
  durationMs: number
}

/** Sağ tıklanan komut bloğu (shell integration). */
export interface BlockMenuInfo {
  command: string
  output: string
  exitCode?: number
}

/** Bu süreden uzun süren komut arka planda biterse bildirim gösterilir. */
const NOTIFY_MIN_MS = 10_000

interface ContextMenuState {
  x: number
  y: number
  hasSelection: boolean
  block?: BlockMenuInfo | null
  /** İmleç altında çözülmüş bir yol varsa menünün en üstüne yol işlemleri eklenir. */
  path?: PathMenuInfo | null
  /** İmleç altındaki web adresi (Open Link / Copy Link). */
  link?: string | null
}

/**
 * Bu render'da PTY'si oluşturulmuş tab id'leri. Savunma amaçlı: PtyCore.create()
 * var olan PTY'yi öldürüp yenisini spawn ettiği için (restart bunu kullanır),
 * bir TerminalView aynı tabId için ikinci kez create çağırmamalı.
 */
const createdPtys = new Set<string>()

/** Seçimi sistem panosuna kopyala (navigator.clipboard; yazma izni otomatik). */
function copySelection(term: Terminal): void {
  const sel = term.getSelection()
  if (!sel) return
  void navigator.clipboard.writeText(sel).catch(() => {})
}

/** Panoyu okuyup xterm'e yapıştır — tek yol preload IPC (sandbox uyumlu). */
function pasteFromClipboard(term: Terminal, tabId: string): void {
  void window.termflow.clipboard.readPaste().then(({ kind, value }) => {
    if (!value) return
    if (kind === 'file') reportMedia(tabId, value, 'paste', useSettingsStore.getState().settings.mediaPreviews)
    term.paste(kind === 'file' ? `"${value.replace(/"/g, '\\"')}"` : value)
  })
}

/**
 * A single xterm.js instance bound to a PTY. Mounting this component creates
 * the PTY (every tab stays mounted for its lifetime, so mount == PTY create
 * exactly once — sekme değiştirmek arka plandaki process'i öldürmez), rehydrates
 * from the main-process ring buffer with live chunks queued to avoid ordering
 * races, and funnels every resize through one atomic channel: xterm view and
 * PTY move to the new size in the SAME tick, 250ms after the last change.
 */
export function TerminalView({ tabId, active, visible = active, splitPane, splitDirection }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Canlı yüklenip atılabilen addon'lar/joiner: ayar değişimi terminali
  // yeniden yaratmasın diye ref'te tutulur.
  const webglRef = useRef<WebglAddon | null>(null)
  const shellRef = useRef<ShellIntegration | null>(null)
  const imageRef = useRef<ImageAddon | null>(null)
  const joinerRef = useRef<number | null>(null)
  const activeRef = useRef(active)
  // Single resize channel, populated by the main effect. Other effects call
  // through this ref so every resize goes through the same atomic path.
  const scheduleResizeRef = useRef<(() => void) | null>(null)
  /** Last cell size pushed to xterm/PTY — re-asserted after a PTY restart. */
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  const [exited, setExited] = useState<ExitInfo | null>(null)
  const [startError, setStartError] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)

  const profileId = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.profileId)
  const resumeSession = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.resumeSession)
  const launchCwd = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.launchCwd)
  const launchCommand = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.launchCommand)
  const elevated = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.elevated)
  const model = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.model)
  const settings = useSettingsStore((s) => s.settings)
  const permissionMode = useTerminalStore((s) => s.tabs.find((t) => t.id === tabId)?.permissionMode) ?? settings.defaultAgentPermissionMode
  const uiSearchTabId = useSettingsStore((s) => s.uiSearchTabId)
  const asciiBackground = profileId ? settings.asciiBackgrounds?.[profileId] : undefined
  // xterm's own background goes see-through when a backdrop or an ASCII picture sits behind it.
  const transparent = backdropActive(settings) || !!asciiBackground
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const sessionId = useTerminalStore((s) => s.tabs.find((tab) => tab.id === tabId)?.agentHook?.sessionId)
  const speakingNow = useVoiceStore((s) => s.speaking !== 'idle')

  useEffect(() => {
    activeRef.current = active
  }, [active])

  /**
   * WebGL renderer: 'off' hiç denemez. Yükleme başarısızsa (context yok, sürücü
   * sorunu) sessizce DOM renderer'da kalınır; context kaybında addon dispose
   * edilir ve xterm kendiliğinden DOM renderer'a döner.
   */
  const syncWebgl = (term: Terminal, mode: 'auto' | 'on' | 'off'): void => {
    if (mode === 'off') {
      webglRef.current?.dispose()
      webglRef.current = null
      return
    }
    if (webglRef.current) return
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        addon.dispose()
        if (webglRef.current === addon) webglRef.current = null
      })
      term.loadAddon(addon)
      webglRef.current = addon
    } catch {
      webglRef.current = null
    }
  }

  /** Sixel / iTerm2 satır içi görseller. */
  const syncImage = (term: Terminal, enabled: boolean): void => {
    if (!enabled) {
      imageRef.current?.dispose()
      imageRef.current = null
      return
    }
    if (imageRef.current) return
    try {
      const addon = new ImageAddon()
      term.loadAddon(addon)
      imageRef.current = addon
    } catch {
      imageRef.current = null
    }
  }

  /** Ligature'lar xterm'in character joiner API'siyle çizilir (bkz. ligatures.ts). */
  const syncLigatures = (term: Terminal, enabled: boolean): void => {
    if (enabled) {
      if (joinerRef.current === null) joinerRef.current = term.registerCharacterJoiner(ligatureJoiner)
    } else if (joinerRef.current !== null) {
      term.deregisterCharacterJoiner(joinerRef.current)
      joinerRef.current = null
    }
  }

  // ---- Terminal init + PTY create (mount == create) ----
  useEffect(() => {
    const host = hostRef.current
    if (!host || !profileId) return

    const themeColors = resolveTheme(settings).colors
    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      // Settings'te serbest string; xterm yalnızca normal/bold/100..900 kabul eder.
      fontWeight: settings.fontWeight as 'normal' | 'bold' | number,
      lineHeight: settings.lineHeight,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      cursorWidth: settings.cursorWidth,
      letterSpacing: settings.letterSpacing,
      scrollback: settings.scrollback,
      // cursorColor override: '' = tema default (PRD §32); backdrop'ta saydam zemin.
      theme: terminalTheme(themeColors, settings, transparent),
      allowTransparency: transparent,
      minimumContrastRatio: settings.minimumContrastRatio,
      allowProposedApi: true,
      // Draw box-drawing / block glyphs procedurally instead of using the
      // font's own (often misaligned) glyphs — keeps TUI borders crisp.
      customGlyphs: true,
      // VS Code parity: tell xterm the real ConPTY build so its reflow
      // behaviour matches what the backend actually does.
      windowsPty: { backend: 'conpty', buildNumber: window.termflow.system.osBuildNumber }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_event, url) => {
      void window.termflow.system.openExternal(url)
    }))
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddons.set(tabId, searchAddon) // TerminalSearch lookup (Faz 7)
    // Without bracketed paste a multi-line paste would run each line in the shell, so refuse instead.
    pasteHandlers.set(tabId, (text) => {
      if (text.includes('\n') && !term.modes.bracketedPasteMode) return false
      term.paste(text)
      return true
    })
    // scrollback-restore: yalniz normal buffer'in son 2000 satiri (TUI'nin alternatif ekrani degil).
    const serializeAddon = new SerializeAddon()
    term.loadAddon(serializeAddon)
    const unregisterSerializer = registerSerializer(tabId, () => serializeAddon.serialize({ scrollback: 2000, excludeAltBuffer: true, excludeModes: true }))
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(host)
    // WebGL/image addon'ları yalnızca open() sonrası yüklenebilir.
    syncWebgl(term, settings.gpuAcceleration)
    syncImage(term, settings.imageSupport)
    syncLigatures(term, settings.fontLigatures)
    termRef.current = term
    fitRef.current = fit
    // İmleç efekti yalnızca görünen/aktif sekmede ve hareket açıkken çizilir.
    const cursorFx = new CursorFx(term, () => {
      const current = useSettingsStore.getState().settings
      return {
        effect: current.cursorEffect,
        color: current.cursorColor || resolveTheme(current).colors.cursor,
        enabled: activeRef.current && motionEnabled(current.motion)
      }
    })
    // OSC 133 komut blokları: gutter, süre/exit rozeti, gezinme, bildirim.
    const onCommandFinished = (cmd: FinishedCommand): void => {
      useTerminalStore.getState().setTabLastCommand(tabId, cmd.exitCode, cmd.durationMs)
      useStatsStore.getState().finished(cmd.command, cmd.exitCode, cmd.durationMs)
      const current = useSettingsStore.getState().settings
      if (cmd.exitCode !== 0 && activeRef.current) playCue(current.soundTheme, 'error')
      if (current.celebrate && activeRef.current && motionEnabled(current.motion) && shouldCelebrate(cmd.command, cmd.exitCode, cmd.durationMs)) {
        burstConfetti(host)
      }
      const unseen = !activeRef.current || !document.hasFocus()
      if (!current.commandNotifications || !unseen || cmd.durationMs < NOTIFY_MIN_MS) return
      const tab = useTerminalStore.getState().tabs.find((t) => t.id === tabId)
      const ok = cmd.exitCode === 0
      window.termflow.window.notify({
        tabId,
        title: `${ok ? 'Command finished' : `Command failed (exit ${cmd.exitCode})`} · ${formatDuration(cmd.durationMs)}`,
        body: `${tab?.title ?? 'Terminal'}: ${redactApiKeys(cmd.command).slice(0, 160)}`
      })
    }
    const shellIntegration = new ShellIntegration(term, onCommandFinished)
    shellRef.current = shellIntegration
    const selectionEdit = new SelectionEdit(term)
    const inlineSuggest = new InlineSuggest(term, shellIntegration, {
      enabled: () => activeRef.current && useSettingsStore.getState().settings.inlineSuggestions,
      // Aynı profildeki komutlar önce; maskelenmiş (***) kayıtlar asla önerilmez.
      history: () => {
        const entries = useCommandHistoryStore.getState().entries.filter((e) => !e.command.includes('***'))
        const own = entries.filter((e) => e.profileId === profileId).map((e) => e.command)
        return [...own, ...entries.filter((e) => e.profileId !== profileId).map((e) => e.command)]
      },
      accept: (text) => window.termflow.pty.write(tabId, text)
    })
    // Terminaldeki tıklanabilir yollar (PRD ek). Ayarlar canlı okunur:
    // clickablePaths kapatılınca provider link üretmeyi bırakır.
    const pathLinksDisposable = registerPathLinkProvider(
      term,
      () => useTerminalStore.getState().tabs.find((t) => t.id === tabId)?.cwd ?? launchCwd ?? '',
      () => useSettingsStore.getState().settings.clickablePaths
    )

    let disposed = false
    let ready = false
    /** Sağ tıklama sırası; hızlı art arda tıklamalarda eski çözümleme yok sayılır. */
    let ctxMenuToken = 0
    const queue: string[] = []
    let recentOutput = ''
    let inputBuffer = ''
    let capturingCommand = false
    lastSizeRef.current = { cols: term.cols, rows: term.rows }

    const tabProfile = mergeProfiles(settings.profiles).find((item) => item.id === profileId)
    const tabCommand = tabProfile?.startupCommand || tabProfile?.command || providerFromProfileId(settings, profileId)?.command
    const tabAgent = agentKindForCommand(tabCommand)
    // Shift+Enter her ajan CLI'inda calisir; hook/izin kipi yalniz tabAgent'ta.
    const tabAgentCli = agentCliForCommand(tabCommand)
    // Codex durumunu kendisi bildirir: OSC 9 (tur sonu / onay) ve baslikta spinner (calisiyor).
    let codexDoneAt = 0
    const codexOsc = tabAgent === 'codex' && settings.agentHooks
      ? term.parser.registerOscHandler(9, (payload) => {
        if (/^\d+;/.test(payload)) return false // ConEmu ilerleme/cwd alt komutlari, bildirim degil
        const event = codexOscEvent(payload)
        if (event.state === 'done') codexDoneAt = Date.now()
        applyHookEvent(tabId, 'codex', permissionMode, event)
        return true
      })
      : null
    const codexTitle = tabAgent === 'codex' && settings.agentHooks
      ? term.onTitleChange((title) => {
        // Tur sonundan hemen sonra gelen son spinner karesi isi yeniden baslatmaz.
        if (!codexTitleWorking(title) || Date.now() - codexDoneAt < 1500) return
        if (useTerminalStore.getState().tabs.find((tab) => tab.id === tabId)?.agentHook?.state === 'working') return
        applyHookEvent(tabId, 'codex', permissionMode, { state: 'working' })
      })
      : null
    // OSC 52: SSH/tmux icindeki TUI'lerden kopyalama. Yalniz yazma; okuma istegi parseOsc52'de reddedilir.
    const osc52 = term.parser.registerOscHandler(52, (payload) => {
      if (!useSettingsStore.getState().settings.osc52Clipboard) return true
      const text = parseOsc52(payload)
      if (text) void navigator.clipboard.writeText(text).then(() => useToastStore.getState().show('Copied from terminal app', 'success')).catch(() => {})
      return true
    })

    // Data stream: buffer rehydration + live chunks (queue pattern — race yok).
    const onDataHandler = (data: string): void => {
      if (ready) term.write(data)
      else queue.push(data)
      recordOutput(tabId, data.length)
      markScrollbackDirty(tabId)
      // Strip CSI and OSC sequences: shell integration ends every prompt with
      // OSC 133;B, which would otherwise hide the prompt from the check below.
      recentOutput = (recentOutput + data).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-256)
      // Ajan kendi durumunu bildiriyorsa (agent-hooks) prompt sezgisi devre disi.
      const hooked = hasAgentHook(tabId)
      if (!hooked) {
        const activity = !activeRef.current
          ? 'unread'
          : /(?:[A-Za-z]:\\[^\r\n]*>|[$#>❯])\s*$/.test(recentOutput)
            ? 'waiting'
            : 'running'
        useTerminalStore.getState().setTabActivity(tabId, activity)
      }
      // Her ajan CLI'i icin: cikti tahmini Agent Inbox'a ve widget'in "needs you" satirina besler.
      if (tabAgentCli) {
        for (const event of parseAgentOutput(tabAgentCli, data)) {
          if (hooked && HOOK_OWNED_KINDS.has(event.kind)) continue
          useAgentEventStore.getState().append(tabId, tabAgentCli, permissionMode, event)
        }
      }
    }
    dataHandlers.set(tabId, onDataHandler)

    const onExitHandler = (exitCode: number, durationMs: number): void => {
      // agent-resume: silinmis ya da baska makineye ait konusma hemen hata verir; sekme yeni oturumla baslar.
      if (resumeSession && exitCode !== 0 && durationMs < 8000) {
        useToastStore.getState().show(`The previous ${resumeSession.agent} conversation could not be resumed. Started a new one.`, 'info')
        createdPtys.delete(tabId)
        useTerminalStore.getState().dropResume(tabId) // efekt resumeSession'a bagli: yeniden calisir, temiz baslar
        return
      }
      // Sarımsı mesaj terminal içine, butonlar overlay'de (PRD §74).
      term.write(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m\r\n`)
      useTerminalStore.getState().clearAgentHook(tabId)
      setExited({ exitCode, durationMs })
      if (exitCode !== 0) useHandoverStore.getState().failed(tabId)
      useTerminalStore.getState().setTabActivity(tabId, exitCode === 0 ? 'completed' : 'error')
      const profile = mergeProfiles(settings.profiles).find((item) => item.id === profileId)
      const provider = providerFromProfileId(settings, profileId)
      const agent = agentKindForCommand(profile?.startupCommand || profile?.command || provider?.command)
      if (agent) useAgentEventStore.getState().append(tabId, agent, permissionMode, {
        kind: exitCode === 0 ? 'completed' : 'error',
        title: exitCode === 0 ? 'Agent session completed' : 'Agent process failed',
        detail: `Exit code ${exitCode} · ${Math.round(durationMs / 1000)}s`
      })
    }
    exitHandlers.set(tabId, onExitHandler)

    // First measurement: move xterm AND the PTY to the real cell size in the
    // same tick (no settle wait). The PTY spawns at a 120x30 default, and TUI
    // apps that draw their first frames at that width leave permanently-
    // wrapped garbage in the ring buffer otherwise.
    let firstMeasureDone = false
    const measureNow = (): boolean => {
      try {
        const dims = fit.proposeDimensions()
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return false
        const cols = Math.max(2, Math.floor(dims.cols))
        const rows = Math.max(1, Math.floor(dims.rows))
        firstMeasureDone = true
        if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows)
        lastSizeRef.current = { cols, rows }
        return true
      } catch {
        return false // not laid out yet
      }
    }

    const createPty = (): void => {
      if (disposed || !profileId) return
      if (createdPtys.has(tabId)) {
        // PTY zaten yaşıyor (ör. StrictMode remount) — öldürüp yeniden
        // spawn etmek yerine sadece buffer'dan rehydrate et.
        window.termflow.pty.resize(tabId, lastSizeRef.current.cols, lastSizeRef.current.rows)
        void window.termflow.pty.buffer(tabId).then((data) => {
          if (disposed) return
          if (data) term.write(data)
          for (const q of queue) term.write(q)
          queue.length = 0
          ready = true
        })
        return
      }
      createdPtys.add(tabId)
      // Eski cikti once basilir; canli cikti kuyrukta bekledigi icin sira bozulmaz.
      void restoreScrollback(term, tabId)
        .then(() => window.termflow.pty.create(tabId, profileId, lastSizeRef.current.cols, lastSizeRef.current.rows, launchCwd, resumeSession, launchCommand, permissionMode, model, elevated))
        .then(() => {
          if (disposed) return
          useHandoverStore.getState().started(tabId)
          // Re-assert the current cell size so a size change that landed while
          // the PTY was spawning is not lost (main no-ops when identical).
          window.termflow.pty.resize(tabId, lastSizeRef.current.cols, lastSizeRef.current.rows)
          const profile = mergeProfiles(settings.profiles).find((item) => item.id === profileId)
          const provider = providerFromProfileId(settings, profileId)
          const agent = agentKindForCommand(profile?.startupCommand || profile?.command || provider?.command)
          if (agent) {
            useAgentEventStore.getState().append(tabId, agent, permissionMode, {
              kind: 'session', title: 'Agent session started', detail: `${agent} · ${permissionMode}`
            })
            useStatsStore.getState().agentSession()
          }
        void window.termflow.pty.buffer(tabId).then((data) => {
          if (disposed) return
          if (data) term.write(data)
          for (const q of queue) term.write(q)
          queue.length = 0
          ready = true
        })
      }).catch((error: unknown) => {
        createdPtys.delete(tabId)
        if (disposed) return
        setStartError(redactApiKeys(error instanceof Error ? error.message : 'Terminal could not start.'))
        useTerminalStore.getState().setTabActivity(tabId, 'error')
        useSavedCommandStore.getState().finishRun(tabId, -1, 0, 'Could not start. Check the profile and folder.')
        useHandoverStore.getState().failed(tabId)
      })
    }

    // Register terminal-generated input BEFORE spawning the PTY. TUI programs
    // such as Codex query OSC 10/11 immediately at startup to discover the
    // terminal foreground/background. xterm answers those queries through
    // onData; if this bridge is attached after spawn, the answer is lost and
    // Codex falls back to its dark composer palette even on a light theme.
    const dataSub = term.onData((data) => {
      // Protocol replies (OSC/CSI, always ESC-prefixed) must reach background
      // PTYs too; only human keyboard input is restricted to the active tab.
      // Pane'e tıklanınca activeRef bir sonraki React commit'inde güncellenir;
      // o arada odaktaki terminale yazılan ilk tuşlar düşmesin.
      const focused = term.textarea !== undefined && document.activeElement === term.textarea
      if (!activeRef.current && !focused && !data.startsWith('\x1b')) return
      const tab = useTerminalStore.getState().tabs.find((item) => item.id === tabId)
      const cursorLine = term.buffer.active.getLine(term.buffer.active.cursorY)?.translateToString(true) ?? ''
      const sensitivePrompt = /(?:password|passphrase|token|secret|api[_ -]?key)[^\r\n]*:\s*$/i.test(cursorLine)
      if (!capturingCommand && !sensitivePrompt && !data.startsWith('\x1b')) capturingCommand = true
      if (capturingCommand) {
        if (data === '\x03' || data.startsWith('\x1b')) {
          inputBuffer = ''
          capturingCommand = false
        }
        for (const char of capturingCommand ? data : '') {
          if (char === '\r' || char === '\n') {
            const command = inputBuffer.trim()
            if (command && tab) {
              useCommandHistoryStore.getState().add({
                command: redactApiKeys(command),
                cwd: tab.cwd || tab.launchCwd || '',
                profileId: tab.profileId,
                profileName: tab.title
              })
              useStatsStore.getState().command(command, tab.cwd || tab.launchCwd || '')
            }
            inputBuffer = ''
            capturingCommand = false
          } else if (char === '\x7f' || char === '\b') {
            inputBuffer = inputBuffer.slice(0, -1)
          } else if (char >= ' ' && char !== '\x7f') {
            inputBuffer += char
          }
        }
      }
      if (data.includes('\r')) shellIntegration.noteEnter()
      if (!data.startsWith('\x1b')) playCue(useSettingsStore.getState().settings.soundTheme, data.includes('\r') ? 'enter' : 'key')
      if (!hasAgentHook(tabId)) useTerminalStore.getState().setTabActivity(tabId, 'running')
      // Human keystrokes (not protocol replies) make the agent animation listen.
      if (!data.startsWith('\x1b')) recordInput(tabId)
      // Broadcast: yalnızca insan girdisi (ESC ile başlamayan) split'teki tüm
      // panellere gider; protokol yanıtları hep kendi PTY'sinde kalır. Komut
      // geçmişine kayıt yukarıda yalnızca bir kez (aktif tab) düşer.
      const { splitTabIds, broadcastInput } = useTerminalStore.getState()
      const targets = data.startsWith('\x1b')
        ? [tabId]
        : broadcastTargetIds(tabId, splitTabIds, broadcastInput && activeRef.current)
      for (const target of targets) window.termflow.pty.write(target, data)
    })

    // A brand-new tab's flexbox box is frequently still zero-sized in this
    // tick. Retry on the very next frame instead of falling into the 250ms
    // settle debounce — that delay is what made terminals feel sluggish.
    if (!measureNow()) {
      requestAnimationFrame(() => {
        if (disposed) return
        measureNow()
        createPty()
      })
    } else {
      createPty()
    }

    // Single atomic resize channel. Every resize source (observer, activation,
    // font/theme) funnels through here. We wait for the size to settle, then
    // move the xterm view AND the PTY to the new size in the SAME tick —
    // intermediate sizes are never applied. (PRD §11.7)
    let resizeSettleTimer: ReturnType<typeof setTimeout> | null = null
    const applyResize = (): void => {
      if (disposed) return
      const dims = fit.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      const cols = Math.max(2, Math.floor(dims.cols))
      const rows = Math.max(1, Math.floor(dims.rows))
      firstMeasureDone = true
      if (cols === term.cols && rows === term.rows) return
      term.resize(cols, rows) // xterm view
      window.termflow.pty.resize(tabId, cols, rows) // PTY, same tick
      lastSizeRef.current = { cols, rows }
    }
    const scheduleResize = (): void => {
      if (!firstMeasureDone) {
        applyResize()
        return
      }
      if (resizeSettleTimer) clearTimeout(resizeSettleTimer)
      resizeSettleTimer = setTimeout(applyResize, 250)
    }
    scheduleResizeRef.current = scheduleResize
    const ro = new ResizeObserver(() => scheduleResize())
    ro.observe(host)

    // Ctrl+C / Ctrl+Shift+C: seçim varsa kopyala; seçim yoksa Ctrl+C normal
    // şekilde PTY'ye gider. Ctrl+V / Ctrl+Shift+V preload üzerinden yapıştırır.
    // Voice input: hold Space to dictate (docs/voice-input.md). It sees keyups too.
    const voice = createVoiceInput(tabId, term)
    const onVoiceBlur = (): void => voice.blur()
    term.textarea?.addEventListener('blur', onVoiceBlur)
    window.addEventListener('blur', onVoiceBlur)
    term.attachCustomKeyEventHandler((e) => {
      if (voice.handle(e)) return false
      // Ajan giris kutusunda Shift+Enter gondermez, yeni satir ekler.
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && useSettingsStore.getState().settings.shiftEnterNewline) {
        const newline = shiftEnterSequence(tabAgentCli)
        if (newline) {
          if (e.type === 'keydown') window.termflow.pty.write(tabId, newline)
          return false
        }
      }
      if (e.type !== 'keydown') return true
      if (inlineSuggest.handleKey(e)) return false
      // Ctrl+Up/Down: önceki/sonraki komuta git (yalnızca shell integration varken).
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (shellIntegration.navigate(e.key === 'ArrowUp' ? -1 : 1)) return false
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === 'C' || e.key === 'c') {
          if (term.hasSelection()) {
            copySelection(term)
            return false
          }
        } else if (e.key === 'V' || e.key === 'v') {
          pasteFromClipboard(term, tabId)
          return false
        }
      }
      // Seçili kelimenin üzerine yazma (broadcast'te imleç hareketleri diğer
      // panellerde anlamsız olacağı için devre dışı).
      if (!useTerminalStore.getState().broadcastInput && selectionEdit.handleKey(e)) return false
      return true
    })

    // PRD: copyOnSelect — ayar açıkken seçim biter bitmez panoya kopyala.
    // Ayar getState() ile okunur ki değişiklik terminali yeniden yaratmasın.
    const selSub = term.onSelectionChange(() => {
      if (!useSettingsStore.getState().settings.copyOnSelect) return
      if (!term.hasSelection()) return
      copySelection(term)
    })

    // PRD: bell — ayar açıkken kısa görsel flash (ek dependency yok).
    let bellTimer: ReturnType<typeof setTimeout> | null = null
    const bellSub = term.onBell(() => {
      if (!hasAgentHook(tabId)) useTerminalStore.getState().setTabActivity(tabId, activeRef.current ? 'waiting' : 'unread')
      if (!useSettingsStore.getState().settings.bell) return
      if (activeRef.current) playCue(useSettingsStore.getState().settings.soundTheme, 'bell')
      host.classList.remove('bell-flash')
      // reflow: aynı sınıfın animasyonu üst üste gelen bell'lerde de yeniden başlasın
      void host.offsetWidth
      host.classList.add('bell-flash')
      if (bellTimer) clearTimeout(bellTimer)
      bellTimer = setTimeout(() => host.classList.remove('bell-flash'), 150)
    })

    // Sağ tık (PRD §24): imleç çözülmüş bir yolun üzerindeyse ve pathContextMenu
    // açıksa yol menüsü (Open / Open File Location / Copy Path) gösterilir;
    // aksi halde 'paste' davranışı — seçim varsa kopyala, yoksa yapıştır;
    // 'context-menu' — normal menüyü aç. Yol çözümlemesi IPC'ye gittiği için
    // menü async açılır; bu sırada yeni sağ tık gelirse eski sonuç yok sayılır.
    const onCtxMenu = (e: MouseEvent): void => {
      e.preventDefault()
      const current = useSettingsStore.getState().settings
      const hasSelection = term.hasSelection()
      const line = shellIntegration.lineAtClientY(e.clientY)
      const found = line === null ? null : shellIntegration.blockAt(line)
      const block: BlockMenuInfo | null = found
        ? { command: found.command, output: shellIntegration.outputOf(found), exitCode: found.exitCode }
        : null
      const link = getUrlAtMouse(term, e)
      if (link) {
        setMenu({ x: e.clientX, y: e.clientY, hasSelection, path: null, block, link })
        return
      }
      if (!current.pathContextMenu) {
        if (current.rightClickBehavior === 'paste') {
          if (hasSelection) copySelection(term)
          else pasteFromClipboard(term, tabId)
          return
        }
        setMenu({ x: e.clientX, y: e.clientY, hasSelection, path: null, block })
        return
      }
      const token = ++ctxMenuToken
      const cwd = useTerminalStore.getState().tabs.find((t) => t.id === tabId)?.cwd ?? launchCwd ?? ''
      void getPathAtMouse(term, e, cwd).then((path) => {
        if (disposed || token !== ctxMenuToken) return
        if (path) {
          setMenu({ x: e.clientX, y: e.clientY, hasSelection, path, block })
          return
        }
        if (current.rightClickBehavior === 'paste') {
          if (hasSelection) copySelection(term)
          else pasteFromClipboard(term, tabId)
          return
        }
        setMenu({ x: e.clientX, y: e.clientY, hasSelection, path: null, block })
      })
    }
    host.addEventListener('contextmenu', onCtxMenu)

    // Visible terminals stream live; offscreen ones are throttled by main.
    // (Gerçek mod aşağıdaki `active` effect'i tarafından yönetilir.)
    window.termflow.pty.setMode(tabId, activeRef.current ? 'active' : 'passive')

    return () => {
      disposed = true
      if (resizeSettleTimer) clearTimeout(resizeSettleTimer)
      if (bellTimer) clearTimeout(bellTimer)
      scheduleResizeRef.current = null
      ro.disconnect()
      dataSub.dispose()
      selSub.dispose()
      bellSub.dispose()
      codexOsc?.dispose()
      codexTitle?.dispose()
      osc52.dispose()
      unregisterSerializer()
      voice.blur()
      term.textarea?.removeEventListener('blur', onVoiceBlur)
      window.removeEventListener('blur', onVoiceBlur)
      pathLinksDisposable.dispose()
      cursorFx.dispose()
      inlineSuggest.dispose()
      selectionEdit.dispose()
      shellIntegration.dispose()
      shellRef.current = null
      host.removeEventListener('contextmenu', onCtxMenu)
      // Bu view'lar tabId ile anahtarlanır; unmount yalnızca kendi kaydını siler.
      dataHandlers.delete(tabId)
      exitHandlers.delete(tabId)
      searchAddons.delete(tabId)
      pasteHandlers.delete(tabId)
      // Unmount artık yalnızca tab kapanınca olur; tab kapanışı zaten pty.kill
      // çağırdığı için ayrıca bir mod değişikliğine gerek yok. createdPtys'ten
      // silmiyoruz: tab id'leri benzersiz, ve StrictMode'un unmount/remount
      // döngüsünde PTY'nin yeniden spawn edilmesini de böylece engelliyoruz.
      webglRef.current?.dispose()
      webglRef.current = null
      imageRef.current?.dispose()
      imageRef.current = null
      joinerRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, profileId, launchCwd, resumeSession, launchCommand, retryNonce])

  // Focus + re-measure when this tab becomes active. Tüm tab'lar mount kaldığı
  // için render modunu da burada güncelliyoruz: aktif olan canlı stream alır,
  // diğerleri passive (process çalışmaya devam eder).
  useEffect(() => {
    window.termflow.pty.setMode(tabId, active ? 'active' : 'passive')
    if (active && termRef.current) {
      termRef.current.focus()
      scheduleResizeRef.current?.()
    }
  }, [active, tabId])

  // Keep xterm options in sync with settings changes (font, theme, cursor…).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = settings.fontFamily
    term.options.fontSize = settings.fontSize
    term.options.fontWeight = settings.fontWeight as 'normal' | 'bold' | number
    term.options.lineHeight = settings.lineHeight
    term.options.cursorStyle = settings.cursorStyle
    term.options.cursorBlink = settings.cursorBlink
    term.options.cursorWidth = settings.cursorWidth
    term.options.scrollback = settings.scrollback
    // xterm letterSpacing'i (px) native olarak destekler; hücre metriğini
    // değiştirdiği için aşağıdaki resize kanalı yeniden fit edecek.
    term.options.letterSpacing = settings.letterSpacing
    term.options.minimumContrastRatio = settings.minimumContrastRatio
    const themeColors = resolveTheme(settings).colors
    term.options.theme = terminalTheme(themeColors, settings, transparent)
    // A font/size change alters the cell metrics, so the fit result may change;
    // route it through the single atomic resize channel.
    scheduleResizeRef.current?.()
    term.refresh(0, term.rows - 1)
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.fontWeight,
    settings.lineHeight,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.cursorWidth,
    settings.cursorColor,
    settings.letterSpacing,
    settings.minimumContrastRatio,
    settings.scrollback,
    settings.themeId,
    settings.customTheme,
    settings.backdrop,
    transparent
  ])

  // Saydamlık değişince WebGL atlası yeniden kurulmalı (glif kenar yumuşatması
  // opak/saydam zemine göre farklı hazırlanır).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (term.options.allowTransparency === transparent) return
    term.options.allowTransparency = transparent
    webglRef.current?.dispose()
    webglRef.current = null
    syncWebgl(term, settings.gpuAcceleration)
    term.refresh(0, term.rows - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transparent])

  // GPU / inline image / ligature ayarları terminali yeniden yaratmadan,
  // yalnızca ilgili addon'ı yükleyip atarak uygulanır.
  useEffect(() => {
    const term = termRef.current
    if (term) syncWebgl(term, settings.gpuAcceleration)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.gpuAcceleration])

  useEffect(() => {
    const term = termRef.current
    if (term) syncImage(term, settings.imageSupport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.imageSupport])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    syncLigatures(term, settings.fontLigatures)
    term.refresh(0, term.rows - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fontLigatures])

  // Remote Access restarts through the same path as the in-pane button.
  const restartRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    restartHandlers.set(tabId, () => restartRef.current())
    return () => { restartHandlers.delete(tabId) }
  }, [tabId])

  const handleRestart = (): void => {
    setStartError('')
    if (!createdPtys.has(tabId)) { setRetryNonce(value => value + 1); return }
    setExited(null)
    const term = termRef.current
    void window.termflow.pty.restart(tabId).then((res) => {
      if (!res) return
      useTerminalStore.getState().clearAgentHook(tabId)
      useTerminalStore.getState().setTabActivity(tabId, 'running')
      term?.reset() // clear the view; fresh output streams through the handlers
      window.termflow.pty.resize(tabId, lastSizeRef.current.cols, lastSizeRef.current.rows)
    }).catch(error => setStartError(redactApiKeys(error instanceof Error ? error.message : 'Restart failed.')))
  }
  restartRef.current = handleRestart

  const handleChangeCwd = async (cwd: string): Promise<boolean> => {
    try {
      const result = await window.termflow.pty.restartAt(tabId, cwd)
      if (!result) return false
      setExited(null)
      termRef.current?.reset()
      useTerminalStore.getState().setTabWorkingDirectory(tabId, cwd)
      useTerminalStore.getState().clearAgentHook(tabId)
      useTerminalStore.getState().setTabActivity(tabId, 'running')
      window.termflow.pty.resize(tabId, lastSizeRef.current.cols, lastSizeRef.current.rows)
      termRef.current?.focus()
      return true
    } catch {
      return false
    }
  }

  const handleCloseTab = (): void => {
    useTerminalStore.getState().requestCloseTab(tabId)
  }

  // ---- Context menu actions (PRD §24) ----
  const closeMenu = (): void => setMenu(null)
  const handleCopy = (): void => {
    if (termRef.current) copySelection(termRef.current)
    closeMenu()
  }
  const handlePaste = (): void => {
    if (termRef.current) pasteFromClipboard(termRef.current, tabId)
    closeMenu()
    // Menü tıklaması odağı aldı; yapıştırdıktan sonra yazmaya devam edilebilsin.
    termRef.current?.focus()
  }
  const handleSpeak = (): void => {
    const text = termRef.current?.getSelection() ?? ''
    closeMenu()
    void speak(text)
  }
  const handleSelectAll = (): void => {
    termRef.current?.selectAll()
    closeMenu()
  }
  // Coken bir TUI'nin biraktigi modlari (fare izleme, alternatif ekran, uygulama tuslari) temizler; kabuk ayni kalir.
  const handleResetTerminal = (): void => {
    termRef.current?.reset()
    scheduleResizeRef.current?.()
    closeMenu()
    termRef.current?.focus()
  }
  const handleClear = (): void => {
    termRef.current?.clear() // sadece görünüm; PTY geçmişine dokunulmaz
    closeMenu()
  }
  const handleSearch = (): void => {
    closeMenu()
    useSettingsStore.getState().openSearch(tabId)
  }
  const handleNewTab = (): void => {
    closeMenu()
    const { settings, shells } = useSettingsStore.getState()
    useTerminalStore.getState().addTab(resolveDefaultProfileId(settings, shells))
  }
  const handleSettings = (): void => {
    closeMenu()
    useSettingsStore.getState().openSettings()
  }
  // ---- Yol işlemleri (tıklanabilir yollar, PRD ek) ----
  const handleOpenPath = (): void => {
    const path = menu?.path
    closeMenu()
    if (path?.canOpen && path.line && !path.isDirectory) void window.termflow.system.openInEditor(path.path, path.line, path.column)
    else if (path?.canOpen) void window.termflow.system.openPath(path.path)
    else if (path) void window.termflow.system.revealInFolder(path.path)
  }
  const handleRevealInFolder = (): void => {
    const path = menu?.path
    closeMenu()
    if (path) void window.termflow.system.revealInFolder(path.path)
  }
  const handleCopyPath = (): void => {
    const path = menu?.path
    closeMenu()
    // navigator.clipboard.writeText, pencere odaklı değilse/permission yoksa
    // sessizce başarısız olabilir; yazma main üzerinden yapılır (okuma zaten
    // IPC ile gidiyordu — bkz. src/main/ipc/clipboard.ts).
    if (path) void window.termflow.clipboard.writeText(path.path)
  }

  // ---- Komut bloğu işlemleri (shell integration) ----
  const handleCopyCommand = (): void => {
    const block = menu?.block
    closeMenu()
    if (block) void window.termflow.clipboard.writeText(block.command)
  }
  const handleCopyOutput = (): void => {
    const block = menu?.block
    closeMenu()
    if (block) void window.termflow.clipboard.writeText(block.output)
  }
  const handleRerun = (): void => {
    const block = menu?.block
    closeMenu()
    // Komut prompt'a yazılır; Enter'a basılmaz, kullanıcı onaylar.
    if (block && !block.command.includes('\n')) {
      window.termflow.pty.write(tabId, block.command)
      termRef.current?.focus()
    }
  }
  const handleCopyForAgent = (): void => {
    const block = menu?.block
    closeMenu()
    if (!block) return
    const status = block.exitCode === undefined ? 'still running' : `exit code ${block.exitCode}`
    const text = `I ran this command in my terminal (${status}):

\`\`\`
${block.command}
\`\`\`

Output:

\`\`\`
${block.output.slice(-8000)}
\`\`\`
`
    void window.termflow.clipboard.writeText(redactApiKeys(text))
  }

  // ---- Dosya sürükle-bırak: yalnızca yolu input'a yaz (Enter'a BASILMAZ) ----
  // Yalnızca gerçek dosya taşıyan sürüklemeler kabul edilir; metin/URL
  // sürüklemeleri tarayıcının varsayılan davranışına bırakılır.
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    const paths = formatDroppedPaths(files, window.termflow.system.getPathForFile)
    if (!paths) return
    // Yazma yalnızca bu view'ın kendi tab id'sine gider.
    window.termflow.pty.write(tabId, paths)
    termRef.current?.focus()
    const mode = useSettingsStore.getState().settings.mediaPreviews
    for (const file of files) {
      const path = window.termflow.system.getPathForFile(file)
      if (path) reportMedia(tabId, path, 'drop', mode)
    }
  }

  // --terminal-padding: bilgi şeridi terminal dolgusunun dışına taşıp status
  // bar'a yaslanabilsin diye aynı değer CSS'e de verilir.
  const paneStyle = {
    padding: settings.terminalPadding,
    '--terminal-padding': `${settings.terminalPadding}px`
  } as React.CSSProperties
  const themeColors = resolveTheme(settings).colors

  return (
    <div
      className={`terminal-view${asciiBackground ? ' has-ascii-bg' : ''}${visible ? '' : ' inactive'}${splitPane ? ` split-pane split-pane-${splitPane} split-${splitDirection}` : ''}${active ? ' split-pane-active' : ''}`}
      style={paneStyle}
      onMouseDown={() => {
        if (visible && !active) useTerminalStore.getState().setActiveTab(tabId)
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {visible && <PaneToolbar tabId={tabId} />}
      {asciiBackground && (
        <AsciiBackdrop
          background={asciiBackground}
          color={themeColors.foreground}
          invert={isLightColor(themeColors.background)}
          fontFamily={settings.fontFamily}
        />
      )}
      {/* Terminal + optional agent animation side by side; the host keeps
          the remaining width and xterm refits through its ResizeObserver. */}
      <div className="terminal-body">
        <div className="terminal-main">
          <div ref={hostRef} className="terminal-host" />
          <MediaCards tabId={tabId} />
        </div>
      </div>
      <UsageStrip tabId={tabId} />
      <AgentWorkPanel tabId={tabId} onChangeCwd={handleChangeCwd} />
      {uiSearchTabId === tabId && (
        <TerminalSearch
          tabId={tabId}
          onClose={() => {
            useSettingsStore.getState().closeSearch()
            termRef.current?.focus()
          }}
        />
      )}
      {menu !== null && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          hasSelection={menu.hasSelection}
          path={menu.path ?? null}
          block={menu.block ?? null}
          onCopyCommand={handleCopyCommand}
          onCopyOutput={handleCopyOutput}
          onRerun={handleRerun}
          onCopyForAgent={handleCopyForAgent}
          link={menu.link ?? null}
          onOpenLink={() => { if (menu.link) void window.termflow.system.openExternal(menu.link); closeMenu() }}
          onCopyLink={() => { if (menu.link) void navigator.clipboard.writeText(menu.link).catch(() => {}); closeMenu() }}
          sessionId={sessionId}
          onCopySessionId={() => { if (sessionId) void navigator.clipboard.writeText(sessionId).catch(() => {}); closeMenu() }}
          onResetTerminal={handleResetTerminal}
          onOpenPath={handleOpenPath}
          onRevealInFolder={handleRevealInFolder}
          onCopyPath={handleCopyPath}
          speak={settings.voice.speak.enabled ? { speaking: speakingNow, onSpeak: handleSpeak, onStop: () => { closeMenu(); stopSpeaking() } } : undefined}
          onClose={closeMenu}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onSelectAll={handleSelectAll}
          onClear={handleClear}
          onMarkUnread={() => { useTerminalStore.getState().markAttention(tabId, 'done'); closeMenu() }}
          onSearch={handleSearch}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onSettings={handleSettings}
        />
      )}
      {(exited !== null || startError) && (
        <div className="exit-overlay">
          <span role={startError ? 'alert' : undefined}>{startError || `Process exited with code ${exited?.exitCode}`}</span>
          <div className="exit-overlay-actions">
            {startError && <button className="exit-overlay-btn" onClick={handleSettings}>Edit profile</button>}
            <button className="exit-overlay-btn" onClick={handleRestart}>
              Restart
            </button>
            <button className="exit-overlay-btn" onClick={handleCloseTab}>
              Close Tab
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
