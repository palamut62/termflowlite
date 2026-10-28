import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Camera, FolderGit2, House, Monitor, QrCode, Settings as SettingsIcon, SquareTerminal, WifiOff } from 'lucide-react'
import { isLightColor } from '../../renderer/src/backdrop'
import { resolveTheme } from '../../renderer/src/themes/themes'
import { agentForProfile } from '../../shared/profiles'
import { RemoteClient, loadToken, pairWithCode, saveToken } from './client'
import { HAPTIC_GAP_MS, finishedHaptic, hasNative, postNative, type ActivitySeen } from './native'
import { extractPairCode, readQrFromPhoto } from './qr'
import { useRemote, type Screen } from './store'
import { Toasts } from './ui'
import { TerminalScreen } from './views/TerminalScreen'
import { AgentsScreen } from './views/AgentsScreen'
import { ProjectScreen } from './views/ProjectScreen'
import { SettingsScreen } from './views/SettingsScreen'
import { HomeScreen } from './views/HomeScreen'
import { ScreenShare } from './views/ScreenShare'
import { WorkspacesScreen } from './views/WorkspacesScreen'

// Settings sits behind the gear in the header (Orca Mobile); the bar keeps the four places you work in.
const NAV: { id: Screen; label: string; icon: React.JSX.Element }[] = [
  { id: 'home', label: 'Home', icon: <House size={20} /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={20} /> },
  { id: 'agents', label: 'Agents', icon: <Bot size={20} /> },
  { id: 'project', label: 'Project', icon: <FolderGit2 size={20} /> },
  { id: 'desktop', label: 'Screen', icon: <Monitor size={20} /> }
]

/** Reads a one-time #name=value, removing it from the address bar right away. */
function takeHashValue(name: 'pair' | 'tab', pattern: RegExp): string | null {
  const match = new RegExp(`(?:^#|&)${name}=(${pattern.source})`).exec(location.hash)
  if (!match) return null
  history.replaceState(null, '', location.pathname)
  return match[1]
}
const takePairCode = (): string | null => takeHashValue('pair', /[A-Za-z0-9_-]{6,100}/)
/** #tab=<id>: the iPhone app opens a tab from a tapped phone notification. */
const takeTabLink = (): string | null => takeHashValue('tab', /[A-Za-z0-9_-]{1,100}/)

