import type { AgentEventKind, AgentKind, AgentPermissionMode } from '../../../shared/types'
import type { AgentHookEvent, AgentHookState } from '../../../shared/agentHooks'
import { useTerminalStore } from '../store/terminalStore'
import { useAgentEventStore } from '../store/agentEventStore'
import { raiseAttention } from '../attention/alerts'
import { pickStartedSession } from './agentResume'
import { onClaudeLimit } from '../claudeFailover'

/** Hook'lu sekmede bu olaylar yalniz ajanin kendi bildiriminden gelir, cikti metninden degil. */
export const HOOK_OWNED_KINDS = new Set<AgentEventKind>(['approval', 'question', 'completed', 'error'])

const INBOX: Partial<Record<AgentHookState, { kind: AgentEventKind; title: string }>> = {
  'needs-input': { kind: 'approval', title: 'Needs your input' },
  done: { kind: 'completed', title: 'Turn finished' },
  error: { kind: 'error', title: 'Turn failed' }
}

export function hasAgentHook(tabId: string): boolean {
  return Boolean(useTerminalStore.getState().tabs.find((tab) => tab.id === tabId)?.agentHook)
}

/** Sekme durumunu gunceller; dikkat isteyen gecisleri Agent Inbox'a yazar. */
export function applyHookEvent(tabId: string, agent: AgentKind, permissionMode: AgentPermissionMode, event: AgentHookEvent): void {
  const store = useTerminalStore.getState()
  if (!store.tabs.some((tab) => tab.id === tabId)) return
  const previous = store.tabs.find((tab) => tab.id === tabId)?.agentHook?.state
  store.applyAgentHook(tabId, event)
  if (agent === 'claude' && event.limit) void onClaudeLimit(tabId)
  if (!event.state || event.state === previous) return
  const inbox = INBOX[event.state]
  if (inbox) useAgentEventStore.getState().append(tabId, agent, permissionMode, { ...inbox, ...(event.detail ? { detail: event.detail } : {}) })
  // Ajan yeniden calisiyorsa artik kimseyi beklemiyor; okunmadi isareti kalkar.
  if (event.state === 'working') useTerminalStore.getState().clearAttention([tabId])
  else if (event.state === 'needs-input' || event.state === 'done' || event.state === 'error') raiseAttention(tabId, agent, event.state, event.detail)
  // Codex OSC 9 oturum kimligi tasimaz; ilk turdan sonra yerel oturum dosyasindan eslenir (agent-resume).
  if (agent === 'codex' && event.state === 'done') void findCodexSession(tabId)
}

async function findCodexSession(tabId: string): Promise<void> {
  const tab = useTerminalStore.getState().tabs.find((item) => item.id === tabId)
  const cwd = tab?.cwd || tab?.launchCwd
  if (!tab || !cwd || tab.agentHook?.sessionId || tab.resumeSession) return
  const sessions = await window.termflow.agentSessions.list({ agents: ['codex'], limit: 30 }).catch(() => [])
  const current = useTerminalStore.getState()
  const taken = new Set(current.tabs.flatMap((item) => [item.agentHook?.sessionId, item.resumeSession?.id]).filter((id): id is string => Boolean(id)))
  const id = pickStartedSession(sessions, cwd, tab.startedAt, taken)
  if (id && current.tabs.some((item) => item.id === tabId)) current.applyAgentHook(tabId, { sessionId: id })
}

/** Ana surecten gelen Claude hook olaylari; dinlemeyi birakan fonksiyonu dondurur. */
export function subscribeAgentHooks(): () => void {
  return window.termflow.agentHooks.onEvent((tabId, event) => {
    const tab = useTerminalStore.getState().tabs.find((item) => item.id === tabId)
    if (tab) applyHookEvent(tabId, 'claude', tab.permissionMode ?? 'workspace', event)
  })
}
