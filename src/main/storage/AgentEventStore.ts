import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { isAgentCliName } from '../../shared/profiles'
import type { AgentEvent } from '../../shared/types'

const MAX_EVENTS = 2000

// Each event is at most ~860 bytes (title<=240, detail<=500, plus JSON overhead), so
// MAX_EVENTS lines is at most ~1.7MB. A 2MB threshold trims before the file grows
// unbounded while staying comfortably above the post-trim size, so trimming does not
// re-trigger on every subsequent append.
const DEFAULT_TRIM_THRESHOLD_BYTES = 2_000_000

/**
 * Agent Inbox'in kalici kaydi. Yazim ASENKRON ve sirali: bir ajan saniyede
 * onlarca olay uretebilir ve her biri icin senkron disk yazmak ana sureci
 * (dolayisiyla tum pencereyi) bekletiyordu. Bekleyen satirlar `list()`'e de
 * girer, boylece kuyruk cagiran taraf icin gorunmez kalir.
 */
export class AgentEventStore {
  private readonly file: string
  private queue: string[] = []
  private chain: Promise<void> = Promise.resolve()
  private dirReady = false

  constructor(userData: string, private readonly trimThresholdBytes = DEFAULT_TRIM_THRESHOLD_BYTES) {
    this.file = join(userData, 'agent-events.jsonl')
  }

  append(event: AgentEvent): void {
    if (!validEvent(event)) return
    this.queue.push(`${JSON.stringify(event)}\n`)
    // Best-effort log: a failed write must never break the caller.
    this.chain = this.chain.then(() => this.write()).catch(() => undefined)
  }

  /** Bu ana kadar eklenen olaylar diske yazilana kadar bekler. */
  flush(): Promise<void> {
    return this.chain
  }

  /** Kapanis yolu: beklemeye vakit yok, kalani tek seferde senkron yaz. */
  flushSync(): void {
    if (this.queue.length === 0) return
    const chunk = this.queue.join('')
    this.queue = []
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, chunk, 'utf8')
    } catch {
      // Olay gunlugu: kapanista yazilamazsa kaybi onemsenmez.
    }
  }

  private async write(): Promise<void> {
    if (this.queue.length === 0) return
    const chunk = this.queue.join('')
    this.queue = []
    if (!this.dirReady) {
      await mkdir(dirname(this.file), { recursive: true })
      this.dirReady = true
    }
    await appendFile(this.file, chunk, 'utf8')
    await this.trimIfNeeded()
  }

  private async trimIfNeeded(): Promise<void> {
    try {
      if ((await stat(this.file)).size < this.trimThresholdBytes) return
      const lines = (await readFile(this.file, 'utf8')).split('\n').filter(Boolean).slice(-MAX_EVENTS)
      await writeFile(this.file, lines.length ? `${lines.join('\n')}\n` : '', 'utf8')
    } catch {
      // Best-effort trim; failures must not break the append flow.
    }
  }

  list(limit = 500): AgentEvent[] {
    const stored = existsSync(this.file) ? readFileSync(this.file, 'utf8').split('\n') : []
    const lines = [...stored, ...this.queue].flatMap((line) => line.split('\n')).filter(Boolean).slice(-MAX_EVENTS)
    const events: AgentEvent[] = []
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as AgentEvent
        if (validEvent(event)) events.push(event)
      } catch {
        // A torn final line must not hide older valid events.
      }
    }
    return events.slice(-Math.max(1, Math.min(limit, MAX_EVENTS)))
  }

  clear(): void {
    this.queue = []
    this.chain = this.chain.then(() => rm(this.file, { force: true })).catch(() => undefined)
    if (existsSync(this.file)) rmSync(this.file, { force: true })
  }
}

function validEvent(value: AgentEvent): boolean {
  return !!value && typeof value.id === 'string' && typeof value.tabId === 'string'
    // Katalogdaki her ajan CLI'i (gemini, qwen...), yalniz hook'lu uc ajan degil.
    && isAgentCliName(value.agent)
    && ['session', 'activity', 'tool', 'approval', 'question', 'completed', 'error'].includes(value.kind)
    && typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 240
    && (value.detail === undefined || (typeof value.detail === 'string' && value.detail.length <= 500))
    && typeof value.createdAt === 'number'
    && ['safe', 'workspace', 'full'].includes(value.permissionMode)
}
