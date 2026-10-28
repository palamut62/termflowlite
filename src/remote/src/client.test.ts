import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteClient } from './client'

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: { t: string; id?: number; method?: string }[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    this.readyState = 3
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  receive(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

const listeners: Record<string, () => void> = {}
const target = { addEventListener: (name: string, fn: () => void) => { listeners[name] = fn }, removeEventListener: () => undefined }

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('location', { protocol: 'http:', host: '100.64.0.1:47321' })
  vi.stubGlobal('document', { ...target, visibilityState: 'visible' })
  vi.stubGlobal('window', target)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function connect(): { client: RemoteClient; ws: FakeSocket } {
  const client = new RemoteClient('t'.repeat(32))
  client.start()
  const ws = FakeSocket.all.at(-1)!
  ws.open()
  ws.receive({ t: 'hello' })
  return { client, ws }
}

describe('RemoteClient reconnect', () => {
  it('notices a desktop that went silent and dials again', () => {
    const { client, ws } = connect()
    expect(client.state).toBe('online')
    vi.advanceTimersByTime(10_000)
    expect(ws.sent.some((m) => m.method === 'ping')).toBe(true)
    vi.advanceTimersByTime(20_000)
    expect(client.state).not.toBe('online')
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.all.length).toBe(2)
    client.stop()
  })

  it('stays online while the desktop answers pings', () => {
    const { client, ws } = connect()
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(10_000)
      const ping = ws.sent.filter((m) => m.method === 'ping').at(-1)!
      ws.receive({ t: 'result', id: ping.id, ok: true, value: true })
    }
    expect(client.state).toBe('online')
    expect(FakeSocket.all.length).toBe(1)
    client.stop()
  })

  it('gives up a connection attempt that never completes', () => {
    const client = new RemoteClient('t'.repeat(32))
    client.start()
    vi.advanceTimersByTime(10_000)
    expect(client.state).toBe('offline')
    vi.advanceTimersByTime(500)
    expect(FakeSocket.all.length).toBe(2)
    client.stop()
  })

  it('checks a stale-looking socket when the app comes back', () => {
    const { client } = connect()
    vi.advanceTimersByTime(1_000)
    listeners.visibilitychange()
    vi.advanceTimersByTime(5_000)
    expect(client.state).not.toBe('online')
    client.stop()
  })
})
