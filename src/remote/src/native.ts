import { useSyncExternalStore } from 'react'
import type { TabActivity } from '../../shared/types'

/**
 * Bridge to the TermFlow iPhone app (../termflow-lite-ios, WKWebView). In a plain browser
 * `hasNative` is false and every call is a no-op, so the web client works the same without it.
 */

/** What the iPhone app tells the page at load and after a change (WKUserScript). */
export interface NativeInfo {
  /** 'Face ID' | 'Touch ID' | 'Optic ID', or null without biometrics. */
  biometry: string | null
  lockEnabled: boolean
  /** ISO date the free-account signature runs out, if known. */
  signatureExpires: string | null
}

export type NativeMessage =
  | { type: 'copy'; text: string }
  | { type: 'paste' }
  | { type: 'awake'; on: boolean }
  | { type: 'haptic'; kind: 'success' | 'warning' | 'error' }
  | { type: 'dictate'; on: boolean }
  | { type: 'lock'; on: boolean }
  | { type: 'computers' }

/** Sent by the iPhone app through `window.termflowNative.receive`. */
export type NativeEvent =
  | { type: 'text'; text: string; enter: boolean }
  | { type: 'dictation'; state: 'listening' | 'partial' | 'final' | 'error'; text: string }
  | { type: 'info'; info: NativeInfo }
  /** A short error from the app (empty clipboard, failed upload of a shared file). */
  | { type: 'notice'; text: string }

declare global {
  interface Window {
    webkit?: { messageHandlers?: { termflow?: { postMessage(message: unknown): void } } }
    termflowNativeInfo?: NativeInfo
    termflowNative?: { receive(event: NativeEvent): void; token(): string | null }
  }
}

const handler = (): { postMessage(message: unknown): void } | undefined => window.webkit?.messageHandlers?.termflow

export const hasNative = (): boolean => Boolean(handler())

export function postNative(message: NativeMessage): void {
  handler()?.postMessage(message)
}

let info: NativeInfo | null = null
const infoListeners = new Set<() => void>()
const subscribeInfo = (listener: () => void): (() => void) => {
  infoListeners.add(listener)
  return () => infoListeners.delete(listener)
}

/** The iPhone app's state (Face ID lock, signature date); null in a plain browser. */
export function useNativeInfo(): NativeInfo | null {
  return useSyncExternalStore(subscribeInfo, () => info ?? window.termflowNativeInfo ?? null)
}

type Listener = (event: NativeEvent) => void
const listeners = new Set<Listener>()
/** Text that arrived before the terminal was ready (a Shortcut opens the app cold). */
let queued: NativeEvent[] = []

export function onNative(listener: Listener): () => void {
  listeners.add(listener)
  const pending = queued
  queued = []
  for (const event of pending) listener(event)
  return () => listeners.delete(listener)
}

/** Install the receiver; `token` lets the app upload shared files with this phone's key. */
export function installNativeReceiver(token: () => string | null): void {
  window.termflowNative = {
    receive(event) {
      if (!event || typeof event !== 'object') return
      if (event.type === 'info') {
        info = event.info
        for (const listener of infoListeners) listener()
        return
      }
      if (listeners.size === 0) queued = [...queued.slice(-9), event]
      for (const listener of listeners) listener(event)
    },
    token
  }
}

export interface ActivitySeen { activity: TabActivity; since: number }
/** A tab must have worked this long before its stop is worth a tap (shell prompts flicker). */
const HAPTIC_AFTER_MS = 5_000
export const HAPTIC_GAP_MS = 4_000

/**
 * Haptic for a tab that was running a while and then finished (success) or stopped to ask
 * for input or failed (warning). Also returns the updated "since when" bookkeeping.
 */
export function finishedHaptic(
  before: Map<string, ActivitySeen>,
  tabs: { id: string; activity: TabActivity }[],
  now: number
): { kind: 'success' | 'warning' | null; seen: Map<string, ActivitySeen> } {
  const seen = new Map<string, ActivitySeen>()
  let kind: 'success' | 'warning' | null = null
  for (const tab of tabs) {
    const prev = before.get(tab.id)
    seen.set(tab.id, prev && prev.activity === tab.activity ? prev : { activity: tab.activity, since: now })
    if (prev?.activity !== 'running' || tab.activity === 'running' || now - prev.since < HAPTIC_AFTER_MS) continue
    if (tab.activity === 'waiting' || tab.activity === 'error') kind = 'warning'
    else if (tab.activity === 'completed' && !kind) kind = 'success'
  }
  return { kind, seen }
}

/** Copy text: the iPhone app's pasteboard, else the browser clipboard (HTTP pages often lack it). */
export async function copyText(text: string): Promise<boolean> {
  if (hasNative()) {
    postNative({ type: 'copy', text })
    return true
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
