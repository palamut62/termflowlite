// Orchestration dilim 2 (docs/agent-ide/orchestration.md): devir hedefleri ve gorev kuyrugu.
// Gorevler `agentRunner`'la calisir; kayitlar userData/orchestration/tasks.json'da (son 50).

import { randomBytes } from 'crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute } from 'path'
import { agentKindForCommand } from '../../shared/agentEvents'
import type { GitRepoInfo } from '../../shared/ipc'
import { DELEGATE_AGENT_KINDS, type AppSettings, type DelegateAgentKind, type DelegatedTask, type OrchestrationTarget } from '../../shared/types'
import { discardTask, runDelegatedTask, type DelegatedTaskInput, type DelegatedTaskRun } from '../agentRunner'
import { readRepoInfo } from '../worktree'

// Record oldugu icin DELEGATE_AGENT_KINDS'a yeni ajan eklenince etiketi unutmak derlemede hata verir.
const BUILTIN_LABELS: Record<DelegateAgentKind, string> = {
  opencode: 'OpenCode', codex: 'Codex', grok: 'Grok', claude: 'Claude Code', agy: 'Antigravity',
  gemini: 'Gemini CLI', qwen: 'Qwen Code', copilot: 'GitHub Copilot CLI', kimi: 'Kimi', droid: 'Droid'
}
const BUILTIN: readonly [DelegateAgentKind, string][] = DELEGATE_AGENT_KINDS.map((agent) => [agent, BUILTIN_LABELS[agent]])
const MAX_TASKS = 50
const MAX_PROMPT = 20_000
const MAX_CHECK = 2_000
const FINISHED = new Set(['done', 'failed', 'timeout', 'cancelled'])

export interface TargetContext {
  settings: AppSettings
  /** Kurulu ajan profil id'leri (agentDetect). */
  installed: readonly string[]
  hasSecret: (providerId: string) => boolean
}

/** Is verilebilecek hedefler: yerlesik ajanlar + komutu `claude` olan saglayici profilleri. */
export function listTargets(ctx: TargetContext): OrchestrationTarget[] {
  const conf = ctx.settings.orchestration.targets
  const targets: OrchestrationTarget[] = BUILTIN.map(([agent, label]) => ({
    id: agent, label, agent, installed: ctx.installed.includes(agent), enabled: conf[agent]?.enabled !== false, model: conf[agent]?.model ?? ''
  }))
  for (const provider of ctx.settings.providerProfiles) {
    if (agentKindForCommand(provider.command) !== 'claude') continue
    const id = `provider:${provider.id}`
    targets.push({
      id, label: `${provider.name} (Claude Code)`, agent: 'claude', installed: ctx.installed.includes('claude'),
      enabled: conf[id]?.enabled !== false, model: conf[id]?.model || provider.model || '', providerId: provider.id,
      hasCredential: !provider.apiKeyEnv || ctx.hasSecret(provider.id)
    })
  }
  return targets
}

export interface ResolvedTarget {
  id: string
  label: string
  agent: DelegateAgentKind
  model?: string
  env: Record<string, string>
}

/** Hedefi calistirilabilir hale getirir; saglayici anahtari yalniz bu sureclerin env'ine girer. */
export function resolveTarget(ctx: TargetContext, id: string, modelOverride: string | undefined, getSecret: (providerId: string) => string | undefined): ResolvedTarget | { error: string } {
  const target = listTargets(ctx).find((item) => item.id === id)
  if (!target) return { error: `Unknown agent "${id}". Call list_agents for the available ids.` }
  if (!target.installed) return { error: `${target.label} CLI is not installed on this computer.` }
  if (!target.enabled) return { error: `${target.label} is turned off in TermFlow Settings > Orchestration.` }
  const model = modelOverride?.trim() || target.model || undefined
  if (!target.providerId) return { id, label: target.label, agent: target.agent, model, env: {} }
  const provider = ctx.settings.providerProfiles.find((item) => item.id === target.providerId)!
  const env: Record<string, string> = {}
  if (provider.baseUrlEnv && provider.baseUrl) env[provider.baseUrlEnv] = provider.baseUrl
  if (provider.apiKeyEnv) {
    const secret = getSecret(provider.id)
    if (!secret) return { error: `${target.label}: no API key is stored for this provider (Settings > Providers).` }
    env[provider.apiKeyEnv] = secret
  }
  // Profil modeli env ile veriyorsa --model gecilmez (Claude ikisini birlikte alinca env'i ezer).
  if (provider.modelEnv && model) return { id, label: target.label, agent: 'claude', env: { ...env, [provider.modelEnv]: model } }
  return { id, label: target.label, agent: 'claude', model, env }
}

