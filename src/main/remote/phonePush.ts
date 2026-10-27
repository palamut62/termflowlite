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

/** ntfy `http` action button: the ntfy phone app POSTs `body` to `url` when tapped. */
export interface PushAction {
  action: 'http'
  label: string
  url: string
  method: 'POST'
  body: string
}

/** Keys an action button may type into its tab: Enter accepts the highlighted choice, Esc declines. */
export const PUSH_ACTION_KEYS = { approve: '\r', reject: '\x1b' } as const
const ACTION_TTL_MS = 10 * 60_000
const MAX_ACTION_TABS = 50

/**
 * One-time tokens behind the Approve / Reject buttons of a phone push. Both buttons of a push
 * share a group: using one burns the other, and a newer push for the same tab replaces them,
 * so a stale button cannot press a key into a later prompt. The token is the only credential
 * (the ntfy app sends no device key), so it is random, single use and short lived.
 */
export class PushActionTokens {
  private byTab = new Map<string, { tokens: Map<string, string>; expires: number }>()
  constructor(private readonly now: () => number = Date.now) {}

  issue(tabId: string): { approve: string; reject: string } {
    this.byTab.delete(tabId)
    if (this.byTab.size >= MAX_ACTION_TABS) this.byTab.delete(this.byTab.keys().next().value!)
    const approve = randomBytes(24).toString('base64url')
    const reject = randomBytes(24).toString('base64url')
    this.byTab.set(tabId, {
      tokens: new Map([[approve, PUSH_ACTION_KEYS.approve], [reject, PUSH_ACTION_KEYS.reject]]),
      expires: this.now() + ACTION_TTL_MS
    })
    return { approve, reject }
  }

  /** The tab and keys for a token, once; null when unknown, used or expired. */
  consume(token: unknown): { tabId: string; data: string } | null {
    if (typeof token !== 'string' || token.length > 100) return null
    for (const [tabId, group] of this.byTab) {
      const data = group.tokens.get(token)
      if (data === undefined) continue
      this.byTab.delete(tabId)
      return group.expires > this.now() ? { tabId, data } : null
    }
    return null
  }
}

/** Approve / Reject buttons for a push; `origin` is the remote server the phone reaches over Tailscale. */
export function buildPushActions(origin: string, tokens: { approve: string; reject: string }): PushAction[] {
  const url = `${origin}/api/push-action`
  return [
    { action: 'http', label: 'Approve', url, method: 'POST', body: JSON.stringify({ token: tokens.approve }) },
    { action: 'http', label: 'Reject', url, method: 'POST', body: JSON.stringify({ token: tokens.reject }) }
  ]
}

/** ntfy JSON publish request (JSON keeps non-ASCII tab names intact, headers would not). */
export function buildPushRequest(settings: PhonePushSettings, event: PhonePushEvent, actions?: PushAction[]): { url: string; body: string } | null {
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
      click: `termflow://tab/${event.tabId}`,
      ...(actions?.length ? { actions } : {})
    })
  }
}

/** Sends one push; resolves to an error text instead of throwing. */
export async function sendPhonePush(settings: PhonePushSettings, event: PhonePushEvent, fetchImpl: typeof fetch = fetch, actions?: PushAction[]): Promise<string | null> {
  const request = buildPushRequest(settings, event, actions)
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
