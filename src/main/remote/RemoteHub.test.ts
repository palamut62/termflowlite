import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings, type ElevationStatus, type PtyEvent } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import type { RemoteTabCommand, ServerMessage } from '../../shared/remote'
import { RemoteHub, tailSnapshot, type RemoteConnection } from './RemoteHub'

const TOKEN = 'a'.repeat(43)

function setup(elevation?: { status(): Promise<ElevationStatus>; grant(pin: string): void }) {
  let output: (event: PtyEvent) => void = () => undefined
  let sizeChange: (id: string, size: { cols: number; rows: number }) => void = () => undefined
  const sizes: [string, { cols: number; rows: number } | null][] = []
  const writes: [string, string][] = []
  const commands: RemoteTabCommand[] = []
  const ipcCalls: [string, unknown[]][] = []
  const remoteSettings: AppSettings[] = []
  const revoked: string[] = []
  const termSizes = new Map<string, { cols: number; rows: number }>([['tab1', { cols: 120, rows: 30 }]])
  let settings: AppSettings = { ...DEFAULT_SETTINGS, asciiBackgrounds: { x: { image: 'data:', density: 1, opacity: 1, charset: 'a' } as never } }
  const hub = new RemoteHub({
    terminals: {
      onOutput: (listener) => { output = listener; return () => undefined },
      setRemoteSize: (id, size) => { sizes.push([id, size]); if (size) termSizes.set(id, size) },
      write: (id, data) => { writes.push([id, data]) },
      getBuffer: (id) => `history of ${id}`,
      size: (id) => termSizes.get(id) ?? null,
      onSizeChange: (listener) => { sizeChange = listener; return () => undefined }
    },
    devices: {
      authenticate: (token) => (token === TOKEN ? { id: 'dev1', name: 'Pixel', createdAt: 0, lastSeenAt: 0 } : null),
      touch: () => undefined,
      revoke: (id) => { revoked.push(id); return true }
    },
    invokeIpc: async (channel, args) => {
      ipcCalls.push([channel, args])
      if (channel === IPC.SETTINGS_SET) {
        settings = { ...settings, ...(args[0] as Partial<AppSettings>) }
        return settings
      }
      return `result:${channel}`
    },
    getSettings: () => settings,
    getShells: async () => [],
    runTabCommand: async (command) => { commands.push(command); return command.kind === 'open' ? 'newtab' : true },
    onRemoteSettings: (next) => remoteSettings.push(next),
    onClientsChanged: () => undefined,
    platform: 'win32',
    version: '1.0.0',
    home: '/home/me',
    elevation
  })
  hub.setTabs({ tabs: [{ id: 'tab1', title: 'pwsh', profileId: 'pwsh', running: true, activity: 'running', visible: true }], activeTabId: 'tab1' })

  function phone() {
    const sent: ServerMessage[] = []
    let closed: number | undefined
    let buffered = 0
    const conn: RemoteConnection = {
      send: (m) => sent.push(m),
      close: (code) => { closed = code },
      bufferedAmount: () => buffered
    }
    const receive = hub.connect(conn)
    const send = async (message: object): Promise<void> => {
      receive(JSON.stringify(message))
      await vi.advanceTimersByTimeAsync(0)
    }
    return { conn, sent, send, closed: () => closed, setBuffered: (n: number) => { buffered = n } }
  }

  return { hub, phone, sizes, writes, commands, ipcCalls, remoteSettings, revoked, emit: (e: PtyEvent) => output(e), resizePty: (id: string, size: { cols: number; rows: number }) => { termSizes.set(id, size); sizeChange(id, size) } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('RemoteHub', () => {
  it('ignores everything until the phone authenticates', async () => {
    const { phone, writes } = setup()
    const p = phone()
    await p.send({ t: 'input', tabId: 'tab1', data: 'dir\r' })
    expect(writes).toEqual([])
    await p.send({ t: 'auth', token: TOKEN })
    expect(p.sent[0]).toMatchObject({ t: 'hello', device: { id: 'dev1' }, tabs: [{ id: 'tab1' }] })
    expect((p.sent[0] as { settings: object }).settings).not.toHaveProperty('asciiBackgrounds')
  })

  it('closes unknown devices and silent sockets', async () => {
    const { phone } = setup()
    const bad = phone()
    await bad.send({ t: 'auth', token: 'b'.repeat(43) })
    expect(bad.sent).toEqual([{ t: 'revoked' }])
    expect(bad.closed()).toBe(4401)
    const silent = phone()
    await vi.advanceTimersByTimeAsync(10_001)
    expect(silent.closed()).toBe(4401)
  })

  it('subscribes with a snapshot, takes the size and streams batched output', async () => {
    const { phone, sizes, emit } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: true })
    expect(sizes).toEqual([['tab1', { cols: 40, rows: 20 }]])
    expect(p.sent.at(-1)).toEqual({ t: 'snapshot', tabId: 'tab1', data: 'history of tab1', repaint: true, cols: 40, rows: 20 })
    emit({ kind: 'data', ptyId: 'tab1', data: 'a' })
    emit({ kind: 'data', ptyId: 'tab1', data: 'b' })
    emit({ kind: 'data', ptyId: 'other', data: 'x' })
    await vi.advanceTimersByTimeAsync(20)
    expect(p.sent.at(-1)).toEqual({ t: 'data', tabId: 'tab1', data: 'ab' })
    await p.send({ t: 'unsub', tabId: 'tab1' })
    expect(sizes.at(-1)).toEqual(['tab1', null])
  })

  it('hands the size to the remaining phone and releases it on disconnect', async () => {
    const { hub, phone, sizes } = setup()
    const a = phone()
    const b = phone()
    await a.send({ t: 'auth', token: TOKEN })
    await b.send({ t: 'auth', token: TOKEN })
    await a.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: true })
    await b.send({ t: 'sub', tabId: 'tab1', cols: 60, rows: 30, fit: true })
    hub.disconnect(b.conn)
    expect(sizes.at(-1)).toEqual(['tab1', { cols: 40, rows: 20 }])
    hub.disconnect(a.conn)
    expect(sizes.at(-1)).toEqual(['tab1', null])
  })

  it('a tab opened from the phone claims the phone size before its PTY spawns', async () => {
    const { phone, sizes } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 11, method: 'tab.open', params: { profileId: 'pwsh', cols: 44, rows: 22 } })
    expect(p.sent.at(-1)).toEqual({ t: 'result', id: 11, ok: true, value: 'newtab' })
    expect(sizes.at(-1)).toEqual(['newtab', { cols: 44, rows: 22 }])
  })

  it('asks for no repaint when the PTY already has the phone size', async () => {
    const { phone } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 120, rows: 30, fit: true })
    expect(p.sent.at(-1)).toMatchObject({ t: 'snapshot', repaint: false })
  })

  it('by default mirrors the desktop size and leaves the PTY alone', async () => {
    const { phone, sizes, resizePty } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: false })
    expect(sizes).toEqual([])
    expect(p.sent.at(-1)).toEqual({ t: 'snapshot', tabId: 'tab1', data: 'history of tab1', repaint: false, cols: 120, rows: 30 })
    // The phone cannot resize a mirrored tab, and follows desktop resizes.
    await p.send({ t: 'resize', tabId: 'tab1', cols: 30, rows: 10 })
    expect(sizes).toEqual([])
    resizePty('tab1', { cols: 150, rows: 40 })
    expect(p.sent.at(-1)).toEqual({ t: 'size', tabId: 'tab1', cols: 150, rows: 40 })
  })

  it('switching a tab from fit back to mirror gives the desktop its size back', async () => {
    const { phone, sizes } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: true })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: false })
    expect(sizes).toEqual([['tab1', { cols: 40, rows: 20 }], ['tab1', null]])
  })

  it('writes input only to known tabs', async () => {
    const { phone, writes } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'input', tabId: 'tab1', data: 'ls\r' })
    await p.send({ t: 'input', tabId: 'ghost', data: 'ls\r' })
    expect(writes).toEqual([['tab1', 'ls\r']])
  })

  it('allows only allow-listed IPC channels', async () => {
    const { phone, ipcCalls } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 1, method: 'ipc', params: { channel: IPC.GIT_STATUS, args: ['C:\\x'] } })
    await p.send({ t: 'call', id: 2, method: 'ipc', params: { channel: IPC.CLIPBOARD_READ, args: [] } })
    await p.send({ t: 'call', id: 3, method: 'ipc', params: { channel: IPC.DIALOG_OPEN_DIR, args: [] } })
    expect(ipcCalls).toEqual([[IPC.GIT_STATUS, ['C:\\x']]])
    expect(p.sent.slice(-3)).toEqual([
      { t: 'result', id: 1, ok: true, value: `result:${IPC.GIT_STATUS}` },
      { t: 'result', id: 2, ok: false, error: 'Not available remotely' },
      { t: 'result', id: 3, ok: false, error: 'Not available remotely' }
    ])
  })

  it('strips desktop-only fields from settings patches and notifies the desktop', async () => {
    const { phone, ipcCalls, remoteSettings } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 5, method: 'ipc', params: { channel: IPC.SETTINGS_SET, args: [{ fontSize: 16, remote: { enabled: false, port: 1 }, asciiBackgrounds: {} }] } })
    expect(ipcCalls).toEqual([[IPC.SETTINGS_SET, [{ fontSize: 16 }]]])
    expect(remoteSettings[0].fontSize).toBe(16)
    expect((p.sent.at(-1) as { value: object }).value).not.toHaveProperty('asciiBackgrounds')
  })

  it('relays validated tab commands to the desktop', async () => {
    const { phone, commands } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 7, method: 'tab.open', params: { profileId: 'pwsh', permissionMode: 'nope' } })
    await p.send({ t: 'call', id: 8, method: 'tab.close', params: { tabId: '../x' } })
    await p.send({ t: 'call', id: 9, method: 'agent.resume', params: { profileId: 'claude', session: { agent: 'claude', id: 'abc-1' } } })
    expect(commands).toEqual([
      { kind: 'open', profileId: 'pwsh', cwd: undefined, launchCommand: undefined, permissionMode: undefined },
      { kind: 'resume', profileId: 'claude', session: { agent: 'claude', id: 'abc-1' }, cwd: undefined, permissionMode: undefined }
    ])
    expect(p.sent.find((m) => m.t === 'result' && m.id === 8)).toMatchObject({ ok: false, error: 'Invalid tab' })
  })

  it('opens an administrator tab only when the PC set it up, passing the PIN on', async () => {
    const pins: string[] = []
    let status: ElevationStatus = 'off'
    const { phone, commands } = setup({ status: async () => status, grant: (pin) => { pins.push(pin) } })
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 1, method: 'tab.open', params: { profileId: 'pwsh', elevated: true, pin: '123456' } })
    expect(p.sent.at(-1)).toMatchObject({ t: 'result', id: 1, ok: false })
    status = 'on'
    await p.send({ t: 'call', id: 2, method: 'elevation.status' })
    expect(p.sent.at(-1)).toEqual({ t: 'result', id: 2, ok: true, value: 'on' })
    await p.send({ t: 'call', id: 3, method: 'tab.open', params: { profileId: 'pwsh', elevated: true, pin: '123456' } })
    expect(pins).toEqual(['123456'])
    expect(commands).toEqual([{ kind: 'open', profileId: 'pwsh', cwd: undefined, launchCommand: undefined, permissionMode: undefined, elevated: true }])
  })

  it('reports administrator tabs as unsupported without an elevation backend', async () => {
    const { phone, commands } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 1, method: 'elevation.status' })
    expect(p.sent.at(-1)).toEqual({ t: 'result', id: 1, ok: true, value: 'unsupported' })
    await p.send({ t: 'call', id: 2, method: 'tab.open', params: { profileId: 'pwsh', elevated: true, pin: '123456' } })
    expect(p.sent.at(-1)).toMatchObject({ ok: false })
    expect(commands).toEqual([])
  })

  it('revokes connected devices immediately', async () => {
    const { hub, phone } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    expect(hub.connectedDeviceIds()).toEqual(new Set(['dev1']))
    hub.revokeDevice('dev1')
    expect(p.sent.at(-1)).toEqual({ t: 'revoked' })
    expect(p.closed()).toBe(4403)
    expect(hub.connectedDeviceIds().size).toBe(0)
  })

  it('a phone can forget itself', async () => {
    const { phone, revoked } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'call', id: 4, method: 'device.forget' })
    await vi.advanceTimersByTimeAsync(1)
    expect(revoked).toEqual(['dev1'])
    expect(p.closed()).toBe(4403)
  })

  it('drops subscriptions of tabs closed on the desktop', async () => {
    const { hub, phone, sizes } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: true })
    hub.setTabs({ tabs: [], activeTabId: null })
    expect(sizes.at(-1)).toEqual(['tab1', null])
    expect(p.sent.at(-1)).toEqual({ t: 'tabs', tabs: [], activeTabId: null })
  })

  it('resyncs a stalled phone with a snapshot instead of queueing forever', async () => {
    const { phone, emit } = setup()
    const p = phone()
    await p.send({ t: 'auth', token: TOKEN })
    await p.send({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20, fit: true })
    p.setBuffered(5 * 1024 * 1024)
    emit({ kind: 'data', ptyId: 'tab1', data: 'lost' })
    p.setBuffered(0)
    await vi.advanceTimersByTimeAsync(20)
    expect(p.sent.at(-1)).toEqual({ t: 'snapshot', tabId: 'tab1', data: 'history of tab1' })
  })
})

describe('tailSnapshot', () => {
  it('keeps short buffers and cuts long ones at a line start', () => {
    expect(tailSnapshot('abc', 10)).toBe('abc')
    expect(tailSnapshot('line1\nline2\nline3', 9)).toBe('line3')
  })
})
