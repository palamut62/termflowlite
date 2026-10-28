import { claudeAccounts, claudeConfigDir, nextClaudeAccount } from '../../shared/claudeAccounts'
import type { TerminalProfile } from '../../shared/types'
import { useSettingsStore } from './store/settingsStore'
import { useTerminalStore } from './store/terminalStore'
import { useToastStore } from './store/toastStore'

/** profile id -> when it last reported a usage limit (this app run only). */
const limitedAt = new Map<string, number>()

/** Same session, another login: share the history folders, resume there, then close this tab so one process writes it. */
export async function continueWithAccount(tabId: string, target: TerminalProfile): Promise<boolean> {
  const store = useTerminalStore.getState()
  const tab = store.tabs.find((t) => t.id === tabId)
  const sessionId = tab?.agentHook?.sessionId ?? tab?.resumeSession?.id
  if (!tab || !sessionId) return false
  const dir = claudeConfigDir(target)
  if (dir) {
    const linked = await window.termflow.files.linkClaudeAccount(dir)
    if (!linked.ok) { useToastStore.getState().show(linked.error ?? 'Could not prepare the account.', 'error'); return false }
  }
  store.resumeAgentSession(target.id, { agent: 'claude', id: sessionId }, tab.cwd || tab.launchCwd, tab.permissionMode)
  store.closeTab(tabId)
  useToastStore.getState().show(`Continuing this session with ${target.name}.`, 'info')
  return true
}

/** A Claude tab reported its usage limit: move the session to the next account that still has room. */
export async function onClaudeLimit(tabId: string): Promise<void> {
  const settings = useSettingsStore.getState().settings
  const tab = useTerminalStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return
  const accounts = claudeAccounts(settings.profiles)
  if (!accounts.some((a) => a.id === tab.profileId)) return
  limitedAt.set(tab.profileId, Date.now())
  if (!settings.autoSwitchClaudeAccount || accounts.length < 2) return
  const target = nextClaudeAccount(accounts, tab.profileId, limitedAt, Date.now())
  if (!target) { useToastStore.getState().show('Every Claude account has hit its limit.', 'error'); return }
  if (!(await continueWithAccount(tabId, target))) useToastStore.getState().show('Limit reached, but this tab has no session to move yet.', 'error')
}
