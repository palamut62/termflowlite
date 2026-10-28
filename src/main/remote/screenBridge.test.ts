import { createServer, type Server, type Socket } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScreenTickets, bridgeScreen } from './screenBridge'

describe('ScreenTickets', () => {
  it('accepts a ticket once', () => {
    const tickets = new ScreenTickets()
    const ticket = tickets.issue()
    expect(tickets.consume(ticket)).toBe(true)
    expect(tickets.consume(ticket)).toBe(false)
  })

  it('refuses an expired, unknown or oversized ticket', () => {
    let now = 1000
    const tickets = new ScreenTickets(() => now)
    const ticket = tickets.issue()
    now += 20_000
    expect(tickets.consume(ticket)).toBe(false)
    expect(tickets.consume('nope')).toBe(false)
    expect(tickets.consume('x'.repeat(200))).toBe(false)
    expect(tickets.consume(undefined)).toBe(false)
  })
})

describe('bridgeScreen', () => {
  let server: Server
  let port: number
  const sockets: Socket[] = []

  beforeAll(async () => {
    // Stands in for the VNC server: echoes what it is sent, upper-cased.
    server = createServer((socket) => {
      sockets.push(socket)
      socket.on('data', (chunk: Buffer) => socket.write(Buffer.from(chunk.toString().toUpperCase())))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
  })

  afterAll(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function fakeSocket(): { sent: Buffer[]; closed: { code?: number }[]; fire(event: string, ...args: unknown[]): void; ws: Parameters<typeof bridgeScreen>[0] } {
    const sent: Buffer[] = []
    const closed: { code?: number }[] = []
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    const ws = {
      send: (data: Buffer) => sent.push(data),
      close: (code?: number) => closed.push({ code }),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), listener])
      }
    } as unknown as Parameters<typeof bridgeScreen>[0]
    return { sent, closed, ws, fire: (event, ...args) => { for (const l of handlers.get(event) ?? []) l(...args) } }
  }

  it('passes bytes both ways', async () => {
    const phone = fakeSocket()
    bridgeScreen(phone.ws, port)
    phone.fire('message', Buffer.from('rfb'), true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(Buffer.concat(phone.sent).toString()).toBe('RFB')
  })

  it('drops text frames instead of writing them to the server', async () => {
    const phone = fakeSocket()
    bridgeScreen(phone.ws, port)
    phone.fire('message', Buffer.from('rfb'), false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(phone.sent).toHaveLength(0)
  })

  it('closes the phone socket when no screen server answers', async () => {
    const phone = fakeSocket()
    // Port 1 needs root to bind and is never a VNC server.
    bridgeScreen(phone.ws, 1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(phone.closed[0]?.code).toBe(1011)
  })
})
