import { useCallback, useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { Keyboard, Maximize2, Minimize2, Monitor, MousePointer2, Power } from 'lucide-react'
import { screenTicket } from '../client'
import { useRemote } from '../store'

/** X11 keysyms for the keys a phone keyboard has that are not plain text. */
const SPECIAL: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  Delete: 0xffff,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56
}

/** Latin-1 maps one to one; everything above it uses the Unicode keysym range. */
function keysym(char: string): number {
  const cp = char.codePointAt(0) ?? 0
  return cp < 0x100 ? cp : 0x01000000 + cp
}

type State = 'off' | 'connecting' | 'password' | 'on' | 'error'

/**
 * The whole desktop on the phone. TermFlow does not capture the screen itself:
 * this is a noVNC client for the VNC server on the computer (the desktop's
 * Settings > Remote Access > Screen explains why, and sets it up). The password
 * is the VNC server's own and is never stored - it lives in this page only.
 */
export function ScreenShare(): React.JSX.Element {
  const enabled = useRemote((s) => s.settings?.remote.screen.enabled ?? false)
  const computer = useRemote((s) => s.computer)
  const toast = useRemote((s) => s.toast)
  const holder = useRef<HTMLDivElement>(null)
  const keys = useRef<HTMLInputElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [state, setState] = useState<State>('off')
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [immersive, setImmersive] = useState(false)
  const [viewOnly, setViewOnly] = useState(false)
  /** Sticky: the phone keyboard stays up across taps on the desktop until it is turned off. */
  const [typing, setTyping] = useState(false)

  const disconnect = useCallback((): void => {
    rfb.current?.disconnect()
    rfb.current = null
    setState('off')
  }, [])

  const connect = useCallback(async (): Promise<void> => {
    if (!holder.current || rfb.current) return
    setError(null)
    setState('connecting')
    try {
      const ticket = await screenTicket()
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      const client = new RFB(holder.current, `${scheme}://${location.host}/vnc?t=${encodeURIComponent(ticket)}`, { shared: true })
      client.scaleViewport = true
      client.background = 'transparent'
      client.showDotCursor = true
      client.viewOnly = viewOnly
      client.addEventListener('connect', () => {
        setState('on')
        setError(null)
      })
      client.addEventListener('credentialsrequired', () => setState('password'))
      // securityfailure comes first and says why; disconnect must not overwrite it.
      let reason: string | null = null
      client.addEventListener('securityfailure', () => {
        reason = 'The computer refused the password.'
      })
      client.addEventListener('disconnect', (event) => {
        rfb.current = null
        const clean = (event as CustomEvent<{ clean: boolean }>).detail?.clean
        if (clean && !reason) {
          setState('off')
          return
        }
        setError(reason ?? 'The screen connection dropped. Is the VNC server still running on the computer?')
        setState('error')
      })
      rfb.current = client
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The screen could not be opened.')
      setState('error')
    }
  }, [viewOnly])

  // Leaving the screen (or the app) must not keep the desktop streaming.
  useEffect(() => () => {
    rfb.current?.disconnect()
    rfb.current = null
  }, [])

  useEffect(() => {
    document.documentElement.toggleAttribute('data-immersive', immersive)
    return () => document.documentElement.removeAttribute('data-immersive')
  }, [immersive])

  // Full screen moves the button bar to the side, so the canvas box changes
  // after this render; the scale has to be asked for once the new box exists.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (rfb.current) rfb.current.scaleViewport = true
    })
    return () => cancelAnimationFrame(frame)
  }, [immersive])

  useEffect(() => {
    if (rfb.current) rfb.current.viewOnly = viewOnly
  }, [viewOnly])

  /**
   * Turning the phone, and the keyboard taking half of it, both change how much
   * room the desktop has. noVNC only watches window resizes, which iOS does not
   * fire for the keyboard, so the scale is asked for again on every change.
   */
  useEffect(() => {
    if (state !== 'on') return
    const vv = window.visualViewport
    const rescale = (): void => {
      if (rfb.current) rfb.current.scaleViewport = true
    }
    // Landscape is the shape of a desktop: give it the whole phone by itself.
    // The orientation is read from the window, never from the visual viewport:
    // an open keyboard makes the viewport wider than tall while the phone is
    // still upright, which used to drop the bars in portrait.
    const follow = (): void => {
      rescale()
      setImmersive(window.innerWidth > window.innerHeight)
    }
    follow()
    vv?.addEventListener('resize', follow)
    window.addEventListener('resize', follow)
    window.addEventListener('orientationchange', follow)
    return () => {
      vv?.removeEventListener('resize', follow)
      window.removeEventListener('resize', follow)
      window.removeEventListener('orientationchange', follow)
    }
  }, [state])

  useEffect(() => {
    if (state !== 'on') setTyping(false)
  }, [state])

  // Tapping the desktop steals focus from the key input; sticky mode takes it back.
  useEffect(() => {
    if (!typing || state !== 'on') return
    keys.current?.focus()
    const holdFocus = (): void => {
      // After the tap has been delivered to the desktop, not before.
      setTimeout(() => keys.current?.focus(), 0)
    }
    const node = holder.current
    node?.addEventListener('pointerup', holdFocus)
    return () => node?.removeEventListener('pointerup', holdFocus)
  }, [typing, state])

  const sendPassword = (): void => {
    rfb.current?.sendCredentials({ password })
    setPassword('')
    setState('connecting')
  }

  const tap = (keysymValue: number): void => {
    rfb.current?.sendKey(keysymValue, null, true)
    rfb.current?.sendKey(keysymValue, null, false)
  }

  /**
   * iOS gives a software keyboard only to a real input, and canvas keyboard
   * events never arrive from it; `beforeinput` is what both a tapped key and a
   * paste produce, so it is translated to key presses here.
   */
  const onBeforeInput = (event: React.FormEvent<HTMLInputElement>): void => {
    const input = event.nativeEvent as InputEvent
    event.preventDefault()
    if (input.inputType === 'deleteContentBackward') return tap(SPECIAL.Backspace)
    if (input.inputType === 'insertLineBreak' || input.inputType === 'insertParagraph') return tap(SPECIAL.Enter)
    for (const char of input.data ?? '') tap(keysym(char))
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const special = SPECIAL[event.key]
    if (special === undefined) return
    event.preventDefault()
    tap(special)
  }

  if (!enabled) {
    return (
      <div className="screen-off">
        <Monitor size={32} />
        <h2>Screen sharing is off</h2>
        <p>
          On the computer open <strong>Settings &gt; Remote Access</strong> and turn on <strong>Share the screen</strong>.
          It needs a VNC server running on {computer || 'the computer'}; the setting explains how to install one.
        </p>
      </div>
    )
  }

  return (
    <div className={`screen-view${immersive ? ' immersive' : ''}`}>
      <div className="screen-canvas" ref={holder} />
      {state !== 'on' && (
        <div className="screen-overlay">
          {state === 'password' ? (
            <form
              className="screen-password"
              onSubmit={(e) => {
                e.preventDefault()
                sendPassword()
              }}
            >
              <label htmlFor="vnc-password">Password of the VNC server on {computer || 'the computer'}</label>
              <input
                id="vnc-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="btn primary" type="submit" disabled={!password}>Unlock</button>
            </form>
          ) : (
            <>
              <Monitor size={32} />
              <p>{state === 'connecting' ? 'Opening the screen...' : error ?? `See and control ${computer || 'the computer'} from here.`}</p>
              {state !== 'connecting' && (
                <button className="btn primary" onClick={() => void connect()}>Connect to the screen</button>
              )}
            </>
          )}
        </div>
      )}
      {state === 'on' && (
        <div className="screen-bar">
          <button
            className={typing ? 'btn active' : 'btn'}
            aria-label="Keyboard"
            aria-pressed={typing}
            title={typing ? 'Keyboard stays open - tap to close it' : 'Type on the computer'}
            onClick={() => {
              if (typing) keys.current?.blur()
              else keys.current?.focus()
              setTyping(!typing)
            }}
          >
            <Keyboard size={18} />
          </button>
          <button className="btn" onClick={() => rfb.current?.sendCtrlAltDel()}>Ctrl+Alt+Del</button>
          <button
            className={viewOnly ? 'btn active' : 'btn'}
            onClick={() => setViewOnly(!viewOnly)}
            aria-pressed={viewOnly}
            aria-label="Watch only"
            title={viewOnly ? 'Watching only - tap to control again' : 'Control is on - tap to watch only'}
          >
            <MousePointer2 size={18} />
          </button>
          <button className="btn" onClick={() => setImmersive(!immersive)} aria-label={immersive ? 'Show the app bars' : 'Full screen'}>
            {immersive ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            className="btn"
            onClick={() => {
              disconnect()
              toast('Screen closed.')
            }}
            aria-label="Close the screen"
          >
            <Power size={18} />
          </button>
          {/* Off-screen, but focusable: tapping Keyboard opens the phone keyboard on it. */}
          <input
            ref={keys}
            className="screen-keys"
            aria-label="Keys for the computer"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value=""
            onChange={() => undefined}
            onBeforeInput={onBeforeInput}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
    </div>
  )
}
