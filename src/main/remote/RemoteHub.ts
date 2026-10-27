import type { AppSettings, ElevationStatus, PtyEvent, ShellInfo } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import {
  isValidTabId,
  parseClientMessage,
  type RemoteSettingsView,
  type RemoteTabCommand,
  type RemoteTabsState,
  type ServerMessage
} from '../../shared/remote'
import type { DeviceStore, PairedDevice } from './devices'

/**
 * Main-process channels a phone may call. Everything that opens native
 * dialogs, touches the desktop window or clipboard, or launches desktop apps
 * is left out on purpose.
 */
export const REMOTE_IPC_CHANNELS: ReadonlySet<string> = new Set([
  IPC.SHELLS_DISCOVER,
  IPC.SETTINGS_GET,
  IPC.SETTINGS_SET,
  IPC.PROVIDER_SECRET_STATUS,
  IPC.PROVIDER_SECRET_HEALTH,
  IPC.PROVIDER_SECRET_SET,
  IPC.PROVIDER_SECRET_DELETE,
  IPC.PROFILE_HEALTH,
  IPC.GIT_STATUS,
  // Read-only uncommitted diff: review an agent's changes on the phone.
  IPC.SCM_DIFF,
  IPC.WORKTREE_REPO_INFO,
  IPC.WORKTREE_LIST,
  IPC.WORKTREE_CREATE,
  IPC.WORKTREE_REMOVE,
  IPC.GITHUB_STATUS,
  IPC.GITHUB_REPOS,
  IPC.GITHUB_CURRENT_REPO,
  IPC.GITHUB_PULL_REQUESTS,
  IPC.FILES_LIST,
  IPC.TASKS_DISCOVER,
  IPC.PROJECT_DETECT,
  IPC.AGENT_SESSIONS_LIST,
  IPC.AGENT_SESSION_WARNINGS,
  IPC.MEMORY_STATUS,
  IPC.MEMORY_RUN,
  IPC.MEMORY_PROJECTS,
  IPC.MEMORY_PROJECT,
  IPC.MEMORY_FORGET,
  IPC.MEMORY_CLEAR,
  IPC.MEMORY_CONNECTIONS,
  IPC.MEMORY_CONNECT,
  IPC.MEMORY_DISCONNECT,
  IPC.MEMORY_MODELS,
  IPC.MEMORY_TEST_MODEL,
  IPC.AGENT_EVENTS_LIST,
  IPC.UPDATE_CHECK,
  // Phone home screen (Orca): agent limits and GitHub tasks, both read-only.
  IPC.USAGE_GET,
  IPC.GITHUB_TASKS
])

/** Settings a phone may not change: it would lock itself out or ship desktop-only data. */
const DESKTOP_ONLY_SETTINGS: (keyof AppSettings)[] = ['remote', 'asciiBackgrounds', 'windowWidth', 'windowHeight', 'widgetX', 'widgetY']

/** Snapshot sent when a phone opens a tab; older output stays on the desktop. */
const SNAPSHOT_MAX_CHARS = 512 * 1024
const AUTH_TIMEOUT_MS = 10_000
const FLUSH_MS = 16
/** Above this much unsent data the tab is resynced with a snapshot instead. */
const STALL_BYTES = 4 * 1024 * 1024
const RESUME_BYTES = 512 * 1024

/** One phone connection as the hub sees it (a WebSocket in production). */
export interface RemoteConnection {
  send(message: ServerMessage): void
  close(code?: number, reason?: string): void
  /** Bytes queued but not yet written to the socket. */
  bufferedAmount(): number
}

export interface RemoteTerminals {
  onOutput(listener: (event: PtyEvent) => void): () => void
  setRemoteSize(id: string, size: { cols: number; rows: number } | null): void
  write(id: string, data: string): void
  getBuffer(id: string): string
  size(id: string): { cols: number; rows: number } | null
  onSizeChange(listener: (id: string, size: { cols: number; rows: number }) => void): () => void
}

export interface RemoteHubDeps {
  terminals: RemoteTerminals
  devices: Pick<DeviceStore, 'authenticate' | 'touch' | 'revoke'>
  invokeIpc(channel: string, args: unknown[]): Promise<unknown>
  getSettings(): AppSettings
  getShells(): Promise<ShellInfo[]>
  /** Run a tab command in the desktop renderer and wait for its answer. */
  runTabCommand(command: RemoteTabCommand): Promise<unknown>
  /** A phone changed settings: the desktop renderer must pick them up. */
  onRemoteSettings(settings: AppSettings): void
  /** Connected device count changed. */
  onClientsChanged(): void
  platform: string
  version: string
  home: string
  computer?: string
  /** Administrator tabs approved with a PIN (src/main/terminal/elevation.ts). */
  elevation?: { status(): Promise<ElevationStatus>; grant(pin: string): void }
}

