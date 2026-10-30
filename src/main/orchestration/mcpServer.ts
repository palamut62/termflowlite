import { readFileSync } from 'fs'
import { DELEGATE_AGENT_KINDS, type DelegatedTask } from '../../shared/types'
import type { Endpoint } from './apiServer'

// termflow-agents: koordinator ajanin (Claude Code, Codex, OpenCode) isi baska ajana devrettigi MCP sunucusu.
// Bagimliliksiz stdio JSON-RPC; uygulamanin exe'siyle ELECTRON_RUN_AS_NODE=1 altinda calisir. Hicbir isi
// kendisi yapmaz: her cagri Agent IDE'nin yerel API'sine gider (apiServer.ts).

export const AGENTS_SERVER_NAME = 'termflow-agents'
const FALLBACK_PROTOCOL = '2025-06-18'
const DEFAULT_WAIT_S = 30
const MAX_WAIT_S = 55

const INSTRUCTIONS = [
  'TermFlow Agent IDE orchestration: delegate self-contained, mechanical coding tasks (tests, docs, small refactors,',
  'boilerplate, one-file changes with clear acceptance criteria) to other coding agents and models, often free ones,',
  'to save your own usage limits. Call list_agents first: it shows the available agents, their models, which are free',
  'and your current usage. Each task runs headless in its own git worktree that starts from the last commit (HEAD),',
  'so uncommitted changes are not visible to it. Give a precise prompt with file paths and acceptance criteria, and a',
  'check_command (for example a single test file) whenever possible. Review the returned diff before applying it with',
  'git cherry-pick <commit>, then discard_task. Do not delegate security-sensitive, architectural or hard-to-reverse',
  'work. If the same task fails twice, do it yourself instead of retrying.'
].join(' ')

const TOOLS = [
  {
    name: 'list_agents',
    description: 'Agents and models you can delegate to (installed, enabled, free or paid) and your own usage limits with a delegation hint.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'delegate_task',
    description: 'Start a task on another agent in an isolated git worktree. Returns a task id at once; then call get_task_result.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: `Agent id from list_agents: ${DELEGATE_AGENT_KINDS.join(', ')} or "provider:<id>".` },
        prompt: { type: 'string', description: 'Complete, self-contained instructions: files to touch, expected behavior, what not to change.' },
        cwd: { type: 'string', description: 'Absolute path inside the git repository to work on (usually your current directory).' },
        model: { type: 'string', description: 'Optional model id; defaults to the one chosen in TermFlow settings.' },
        check_command: { type: 'string', description: 'Optional shell command run in the worktree afterwards; exit code 0 means accepted.' },
        timeout_s: { type: 'number', description: 'Optional time limit in seconds (30-3600).' }
      },
      required: ['agent', 'prompt', 'cwd']
    }
  },
  {
    name: 'get_task_result',
    description: 'Wait for a delegated task (up to wait_s seconds) and return its status, diff summary, check result and the agent\'s last message.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        wait_s: { type: 'number', description: `Seconds to wait for completion (0-${MAX_WAIT_S}, default ${DEFAULT_WAIT_S}).` },
        full_diff: { type: 'boolean', description: 'Include the full diff of the task commit.' }
      },
      required: ['task_id']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'list_tasks',
    description: 'Recent delegated tasks with their status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'cancel_task',
    description: 'Stop a queued or running task (its whole process tree).',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] }
  },
  {
    name: 'discard_task',
    description: 'Delete the task worktree and branch. Do this after applying (or rejecting) the result.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    annotations: { destructiveHint: true }
  }
]

export interface ApiResponse {
  status: number
  body: Record<string, unknown>
}

export type ApiClient = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<ApiResponse>

const text = (value: string, isError = false): Record<string, unknown> => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) })

const seconds = (task: DelegatedTask): string => {
  const end = task.finishedAt ?? Date.now()
  return task.startedAt ? `${Math.round((end - task.startedAt) / 1000)} s` : 'not started'
}

/** Koordinatorun okuyacagi sonuc metni: once karar icin gerekenler, sonra ayrinti. */
export function formatTask(task: DelegatedTask, diff?: string): string {
  const lines = [
    `Task ${task.id}: ${task.status.toUpperCase()}`,
    `Agent: ${task.label}${task.model ? ` (${task.model})` : ''} · ${seconds(task)}${task.cost !== undefined ? ` · $${task.cost.toFixed(4)}` : ''}${task.tokens ? ` · ${task.tokens} tokens` : ''}`,
    `Repository: ${task.repoRoot} · branch ${task.branch}${task.worktreePath ? ` · worktree ${task.worktreePath}` : ''}`
  ]
  if (task.error) lines.push(`Error: ${task.error}`)
  if (task.status === 'queued' || task.status === 'running') {
    lines.push(`Still ${task.status}. Call get_task_result again with task_id "${task.id}".`)
    return lines.join('\n')
  }
  if (task.changedFiles.length) lines.push('', `Changed files (${task.changedFiles.length}):`, ...task.changedFiles.slice(0, 50).map((file) => `- ${file}`))
  if (task.diffStat) lines.push('', task.diffStat)
  if (task.check) lines.push('', `Check "${task.checkCommand ?? ''}": exit ${task.check.code ?? 'none'}${task.check.timedOut ? ' (timed out)' : ''}`, task.check.output)
  if (task.lastMessage) lines.push('', 'Agent\'s last message:', task.lastMessage.slice(0, 4000))
  if (task.status !== 'done' && task.outputTail) lines.push('', 'Agent output (tail):', task.outputTail.slice(-2000))
  if (diff) lines.push('', 'Full diff:', diff)
  lines.push('')
  if (task.commit) {
    lines.push(`Commit ${task.commit} on ${task.branch}. Review it${diff ? '' : ' (full_diff: true shows it)'}; to apply run in your checkout: git cherry-pick ${task.commit}`)
    lines.push(`Then call discard_task with task_id "${task.id}".`)
  } else if (task.worktreePath) {
    lines.push(`Nothing to apply. Call discard_task with task_id "${task.id}" to remove the worktree.`)
  }
  if (task.status !== 'done') lines.push('If this task already failed once, do the work yourself instead of retrying.')
  return lines.join('\n')
}

