import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { ServerMessage } from '../../shared/remote'
import { DeviceStore } from './devices'
import { RemoteHub } from './RemoteHub'
import { RateLimiter, RemoteServer, allowedHost, sameOrigin } from './RemoteServer'

const HOST = '127.0.0.1'
let dir: string
let server: RemoteServer
let devices: DeviceStore
let port: number
let base: string
const writes: string[] = []
const typed: string[] = []

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tfl-remote-srv-'))
  const web = join(dir, 'web')
  mkdirSync(join(web, 'assets'), { recursive: true })
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>TermFlow Remote</title>')
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dir, 'secret.txt'), 'top secret')
  devices = new DeviceStore(join(dir, 'devices.json'))
  const hub = new RemoteHub({
    terminals: { onOutput: () => () => undefined, setRemoteSize: () => undefined, write: (_id, data) => { writes.push(data) }, getBuffer: () => 'PS C:\\> ', size: () => null, onSizeChange: () => () => undefined },
    devices,
    invokeIpc: async () => null,
    getSettings: () => DEFAULT_SETTINGS,
    getShells: async () => [],
    runTabCommand: async () => true,
    onRemoteSettings: () => undefined,
    onClientsChanged: () => undefined,
    platform: 'win32',
    version: 'test',
    home: '/home/me'
  })
  hub.setTabs({ tabs: [{ id: 'tab1', title: 'pwsh', profileId: 'pwsh', running: true, activity: 'running', visible: true }], activeTabId: 'tab1' })
  server = new RemoteServer({ staticDir: web, uploadDir: join(dir, 'uploads'), hub, devices, onPaired: () => undefined, onPushAction: (token) => token === 'good',
    status: () => ({ computer: 'pc', tabs: [{ id: 'tab1', title: 'pwsh', activity: 'waiting', agent: false }] }),
    typeText: (text) => { typed.push(text); return true }
  })
  port = 40000 + Math.floor(Math.random() * 20000)
  await server.start(HOST, port)
  base = `http://${HOST}:${port}`
})

afterAll(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

function pair(code: string, origin = base): Promise<Response> {
  return fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ code, name: 'Test phone' }) })
}