type QueuedTarget = ResolvedTarget & { timeoutS: number }

export interface SubmitInput {
  target: string
  model?: string
  prompt: string
  cwd: string
  checkCommand?: string
  timeoutS?: number
  requestedBy?: string
}

export interface TaskManagerDeps {
  file: string
  getSettings: () => AppSettings
  resolve: (target: string, model?: string) => Promise<ResolvedTarget | { error: string }>
  run?: (input: DelegatedTaskInput) => DelegatedTaskRun
  repoInfo?: (cwd: string) => Promise<GitRepoInfo | null>
  discard?: typeof discardTask
  onChange?: (tasks: DelegatedTask[]) => void
  now?: () => number
  newId?: () => string
}

export class TaskManager {
  private tasks: DelegatedTask[] = []
  private readonly runs = new Map<string, DelegatedTaskRun>()
  private readonly targets = new Map<string, QueuedTarget>()
  private readonly waiters = new Map<string, (() => void)[]>()
  private readonly run: (input: DelegatedTaskInput) => DelegatedTaskRun
  private readonly repoInfo: (cwd: string) => Promise<GitRepoInfo | null>
  private readonly discardImpl: typeof discardTask
  private readonly now: () => number
  private readonly newId: () => string

  constructor(private readonly deps: TaskManagerDeps) {
    this.run = deps.run ?? runDelegatedTask
    this.repoInfo = deps.repoInfo ?? readRepoInfo
    this.discardImpl = deps.discard ?? discardTask
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? (() => randomBytes(4).toString('hex'))
    this.tasks = this.load()
  }

  list(): DelegatedTask[] {
    return structuredClone(this.tasks)
  }

  get(id: string): DelegatedTask | undefined {
    const task = this.tasks.find((item) => item.id === id)
    return task && structuredClone(task)
  }

