// Remote Access protocol (docs/remote-access.md). Shared by the main process
// and the phone client in src/remote/.

import type { AgentPermissionMode, AgentSessionRef, AppSettings, ShellInfo, TabActivity, TabWorktree } from './types'

/** The slice of a desktop tab the phone needs; never carries env or secrets. */
export interface RemoteTab {
  id: string
  title: string
  profileId: string
  running: boolean
  activity: TabActivity
  cwd?: string
  model?: string
  permissionMode?: AgentPermissionMode
  worktree?: TabWorktree
  /** Shown in a desktop split pane right now. */
  visible: boolean
}

export interface RemoteTabsState {
  tabs: RemoteTab[]
  activeTabId: string | null
}

/** Settings as sent to a phone: large picture data stays on the desktop. */
export type RemoteSettingsView = Omit<AppSettings, 'asciiBackgrounds'>

export interface RemoteDeviceInfo {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  connected: boolean
}

export type RemoteServerState = 'off' | 'starting' | 'running' | 'no-tailscale' | 'error'

export interface RemoteStatus {
  state: RemoteServerState
  /** http://100.x.y.z:port when running. */
  url: string | null
  error: string | null
  connectedDevices: number
  /** When a phone last paired or renewed its key (closes the QR on the desktop). */
  lastPairedAt: number | null
}

export interface RemotePairing {
  url: string
  /** The same one-time code, for typing on the phone ("7KQ2M-X9HDA"). */
  code: string
  /** Set when the code renews this paired device. */
  deviceId?: string
  /** QR code of `url` as an SVG string. */
  svg: string
  expiresAt: number
}

/** A saved command as listed on the phone. */
export interface RemoteSavedCommand {
  id: string
  name: string
  command: string
  profileId?: string
  cwd?: string
}

// ---- Tab commands relayed to the desktop renderer ----
export type RemoteTabCommand =
  | { kind: 'open'; profileId: string; cwd?: string; launchCommand?: string; permissionMode?: AgentPermissionMode; elevated?: boolean }
  | { kind: 'close'; tabId: string }
  | { kind: 'rename'; tabId: string; title: string }
  | { kind: 'focus'; tabId: string }
  | { kind: 'restart'; tabId: string }
  | { kind: 'resume'; profileId: string; session: AgentSessionRef; cwd?: string; permissionMode?: AgentPermissionMode }
  | { kind: 'saved-list' }
  | { kind: 'saved-run'; id: string }

export interface RemoteCommandRequest {
  requestId: string
  command: RemoteTabCommand
}

export interface RemoteCommandReply {
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

// ---- Wire messages ----
export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'call'; id: number; method: string; params?: unknown }
  /** fit: the phone takes over the PTY size; otherwise it mirrors the desktop size. */
  | { t: 'sub'; tabId: string; cols: number; rows: number; fit: boolean }
  | { t: 'unsub'; tabId: string }
  | { t: 'input'; tabId: string; data: string }
  | { t: 'resize'; tabId: string; cols: number; rows: number }

export interface HelloPayload extends RemoteTabsState {
  device: { id: string; name: string }
  settings: RemoteSettingsView
  shells: ShellInfo[]
  platform: string
  version: string
  /** The computer's home folder, the fallback place to browse from. */
  home: string
  /** The computer's name (hostname), shown on the phone home screen. */
  computer?: string
}

export type ServerMessage =
  | ({ t: 'hello' } & HelloPayload)
  | { t: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  | ({ t: 'tabs' } & RemoteTabsState)
  | { t: 'settings'; settings: RemoteSettingsView }
  /** repaint: the PTY was just resized for this phone and a full repaint follows (ConPTY). */
  | { t: 'snapshot'; tabId: string; data: string; repaint?: boolean; cols?: number; rows?: number }
  /** The PTY size changed (desktop window resized); mirroring phones follow it. */
  | { t: 'size'; tabId: string; cols: number; rows: number }
  | { t: 'data'; tabId: string; data: string }
  | { t: 'exit'; tabId: string; exitCode: number }
  | { t: 'revoked' }

/** Largest WebSocket frame the server accepts from a phone. */
export const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024

const TAB_ID = /^[A-Za-z0-9_-]{1,100}$/
const METHOD = /^[a-z][a-zA-Z.-]{0,40}$/

function size(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

/** Parse and validate one client frame; anything malformed is null. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  switch (m.t) {
    case 'auth':
      return typeof m.token === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(m.token) ? { t: 'auth', token: m.token } : null
    case 'call':
      return typeof m.id === 'number' && Number.isInteger(m.id) && typeof m.method === 'string' && METHOD.test(m.method)
        ? { t: 'call', id: m.id, method: m.method, params: m.params }
        : null
    case 'sub':
    case 'resize': {
      const cols = size(m.cols, 2, 1000)
      const rows = size(m.rows, 1, 500)
      if (typeof m.tabId !== 'string' || !TAB_ID.test(m.tabId) || cols === null || rows === null) return null
      return m.t === 'sub' ? { t: 'sub', tabId: m.tabId, cols, rows, fit: m.fit === true } : { t: 'resize', tabId: m.tabId, cols, rows }
    }
    case 'unsub':
      return typeof m.tabId === 'string' && TAB_ID.test(m.tabId) ? { t: 'unsub', tabId: m.tabId } : null
    case 'input':
      return typeof m.tabId === 'string' && TAB_ID.test(m.tabId) && typeof m.data === 'string' && m.data.length > 0 && m.data.length <= 64 * 1024
        ? { t: 'input', tabId: m.tabId, data: m.data }
        : null
    default:
      return null
  }
}

export function isValidTabId(value: unknown): value is string {
  return typeof value === 'string' && TAB_ID.test(value)
}
