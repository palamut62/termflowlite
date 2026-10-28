import { execFile } from 'child_process'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { EventEmitter } from 'events'
import { readFileSync, writeFileSync } from 'fs'
import { createServer, connect, type Server, type Socket } from 'net'
import { userInfo } from 'os'
import { join } from 'path'
import * as pty from '@lydell/node-pty'
import type { IPty } from '@lydell/node-pty'
import { PRODUCT } from '../../shared/edition'
import type { ElevationStatus } from '../../shared/types'

/**
 * Administrator tabs approved from a phone (docs/remote-access.md "Admin tabs").
 *
 * Windows lets no program click a UAC prompt, so the PC approves once: setup runs
 * under UAC and registers a "run with highest privileges" scheduled task plus a
 * PIN hash in an admin-only ProgramData folder. Later the task starts this app
 * elevated with ELEVATED_HOST_FLAG; that host checks the phone's PIN itself (the
 * hash is unreadable without admin rights), spawns the shell and relays it over a
 * named pipe. Without the PIN, starting the task gives nothing.
 * shortcut: same-user malware that is running while you approve can read the PIN
 * from the pipe; real isolation needs a signed SYSTEM service.
 */

export const ELEVATED_HOST_FLAG = '--termflow-elevated-host'
export const PIN_RE = /^\d{6,12}$/
const TASK_NAME = `${PRODUCT.name} Elevated`
const GRANT_MS = 60_000
const CONNECT_TIMEOUT_MS = 20_000
const MAX_FAILS = 5
const LOCK_MS = 15 * 60_000
const SYSTEM32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const POWERSHELL = join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export interface PinRecord {
  salt: string
  hash: string
  fails: number
  lockedUntil: number
}

export function hashPin(pin: string, salt = randomBytes(16).toString('hex')): PinRecord {
  return { salt, hash: scryptSync(pin, salt, 32).toString('hex'), fails: 0, lockedUntil: 0 }
}

/** Checks a PIN and returns the record to store back (fail counter / lockout). */
export function checkPin(record: PinRecord, pin: string, now = Date.now()): { ok: boolean; record: PinRecord; error?: string } {
  if (record.lockedUntil > now) return { ok: false, record, error: 'Too many wrong PINs. Try again in 15 minutes.' }
  const ok = PIN_RE.test(pin) && timingSafeEqual(scryptSync(pin, record.salt, 32), Buffer.from(record.hash, 'hex'))
  if (ok) return { ok, record: { ...record, fails: 0, lockedUntil: 0 } }
  const fails = record.fails + 1
  return fails >= MAX_FAILS
    ? { ok, record: { ...record, fails: 0, lockedUntil: now + LOCK_MS }, error: 'Too many wrong PINs. Try again in 15 minutes.' }
    : { ok, record: { ...record, fails }, error: 'Wrong PIN.' }
}

export function pipePath(): string {
  const user = createHash('sha256').update(userInfo().username.toLowerCase()).digest('hex').slice(0, 12)
  return `\\\\.\\pipe\\${PRODUCT.slug}-elevate-${user}`
}

function secretDir(): string {
  return join(process.env.ProgramData || 'C:\\ProgramData', PRODUCT.slug)
}