  async submit(input: SubmitInput): Promise<DelegatedTask | { error: string }> {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) return { error: 'prompt is empty.' }
    if (prompt.length > MAX_PROMPT) return { error: `prompt is longer than ${MAX_PROMPT} characters.` }
    if (typeof input.cwd !== 'string' || !isAbsolute(input.cwd)) return { error: 'cwd must be an absolute path inside a git repository.' }
    const checkCommand = typeof input.checkCommand === 'string' ? input.checkCommand.trim() : ''
    if (checkCommand.length > MAX_CHECK) return { error: `check_command is longer than ${MAX_CHECK} characters.` }
    const repo = await this.repoInfo(input.cwd)
    if (!repo) return { error: `Not inside a git repository: ${input.cwd}` }
    const resolved = await this.deps.resolve(String(input.target ?? ''), input.model)
    if ('error' in resolved) return resolved
    const settings = this.deps.getSettings().orchestration
    const timeoutS = typeof input.timeoutS === 'number' && Number.isFinite(input.timeoutS)
      ? Math.min(3600, Math.max(30, Math.round(input.timeoutS)))
      : settings.timeoutMinutes * 60
    const id = this.newId()
    const task: DelegatedTask = {
      id, target: resolved.id, label: resolved.label, ...(resolved.model ? { model: resolved.model } : {}),
      prompt, repoRoot: repo.root, ...(input.requestedBy ? { requestedBy: String(input.requestedBy).slice(0, 100) } : {}),
      ...(checkCommand ? { checkCommand } : {}), status: 'queued', createdAt: this.now(), branch: `deleg/${id}`,
      lastMessage: '', exitCode: null, diffStat: '', changedFiles: [], outputTail: ''
    }
    this.targets.set(id, { ...resolved, timeoutS })
    this.tasks.unshift(task)
    this.trim()
    this.changed()
    this.pump()
    return structuredClone(this.tasks.find((item) => item.id === id)!)
  }

  /** Kuyruktaki gorev hemen iptal olur; calisan gorevin sureci (agaciyla) oldurulur. */
  cancel(id: string): DelegatedTask | undefined {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return undefined
    if (task.status === 'queued') {
      this.finish(id, { status: 'cancelled', error: 'Cancelled before it started' })
    } else if (task.status === 'running') {
      this.runs.get(id)?.cancel()
    }
    return this.get(id)
  }

  /** Worktree'yi ve dali siler, kaydi listeden kaldirir. Calisan gorev once iptal edilir. */
  async discard(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return { ok: false, error: `Unknown task "${id}".` }
    if (!FINISHED.has(task.status)) {
      this.cancel(id)
      await this.wait(id, 15_000)
    }
    const current = this.tasks.find((item) => item.id === id)
    if (current && !FINISHED.has(current.status)) return { ok: false, error: 'Task is still stopping; try again.' }
    if (current?.worktreePath) {
      const removed = await this.discardImpl(current.repoRoot, { worktreePath: current.worktreePath, branch: current.branch })
      if (!removed.ok) return removed
    }
    this.tasks = this.tasks.filter((item) => item.id !== id)
    this.changed()
    return { ok: true }
  }

  /** Gorev bitene ya da sure dolana kadar bekler; bilinmeyen gorevde undefined. */
  wait(id: string, ms: number): Promise<DelegatedTask | undefined> {
    const task = this.tasks.find((item) => item.id === id)
    if (!task || FINISHED.has(task.status) || ms <= 0) return Promise.resolve(task && structuredClone(task))
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        resolve(this.get(id))
      }
      const timer = setTimeout(() => {
        this.waiters.set(id, (this.waiters.get(id) ?? []).filter((fn) => fn !== done))
        resolve(this.get(id))
      }, ms)
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), done])
    })
  }

  /** Uygulama kapanirken: calisan surecler oldurulur (kayitlar 'failed' olarak kalir). */
  dispose(): void {
    for (const run of this.runs.values()) run.cancel()
  }

  private pump(): void {
    const limit = this.deps.getSettings().orchestration.maxConcurrent
    const running = (): DelegatedTask[] => this.tasks.filter((item) => item.status === 'running')
    // En eski kuyruk gorevi once; OpenCode ayni anda tek (paralel baslatmada hepsi asildi, dilim 0).
    for (const task of this.tasks.filter((item) => item.status === 'queued').reverse()) {
      const active = running()
      if (active.length >= limit) break
      const target = this.targets.get(task.id)
      if (!target) {
        this.finish(task.id, { status: 'failed', error: 'Task target was lost' })
        continue
      }
      if (target.agent === 'opencode' && active.some((item) => this.targets.get(item.id)?.agent === 'opencode')) continue
      this.start(task, target)
    }
  }

  private start(task: DelegatedTask, target: QueuedTarget): void {
    task.status = 'running'
    task.startedAt = this.now()
    this.changed()
    let run: DelegatedTaskRun
    try {
      run = this.run({
        id: task.id, repoRoot: task.repoRoot, agent: target.agent, model: target.model, prompt: task.prompt,
        checkCommand: task.checkCommand, timeoutMs: target.timeoutS * 1000, env: target.env
      })
    } catch (error) {
      this.finish(task.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      return
    }
    this.runs.set(task.id, run)
    run.done.then(
      (result) => {
        const { id: _id, agent: _agent, durationMs: _duration, ...rest } = result
        this.finish(task.id, rest)
      },
      (error: unknown) => this.finish(task.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
    )
  }

  private finish(id: string, patch: Partial<DelegatedTask>): void {
    const task = this.tasks.find((item) => item.id === id)
    this.runs.delete(id)
    this.targets.delete(id)
    if (task) Object.assign(task, patch, { finishedAt: this.now() })
    this.changed()
    for (const done of this.waiters.get(id) ?? []) done()
    this.waiters.delete(id)
    this.pump()
  }

  /** Bitmis en eski kayitlar dusurulur; calisan/kuyruktaki asla. */
  private trim(): void {
    while (this.tasks.length > MAX_TASKS) {
      const index = this.tasks.map((item) => FINISHED.has(item.status)).lastIndexOf(true)
      if (index < 0) break
      this.tasks.splice(index, 1)
    }
  }

  private changed(): void {
    this.save()
    this.deps.onChange?.(this.list())
  }

  private load(): DelegatedTask[] {
    try {
      const parsed = JSON.parse(readFileSync(this.deps.file, 'utf8')) as { tasks?: DelegatedTask[] }
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter((task) => task && typeof task.id === 'string').slice(0, MAX_TASKS) : []
      // Onceki oturumda yarim kalanlarin sureci yok; worktree durur, Discard ile silinebilir.
      for (const task of tasks) {
        if (!FINISHED.has(task.status)) Object.assign(task, { status: 'failed', error: 'TermFlow closed before the task finished' })
      }
      return tasks
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.deps.file), { recursive: true })
      const temp = `${this.deps.file}.tmp`
      writeFileSync(temp, JSON.stringify({ tasks: this.tasks }))
      renameSync(temp, this.deps.file)
    } catch (error) {
      console.warn('[orchestration] task list could not be saved:', error)
    }
  }
}