function PairScreen({ error, busy, onCode }: { error: string | null; busy: boolean; onCode(code: string): void }): React.JSX.Element {
  const [code, setCode] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  // The camera takes a photo of the QR on the computer; the code is read from it here.
  const onPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setScanError(null)
    setReading(true)
    try {
      const text = await readQrFromPhoto(file)
      const found = text ? extractPairCode(text) : null
      if (found) onCode(found)
      else setScanError('No pairing QR code found in the photo. Hold the phone closer so the code fills most of the picture.')
    } catch (failure) {
      setScanError(failure instanceof Error ? failure.message : 'The photo could not be read.')
    } finally {
      setReading(false)
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  return (
    <main className="pair">
      <img src="/icon-192.png" alt="" className="pair-logo" />
      <h1>TermFlow Remote</h1>
      {busy || reading
        ? <p>{reading ? 'Reading the QR code...' : 'Pairing with your computer...'}</p>
        : (
          <>
            <p>On the computer open <strong>Settings &gt; Remote Access</strong> and press <strong>Show QR code</strong>, then scan it here.</p>
            <button className="btn primary pair-scan" onClick={() => photoRef.current?.click()}>
              <Camera size={20} /> Scan QR code
            </button>
            <input
              ref={photoRef}
              className="pair-photo"
              type="file"
              accept="image/*"
              capture="environment"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
            {scanError && <p className="pair-error">{scanError}</p>}
            <form className="pair-code" onSubmit={(e) => { e.preventDefault(); if (code.trim()) onCode(code) }}>
              <label htmlFor="pair-code">Or type the code shown next to the QR:</label>
              <div className="pair-code-row">
                <input
                  id="pair-code"
                  className="input mono"
                  placeholder="XXXXX-XXXXX"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={20}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button className="btn" type="submit" disabled={!code.trim()}>Pair</button>
              </div>
            </form>
            <div className="pair-hint"><QrCode size={16} /> Both devices must be on the same Tailscale network.</div>
          </>
        )}
      {error && <p className="pair-error">{error}</p>}
    </main>
  )
}

function useViewportHeight(): void {
  // Keeps the layout above the on-screen keyboard on browsers that overlay it.
  useEffect(() => {
    const vv = window.visualViewport
    const apply = (): void => {
      const style = document.documentElement.style
      style.setProperty('--app-height', `${Math.round(vv?.height ?? window.innerHeight)}px`)
      // iOS scrolls the visual viewport over the page when the keyboard opens; sheets follow it.
      style.setProperty('--vv-top', `${Math.round(vv?.offsetTop ?? 0)}px`)
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
    }
  }, [])
}

/**
 * iPhone app only: keep the screen on while an agent works, a haptic tap when one finishes or
 * needs you (while you look at the app), and the tab summary for the widget and Live Activity.
 */
function useNativeSignals(): void {
  const tabs = useRemote((s) => s.tabs)
  const connection = useRemote((s) => s.connection)
  const seen = useRef(new Map<string, ActivitySeen>())
  const lastHaptic = useRef(0)
  const awake = connection === 'online' && tabs.some((t) => t.activity === 'running')

  useEffect(() => {
    if (hasNative()) postNative({ type: 'awake', on: awake })
  }, [awake])

  useEffect(() => {
    const now = Date.now()
    const result = finishedHaptic(seen.current, tabs, now)
    seen.current = result.seen
    if (!result.kind || !hasNative() || document.visibilityState !== 'visible' || now - lastHaptic.current < HAPTIC_GAP_MS) return
    lastHaptic.current = now
    postNative({ type: 'haptic', kind: result.kind })
  }, [tabs])

  const computer = useRemote((s) => s.computer)
  const settings = useRemote((s) => s.settings)
  useEffect(() => {
    if (!hasNative() || connection !== 'online' || !settings) return
    const agentOf = (profileId: string): boolean => agentForProfile(settings, profileId) !== null
    postNative({ type: 'status', computer, tabs: tabs.map(({ id, title, activity, profileId }) => ({ id, title, activity, agent: agentOf(profileId) })) })
  }, [tabs, computer, connection, settings])
}

/** The phone chrome takes the light/dark tone of the desktop terminal theme. */
function useDesktopTone(): void {
  const settings = useRemote((s) => s.settings)
  useEffect(() => {
    if (!settings) return
    const light = isLightColor(resolveTheme(settings).colors.background)
    document.documentElement.dataset.theme = light ? 'light' : 'dark'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f5f8' : '#0e1014')
  }, [settings])
}

export function App(): React.JSX.Element {
  const [token, setToken] = useState<string | null>(() => loadToken())
  const [pairError, setPairError] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const connection = useRemote((s) => s.connection)
  const device = useRemote((s) => s.device)
  const screen = useRemote((s) => s.screen)
  const setScreen = useRemote((s) => s.setScreen)
  const attach = useRemote((s) => s.attach)
  useViewportHeight()
  useDesktopTone()
  useNativeSignals()

  const pairCode = useCallback((code: string): void => {
    setPairing(true)
    pairWithCode(code)
      .then((next) => {
        saveToken(next)
        setToken(next)
        setPairError(null)
      })
      .catch((error: Error) => setPairError(error.message))
      .finally(() => setPairing(false))
  }, [])

  // A QR scanned while this page is already open only changes the hash.
  useEffect(() => {
    const tryPair = (): void => {
      const code = takePairCode()
      if (!code) return
      pairCode(code)
    }
    tryPair()
    window.addEventListener('hashchange', tryPair)
    return () => window.removeEventListener('hashchange', tryPair)
  }, [pairCode])

  useEffect(() => {
    const openLinkedTab = (): void => {
      const tabId = takeTabLink()
      if (tabId) useRemote.getState().setCurrentTab(tabId)
    }
    openLinkedTab()
    window.addEventListener('hashchange', openLinkedTab)
    return () => window.removeEventListener('hashchange', openLinkedTab)
  }, [])

  useEffect(() => {
    if (!token) return
    const remote = new RemoteClient(token)
    const detach = attach(remote)
    remote.start()
    return () => {
      detach()
      remote.stop()
    }
  }, [token, attach])

  useEffect(() => {
    if (connection !== 'revoked') return
    setToken(null)
    setPairError('This phone was disconnected from the computer. Scan a new QR code to pair again.')
  }, [connection])

  if (!token || connection === 'revoked') return <PairScreen error={pairError} busy={pairing} onCode={pairCode} />

  if (!device) {
    return (
      <main className="pair">
        <img src="/icon-192.png" alt="" className="pair-logo" />
        <h1>TermFlow Remote</h1>
        <p>{connection === 'offline' ? 'Your computer is not reachable. Is TermFlow Lite running and Tailscale connected?' : 'Connecting to your computer...'}</p>
        {connection === 'offline' && <div className="pair-hint"><WifiOff size={16} /> Retrying automatically</div>}
      </main>
    )
  }

  return (
    <div className="app">
      <header className="app-head">
        <img src="/icon-192.png" alt="" className="app-logo" />
        <span className="app-title">TermFlow</span>
        <span className={`conn ${connection}`} title={connection} />
        {connection !== 'online' && <span className="app-sub">{connection === 'connecting' ? 'Connecting...' : 'Offline'}</span>}
        <button className={`app-gear${screen === 'settings' ? ' active' : ''}`} onClick={() => setScreen(screen === 'settings' ? 'home' : 'settings')} aria-label="Settings" aria-pressed={screen === 'settings'}>
          <SettingsIcon size={20} />
        </button>
      </header>
      <main className="app-main">
        {/* The terminal stays mounted so switching screens keeps its state. */}
        <div className="screen" hidden={screen !== 'terminal'}><TerminalScreen /></div>
        {screen === 'workspaces' && <div className="screen scroll"><WorkspacesScreen /></div>}
        {screen === 'home' && <div className="screen scroll"><HomeScreen /></div>}
        {screen === 'agents' && <div className="screen scroll"><AgentsScreen /></div>}
        {screen === 'project' && <div className="screen scroll"><ProjectScreen /></div>}
        {screen === 'desktop' && <div className="screen"><ScreenShare /></div>}
        {screen === 'settings' && <div className="screen scroll"><SettingsScreen /></div>}
      </main>
      <nav className="bottom-nav" aria-label="Sections">
        {NAV.map((item) => (
          <button key={item.id} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setScreen(item.id)} aria-current={screen === item.id ? 'page' : undefined}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <Toasts />
    </div>
  )
}
