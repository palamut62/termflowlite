import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { readFile, stat } from 'fs/promises'
import { extname, join, normalize, sep } from 'path'
import { gzipSync } from 'zlib'
import { WebSocketServer, type WebSocket } from 'ws'
import { MAX_CLIENT_MESSAGE_BYTES, type RemoteTab } from '../../shared/remote'
import type { DeviceStore } from './devices'
import type { RemoteConnection, RemoteHub } from './RemoteHub'
import { ScreenTickets, bridgeScreen, type ScreenSocket } from './screenBridge'
import { MAX_UPLOAD_BYTES, saveUpload } from './uploads'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

const PAIR_ATTEMPTS_PER_MINUTE = 10
/** Text assets are gzipped once and kept; the bundle is ~0.5 MB raw. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg'])
const HEARTBEAT_MS = 25_000
/** Phone -> screen frames are key and pointer events; nothing legitimate is larger. */
const MAX_SCREEN_FRAME_BYTES = 64 * 1024

/**
 * Hostnames the server answers to: the bound address, Tailscale MagicDNS
 * names (*.ts.net) and single-label MagicDNS short names. Anything else is a
 * DNS-rebinding attempt and is refused.
 */
export function allowedHost(hostHeader: string | undefined, boundAddress: string, port: number): boolean {
  if (!hostHeader) return false
  const match = /^([A-Za-z0-9.-]+)(?::(\d+))?$/.exec(hostHeader.trim())
  if (!match) return false
  const [, hostname, portText] = match
  if (portText !== undefined && Number(portText) !== port) return false
  const host = hostname.toLowerCase()
  return host === boundAddress || host.endsWith('.ts.net') || /^[a-z0-9-]{1,63}$/.test(host)
}

/** A browser Origin must point at the very host the page was served from. */
export function sameOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin || !hostHeader) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && url.host === hostHeader.trim().toLowerCase()
  } catch {
    return false
  }
}

/** Sliding one-minute window per address. */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private readonly limit: number, private readonly now: () => number = Date.now) {}

  allow(key: string): boolean {
    const now = this.now()
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}

function securityHeaders(res: ServerResponse, host: string): void {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // blob: lets the pairing screen read a photo of the QR code.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://${host}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export interface RemoteServerOptions {
  /** Built phone client (out/remote). */
  staticDir: string
  hub: RemoteHub
  devices: Pick<DeviceStore, 'pair' | 'authenticate'>
  /** Where files uploaded from a phone are saved. */
  uploadDir: string
  /** A device paired; the desktop closes its QR. renewed: an existing device got a new key. */
  onPaired(deviceId: string, renewed: boolean): void
  /** An Approve / Reject button of a phone push was tapped; false when the token is not valid (any more). */
  onPushAction?(token: unknown): boolean
  /** Tab summary for the iPhone widget and Live Activity (`GET /api/status`). */
  status?(): RemoteStatusSummary
  /** Text from the iPhone share sheet for the desktop's active tab, never with Enter (`POST /api/type`). */
  typeText?(text: string): boolean
  /** Port of the local VNC server for screen sharing, or null while it is off (screenBridge.ts). */
  screenPort?(): number | null
}

export interface RemoteStatusSummary {
  computer: string
  /** agent: a CLI agent tab (an idle shell also reports 'waiting', which is not worth a ping). */
  tabs: { id: string; title: string; activity: RemoteTab['activity']; agent: boolean }[]
}

/** Shared text is typed, not run: control characters (Enter, Esc, Ctrl-C...) become spaces. */
export function typeableText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]+/g, ' ')
}

/**
 * HTTP + WebSocket transport for Remote Access. Serves the phone client,
 * exchanges pairing codes for device tokens and hands authenticated sockets
 * to the hub. Binds only to the address it is given (the Tailscale IP).
 */
export class RemoteServer {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private screenWss: WebSocketServer | null = null
  private screenTickets = new ScreenTickets()
  private heartbeat: NodeJS.Timeout | null = null
  private address = ''
  private port = 0
  private pairLimiter = new RateLimiter(PAIR_ATTEMPTS_PER_MINUTE)
  private actionLimiter = new RateLimiter(PAIR_ATTEMPTS_PER_MINUTE)
  private gzipCache = new Map<string, Buffer>()

  constructor(private readonly options: RemoteServerOptions) {}

  get listening(): boolean {
    return this.server?.listening ?? false
  }

