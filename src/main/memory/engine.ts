import { DEFAULT_SETTINGS, type MemoryStatus } from '../../shared/types'
import { isMeaningful, renderDigest, type SessionDigest } from './extract'
import { chat as defaultChat, OpenRouterError, type ChatRequest, type ChatResult } from './openrouter'
import { normalizePath, projectKey, projectRoot } from './projectKey'
import { mergeMessages, parseSessionSummary, projectMarkdown, SESSION_SCHEMA, sessionMessages } from './prompts'
import { listSources as defaultListSources, readDigest as defaultReadDigest, type SessionSource } from './sources'
import { RETENTION_MS, type MemoryStore, type StoredSession } from './store'

/** Bu süreden yeni değişen session hâlâ sürüyor sayılır, bir sonraki tura kalır. */
export const LIVE_MS = 10 * 60 * 1000
/** Bir turda en fazla özetlenecek session (ilk taramada maliyeti sınırlar; kalanı sonraki tura). */
export const MAX_SESSIONS_PER_RUN = 40
const CONCURRENCY = 3

export interface MemoryConfig {
  enabled: boolean
  model: string
  excludedProjects: string[]
}

export interface MemoryEngineOptions {
  store: MemoryStore
  getConfig: () => MemoryConfig
  getApiKey: () => string | undefined
  listSources?: (cutoff: number) => Promise<SessionSource[]>
  readDigest?: (source: SessionSource) => Promise<SessionDigest>
  chat?: (request: ChatRequest) => Promise<ChatResult>
  now?: () => number
  onStatus?: (status: MemoryStatus) => void
}

export interface RunOptions {
  /** Elle "Update now": canlı session'ları da al. */
  force?: boolean
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  })
  await Promise.all(workers)
}

export class MemoryEngine {
  private running: Promise<MemoryStatus> | null = null
  private runningForce = false
  private queuedForce: Promise<MemoryStatus> | null = null
  /** clear()/forget() bunu artirir: devam eden tur kendi yazimlarini iptal eder. */
  private generation = 0
  private status: MemoryStatus

  constructor(private readonly options: MemoryEngineOptions) {
    const state = options.store.getState()
    this.status = {
      state: 'idle',
      projects: options.store.listProjects().length,
      ...(state.lastRunAt ? { lastRunAt: state.lastRunAt } : {}),
      ...(state.lastError ? { lastError: state.lastError } : {}),
      ...(state.usage ? { usage: state.usage } : {})
    }
  }

  getStatus(): MemoryStatus {
    const config = this.options.getConfig()
    if (this.status.state === 'running') return { ...this.status }
    if (!config.enabled) return { ...this.status, state: 'disabled' }
    if (!this.options.getApiKey()) return { ...this.status, state: 'no-key' }
    return { ...this.status }
  }

  private emit(patch: Partial<MemoryStatus>): void {
    this.status = { ...this.status, ...patch }
    this.options.onStatus?.(this.getStatus())
  }

  run(options: RunOptions = {}): Promise<MemoryStatus> {
    if (!this.running) {
      this.runningForce = options.force === true
      this.running = this.execute(options).finally(() => { this.running = null; this.runningForce = false })
      return this.running
    }
    if (!options.force || this.runningForce) return this.running
    // "Run now": calisan zamanlanmis tur taze oturumlari atlar, o yuzden elle
    // baslatilan tur yutulmaz, siraya alinir.
    this.queuedForce ??= this.running.catch(() => undefined).then(() => {
      this.queuedForce = null
      return this.run(options)
    })
    return this.queuedForce
  }

  /** Hariç tutulan projenin bütün verisini siler. */
  forget(key: string): void {
    const { store } = this.options
    this.generation++
    store.forgetProject(normalizePath(key))
    store.writeIndex(this.now())
    this.emit({ projects: store.listProjects().length })
  }

