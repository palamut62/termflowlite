import type { RemoteSavedCommand, RemoteTabCommand, RemoteTabsState } from '../../shared/remote'
import { paneTerminalIds } from './paneUtils'
import { restartHandlers, useTerminalStore } from './store/terminalStore'
import { useSavedCommandStore } from './store/savedCommandStore'
import { useSettingsStore } from './store/settingsStore'

const PUBLISH_DEBOUNCE_MS = 100

/** The desktop tab list as phones see it. */
export function remoteTabsState(): RemoteTabsState {
  const { tabs, activeTabId, paneTree } = useTerminalStore.getState()
  const shown = paneTree ? new Set(paneTerminalIds(paneTree)) : new Set(activeTabId ? [activeTabId] : [])
  return {
    activeTabId,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      profileId: tab.profileId,
      running: tab.running,
      activity: tab.activity,
      cwd: tab.cwd,
      model: tab.model,
      permissionMode: tab.permissionMode,
      worktree: tab.worktree,
      visible: shown.has(tab.id)
    }))
  }
}

function requireTab(tabId: string): void {
  if (!useTerminalStore.getState().tabs.some((tab) => tab.id === tabId)) throw new Error('That tab is no longer open.')
}

/** Run one phone command against the desktop stores. */
export function runRemoteCommand(command: RemoteTabCommand): unknown {
  const terminals = useTerminalStore.getState()
  switch (command.kind) {
    case 'open':
      // Opened in the background so the desktop layout is left alone.
      return terminals.addTab(command.profileId, false, command.cwd, command.launchCommand, command.permissionMode, undefined, command.elevated === true)
    case 'close':
      requireTab(command.tabId)
      terminals.closeTab(command.tabId)
      return true
    case 'rename':
      requireTab(command.tabId)
      terminals.renameTab(command.tabId, command.title.trim() || 'Terminal')
      return true
    case 'focus':
      requireTab(command.tabId)
      terminals.setActiveTab(command.tabId)
      return true
    case 'restart': {
      const restart = restartHandlers.get(command.tabId)
      if (!restart) throw new Error('That tab is no longer open.')
      restart()
      return true
    }
    case 'resume':
      return terminals.resumeAgentSession(command.profileId, command.session, command.cwd, command.permissionMode)
    case 'saved-list':
      return useSavedCommandStore.getState().commands.map((item): RemoteSavedCommand => ({
        id: item.id,
        name: item.name,
        command: item.command,
        profileId: item.profileId || undefined,
        cwd: item.cwd || undefined
      }))
    case 'saved-run': {
      const saved = useSavedCommandStore.getState()
      const item = saved.commands.find((candidate) => candidate.id === command.id)
      if (!item) throw new Error('That saved command no longer exists.')
      if (item.activeTabId) throw new Error('That command is already running.')
      if (!item.profileId) throw new Error('Pick a profile for this command on the desktop first.')
      const tabId = terminals.addTab(item.profileId, false, item.cwd || undefined, item.command)
      saved.startRun(item.id, tabId, Date.now())
      return tabId
    }
  }
}

/**
 * Desktop side of Remote Access: publishes the tab list to the main process,
 * runs tab commands sent from a phone and applies settings a phone changed.
 */
export function startRemoteBridge(): () => void {
  const api = window.termflow.remote
  const publish = (): void => api.publishTabs(remoteTabsState())
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = useTerminalStore.subscribe((state, previous) => {
    if (state.tabs === previous.tabs && state.activeTabId === previous.activeTabId && state.paneTree === previous.paneTree) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS)
  })
  publish()

  const offCommand = api.onCommand(({ requestId, command }) => {
    try {
      const value = runRemoteCommand(command)
      // The phone acts on the new tab right away, so it must know about it first.
      publish()
      api.reply({ requestId, ok: true, value })
    } catch (error) {
      api.reply({ requestId, ok: false, error: error instanceof Error ? error.message : 'The desktop could not do that.' })
    }
  })

  const offSettings = window.termflow.settings.onChanged((settings) => {
    useSettingsStore.setState({ settings })
    useSettingsStore.getState().applyTheme()
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
    offCommand()
    offSettings()
  }
}