interface Client {
  conn: RemoteConnection
  device: PairedDevice | null
  authTimer: NodeJS.Timeout | null
  /** Subscribed tabs, the phone's own size and whether it takes over the PTY size (fit). */
  subs: Map<string, { cols: number; rows: number; fit: boolean }>
  pending: Map<string, string>
  pendingBytes: number
  flushTimer: NodeJS.Timeout | null
  stalled: Set<string>
}

export function settingsView(settings: AppSettings): RemoteSettingsView {
  const { asciiBackgrounds: _pictures, ...rest } = settings
  return rest
}

function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings')
  const clean = { ...(patch as Partial<AppSettings>) }
  for (const key of DESKTOP_ONLY_SETTINGS) delete clean[key]
  return clean
}

/** Last `max` characters of the scrollback, cut at a line start when possible. */
export function tailSnapshot(buffer: string, max = SNAPSHOT_MAX_CHARS): string {
  if (buffer.length <= max) return buffer
  const tail = buffer.slice(-max)
  const newline = tail.indexOf('\n')
  return newline >= 0 && newline < 4096 ? tail.slice(newline + 1) : tail
}

/**
 * Transport-agnostic heart of Remote Access: authenticates phones, mirrors
 * the desktop tabs and settings to them, streams terminal output, arbitrates
 * PTY size and runs their calls against the allow-listed IPC handlers.
 */
export class RemoteHub {
  private clients = new Set<Client>()
  private tabs: RemoteTabsState = { tabs: [], activeTabId: null }
  /** Which client currently dictates each tab's PTY size. */
  private sizeOwner = new Map<string, Client>()
  private offOutput: () => void
  private offSize: () => void

  constructor(private readonly deps: RemoteHubDeps) {
    this.offOutput = deps.terminals.onOutput((event) => this.onOutput(event))
    this.offSize = deps.terminals.onSizeChange((tabId, size) => {
      for (const client of this.clients) {
        if (client.device && client.subs.get(tabId)?.fit === false) client.conn.send({ t: 'size', tabId, ...size })
      }
    })
  }

  dispose(): void {
    this.offOutput()
    this.offSize()
    for (const client of [...this.clients]) client.conn.close(1001, 'Server stopped')
    this.clients.clear()
  }

  connect(conn: RemoteConnection): (raw: string) => void {
    const client: Client = { conn, device: null, authTimer: null, subs: new Map(), pending: new Map(), pendingBytes: 0, flushTimer: null, stalled: new Set() }
    client.authTimer = setTimeout(() => conn.close(4401, 'Authentication timeout'), AUTH_TIMEOUT_MS)
    this.clients.add(client)
    return (raw) => {
      void this.onMessage(client, raw).catch((error) => console.warn('[remote] message failed:', error))
    }
  }

  disconnect(conn: RemoteConnection): void {
    const client = [...this.clients].find((c) => c.conn === conn)
    if (!client) return
    this.clients.delete(client)
    if (client.authTimer) clearTimeout(client.authTimer)
    if (client.flushTimer) clearTimeout(client.flushTimer)
    for (const tabId of client.subs.keys()) this.releaseSize(client, tabId)
    if (client.device) this.deps.onClientsChanged()
  }

  /** Distinct paired devices with a live connection. */
  connectedDeviceIds(): Set<string> {
    return new Set([...this.clients].flatMap((c) => (c.device ? [c.device.id] : [])))
  }

  /** The desktop revoked a device: drop its sockets right away. */
  revokeDevice(deviceId: string | null): void {
    for (const client of [...this.clients]) {
      if (!client.device || (deviceId !== null && client.device.id !== deviceId)) continue
      client.conn.send({ t: 'revoked' })
      client.conn.close(4403, 'Device disconnected')
      this.disconnect(client.conn)
    }
  }

  setTabs(state: RemoteTabsState): void {
    this.tabs = state
    const ids = new Set(state.tabs.map((t) => t.id))
    for (const client of this.clients) {
      for (const tabId of [...client.subs.keys()]) {
        if (ids.has(tabId)) continue
        client.subs.delete(tabId)
        this.releaseSize(client, tabId)
      }
    }
    this.broadcast({ t: 'tabs', ...state })
  }

