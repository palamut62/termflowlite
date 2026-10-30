import { randomBytes } from 'crypto'
import { connect, type Socket } from 'net'

/**
 * Screen sharing: the phone sees and controls the whole desktop through a VNC
 * server running on this computer (docs/remote-access.md). TermFlow does not
 * capture the screen itself - a VNC service can also show the Windows sign-in
 * screen and UAC prompts, which a normal desktop app never can. This module is
 * only the pipe: a paired phone's WebSocket is joined to that local server.
 */
const TICKET_TTL_MS = 15_000
const MAX_TICKETS = 20
/** WebSocket kuyrugu bu sinirin uzerine cikarsa VNC akisi duraklatilir. */
const STALL_BYTES = 4 * 1024 * 1024
const DRAIN_POLL_MS = 50

/**
 * One-time tickets for the screen WebSocket. A browser cannot put the device
 * key in an upgrade header, and a long-lived key does not belong in a URL, so
 * the phone asks for a ticket over the authenticated HTTP endpoint and spends
 * it right away.
 */
export class ScreenTickets {
  private tickets = new Map<string, number>()
  constructor(private readonly now: () => number = Date.now) {}

  issue(): string {
    if (this.tickets.size >= MAX_TICKETS) this.tickets.delete(this.tickets.keys().next().value!)
    const ticket = randomBytes(24).toString('base64url')
    this.tickets.set(ticket, this.now() + TICKET_TTL_MS)
    return ticket
  }

  /** True once per ticket; false when unknown, used or expired. */
  consume(ticket: unknown): boolean {
    if (typeof ticket !== 'string' || ticket.length > 100) return false
    const expires = this.tickets.get(ticket)
    if (expires === undefined) return false
    this.tickets.delete(ticket)
    return expires > this.now()
  }
}

/** The two ends of the pipe, as little of them as this module needs. */
export interface ScreenSocket {
  send(data: Buffer): void
  /** Bytes queued on the socket; `ws`'s own property, used for backpressure. */
  readonly bufferedAmount?: number
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void
  on(event: 'close' | 'error', listener: () => void): void
}

/**
 * Joins a phone WebSocket to the local VNC server. The server is reached on the
 * loopback address only: a VNC service that listens on the network is the
 * user's own business, but TermFlow never sends the phone anywhere else.
 */
export function bridgeScreen(ws: ScreenSocket, port: number, dial: typeof connect = connect): Socket {
  const tcp = dial({ host: '127.0.0.1', port })
  let closed = false
  let drainTimer: ReturnType<typeof setInterval> | null = null
  const stopDraining = (): void => {
    if (drainTimer) clearInterval(drainTimer)
    drainTimer = null
  }
  const shutdown = (code?: number, reason?: string): void => {
    if (closed) return
    closed = true
    stopDraining()
    tcp.destroy()
    ws.close(code, reason)
  }
  tcp.on('connect', () => tcp.setNoDelay(true))
  tcp.on('data', (chunk: Buffer) => {
    ws.send(chunk)
    // Yavas baglantida VNC ekran guncellemeleri WebSocket kuyrugunda birikir;
    // kuyruk sisince akisi durdur, bosalinca devam et (yoksa bellek sinirsiz buyur).
    if (drainTimer || (ws.bufferedAmount ?? 0) <= STALL_BYTES) return
    tcp.pause()
    drainTimer = setInterval(() => {
      if (closed) return stopDraining()
      if ((ws.bufferedAmount ?? 0) > STALL_BYTES) return
      stopDraining()
      tcp.resume()
    }, DRAIN_POLL_MS)
  })
  tcp.on('error', () => shutdown(1011, 'The screen server could not be reached.'))
  tcp.on('close', () => shutdown())
  ws.on('message', (data, isBinary) => {
    if (isBinary && !closed) tcp.write(data)
  })
  ws.on('close', () => shutdown())
  ws.on('error', () => shutdown())
  return tcp
}
