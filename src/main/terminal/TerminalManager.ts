import type { BrowserWindow } from 'electron'
import type { AgentPermissionMode, AgentSessionRef, AppSettings, CreateTerminalInput, PtyEvent, RenderMode, ShellInfo } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { PtyCore } from './PtyCore'
import { agentForProfile, mergeProfiles } from '../../shared/profiles'
import { profileToInput, resolveProfileId } from './profileResolver'
import { prepareLaunch } from './cli'
import type { HookLaunch } from '../agentHooks/hookServer'
import { effectiveClaudeStatusLine } from '../agentHooks/claudeStatusLine'

export function applyProviderSecret(
  input: CreateTerminalInput,
  resolvedId: string,
  settings: AppSettings,
  getSecret: (providerId: string) => string | undefined
): CreateTerminalInput {
  if (!resolvedId.startsWith('provider:')) return input
  const provider = settings.providerProfiles.find((item) => `provider:${item.id}` === resolvedId)
  const secret = provider ? getSecret(provider.id) : undefined
  if (!provider?.apiKeyEnv || !secret) return input
  return {
    ...input,
    env: { ...input.env, [provider.apiKeyEnv]: secret },
    secretEnvNames: [provider.apiKeyEnv]
  }
}

/**
 * PTY lifecycle owner (PRD §20). Wraps PtyCore and forwards its events to the
 * renderer over Electron IPC. The manager is transport-agnostic: the only
 * Electron touchpoint is the getWindow() sink used for event delivery.
 */
type CoreFactory = (emit: (event: PtyEvent) => void, tap: (id: string, data: string) => void) => PtyCore

type Size = { cols: number; rows: number }