  settingsChanged(settings: AppSettings): void {
    this.broadcast({ t: 'settings', settings: settingsView(settings) })
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients) if (client.device) client.conn.send(message)
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    const message = parseClientMessage(raw)
    if (!message) return
    if (!client.device) {
      if (message.t !== 'auth') return
      const device = this.deps.devices.authenticate(message.token)
      if (!device) {
        client.conn.send({ t: 'revoked' })
        client.conn.close(4401, 'Unknown device')
        return
      }
      client.device = device
      if (client.authTimer) clearTimeout(client.authTimer)
      client.authTimer = null
      const shells = await this.deps.getShells().catch(() => [] as ShellInfo[])
      client.conn.send({
        t: 'hello',
        device: { id: device.id, name: device.name },
        ...this.tabs,
        settings: settingsView(this.deps.getSettings()),
        shells,
        platform: this.deps.platform,
        version: this.deps.version,
        home: this.deps.home,
        computer: this.deps.computer
      })
      this.deps.onClientsChanged()
      return
    }
    this.deps.devices.touch(client.device.id)
    switch (message.t) {
      case 'auth':
        return
      case 'sub': {
        if (!this.knownTab(message.tabId)) return
        const size = { cols: message.cols, rows: message.rows }
        const before = this.deps.terminals.size(message.tabId)
        client.subs.set(message.tabId, { ...size, fit: message.fit })
        client.pending.delete(message.tabId)
        client.stalled.delete(message.tabId)
        // Mirroring (the default) leaves the desktop alone; only "fit to phone" resizes the PTY.
        if (message.fit) this.takeSize(client, message.tabId, size)
        else this.releaseSize(client, message.tabId)
        const repaint = message.fit && !!before && (before.cols !== size.cols || before.rows !== size.rows)
        const now = this.deps.terminals.size(message.tabId)
        client.conn.send({ t: 'snapshot', tabId: message.tabId, data: tailSnapshot(this.deps.terminals.getBuffer(message.tabId)), repaint, ...(now ?? {}) })
        return
      }
      case 'unsub':
        if (client.subs.delete(message.tabId)) this.releaseSize(client, message.tabId)
        client.pending.delete(message.tabId)
        return
      case 'resize': {
        const sub = client.subs.get(message.tabId)
        if (!sub?.fit) return
        const size = { cols: message.cols, rows: message.rows }
        client.subs.set(message.tabId, { ...size, fit: true })
        this.takeSize(client, message.tabId, size)
        return
      }
      case 'input':
        if (this.knownTab(message.tabId)) this.deps.terminals.write(message.tabId, message.data)
        return
      case 'call': {
        try {
          const value = await this.call(client, message.method, message.params)
          client.conn.send({ t: 'result', id: message.id, ok: true, value })
        } catch (error) {
          client.conn.send({ t: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : 'Request failed' })
        }
      }
    }
  }

  private knownTab(tabId: string): boolean {
    return this.tabs.tabs.some((t) => t.id === tabId)
  }

  private async call(client: Client, method: string, params: unknown): Promise<unknown> {
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
    switch (method) {
      case 'ipc': {
        const channel = p.channel
        const args = Array.isArray(p.args) ? p.args : []
        if (typeof channel !== 'string' || !REMOTE_IPC_CHANNELS.has(channel)) throw new Error('Not available remotely')
        if (channel === IPC.SETTINGS_GET) return settingsView(this.deps.getSettings())
        if (channel === IPC.SETTINGS_SET) {
          const next = await this.deps.invokeIpc(channel, [sanitizeSettingsPatch(args[0])]) as AppSettings
          this.deps.onRemoteSettings(next)
          return settingsView(next)
        }
        return await this.deps.invokeIpc(channel, args)
      }
      case 'tab.open': {
        const elevated = p.elevated === true
        if (elevated) {
          if (!this.deps.elevation || await this.deps.elevation.status() !== 'on') throw new Error('Turn on administrator tabs on the PC first (Settings > Remote).')
          // The elevated host checks the PIN itself; a wrong one is printed in the tab.
          this.deps.elevation.grant(requireString(p.pin, 'PIN'))
        }
        return this.openedAtPhoneSize(client, p, await this.deps.runTabCommand({
          kind: 'open',
          profileId: requireString(p.profileId, 'profile'),
          cwd: optionalString(p.cwd),
          launchCommand: optionalString(p.launchCommand),
          permissionMode: permission(p.permissionMode),
          ...(elevated ? { elevated } : {})
        }))
      }
      case 'ping':
        return true
      case 'elevation.status':
        return this.deps.elevation ? await this.deps.elevation.status() : 'unsupported'
      case 'tab.close':
        return await this.deps.runTabCommand({ kind: 'close', tabId: requireTab(p.tabId) })
      case 'tab.rename':
        return await this.deps.runTabCommand({ kind: 'rename', tabId: requireTab(p.tabId), title: requireString(p.title, 'title').slice(0, 100) })
      case 'tab.focus':
        return await this.deps.runTabCommand({ kind: 'focus', tabId: requireTab(p.tabId) })
      case 'tab.restart':
        return await this.deps.runTabCommand({ kind: 'restart', tabId: requireTab(p.tabId) })
      case 'agent.resume': {
        const session = p.session as { agent?: unknown; id?: unknown } | undefined
        if (!session || !['claude', 'codex', 'opencode'].includes(session.agent as string) || typeof session.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(session.id)) {
          throw new Error('Invalid agent session')
        }
        return this.openedAtPhoneSize(client, p, await this.deps.runTabCommand({
          kind: 'resume',
          profileId: requireString(p.profileId, 'profile'),
          session: { agent: session.agent as 'claude' | 'codex' | 'opencode', id: session.id },
          cwd: optionalString(p.cwd),
          permissionMode: permission(p.permissionMode)
        }))
      }
      case 'saved.list':
        return await this.deps.runTabCommand({ kind: 'saved-list' })
      case 'saved.run':
        return this.openedAtPhoneSize(client, p, await this.deps.runTabCommand({ kind: 'saved-run', id: requireString(p.id, 'command') }))
      case 'device.forget': {
        const id = client.device!.id
        this.deps.devices.revoke(id)
        setTimeout(() => this.revokeDevice(id), 0)
        return true
      }
      default:
        throw new Error('Unknown method')
    }
  }

  /**
   * A tab opened from the phone is watched there right away: claim the phone's
   * size before its PTY spawns, so programs draw for the phone from the first
   * frame instead of being redrawn after a resize.
   */
  private openedAtPhoneSize(client: Client, params: Record<string, unknown>, tabId: unknown): unknown {
    const cols = params.cols
    const rows = params.rows
    if (!isValidTabId(tabId) || typeof cols !== 'number' || typeof rows !== 'number') return tabId
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 1000 || rows < 1 || rows > 500) return tabId
    client.subs.set(tabId, { cols, rows, fit: true })
    this.takeSize(client, tabId, { cols, rows })
    return tabId
  }

  // ---- PTY size arbitration: the last phone to view or resize a tab wins ----
  private takeSize(client: Client, tabId: string, size: { cols: number; rows: number }): void {
    this.sizeOwner.set(tabId, client)
    this.deps.terminals.setRemoteSize(tabId, size)
  }

  private releaseSize(client: Client, tabId: string): void {
    if (this.sizeOwner.get(tabId) !== client) return
    this.sizeOwner.delete(tabId)
    const next = [...this.clients].find((c) => c !== client && c.subs.get(tabId)?.fit)
    const nextSize = next?.subs.get(tabId)
    if (next && nextSize) this.takeSize(next, tabId, { cols: nextSize.cols, rows: nextSize.rows })
    else this.deps.terminals.setRemoteSize(tabId, null)
  }

  // ---- Output streaming with batching and backpressure ----
  private onOutput(event: PtyEvent): void {
    for (const client of this.clients) {
      if (!client.device || !client.subs.has(event.ptyId)) continue
      if (event.kind === 'exit') {
        this.flush(client)
        client.conn.send({ t: 'exit', tabId: event.ptyId, exitCode: event.exitCode })
        continue
      }
      if (event.kind !== 'data' || client.stalled.has(event.ptyId)) continue
      if (client.conn.bufferedAmount() > STALL_BYTES) {
        client.stalled.add(event.ptyId)
        client.pending.delete(event.ptyId)
        this.scheduleFlush(client)
        continue
      }
      client.pending.set(event.ptyId, (client.pending.get(event.ptyId) ?? '') + event.data)
      client.pendingBytes += event.data.length
      if (client.pendingBytes > STALL_BYTES) this.flush(client)
      else this.scheduleFlush(client)
    }
  }

  private scheduleFlush(client: Client): void {
    if (!client.flushTimer) client.flushTimer = setTimeout(() => this.flush(client), FLUSH_MS)
  }

  private flush(client: Client): void {
    if (client.flushTimer) clearTimeout(client.flushTimer)
    client.flushTimer = null
    for (const [tabId, data] of client.pending) client.conn.send({ t: 'data', tabId, data })
    client.pending.clear()
    client.pendingBytes = 0
    if (client.stalled.size === 0) return
    // A slow phone missed output: once its socket drains, resend a fresh tail.
    if (client.conn.bufferedAmount() > RESUME_BYTES) {
      client.flushTimer = setTimeout(() => this.flush(client), 250)
      return
    }
    for (const tabId of client.stalled) {
      if (client.subs.has(tabId)) client.conn.send({ t: 'snapshot', tabId, data: tailSnapshot(this.deps.terminals.getBuffer(tabId)) })
    }
    client.stalled.clear()
  }
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.includes('\0')) throw new Error(`Invalid ${what}`)
  return value
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 8192 || value.includes('\0')) throw new Error('Invalid value')
  return value
}

function requireTab(value: unknown): string {
  if (!isValidTabId(value)) throw new Error('Invalid tab')
  return value
}

function permission(value: unknown): 'safe' | 'workspace' | 'full' | undefined {
  return value === 'safe' || value === 'workspace' || value === 'full' ? value : undefined
}
