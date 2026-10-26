import { describe, expect, it, vi } from 'vitest'
import { PUSH_TOPIC, buildPushRequest, newPushTopic, normalizePushServer, sendPhonePush } from './phonePush'

const settings = { enabled: true, server: 'https://ntfy.sh', topic: 'termflow-abcdefghijklmnopqrst' }
const event = { tabId: 'Ab3_x-9QzK', kind: 'needs-input' as const, title: 'Claude Code needs you', body: 'Çalışma sekmesi' }

describe('phone push', () => {
  it('makes unguessable topics that pass validation', () => {
    const a = newPushTopic()
    expect(a).toMatch(PUSH_TOPIC)
    expect(a).not.toBe(newPushTopic())
  })

  it('accepts only plain http(s) servers', () => {
    expect(normalizePushServer(' https://ntfy.example.com/ ')).toBe('https://ntfy.example.com')
    expect(normalizePushServer('http://100.64.0.2:8080')).toBe('http://100.64.0.2:8080')
    expect(normalizePushServer('file:///etc/passwd')).toBeNull()
    expect(normalizePushServer('https://user:pw@ntfy.sh')).toBeNull()
    expect(normalizePushServer('https://ntfy.sh/?x=1')).toBeNull()
    expect(normalizePushServer(42)).toBeNull()
  })

  it('builds a JSON publish with a deep link and keeps non-ASCII text', () => {
    const request = buildPushRequest(settings, event)
    expect(request?.url).toBe('https://ntfy.sh/')
    expect(JSON.parse(request!.body)).toEqual({
      topic: settings.topic,
      title: 'Claude Code needs you',
      message: 'Çalışma sekmesi',
      priority: 4,
      tags: ['bell'],
      click: 'termflow://tab/Ab3_x-9QzK'
    })
  })

  it('refuses when off, misconfigured or given a bad tab id', () => {
    expect(buildPushRequest({ ...settings, enabled: false }, event)).toBeNull()
    expect(buildPushRequest({ ...settings, topic: 'short' }, event)).toBeNull()
    expect(buildPushRequest({ ...settings, server: 'ftp://x' }, event)).toBeNull()
    expect(buildPushRequest(settings, { ...event, tabId: '../x' })).toBeNull()
    expect(buildPushRequest(settings, { ...event, kind: 'other' as never })).toBeNull()
  })

  it('reports ntfy failures instead of throwing', async () => {
    const ok = vi.fn(async () => new Response('', { status: 200 }))
    expect(await sendPhonePush(settings, event, ok as unknown as typeof fetch)).toBeNull()
    expect(ok).toHaveBeenCalledWith('https://ntfy.sh/', expect.objectContaining({ method: 'POST' }))
    const denied = vi.fn(async () => new Response('', { status: 429 }))
    expect(await sendPhonePush(settings, event, denied as unknown as typeof fetch)).toBe('ntfy answered 429')
    const offline = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') })
    expect(await sendPhonePush(settings, event, offline as unknown as typeof fetch)).toBe('getaddrinfo ENOTFOUND')
    expect(await sendPhonePush({ ...settings, enabled: false }, event, ok as unknown as typeof fetch)).toMatch(/off/)
  })
})