export class TerminalManager {
  private core: PtyCore
  private shells: ShellInfo[] = []
  /** Remote viewers (phones): raw output plus exit/cwd, independent of the desktop render mode. */
  private outputListeners = new Set<(event: PtyEvent) => void>()
  /** Size a phone has taken over; while set, desktop resizes are only remembered. */
  private remoteSizes = new Map<string, Size>()
  /** Last size the desktop asked for, restored when the phone lets go. */
  private desktopSizes = new Map<string, Size>()
  /** Phones that mirror the desktop width follow every real PTY size change. */
  private sizeListeners = new Set<(id: string, size: Size) => void>()
  private reportedSizes = new Map<string, Size>()
  /** Ajan hook sunucusu (agent-hooks); hazir degilse ajanlar hook'suz baslar. */
  private hookLaunch: () => HookLaunch | null = () => null

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly getSettings: () => AppSettings,
    private readonly getProviderSecret: (providerId: string) => string | undefined = () => undefined,
    private readonly onAgentLaunch: (record: { agent: AgentSessionRef['agent']; profileId: string; cwd?: string; startedAt: number; resumeSession?: AgentSessionRef }) => void = () => undefined,
    createCore: CoreFactory = (emit, tap) => new PtyCore(emit, tap)
  ) {
    this.core = createCore(
      (event) => this.handleEvent(event),
      (ptyId, data) => this.notify({ kind: 'data', ptyId, data })
    )
  }

  /** Subscribe to every terminal's output; returns the unsubscribe function. */
  onOutput(listener: (event: PtyEvent) => void): () => void {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  private notify(event: PtyEvent): void {
    for (const listener of this.outputListeners) {
      try {
        listener(event)
      } catch (error) {
        console.warn('[terminal] output listener failed:', error)
      }
    }
  }

  /**
   * A phone takes over (size) or releases (null) a terminal's size. On release
   * the size the desktop last asked for is applied again.
   */
  setRemoteSize(id: string, size: Size | null): void {
    if (size) {
      this.remoteSizes.set(id, size)
      this.resizeCore(id, size.cols, size.rows)
      return
    }
    if (!this.remoteSizes.delete(id)) return
    const desktop = this.desktopSizes.get(id)
    if (desktop) this.resizeCore(id, desktop.cols, desktop.rows)
  }

  /** Subscribe to PTY size changes; returns the unsubscribe function. */
  onSizeChange(listener: (id: string, size: Size) => void): () => void {
    this.sizeListeners.add(listener)
    return () => this.sizeListeners.delete(listener)
  }

  private resizeCore(id: string, cols: number, rows: number): void {
    this.core.resize(id, cols, rows)
    this.reportSize(id)
  }

  private reportSize(id: string): void {
    const size = this.core.size(id)
    if (!size) return
    const last = this.reportedSizes.get(id)
    if (last && last.cols === size.cols && last.rows === size.rows) return
    this.reportedSizes.set(id, size)
    for (const listener of this.sizeListeners) listener(id, size)
  }

  hasRemoteSize(id: string): boolean {
    return this.remoteSizes.has(id)
  }

  setAgentHooks(launch: () => HookLaunch | null): void {
    this.hookLaunch = launch
  }

  /** Initial discovery result — shells can change later via SETTINGS/reboot. */
  setShells(shells: ShellInfo[]): void {
    this.shells = shells
  }

  /** Resolve a profile id + create the PTY at the measured cell size. */
  create(tabId: string, profileId: string, cols: number, rows: number, cwd?: string, resumeSession?: AgentSessionRef, launchCommand?: string, permissionMode?: AgentPermissionMode, model?: string, elevated?: boolean): { pid: number } {
    let settings = this.getSettings()
    if (model) settings = { ...settings,
      profiles: mergeProfiles(settings.profiles).map(p => p.id === profileId ? { ...p, model } : p),
      providerProfiles: settings.providerProfiles.map(p => `provider:${p.id}` === profileId ? { ...p, model } : p) }
    const resolvedId = resolveProfileId(profileId, settings, this.shells)
    const input = applyProviderSecret(
      { ...profileToInput(resolvedId, settings, this.shells, { cols, rows, cwd, resumeSession, permissionMode }), launchCommand, elevated },
      resolvedId,
      settings,
      this.getProviderSecret
    )
    // Keep the ring buffer limit in sync with the current setting on every
    // spawn so a settings change applies even to terminals created later.
    this.core.setScrollback(settings.scrollback)
    this.desktopSizes.set(tabId, { cols, rows })
    const remote = this.remoteSizes.get(tabId)
    const hooks = settings.agentHooks === false ? null : this.hookLaunch()
    // usage-meter: Claude limitleri icin status line; kullanicinin kendi status line'i sarmalanir, gorunumu degismez.
    const hookLaunch = hooks && settings.claudeUsage && agentForProfile(settings, resolvedId) === 'claude'
      ? { ...hooks, claudeSettingsPath: hooks.claudeUsageSettings(effectiveClaudeStatusLine(input.cwd)) }
      : hooks
    const launch = prepareLaunch(remote ? { ...input, cols: remote.cols, rows: remote.rows } : input, hookLaunch ? { tabId, launch: hookLaunch } : undefined)
    const result = this.core.create(tabId, launch)
    this.reportedSizes.delete(tabId)
    this.reportSize(tabId)
    const agent = agentForProfile(settings, resolvedId)
    if (agent) this.onAgentLaunch({ agent, profileId: resolvedId, cwd: input.cwd, startedAt: Date.now(), resumeSession })
    return result
  }

  write(id: string, data: string): void {
    this.core.write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.desktopSizes.set(id, { cols, rows })
    if (this.remoteSizes.has(id)) return
    this.resizeCore(id, cols, rows)
  }

  kill(id: string): void {
    this.core.kill(id)
    this.desktopSizes.delete(id)
    this.remoteSizes.delete(id)
    this.reportedSizes.delete(id)
  }

  /** Current PTY size, or null when the terminal does not exist. */
  /** Canli PTY kok surecleri (Agent IDE Resource Manager). */
  pids(): { id: string; pid: number }[] {
    return this.core.pids()
  }

  size(id: string): Size | null {
    return this.core.size(id)
  }

  setMode(id: string, mode: RenderMode): void {
    this.core.setMode(id, mode)
  }

  restart(id: string): { pid: number } | null {
    return this.keepRemoteSize(id, this.core.restart(id))
  }

  restartAt(id: string, cwd: string): { pid: number } | null {
    return this.keepRemoteSize(id, this.core.restartAt(id, cwd))
  }

  /** A restarted process spawns at its original size; a phone viewing it keeps its own. */
  private keepRemoteSize<T>(id: string, result: T): T {
    const remote = this.remoteSizes.get(id)
    if (result && remote) this.resizeCore(id, remote.cols, remote.rows)
    if (result) this.reportSize(id)
    return result
  }

  getBuffer(id: string): string {
    return this.core.getBuffer(id)
  }

  setScrollback(lines: number): void {
    this.core.setScrollback(lines)
  }

  /** Kill every live PTY (app quit). */
  shutdown(): void {
    this.core.killAll()
  }

  private handleEvent(event: PtyEvent): void {
    // Output reaches remote viewers through the tap; exit/cwd come from here.
    if (event.kind !== 'data') this.notify(event)
    const sender = this.getSender()
    if (!sender) return
    switch (event.kind) {
      case 'data':
        sender.send(IPC.PTY_DATA, { ptyId: event.ptyId, data: event.data })
        break
      case 'exit':
        sender.send(IPC.PTY_EXIT, { ptyId: event.ptyId, exitCode: event.exitCode, durationMs: event.durationMs })
        break
      case 'cwd':
        sender.send(IPC.PTY_CWD, { ptyId: event.ptyId, cwd: event.cwd })
        break
    }
  }

  private getSender(): Electron.WebContents | null {
    // A destroyed BrowserWindow throws on `.webContents` access, so guard the
    // window itself before touching webContents (fixes "Object has been
    // destroyed" when a PTY flushes during/after window close).
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return null
    const wc = win.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }
}
