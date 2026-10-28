import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { isValidTabId, type RemoteCommandReply, type RemoteTab, type RemoteTabsState } from '../../shared/remote'
import type { RemoteController } from '../remote/RemoteController'
import { disableElevation, elevationStatus, enableElevation } from '../terminal/elevation'

const ACTIVITIES = new Set(['running', 'waiting', 'unread', 'completed', 'error'])

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

/** The renderer's tab list, reduced to plain validated fields before it reaches a phone. */
export function sanitizeTabs(value: unknown): RemoteTabsState | null {
  if (!value || typeof value !== 'object') return null
  const input = value as { tabs?: unknown; activeTabId?: unknown }
  if (!Array.isArray(input.tabs)) return null
  const tabs: RemoteTab[] = input.tabs.slice(0, 200).flatMap((raw): RemoteTab[] => {
    const tab = raw as Partial<RemoteTab>
    if (!tab || !isValidTabId(tab.id) || typeof tab.profileId !== 'string') return []
    const worktree = tab.worktree && typeof tab.worktree.path === 'string' && typeof tab.worktree.branch === 'string'
      ? { repoRoot: String(tab.worktree.repoRoot ?? ''), path: tab.worktree.path, branch: tab.worktree.branch, createdByApp: tab.worktree.createdByApp === true }
      : undefined
    return [{
      id: tab.id,
      title: text(tab.title, 200) || 'Terminal',
      profileId: tab.profileId.slice(0, 200),
      running: tab.running === true,
      activity: ACTIVITIES.has(tab.activity as string) ? tab.activity! : 'running',
      cwd: text(tab.cwd, 4096),
      model: text(tab.model, 200),
      permissionMode: tab.permissionMode === 'safe' || tab.permissionMode === 'workspace' || tab.permissionMode === 'full' ? tab.permissionMode : undefined,
      worktree,
      visible: tab.visible === true
    }]
  })
  const activeTabId = isValidTabId(input.activeTabId) ? input.activeTabId : null
  return { tabs, activeTabId }
}

export function registerRemoteIpc(controller: RemoteController): void {
  ipcMain.handle(IPC.REMOTE_STATUS, () => controller.status())
  ipcMain.handle(IPC.REMOTE_PAIR, (_event, deviceId: unknown) =>
    controller.startPairing(typeof deviceId === 'string' && /^[0-9a-f]{16}$/.test(deviceId) ? deviceId : undefined))
  ipcMain.handle(IPC.REMOTE_PAIR_CANCEL, () => controller.cancelPairing())
  ipcMain.handle(IPC.ELEVATION_STATUS, () => elevationStatus())
  ipcMain.handle(IPC.ELEVATION_ENABLE, (_event, pin: unknown) => enableElevation(typeof pin === 'string' ? pin : ''))
  ipcMain.handle(IPC.ELEVATION_DISABLE, () => disableElevation())
  ipcMain.handle(IPC.REMOTE_DEVICES, () => controller.listDevices())
  ipcMain.handle(IPC.REMOTE_REVOKE, (_event, deviceId: unknown) => {
    if (deviceId === null) controller.revoke(null)
    else if (typeof deviceId === 'string' && /^[0-9a-f]{16}$/.test(deviceId)) controller.revoke(deviceId)
  })
  ipcMain.on(IPC.REMOTE_TABS, (_event, state: unknown) => {
    const clean = sanitizeTabs(state)
    if (clean) controller.setTabs(clean)
  })
  ipcMain.on(IPC.REMOTE_COMMAND_REPLY, (_event, reply: unknown) => {
    const r = reply as Partial<RemoteCommandReply> | null
    if (!r || typeof r.requestId !== 'string') return
    controller.commandReply({ requestId: r.requestId, ok: r.ok === true, value: r.value, error: typeof r.error === 'string' ? r.error.slice(0, 500) : undefined })
  })
}