const id = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export class AgentsMcpServer {
  private clientName = ''

  constructor(private readonly api: ApiClient) {}

  async handle(message: unknown): Promise<Record<string, unknown> | null> {
    const request = (message && typeof message === 'object' ? message : {}) as { id?: string | number | null; method?: string; params?: Record<string, unknown> }
    const isNotification = request.id === undefined
    const reply = (result: Record<string, unknown>): Record<string, unknown> | null => isNotification ? null : { jsonrpc: '2.0', id: request.id, result }
    switch (request.method) {
      case 'initialize': {
        const info = request.params?.clientInfo as { name?: unknown } | undefined
        this.clientName = typeof info?.name === 'string' ? info.name.slice(0, 100) : ''
        const requested = request.params?.protocolVersion
        return reply({
          protocolVersion: typeof requested === 'string' ? requested : FALLBACK_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: AGENTS_SERVER_NAME, title: 'TermFlow Agent IDE Orchestration', version: '1.0.0' },
          instructions: INSTRUCTIONS
        })
      }
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call':
        return reply(await this.callTool(String(request.params?.name ?? ''), (request.params?.arguments ?? {}) as Record<string, unknown>))
      default:
        if (request.method?.startsWith('notifications/')) return null
        return isNotification ? null : { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: `Method not found: ${request.method ?? ''}` } }
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      switch (name) {
        case 'list_agents': {
          const { status, body } = await this.api('GET', '/v1/agents')
          return status === 200 ? text(String(body.report ?? JSON.stringify(body))) : this.failure(body)
        }
        case 'delegate_task': {
          const { status, body } = await this.api('POST', '/v1/tasks', { ...args, requested_by: this.clientName || undefined })
          if (status !== 201) return this.failure(body)
          const task = body.task as DelegatedTask
          return text([
            `Task ${task.id} ${task.status} on ${task.label}${task.model ? ` (${task.model})` : ''}, branch ${task.branch}.`,
            'It starts from the last commit (HEAD); your uncommitted changes are not visible to it.',
            `Call get_task_result with task_id "${task.id}" to wait for the result.`
          ].join('\n'))
        }
        case 'get_task_result': {
          const taskId = id(args.task_id)
          if (!taskId) return text('task_id is required.', true)
          const wait = typeof args.wait_s === 'number' ? Math.min(MAX_WAIT_S, Math.max(0, args.wait_s)) : DEFAULT_WAIT_S
          const { status, body } = await this.api('GET', `/v1/tasks/${encodeURIComponent(taskId)}?wait=${wait}${args.full_diff === true ? '&full_diff=1' : ''}`)
          return status === 200 ? text(formatTask(body.task as DelegatedTask, body.diff as string | undefined)) : this.failure(body)
        }
        case 'list_tasks': {
          const { status, body } = await this.api('GET', '/v1/tasks')
          if (status !== 200) return this.failure(body)
          const tasks = (body.tasks as DelegatedTask[]) ?? []
          return text(tasks.length
            ? tasks.map((task) => `- ${task.id} ${task.status} · ${task.label}${task.model ? ` (${task.model})` : ''} · ${task.prompt.split('\n')[0].slice(0, 80)}`).join('\n')
            : 'No delegated tasks yet.')
        }
        case 'cancel_task':
        case 'discard_task': {
          const taskId = id(args.task_id)
          if (!taskId) return text('task_id is required.', true)
          const action = name === 'cancel_task' ? 'cancel' : 'discard'
          const { status, body } = await this.api('POST', `/v1/tasks/${encodeURIComponent(taskId)}/${action}`)
          if (status !== 200) return this.failure(body)
          return text(action === 'cancel' ? formatTask(body.task as DelegatedTask) : `Task ${taskId} discarded: worktree and branch removed.`)
        }
        default:
          return text(`Unknown tool: ${name}`, true)
      }
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true)
    }
  }

  private failure(body: Record<string, unknown>): Record<string, unknown> {
    return text(typeof body.error === 'string' ? body.error : 'TermFlow returned an error.', true)
  }
}

const NOT_RUNNING = 'TermFlow Agent IDE is not running or Orchestration is off (Settings > Orchestration).'

/** Endpoint dosyasini her cagrida okur: uygulama yeniden acilinca yeni port/token kendiliginden kullanilir. */
export function httpClient(endpointFile: string, fetchImpl: typeof fetch = fetch): ApiClient {
  return async (method, path, body) => {
    let endpoint: Endpoint
    try {
      endpoint = JSON.parse(readFileSync(endpointFile, 'utf8')) as Endpoint
    } catch {
      throw new Error(NOT_RUNNING)
    }
    let response: Response
    try {
      response = await fetchImpl(`${endpoint.url}${path}`, {
        method,
        headers: { 'x-termflow-token': endpoint.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      })
    } catch {
      throw new Error(NOT_RUNNING)
    }
    const json = await response.json().catch(() => ({})) as Record<string, unknown>
    return { status: response.status, body: json }
  }
}