  async start(address: string, port: number): Promise<void> {
    await this.stop()
    this.address = address
    this.port = port
    const server = createServer((req, res) => {
      void this.handleHttp(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES })
    // Screen sharing is a raw byte stream, so it gets its own server: binary
    // frames, no JSON heartbeat, and only phone input comes up this way.
    const screenWss = new WebSocketServer({ noServer: true, maxPayload: MAX_SCREEN_FRAME_BYTES, handleProtocols: (protocols) => protocols.values().next().value ?? false })
    server.on('upgrade', (req, socket, head) => {
      const host = req.headers.host
      const url = new URL(req.url ?? '/', `http://${host ?? this.address}`)
      const screen = url.pathname === '/vnc'
      const refuse = (reason: string): void => {
        socket.write(`HTTP/1.1 403 ${reason}\r\nConnection: close\r\n\r\n`)
        socket.destroy()
      }
      if ((url.pathname !== '/ws' && !screen) || !allowedHost(host, this.address, this.port) || !sameOrigin(req.headers.origin, host)) {
        refuse('Forbidden')
        return
      }
      if (!screen) {
        wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws))
        return
      }
      const screenPort = this.options.screenPort?.() ?? null
      if (screenPort === null || !this.screenTickets.consume(url.searchParams.get('t'))) {
        refuse('Forbidden')
        return
      }
      screenWss.handleUpgrade(req, socket, head, (ws) => {
        ws.binaryType = 'nodebuffer'
        bridgeScreen(ws as unknown as ScreenSocket, screenPort)
      })
    })
    this.server = server
    this.wss = wss
    this.screenWss = screenWss
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(port, address, () => {
        server.off('error', onError)
        resolve()
      })
    })
    this.heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        const alive = (ws as WebSocket & { alive?: boolean }).alive
        if (alive === false) {
          ws.terminate()
          continue
        }
        ;(ws as WebSocket & { alive?: boolean }).alive = false
        ws.ping()
      }
    }, HEARTBEAT_MS)
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    const { server, wss, screenWss } = this
    this.server = null
    this.wss = null
    this.screenWss = null
    for (const ws of [...(wss?.clients ?? []), ...(screenWss?.clients ?? [])]) ws.terminate()
    wss?.close()
    screenWss?.close()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private attach(ws: WebSocket): void {
    const tracked = ws as WebSocket & { alive?: boolean }
    tracked.alive = true
    ws.on('pong', () => { tracked.alive = true })
    const conn: RemoteConnection = {
      send: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
      },
      close: (code, reason) => ws.close(code, reason),
      bufferedAmount: () => ws.bufferedAmount
    }
    const receive = this.options.hub.connect(conn)
    ws.on('message', (data, isBinary) => {
      if (!isBinary) receive(data.toString())
    })
    ws.on('close', () => this.options.hub.disconnect(conn))
    ws.on('error', () => ws.terminate())
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host
    if (!allowedHost(host, this.address, this.port)) {
      res.writeHead(421).end()
      return
    }
    securityHeaders(res, host!)
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname === '/api/pair') {
      await this.handlePair(req, res, host!)
      return
    }
    if (url.pathname === '/api/upload') {
      await this.handleUpload(req, res, host!)
      return
    }
    if (url.pathname === '/api/screen-ticket') {
      await this.handleScreenTicket(req, res, host!)
      return
    }
    if (url.pathname === '/api/push-action') {
      await this.handlePushAction(req, res)
      return
    }
    if (url.pathname === '/api/status' || url.pathname === '/api/type') {
      await this.handleAppApi(url.pathname, req, res)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    await this.serveStatic(url.pathname, req, res)
  }

  private async handlePair(req: IncomingMessage, res: ServerResponse, host: string): Promise<void> {
    const json = (status: number, body: object): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    if (!sameOrigin(req.headers.origin, host)) return json(403, { error: 'Forbidden' })
    if (!this.pairLimiter.allow(req.socket.remoteAddress ?? 'unknown')) return json(429, { error: 'Too many attempts. Wait a minute.' })
    let body: { code?: unknown; name?: unknown }
    try {
      body = JSON.parse(await readBody(req, 4096)) as typeof body
    } catch {
      return json(400, { error: 'Invalid request' })
    }
    const paired = this.options.devices.pair(body.code, body.name)
    if (!paired) return json(401, { error: 'This QR code has expired or was already used. Show a new one on the desktop.' })
    this.options.onPaired(paired.device.id, paired.renewed)
    json(200, { token: paired.token, device: paired.device })
  }

  /** One-time ticket for the screen WebSocket; the device key cannot travel in an upgrade header. */
  private async handleScreenTicket(req: IncomingMessage, res: ServerResponse, host: string): Promise<void> {
    const json = (status: number, body: object): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    if (!sameOrigin(req.headers.origin, host)) return json(403, { error: 'Forbidden' })
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1]
    if (!this.options.devices.authenticate(token)) return json(401, { error: 'This phone is not paired.' })
    if ((this.options.screenPort?.() ?? null) === null) return json(409, { error: 'Screen sharing is off on the computer.' })
    json(200, { ticket: this.screenTickets.issue() })
  }

  /**
   * Sent by the ntfy phone app, not a browser: there is no Origin and no device key. The one-time
   * token from the push is the credential (phonePush.ts PushActionTokens); guesses are rate limited.
   */
  private async handlePushAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (status: number, body: object): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    if (!this.actionLimiter.allow(req.socket.remoteAddress ?? 'unknown')) return json(429, { error: 'Too many attempts. Wait a minute.' })
    let body: { token?: unknown }
    try {
      body = JSON.parse(await readBody(req, 1024)) as typeof body
    } catch {
      return json(400, { error: 'Invalid request' })
    }
    if (!this.options.onPushAction?.(body?.token)) return json(410, { error: 'This button has expired or was already used.' })
    json(200, { ok: true })
  }

  /**
   * For the iPhone widget and share extension (native code, not the page): the paired device key in
   * `Authorization` is the credential. A browser never sends it on its own, so no Origin check.
   */
  private async handleAppApi(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (status: number, body: object): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1]
    if (!this.options.devices.authenticate(token)) return json(401, { error: 'This phone is not paired.' })
    if (path === '/api/status') {
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })
      return json(200, this.options.status?.() ?? { computer: '', tabs: [] })
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    let body: { text?: unknown }
    try {
      body = JSON.parse(await readBody(req, 32 * 1024)) as typeof body
    } catch {
      return json(400, { error: 'Invalid request' })
    }
    if (typeof body?.text !== 'string' || !body.text.trim()) return json(400, { error: 'Nothing to type.' })
    if (!this.options.typeText?.(typeableText(body.text))) return json(409, { error: 'No tab is open on the computer.' })
    json(200, { ok: true })
  }

  /** Raw file body, device token in `Authorization`, name in `X-File-Name` (URI-encoded). Answers `{ path }`. */
  private async handleUpload(req: IncomingMessage, res: ServerResponse, host: string): Promise<void> {
    const json = (status: number, body: object): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    if (!sameOrigin(req.headers.origin, host)) return json(403, { error: 'Forbidden' })
    const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1]
    if (!this.options.devices.authenticate(token)) return json(401, { error: 'This phone is not paired.' })
    if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD_BYTES) return json(413, { error: 'File too large (200 MB max).' })
    let name = ''
    try {
      name = decodeURIComponent(String(req.headers['x-file-name'] ?? ''))
    } catch {
      return json(400, { error: 'Invalid file name' })
    }
    try {
      json(200, { path: await saveUpload(req, this.options.uploadDir, name) })
    } catch (error) {
      json(error instanceof Error && error.message === 'File too large' ? 413 : 500, { error: error instanceof Error && error.message === 'File too large' ? 'File too large (200 MB max).' : 'Upload failed.' })
    }
  }

  private async serveStatic(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const root = normalize(this.options.staticDir)
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      res.writeHead(400).end()
      return
    }
    let file = normalize(join(root, decoded))
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end()
      return
    }
    let info = await stat(file).catch(() => null)
    const isFile = info?.isFile() ?? false
    // Single-page app: unknown paths without an extension get index.html.
    if (!isFile) {
      if (extname(decoded)) {
        res.writeHead(404).end()
        return
      }
      file = join(root, 'index.html')
      info = await stat(file)
    }
    const ext = extname(file).toLowerCase()
    // File names are stable (no content hash) so a cached index.html still finds
    // its scripts after an update; every response is revalidated instead, and an
    // unchanged file costs a 304.
    const etag = `"${info!.size.toString(36)}-${Math.floor(info!.mtimeMs).toString(36)}"`
    const headers = { 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding' }
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end()
      return
    }
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    let body: Buffer
    if (gzip) {
      const key = `${file}|${etag}`
      body = this.gzipCache.get(key) ?? gzipSync(await readFile(file))
      this.gzipCache.set(key, body)
    } else {
      body = await readFile(file)
    }
    res.writeHead(200, {
      ...headers,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {})
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