  clear(): void {
    this.generation++
    this.options.store.clear()
    this.status = { state: 'idle', projects: 0 }
    this.options.onStatus?.(this.getStatus())
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async execute({ force = false }: RunOptions): Promise<MemoryStatus> {
    // Tur sirasinda kullanici "Clear"/"Forget" derse yazimlar durur: silinen veri geri gelmesin.
    const generation = this.generation
    const stale = (): boolean => generation !== this.generation
    const config = this.options.getConfig()
    const apiKey = this.options.getApiKey()
    if (!config.enabled || !apiKey) return this.getStatus()
    const { store } = this.options
    const chat = this.options.chat ?? ((request: ChatRequest) => defaultChat(request))
    const listSources = this.options.listSources ?? defaultListSources
    const readDigest = this.options.readDigest ?? defaultReadDigest
    const model = config.model.trim() || DEFAULT_SETTINGS.memory.model
    const now = this.now()
    const excluded = new Set(config.excludedProjects.map((key) => normalizePath(key)))
    const usage = { promptTokens: 0, completionTokens: 0, requests: 0, cost: 0 }
    const errors: string[] = []
    let fatal: string | undefined

    const call = async (request: Omit<ChatRequest, 'apiKey' | 'model'>): Promise<ChatResult> => {
      const result = await chat({ ...request, apiKey, model })
      usage.requests++
      usage.promptTokens += result.usage.promptTokens
      usage.completionTokens += result.usage.completionTokens
      usage.cost += result.usage.cost ?? 0
      return result
    }
    const isFatal = (error: unknown): boolean => error instanceof OpenRouterError && [401, 402, 404].includes(error.status ?? 0)

    this.emit({ state: 'running', done: 0, total: 0, lastError: undefined })
    try {
      const affected = store.prune(now, excluded)
      for (const key of excluded) if (store.readProject(key) !== null) store.deleteProject(key)

      const sources = await listSources(now - RETENTION_MS)
      const pending = sources.filter((source) => {
        if (!force && source.mtime > now - LIVE_MS) return false
        const cached = store.getSession(source.agent, source.id)
        return !cached || cached.source.mtime !== source.mtime || cached.source.size !== source.size
      }).slice(0, MAX_SESSIONS_PER_RUN)
      this.emit({ total: pending.length })

      let done = 0
      await pool(pending, CONCURRENCY, async (source) => {
        if (fatal || stale()) return
        try {
          const digest = await readDigest(source)
          const key = digest.cwd ? projectKey(digest.cwd) : undefined
          if (key && excluded.has(key)) return
          const previous = store.getSession(source.agent, source.id)
          const record: StoredSession = {
            agent: source.agent,
            id: source.id,
            source: { mtime: source.mtime, size: source.size },
            updatedAt: digest.updatedAt ?? source.mtime,
            ...(digest.startedAt ? { startedAt: digest.startedAt } : {}),
            ...(key ? { projectKey: key, projectPath: projectRoot(digest.cwd!) } : {}),
            files: digest.files.slice(-30),
            interrupted: digest.interrupted,
            summary: null
          }
          if (key && isMeaningful(digest)) {
            const { content } = await call({ messages: sessionMessages(renderDigest(digest)), jsonSchema: SESSION_SCHEMA, maxTokens: 4_000 })
            record.summary = parseSessionSummary(content)
            if (!record.summary) throw new Error('model answer was not valid JSON')
            affected.add(key)
          }
          if (previous?.projectKey && previous.projectKey !== key) affected.add(previous.projectKey)
          if (stale()) return
          store.putSession(record)
        } catch (error) {
          if (isFatal(error)) fatal = (error as Error).message
          else errors.push(`${source.agent} ${source.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          this.emit({ done: ++done })
        }
      })

      if (!fatal && !stale()) {
        for (const key of affected) {
          if (excluded.has(key) || stale()) continue
          const sessions = store.sessionsForProject(key)
          if (!sessions.length) {
            store.deleteProject(key)
            continue
          }
          const path = sessions.at(-1)!.projectPath ?? key
          try {
            const result = await call({ messages: mergeMessages(path, sessions), maxTokens: 6_000 })
            // Kesilen cevapta yarım kalan son satırı at.
            const body = result.truncated ? result.content.replace(/\n[^\n]*$/, '') : result.content
            if (!stale()) store.writeProject(key, projectMarkdown({ key, path, body, now, sessions }))
          } catch (error) {
            if (isFatal(error)) {
              fatal = (error as Error).message
              break
            }
            errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      if (!stale()) store.writeIndex(now)
    } catch (error) {
      fatal = error instanceof Error ? error.message : String(error)
    }

    const lastError = fatal ?? (errors.length ? `${errors.length} item(s) failed. First: ${errors[0]}` : undefined)
    // Yeni session yoksa model cagrilmaz; son gercek calismanin kullanimi korunur.
    const state = store.setState({ lastRunAt: now, lastError, ...(usage.requests > 0 ? { usage } : {}) })
    this.emit({
      state: fatal ? 'error' : 'idle',
      lastRunAt: state.lastRunAt,
      lastError,
      usage: state.usage,
      projects: store.listProjects().length,
      done: undefined,
      total: undefined
    })
    return this.getStatus()
  }
}
