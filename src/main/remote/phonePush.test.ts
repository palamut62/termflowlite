import { describe, expect, it, vi } from 'vitest'
import { PUSH_ACTION_KEYS, PUSH_TOPIC, PushActionTokens, buildPushActions, buildPushRequest, newPushTopic, normalizePushServer, sendPhonePush } from './phonePush'

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

  it('adds Approve / Reject buttons that post one-time tokens to the remote server', () => {
    const actions = buildPushActions('http://100.64.0.2:7420', { approve: 'a1', reject: 'r1' })
    const body = JSON.parse(buildPushRequest(settings, event, actions)!.body)
    expect(body.actions).toEqual([
      { action: 'http', label: 'Approve', url: 'http://100.64.0.2:7420/api/push-action', method: 'POST', body: '{"token":"a1"}' },
      { action: 'http', label: 'Reject', url: 'http://100.64.0.2:7420/api/push-action', method: 'POST', body: '{"token":"r1"}' }
    ])
    expect(JSON.parse(buildPushRequest(settings, event)!.body).actions).toBeUndefined()
  })

  it('action tokens work once, burn their sibling, expire and are replaced by a newer push', () => {
    let now = 1_000
    const store = new PushActionTokens(() => now)
    const first = store.issue('tab1')
    expect(store.consume(first.approve)).toEqual({ tabId: 'tab1', data: PUSH_ACTION_KEYS.approve })
    expect(store.consume(first.approve)).toBeNull()
    expect(store.consume(first.reject)).toBeNull()

    const old = store.issue('tab1')
    const fresh = store.issue('tab1')
    expect(store.consume(old.reject)).toBeNull()
    expect(store.consume(fresh.reject)).toEqual({ tabId: 'tab1', data: PUSH_ACTION_KEYS.reject })

    const late = store.issue('tab2')
    now += 11 * 60_000
    expect(store.consume(late.approve)).toBeNull()
    expect(store.consume(undefined)).toBeNull()
    expect(store.consume('x'.repeat(500))).toBeNull()
  })
})