const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`

function run(file: string, args: string[], timeout = 120_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, output: `${stdout}${stderr}`.trim() })
    })
  })
}

/** Runs a PowerShell script elevated; the PC shows one UAC prompt. */
async function runElevatedScript(script: string): Promise<void> {
  const encoded = Buffer.from(`$ErrorActionPreference='Stop'\n${script}`, 'utf16le').toString('base64')
  const outer = `try { $p = Start-Process -FilePath ${psQuote(POWERSHELL)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru ` +
    `-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; exit $p.ExitCode } catch { exit 1223 }`
  const { code } = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', outer], 300_000)
  if (code === 1223) throw new Error('Windows did not grant administrator rights (UAC was cancelled).')
  if (code !== 0) throw new Error('Setting up administrator tabs failed.')
}

export async function elevationStatus(): Promise<ElevationStatus> {
  if (process.platform !== 'win32') return 'unsupported'
  const { code } = await run(join(SYSTEM32, 'schtasks.exe'), ['/query', '/tn', TASK_NAME], 15_000)
  return code === 0 ? 'on' : 'off'
}

/** One UAC prompt on the PC: registers the elevated task and stores the PIN hash. */
export async function enableElevation(pin: string, executable = process.execPath): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Administrator tabs are only available on Windows.')
  if (!PIN_RE.test(pin)) throw new Error('The PIN must be 6 to 12 digits.')
  const dir = secretDir()
  const user = `${process.env.USERDOMAIN || ''}\\${process.env.USERNAME || userInfo().username}`
  await runElevatedScript([
    `$dir = ${psQuote(dir)}`,
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    // Administrators + SYSTEM only: the user's own unelevated programs cannot read the hash.
    "& icacls.exe $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null",
    'if ($LASTEXITCODE -ne 0) { exit 2 }',
    `[IO.File]::WriteAllText((Join-Path $dir 'elevation.json'), ${psQuote(JSON.stringify(hashPin(pin)))})`,
    `$action = New-ScheduledTaskAction -Execute ${psQuote(executable)} -Argument ${psQuote(ELEVATED_HOST_FLAG)}`,
    `$principal = New-ScheduledTaskPrincipal -UserId ${psQuote(user)} -LogonType Interactive -RunLevel Highest`,
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel -Priority 4',
    `Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Principal $principal -Settings $settings -Force | Out-Null`
  ].join('\n'))
}

export async function disableElevation(): Promise<void> {
  if (process.platform !== 'win32') return
  await runElevatedScript([
    `Unregister-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue`,
    `Remove-Item -LiteralPath ${psQuote(secretDir())} -Recurse -Force -ErrorAction SilentlyContinue`
  ].join('\n'))
}

// ---- Unelevated side: phone grant + pipe bridge ----

let grant: { pin: string; expires: number } | null = null

/** The phone approved the next administrator tab with this PIN. */
export function grantElevation(pin: string): void {
  if (!PIN_RE.test(pin)) throw new Error('The PIN must be 6 to 12 digits.')
  grant = { pin, expires: Date.now() + GRANT_MS }
}

function takeGrant(): string {
  const current = grant
  grant = null
  if (!current || current.expires < Date.now()) throw new Error('Administrator tabs need approval from your phone. Open a new one there.')
  return current.pin
}

export interface ElevatedSpawn {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

type HostRequest = ElevatedSpawn & { pin: string }
type HostMessage = { t: 'ready'; pid: number } | { t: 'data'; d: string } | { t: 'exit'; code: number } | { t: 'error'; message: string }
type BridgeMessage = { t: 'in'; d: string } | { t: 'resize'; cols: number; rows: number } | { t: 'kill' }

/** Newline-delimited JSON over a socket (JSON escapes every newline inside a message). */
function onLines(socket: Socket, handle: (message: unknown) => void): void {
  let rest = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      try { handle(JSON.parse(line)) } catch { /* ignore a malformed line */ }
    }
  })
}

const send = (socket: Socket, message: HostMessage | BridgeMessage | HostRequest): void => {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
}

/** PtyCore's view of a shell running in the elevated host. */
export class ElevatedPty extends EventEmitter {
  pid = 0
  private socket: Socket | null = null
  private queued: BridgeMessage[] = []
  private done = false
  private timer: NodeJS.Timeout

  constructor(readonly request: HostRequest) {
    super()
    this.timer = setTimeout(() => this.fail('The elevated shell did not start. Turn administrator tabs off and on again on the PC.'), CONNECT_TIMEOUT_MS)
  }

  readonly onData = (listener: (data: string) => void): { dispose(): void } => this.listen('data', listener)
  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } => this.listen('exit', listener)

  private listen<T>(event: string, listener: (value: T) => void): { dispose(): void } {
    this.on(event, listener)
    return { dispose: () => this.off(event, listener) }
  }

  write(data: string): void { this.post({ t: 'in', d: data }) }
  resize(cols: number, rows: number): void { this.post({ t: 'resize', cols, rows }) }
  kill(): void {
    this.post({ t: 'kill' })
    this.finish(1)
  }

  private post(message: BridgeMessage): void {
    if (this.done) return
    if (this.socket) send(this.socket, message)
    else this.queued.push(message)
  }

  attach(socket: Socket): void {
    if (this.done) { socket.destroy(); return }
    this.socket = socket
    send(socket, this.request)
    onLines(socket, (raw) => {
      const message = raw as HostMessage
      if (message.t === 'ready') {
        clearTimeout(this.timer)
        this.pid = message.pid
        for (const queued of this.queued.splice(0)) send(socket, queued)
      } else if (message.t === 'data' && typeof message.d === 'string') this.emit('data', message.d)
      else if (message.t === 'exit') this.finish(typeof message.code === 'number' ? message.code : 1)
      else if (message.t === 'error') this.fail(String(message.message).slice(0, 200))
    })
    socket.on('close', () => this.finish(1))
    socket.on('error', () => undefined)
  }

  fail(message: string): void {
    if (this.done) return
    this.emit('data', `\r\n\x1b[31m${message}\x1b[0m\r\n`)
    this.finish(1)
  }

  private finish(exitCode: number): void {
    if (this.done) return
    this.done = true
    clearTimeout(this.timer)
    this.socket?.end()
    const index = waiting.indexOf(this)
    if (index >= 0) waiting.splice(index, 1)
    this.emit('exit', { exitCode })
  }
}

const waiting: ElevatedPty[] = []
let server: Server | null = null

function ensureServer(path: string): Promise<void> {
  if (server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const next = createServer((socket) => {
      // Each started host takes the oldest request; a stray client gets nothing.
      const target = waiting.shift()
      if (target) target.attach(socket)
      else socket.destroy()
    })
    next.once('error', reject)
    next.listen(path, () => {
      server = next
      resolve()
    })
  })
}

/**
 * Starts a shell through the elevated task. Returns at once (PtyCore.create is
 * synchronous); input is queued until the host is ready and failures are printed
 * into the tab before it exits.
 */
export function spawnElevated(spawn: ElevatedSpawn, deps = { path: pipePath(), startTask: () => run(join(SYSTEM32, 'schtasks.exe'), ['/run', '/tn', TASK_NAME], 15_000) }): IPty {
  const proc = new ElevatedPty({ ...spawn, pin: takeGrant() })
  waiting.push(proc)
  void ensureServer(deps.path)
    .then(() => deps.startTask())
    .then(({ code }) => { if (code !== 0) proc.fail('Administrator tabs are not set up on this PC (Settings > Remote).') })
    .catch(() => proc.fail('The elevated shell could not be reached.'))
  return proc as unknown as IPty
}

/** Test hook: forget the pipe server between cases. */
export function resetElevationBridge(): void {
  server?.close()
  server = null
  waiting.length = 0
  grant = null
}

// ---- Elevated side: started by the scheduled task ----

export interface HostDeps {
  path: string
  recordFile: string
  spawn(request: ElevatedSpawn): Pick<IPty, 'pid' | 'onData' | 'onExit' | 'write' | 'resize' | 'kill'>
}

export function runElevatedHost(deps: HostDeps = {
  path: pipePath(),
  recordFile: join(secretDir(), 'elevation.json'),
  spawn: (r) => pty.spawn(r.file, r.args, { name: 'xterm-256color', cols: r.cols, rows: r.rows, cwd: r.cwd, env: r.env, useConpty: true })
}): Promise<void> {
  return new Promise((resolve) => {
    const socket = connect(deps.path)
    let started = false
    let proc: ReturnType<HostDeps['spawn']> | null = null
    const quit = (): void => {
      try { proc?.kill() } catch { /* already gone */ }
      socket.destroy()
      resolve()
    }
    socket.on('error', quit)
    socket.on('close', quit)
    onLines(socket, (raw) => {
      if (!started) {
        started = true
        const request = raw as Partial<HostRequest>
        let error: string | undefined
        try {
          const record = JSON.parse(readFileSync(deps.recordFile, 'utf8').replace(/^\uFEFF/, '')) as PinRecord
          const check = checkPin(record, typeof request.pin === 'string' ? request.pin : '')
          writeFileSync(deps.recordFile, JSON.stringify(check.record))
          error = check.error
        } catch {
          error = 'Administrator tabs are not set up on this PC.'
        }
        if (error) {
          send(socket, { t: 'error', message: error })
          socket.end()
          return
        }
        try {
          proc = deps.spawn(request as ElevatedSpawn)
        } catch (error) {
          send(socket, { t: 'error', message: error instanceof Error ? error.message : 'The shell could not start.' })
          socket.end()
          return
        }
        send(socket, { t: 'ready', pid: proc.pid })
        proc.onData((d) => send(socket, { t: 'data', d }))
        proc.onExit(({ exitCode }) => {
          send(socket, { t: 'exit', code: exitCode })
          socket.end()
        })
        return
      }
      const message = raw as BridgeMessage
      if (!proc) return
      if (message.t === 'in' && typeof message.d === 'string') proc.write(message.d)
      else if (message.t === 'resize' && message.cols > 0 && message.rows > 0) proc.resize(message.cols, message.rows)
      else if (message.t === 'kill') quit()
    })
  })
}
