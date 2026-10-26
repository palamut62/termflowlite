import { randomBytes } from 'crypto'
import type { PhonePushSettings, TabAttention } from '../../shared/types'

/**
 * Phone push over ntfy (docs/orca-parity/remote-attention.md, Faz B): the ntfy phone app shows the
 * notification even when TermFlow Remote is closed; tapping it opens `termflow://tab/<id>`.
 * Only the alert title and tab name leave the computer, never terminal output.
 */
export interface PhonePushEvent {
  tabId: string
  kind: TabAttention
  title: string
  body: string
}

export const PUSH_TOPIC = /^[A-Za-z0-9_-]{16,64}$/
const TAB_ID = /^[A-Za-z0-9_-]{1,100}$/

/** Unguessable topic: on a public ntfy server anyone who knows it can read the pushes. */
export function newPushTopic(): string {
  return `termflow-${randomBytes(15).toString('base64url')}`
}

/** http(s) server URL without trailing slash, or null. */
export function normalizePushServer(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

const PRIORITY: Record<TabAttention, number> = { 'needs-input': 4, error: 4, done: 3 }
const TAGS: Record<TabAttention, string> = { 'needs-input': 'bell', error: 'warning', done: 'white_check_mark' }

/** ntfy JSON publish request (JSON keeps non-ASCII tab names intact, headers would not). */
export function buildPushRequest(settings: PhonePushSettings, event: PhonePushEvent): { url: string; body: string } | null {
  const server = normalizePushServer(settings.server)
  if (!settings.enabled || !server || !PUSH_TOPIC.test(settings.topic) || !TAB_ID.test(event.tabId)) return null
  if (!(event.kind in PRIORITY)) return null
  return {
    url: `${server}/`,
    body: JSON.stringify({
      topic: settings.topic,
      title: String(event.title).slice(0, 80),
      message: String(event.body).slice(0, 200) || 'TermFlow',
      priority: PRIORITY[event.kind],
      tags: [TAGS[event.kind]],
      click: `termflow://tab/${event.tabId}`
    })
  }
}

/** Sends one push; resolves to an error text instead of throwing. */
export async function sendPhonePush(settings: PhonePushSettings, event: PhonePushEvent, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const request = buildPushRequest(settings, event)
  if (!request) return 'Phone notifications are off or not set up.'
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: request.body,
      signal: AbortSignal.timeout(10_000)
    })
    return response.ok ? null : `ntfy answered ${response.status}`
  } catch (error) {
    return error instanceof Error ? error.message : 'ntfy could not be reached'
  }
}
