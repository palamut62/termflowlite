import type { ClientMessage, ServerMessage } from '../../shared/remote'

const TOKEN_KEY = 'termflow.remote.token'
const CALL_TIMEOUT_MS = 30_000
/** A socket that has not said hello by then is given up and retried. */
const CONNECT_TIMEOUT_MS = 10_000
/** Browsers hide WebSocket pings, so the client asks the desktop itself. */
const HEARTBEAT_MS = 10_000
/** Silence this long means the desktop vanished (power off, network drop). */
const DEAD_AFTER_MS = 25_000
/** After returning to the app, the desktop must answer a ping this fast. */
const RESUME_CHECK_MS = 5_000

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'revoked'

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode: the session lasts until the tab closes */
  }
}

/** A readable device name for the desktop's device list. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua)
  if (android?.[1] && !/^(K|wv)$/.test(android[1].trim())) return android[1].trim()
  if (/Android/.test(ua)) return 'Android phone'
  return 'Browser'
}

/** Exchange the one-time QR code for a device token. */
export async function pairWithCode(code: string): Promise<string> {
  const res = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name: guessDeviceName() })
  })
  const body = await res.json().catch(() => ({})) as { token?: string; error?: string }
  if (!res.ok || !body.token) throw new Error(body.error || 'Pairing failed.')
  return body.token
}

/** Send one file to the computer; resolves with its path there. */
export async function uploadFile(file: File): Promise<string> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loadToken() ?? ''}`, 'X-File-Name': encodeURIComponent(file.name) },
    body: file
  })
  const body = await res.json().catch(() => ({})) as { path?: string; error?: string }
  if (!res.ok || !body.path) throw new Error(body.error || 'Upload failed.')
  return body.path
}

/**
 * One-time ticket for the screen socket (`/vnc`): a WebSocket upgrade carries no
 * Authorization header, so the device key is spent here for a short-lived ticket.
 */
export async function screenTicket(): Promise<string> {
  const res = await fetch('/api/screen-ticket', { method: 'POST', headers: { Authorization: `Bearer ${loadToken() ?? ''}` } })
  const body = await res.json().catch(() => ({})) as { ticket?: string; error?: string }
  if (!res.ok || !body.ticket) throw new Error(body.error || 'The computer did not allow the screen.')
  return body.ticket
}

type Listener = (message: ServerMessage) => void

/**
 * One authenticated WebSocket to the desktop with automatic reconnect.
 * Pending calls fail when the socket drops; listeners see every server frame.
 */
export class RemoteClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private calls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private listeners = new Set<Listener>()
  private stateListeners = new Set<(state: ConnectionState) => void>()
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastSeen = 0
  private stopped = false
  state: ConnectionState = 'connecting'

  constructor(private readonly token: string) {}

  start(): void {
    this.stopped = false
    this.open()
    document.addEventListener('visibilitychange', this.onVisible)
    window.addEventListener('online', this.onVisible)
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.clearTimers()
    document.removeEventListener('visibilitychange', this.onVisible)
    window.removeEventListener('online', this.onVisible)
    this.ws?.close()
  }

  /**
   * Coming back to the app (or the network) should not wait for the backoff
   * timer, and a socket that looks online may be dead after a long sleep.
   */
  private onVisible = (): void => {
    if (document.visibilityState !== 'visible' || this.stopped || this.state === 'revoked') return
    if (this.state === 'online' && this.ws) {
      const ws = this.ws
      const sentAt = Date.now()
      this.ping()
      setTimeout(() => {
        if (this.ws === ws && this.lastSeen < sentAt) this.drop(ws)
      }, RESUME_CHECK_MS)
      return
    }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retry = 0
    if (this.ws) this.drop(this.ws, false)
    this.open()
  }

  private ping(): void {
    this.call('ping').catch(() => undefined)
  }

  private clearTimers(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.connectTimer = null
    this.heartbeatTimer = null
  }

  /** Abandon a socket and (unless told not to) schedule the next attempt. */
  private drop(ws: WebSocket, retry = true): void {
    if (this.ws !== ws) return
    this.ws = null
    this.clearTimers()
    ws.onopen = ws.onmessage = ws.onclose = null
    try {
      ws.close()
    } catch {
      /* already closed */
    }
    for (const [, call] of this.calls) {
      clearTimeout(call.timer)
      call.reject(new Error('Connection lost'))
    }
    this.calls.clear()
    if (this.state === 'revoked' || this.stopped) return
    this.setState('offline')
    if (!retry) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const delay = Math.min(15_000, 500 * 2 ** this.retry++)
    this.retryTimer = setTimeout(() => this.open(), delay)
  }

  private setState(state: ConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }

  private open(): void {
    if (this.stopped || this.state === 'revoked') return
    this.setState('connecting')
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    this.ws = ws
    this.clearTimers()
    this.connectTimer = setTimeout(() => this.drop(ws), CONNECT_TIMEOUT_MS)
    ws.onopen = () => this.sendRaw({ t: 'auth', token: this.token })
    ws.onmessage = (event) => {
      this.lastSeen = Date.now()
      let message: ServerMessage
      try {
        message = JSON.parse(event.data as string) as ServerMessage
      } catch {
        return
      }
      if (message.t === 'hello') {
        this.retry = 0
        if (this.connectTimer) clearTimeout(this.connectTimer)
        this.connectTimer = null
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = setInterval(() => {
          if (Date.now() - this.lastSeen > DEAD_AFTER_MS) this.drop(ws)
          else this.ping()
        }, HEARTBEAT_MS)
        this.setState('online')
      }
      if (message.t === 'revoked') {
        saveToken(null)
        this.setState('revoked')
      }
      if (message.t === 'result') {
        const call = this.calls.get(message.id)
        if (call) {
          this.calls.delete(message.id)
          clearTimeout(call.timer)
          if (message.ok) call.resolve(message.value)
          else call.reject(new Error(message.error || 'Request failed'))
        }
        return
      }
      for (const listener of this.listeners) listener(message)
    }
    ws.onclose = () => this.drop(ws)
  }

  private sendRaw(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(message))
    return true
  }

  /** Fire-and-forget frames (input, sub, resize); dropped while offline. */
  send(message: Exclude<ClientMessage, { t: 'auth' } | { t: 'call' }>): boolean {
    return this.state === 'online' && this.sendRaw(message)
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      if (this.state !== 'online' || !this.sendRaw({ t: 'call', id, method, params })) {
        reject(new Error('Not connected to the desktop.'))
        return
      }
      const timer = setTimeout(() => {
        this.calls.delete(id)
        reject(new Error('The desktop did not answer.'))
      }, CALL_TIMEOUT_MS)
      this.calls.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    })
  }

  /** Call one of the desktop's allow-listed IPC handlers. */
  ipc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    return this.call<T>('ipc', { channel, args })
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }
}