function open(origin = base): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${port}/ws`, { headers: { Origin: origin } })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })
}

function next(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()) as ServerMessage)))
}

describe('RemoteServer', () => {
  it('serves the client with security headers and blocks path traversal', async () => {
    const index = await fetch(`${base}/`)
    expect(index.status).toBe(200)
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(index.headers.get('content-security-policy')).toContain("img-src 'self' data: blob:")
    expect(index.headers.get('x-frame-options')).toBe('DENY')
    const asset = await fetch(`${base}/assets/app.js`, { headers: { 'Accept-Encoding': 'gzip' } })
    expect(asset.headers.get('cache-control')).toBe('no-cache')
    const etag = asset.headers.get('etag')
    expect(etag).toBeTruthy()
    expect((await fetch(`${base}/assets/app.js`, { headers: { 'If-None-Match': etag! } })).status).toBe(304)
    expect(asset.headers.get('content-encoding')).toBe('gzip')
    expect(await asset.text()).toBe('console.log(1)')
    expect((await fetch(`${base}/some/route`)).status).toBe(200)
    expect((await fetch(`${base}/%2e%2e%2fsecret.txt`)).status).toBe(403)
    expect((await fetch(`${base}/missing.js`)).status).toBe(404)
  })

  it('pairs with a QR code once, then streams over an authenticated socket', async () => {
    const { code } = devices.startPairing()
    expect((await pair(code, 'http://evil.example')).status).toBe(403)
    const res = await pair(code)
    expect(res.status).toBe(200)
    const { token } = await res.json() as { token: string }
    expect((await pair(code)).status).toBe(401)

    const ws = await open()
    const hello = next(ws)
    ws.send(JSON.stringify({ t: 'auth', token }))
    expect(await hello).toMatchObject({ t: 'hello', device: { name: 'Test phone' } })
    const snapshot = next(ws)
    ws.send(JSON.stringify({ t: 'sub', tabId: 'tab1', cols: 40, rows: 20 }))
    expect(await snapshot).toEqual({ t: 'snapshot', tabId: 'tab1', data: 'PS C:\\> ', repaint: false })
    ws.send(JSON.stringify({ t: 'input', tabId: 'tab1', data: 'echo hi\r' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(writes).toContain('echo hi\r')
    ws.close()
  })

  it('saves uploads from a paired phone only, never overwriting', async () => {
    const send = (token: string, name: string, body: string, origin = base): Promise<Response> =>
      fetch(`${base}/api/upload`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'X-File-Name': encodeURIComponent(name) }, body })
    const { code } = devices.startPairing()
    const { token } = await (await pair(code)).json() as { token: string }
    expect((await send('x'.repeat(40), 'a.txt', 'hi')).status).toBe(401)
    expect((await send(token, 'a.txt', 'hi', 'http://evil.example')).status).toBe(403)
    const first = await (await send(token, '..\\..\\note one.txt', 'hello')).json() as { path: string }
    const second = await (await send(token, 'note one.txt', 'again')).json() as { path: string }
    expect(first.path).toBe(join(dir, 'uploads', 'note one.txt'))
    expect(second.path).toBe(join(dir, 'uploads', 'note one (1).txt'))
    expect(readFileSync(first.path, 'utf-8')).toBe('hello')
  })

  it('refuses sockets from a foreign origin', async () => {
    await expect(open('http://evil.example')).rejects.toThrow('403')
  })
})

describe('host and origin checks', () => {
  it('accepts the bound IP and MagicDNS names only', () => {
    expect(allowedHost('100.89.62.116:47321', '100.89.62.116', 47321)).toBe(true)
    expect(allowedHost('desktop-1.tail1ea60f.ts.net:47321', '100.89.62.116', 47321)).toBe(true)
    expect(allowedHost('desktop-1:47321', '100.89.62.116', 47321)).toBe(true)
    expect(allowedHost('evil.example:47321', '100.89.62.116', 47321)).toBe(false)
    expect(allowedHost('100.89.62.116:80', '100.89.62.116', 47321)).toBe(false)
    expect(allowedHost(undefined, '100.89.62.116', 47321)).toBe(false)
  })

  it('requires a same-host http origin', () => {
    expect(sameOrigin('http://100.89.62.116:47321', '100.89.62.116:47321')).toBe(true)
    expect(sameOrigin('http://evil.example', '100.89.62.116:47321')).toBe(false)
    expect(sameOrigin(undefined, '100.89.62.116:47321')).toBe(false)
  })

  it('serves the iPhone widget status and types shared text, only for a paired device key', async () => {
    const { code } = devices.startPairing()
    const { token } = await (await pair(code)).json() as { token: string }
    const status = (key: string): Promise<Response> => fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${key}` } })
    const type = (key: string, body: string): Promise<Response> => fetch(`${base}/api/type`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body })
    expect((await status('nope')).status).toBe(401)
    expect(await (await status(token)).json()).toEqual({ computer: 'pc', tabs: [{ id: 'tab1', title: 'pwsh', activity: 'waiting', agent: false }] })
    expect((await type('nope', '{"text":"x"}')).status).toBe(401)
    expect((await type(token, '{"text":"   "}')).status).toBe(400)
    expect((await type(token, '{"text":"see https://x.dev\\r\\nrm -rf /\\u001b[201~\\u0003"}')).status).toBe(200)
    expect(typed).toEqual(['see https://x.dev rm -rf / [201~ '])
  })

  it('answers ntfy push buttons by their one-time token, without an Origin', async () => {
    const tap = (body: string, method = 'POST'): Promise<Response> => fetch(`${base}/api/push-action`, { method, body: method === 'POST' ? body : undefined })
    expect((await tap('{"token":"good"}')).status).toBe(200)
    expect((await tap('{"token":"stale"}')).status).toBe(410)
    expect((await tap('not json')).status).toBe(400)
    expect((await tap('', 'GET')).status).toBe(405)
  })

  it('rate limits per address', () => {
    let now = 0
    const limiter = new RateLimiter(2, () => now)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
    expect(limiter.allow('b')).toBe(true)
    now = 61_000
    expect(limiter.allow('a')).toBe(true)
  })
})
