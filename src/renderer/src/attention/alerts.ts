import type { AgentKind, TabAttention } from '../../../shared/types'
import { useTerminalStore } from '../store/terminalStore'
import { useSettingsStore } from '../store/settingsStore'
import { paneTerminalIds } from '../paneUtils'
import { playAlertFile, playAlertTone } from '../fun/sounds'
import { alertDecision, alertTitle } from './attentionPolicy'

/** Kullanicinin su an gordugu sekmeler: aktif sekme ya da onun split duzenindeki tum paneller. */
export function visibleTabIds(): string[] {
  const { paneTree, activeTabId } = useTerminalStore.getState()
  if (paneTree) return paneTerminalIds(paneTree)
  return activeTabId ? [activeTabId] : []
}

let nextSoundAt = 0
let queued = 0

/** Pes pese gelen olaylarin sesleri ust uste binmez, kisa bir kuyrukla sirayla calar. */
function playAlert(kind: TabAttention): void {
  if (queued >= 3) return
  const now = Date.now()
  const wait = Math.max(0, nextSoundAt - now)
  nextSoundAt = now + wait + 700
  queued++
  setTimeout(() => {
    queued--
    const { volume, soundFile } = useSettingsStore.getState().settings.agentAlerts
    if (!soundFile) { playAlertTone(kind, volume); return }
    void playAlertFile(soundFile, () => window.termflow.alerts.loadSound(soundFile), volume)
      .then((played) => { if (!played) playAlertTone(kind, volume) })
  }, wait)
}

export function testAlertSound(): void {
  playAlert('needs-input')
}

/** Ajan dikkat istedi: ayara gore isaret, sistem bildirimi ve ses. */
export function raiseAttention(tabId: string, agent: AgentKind, kind: TabAttention, detail?: string): void {
  const store = useTerminalStore.getState()
  const tab = store.tabs.find((item) => item.id === tabId)
  if (!tab) return
  const settings = useSettingsStore.getState().settings
  const decision = alertDecision(kind, visibleTabIds().includes(tabId), document.hasFocus(), settings.agentAlerts)
  if (decision.mark) store.markAttention(tabId, kind)
  if (decision.notify) window.termflow.window.notify({ tabId, title: alertTitle(agent, kind), body: detail ? `${tab.title}: ${detail}` : tab.title })
  // Phone gets only the title and tab name, never the agent's message (it passes through the ntfy server).
  if (decision.mark && settings.remote.push.enabled) window.termflow.alerts.pushPhone({ tabId, kind, title: alertTitle(agent, kind), body: tab.title })
  if (decision.sound) playAlert(kind)
}

function clearVisibleAttention(): void {
  if (document.hasFocus()) useTerminalStore.getState().clearAttention(visibleTabIds())
}

/** Windows gorev cubugu rozeti: kirmizi daire icinde sayi (16 px'te okunur). */
function badgeIcon(count: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#e5484d'
  ctx.beginPath()
  ctx.arc(16, 16, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${count > 9 ? 17 : 22}px Segoe UI, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(count > 9 ? '9+' : String(count), 16, 17)
  return canvas.toDataURL('image/png')
}

/**
 * Gorulen sekmenin isaretini temizler ve gorev cubugu rozetini gunceller.
 * Dinlemeyi birakan fonksiyonu dondurur.
 */
export function startAttention(): () => void {
  let lastBadge = ''
  const badge = (): void => {
    const marked = useTerminalStore.getState().tabs.filter((tab) => tab.attention)
    const needsInput = marked.some((tab) => tab.attention === 'needs-input')
    const key = `${marked.length}:${needsInput}`
    if (key === lastBadge) return
    lastBadge = key
    window.termflow.alerts.setBadge({ count: marked.length, needsInput, icon: marked.length ? badgeIcon(marked.length) : undefined })
  }
  // Isaret yalniz sekmeye gecince ya da pencere odak alinca kalkar; boylece "Mark as unread" gorunur sekmede de kalir.
  const seen = (): void => { clearVisibleAttention(); badge() }
  const unsubscribe = useTerminalStore.subscribe((state, previous) => {
    if (state.activeTabId !== previous.activeTabId || state.paneTree !== previous.paneTree) seen()
    else if (state.tabs !== previous.tabs) badge()
  })
  window.addEventListener('focus', seen)
  return () => {
    unsubscribe()
    window.removeEventListener('focus', seen)
  }
}
