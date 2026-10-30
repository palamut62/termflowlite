import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { ORCHESTRATION_TARGET_ID, type AppSettings, type MemoryAgent, type MemoryConnection, type OpenRouterModelList, type OrchestrationStatus, type OrchestrationTestResult } from '../../shared/types'
import { connect, connectionStatus, disconnect, type ServerLaunch } from '../memory/connect'
import { OrchestrationServer } from '../orchestration/apiServer'
import { AGENTS_SERVER_NAME } from '../orchestration/mcpServer'
import type { OrchestrationService } from '../orchestration/service'

// Orchestration (docs/agent-ide/orchestration.md): yalniz Agent IDE surumunde servis vardir; Lite'ta
// kanallar bos cevap verir ki renderer hata almasin.

const AGENTS: MemoryAgent[] = ['claude', 'codex', 'opencode']
const TASK_ID = /^[a-z0-9]{1,32}$/
const TARGET_ID = ORCHESTRATION_TARGET_ID

export interface OrchestrationDeps {
  service: OrchestrationService | null
  endpointFile: string
  /** null: sunucu betigi kurulamadi; MCP kaydi yapilamaz. */
  launch: ServerLaunch | null
}

export interface OrchestrationController {
  settingsChanged(settings: AppSettings): void
  shutdown(): void
}

export function registerOrchestrationIpc({ service, endpointFile, launch }: OrchestrationDeps, initial: AppSettings): OrchestrationController {
  let server: OrchestrationServer | null = null
  let status: OrchestrationStatus = { running: false }

  const apply = (settings: AppSettings): void => {
    const want = Boolean(service) && settings.orchestration.enabled
    if (want && !server && service) {
      const next = new OrchestrationServer(endpointFile, service.api())
      server = next
      next.start().then(
        () => { status = { running: true } },
        (error: unknown) => {
          status = { running: false, error: error instanceof Error ? error.message : String(error) }
          if (server === next) server = null
        }
      )
    } else if (!want && server) {
      server.stop()
      server = null
      status = { running: false }
    }
  }

  ipcMain.handle(IPC.ORCH_STATUS, (): OrchestrationStatus => status)
  ipcMain.handle(IPC.ORCH_TARGETS, async () => service ? service.targets() : [])
  ipcMain.handle(IPC.ORCH_TASKS, () => service ? service.manager.list() : [])
  ipcMain.handle(IPC.ORCH_CANCEL, (_event, id: unknown) => service && typeof id === 'string' && TASK_ID.test(id) ? service.manager.cancel(id) ?? null : null)
  ipcMain.handle(IPC.ORCH_DISCARD, async (_event, id: unknown) => {
    if (!service || typeof id !== 'string' || !TASK_ID.test(id)) return { ok: false, error: 'Unknown task' }
    return service.manager.discard(id)
  })
  ipcMain.handle(IPC.ORCH_MODELS, async (_event, targetId: unknown, force: unknown): Promise<OpenRouterModelList> => {
    if (!service || typeof targetId !== 'string' || !TARGET_ID.test(targetId)) return { models: [], fetchedAt: 0, source: 'none' }
    return service.models(targetId, force === true)
  })
  ipcMain.handle(IPC.ORCH_TEST, async (_event, targetId: unknown, model: unknown): Promise<OrchestrationTestResult> => {
    if (!service || typeof targetId !== 'string' || !TARGET_ID.test(targetId)) return { ok: false, status: 'failed', latencyMs: 0, error: 'Unknown target' }
    const id = typeof model === 'string' && model.trim().length <= 200 ? model.trim() : undefined
    return service.test(targetId, id)
  })

  const unavailable = (agent: MemoryAgent): MemoryConnection => ({ agent, state: 'error', detail: 'Orchestration server is not installed. Restart TermFlow Agent IDE.' })
  const isAgent = (value: unknown): value is MemoryAgent => AGENTS.includes(value as MemoryAgent)
  ipcMain.handle(IPC.ORCH_CONNECTIONS, async (): Promise<MemoryConnection[]> =>
    Promise.all(AGENTS.map((agent) => launch ? connectionStatus(agent, launch, undefined, AGENTS_SERVER_NAME) : unavailable(agent))))
  ipcMain.handle(IPC.ORCH_CONNECT, async (_event, agent: unknown): Promise<MemoryConnection | null> => {
    if (!isAgent(agent)) return null
    return launch ? connect(agent, launch, undefined, AGENTS_SERVER_NAME) : unavailable(agent)
  })
  ipcMain.handle(IPC.ORCH_DISCONNECT, async (_event, agent: unknown): Promise<MemoryConnection | null> => {
    if (!isAgent(agent)) return null
    try {
      await disconnect(agent, undefined, AGENTS_SERVER_NAME)
    } catch (error) {
      return { agent, state: 'error', detail: error instanceof Error ? error.message.split('\n')[0] : String(error) }
    }
    return launch ? connectionStatus(agent, launch, undefined, AGENTS_SERVER_NAME) : { agent, state: 'disconnected' }
  })

  apply(initial)
  return {
    settingsChanged: apply,
    shutdown: () => {
      service?.manager.dispose()
      server?.stop()
      server = null
    }
  }
}

export function sendOrchestrationTasks(window: BrowserWindow | null, tasks: unknown): void {
  if (window && !window.isDestroyed()) window.webContents.send(IPC.ORCH_TASKS_EVENT, tasks)
}
