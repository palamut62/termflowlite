import { useEffect, useState } from 'react'
import type { AgentTask } from '../../../shared/ipc'
import { resolveDefaultProfileId, useSettingsStore } from '../store/settingsStore'
import { useTerminalStore } from '../store/terminalStore'

/** Cikti dosyasi gorev bitince de kalir; son bu kadar sure icinde yazilan "aktif" sayilir. */
// shortcut: recency stands in for "still running", Claude Code exposes no task state on disk; switch if it ever does.
export const ACTIVE_TASK_MS = 10 * 60_000
const POLL_MS = 5000

export function activeTasks(tasks: readonly AgentTask[], now: number): AgentTask[] {
  return tasks.filter((t) => now - t.mtimeMs < ACTIVE_TASK_MS)
}

/** Cikti dosyasini canli izleyen komut; sekme bu komutu kabuksuz calistirir (prepareLaunch). */
export function watchTaskCommand(path: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    const p = path.replace(/'/g, "''")
    return `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Content -LiteralPath '${p}' -Encoding UTF8 -Tail 1000 -Wait`
  }
  return `tail -n 1000 -F '${path.replace(/'/g, "'\\''")}'`
}

/** Sekme ve menu adi: alt ajan `agent <ad>`, shell gorevi `task <id>`. */
export function taskName(task: AgentTask): string {
  return task.label ? `agent ${task.label}` : `task ${task.id}`
}

/** Claude oturumunun arka plan gorevleri; oturum varken birkac saniyede bir yenilenir. */
export function useAgentTasks(sessionId: string | undefined): AgentTask[] {
  const [tasks, setTasks] = useState<AgentTask[]>([])
  useEffect(() => {
    if (!sessionId) { setTasks([]); return }
    let alive = true
    const load = (): void => { void window.termflow.agentSessions.tasks(sessionId).then((list) => { if (alive) setTasks(list) }).catch(() => undefined) }
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [sessionId])
  return tasks
}

const watchTabs = new Map<string, string>()

/** Gorevi kendi sekmesinde acar; zaten aciksa ona gecer. */
export function openTaskTab(task: AgentTask, cwd?: string): void {
  const store = useTerminalStore.getState()
  const existing = watchTabs.get(task.path)
  if (existing && store.tabs.some((t) => t.id === existing)) { store.setActiveTab(existing); return }
  const platform = window.termflow.system.platform
  const { settings, shells } = useSettingsStore.getState()
  const shell = platform === 'win32' ? 'powershell' : resolveDefaultProfileId(settings, shells)
  const id = store.addTab(shell, true, cwd, task.command ?? watchTaskCommand(task.path, platform))
  store.renameTab(id, taskName(task))
  watchTabs.set(task.path, id)
}
