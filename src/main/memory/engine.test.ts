import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryEngine, LIVE_MS, MAX_SESSIONS_PER_RUN, type MemoryConfig } from './engine'
import { DigestBuilder, type SessionDigest } from './extract'
import { OpenRouterError, type ChatRequest, type ChatResult } from './openrouter'
import { normalizePath } from './projectKey'
import { MemoryStore, RETENTION_MS } from './store'
import type { SessionSource } from './sources'

const dirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'termflow-engine-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const NOW = Date.parse('2026-10-06T12:00:00Z')
const SUMMARY = JSON.stringify({ goal: 'Build memory', done: ['extractor'], unfinished: ['panel'], problems: [], decisions: [], lastState: 'panel next' })

function digest(cwd: string | undefined, request = 'Please build the agent memory feature for the terminal'): SessionDigest {
  const builder = new DigestBuilder('claude')
  builder.addUser(request)
  builder.addAssistant('ok')
  const result = builder.finish()
  result.cwd = cwd
  result.updatedAt = NOW - 60 * 60 * 1000
  return result
}

function setup(options: { sources: SessionSource[]; digests?: Record<string, SessionDigest>; config?: Partial<MemoryConfig>; key?: string; chat?: (request: ChatRequest) => Promise<ChatResult> }) {
  const store = new MemoryStore(tempDir())
  const project = tempDir()
  const chat = vi.fn(options.chat ?? (async (request: ChatRequest) => ({
    content: request.jsonSchema ? SUMMARY : '## Status\nMemory half done\n## Unfinished\n- panel',
    usage: { promptTokens: 100, completionTokens: 20 }
  })))
  const readDigest = vi.fn(async (source: SessionSource) => options.digests?.[source.id] ?? digest(project))
  const statuses: string[] = []
  const engine = new MemoryEngine({
    store,
    getConfig: () => ({ enabled: true, model: '', excludedProjects: [], ...options.config }),
    getApiKey: () => options.key === undefined ? 'sk-or-key' : options.key || undefined,
    listSources: async () => options.sources,
    readDigest,
    chat,
    now: () => NOW,
    onStatus: (status) => statuses.push(status.state)
  })
  return { engine, store, chat, readDigest, project, statuses }
}

const source = (id: string, mtime = NOW - 60 * 60 * 1000, size = 100): SessionSource => ({ agent: 'claude', id, mtime, size, path: `/x/${id}.jsonl` })

describe('MemoryEngine', () => {
  it('runs a forced pass after the scheduled one instead of swallowing it', async () => {
    // Zamanlanmis tur taze oturumu atlar; "Run now" bitmesini bekleyip zorlamali kosar.
    const live = source('live', NOW - LIVE_MS / 2)
    const { engine, readDigest } = setup({ sources: [live] })
    const scheduled = engine.run()
    const forced = engine.run({ force: true })
    expect(forced).not.toBe(scheduled)
    await scheduled
    await forced
    expect(readDigest).toHaveBeenCalledTimes(1)
  })

  it('stops writing when the memory is cleared mid-run', async () => {
    let clearNow = (): void => undefined
    const { engine, store, project } = setup({
      sources: [source('a')],
      chat: async (request) => {
        clearNow() // model cevabi donerken kullanici Clear'a basti
        return { content: request.jsonSchema ? SUMMARY : '## Status\nx', usage: { promptTokens: 1, completionTokens: 1 } }
      }
    })
    clearNow = () => engine.clear()
    await engine.run()
    expect(store.readProject(normalizePath(project))).toBeNull()
    expect(store.listProjects()).toEqual([])
  })

  it('summarizes new sessions, merges the project and skips unchanged ones next time', async () => {
    const { engine, store, chat, project, statuses } = setup({ sources: [source('a'), source('b')] })
    const status = await engine.run()
    expect(status).toMatchObject({ state: 'idle', projects: 1, lastRunAt: NOW, usage: { requests: 3, promptTokens: 300, completionTokens: 60 } })
    expect(statuses[0]).toBe('running')
    expect(chat.mock.calls.map(([request]) => Boolean(request.jsonSchema))).toEqual([true, true, false])
    expect(chat.mock.calls[0][0].model).toBe('deepseek/deepseek-v4-flash')
    const markdown = store.readProject(normalizePath(project))!
    expect(markdown).toContain('sessions: 2')
    expect(markdown).toContain('## Status\nMemory half done')
    expect(store.readIndex()).toContain('Memory half done')

    chat.mockClear()
    const again = await engine.run()
    expect(chat).not.toHaveBeenCalled()
    // Yeni session yokken son gercek calismanin kullanimi silinmez.
    expect(again.usage).toMatchObject({ requests: 3 })
  })

  it('drops the cut-off last line of a truncated merge and sums cost', async () => {
    const { engine, store, project } = setup({
      sources: [source('a')],
      chat: async (request) => request.jsonSchema
        ? { content: SUMMARY, usage: { promptTokens: 1, completionTokens: 1, cost: 0.001 } }
        : { content: '## Status\nFine\n## Decisions\n- half writ', truncated: true, usage: { promptTokens: 1, completionTokens: 1, cost: 0.002 } }
    })
    const status = await engine.run()
    expect(status.usage?.cost).toBeCloseTo(0.003)
    const markdown = store.readProject(normalizePath(project))!
    expect(markdown).toContain('## Decisions')
    expect(markdown).not.toContain('half writ')
  })

  it('re-summarizes a session whose file changed', async () => {
    const sources = [source('a')]
    const { engine, chat } = setup({ sources })
    await engine.run()
    sources[0] = source('a', NOW - 30 * 60 * 1000, 200)
    chat.mockClear()
    await engine.run()
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('leaves live sessions for later unless forced, and caps one run', async () => {
    const many = Array.from({ length: MAX_SESSIONS_PER_RUN + 5 }, (_, index) => source(`s${index}`))
    const { engine, readDigest } = setup({ sources: [source('live', NOW - LIVE_MS / 2), ...many] })
    await engine.run()
    expect(readDigest).toHaveBeenCalledTimes(MAX_SESSIONS_PER_RUN)
    expect(readDigest.mock.calls.some(([item]) => item.id === 'live')).toBe(false)
    readDigest.mockClear()
    await engine.run({ force: true })
    expect(readDigest.mock.calls.map(([item]) => item.id)).toContain('live')
  })

  it('stores greetings without calling the model and skips excluded projects', async () => {
    const excludedDir = tempDir()
    const { engine, store, chat } = setup({
      sources: [source('hi'), source('secret'), source('nocwd')],
      digests: { hi: digest(undefined, 'selam'), secret: digest(excludedDir), nocwd: digest(undefined) },
      config: { excludedProjects: [excludedDir] }
    })
    await engine.run()
    expect(chat).not.toHaveBeenCalled()
    expect(store.getSession('claude', 'hi')?.summary).toBeNull()
    expect(store.getSession('claude', 'secret')).toBeNull()
  })

  it('drops expired sessions and deletes the project file when nothing is left', async () => {
    const sources = [source('a')]
    const { engine, store, project } = setup({ sources })
    await engine.run()
    const key = normalizePath(project)
    const stale = store.getSession('claude', 'a')!
    store.putSession({ ...stale, updatedAt: NOW - RETENTION_MS - 1 })
    sources.length = 0
    await engine.run()
    expect(store.readProject(key)).toBeNull()
    expect(store.listSessions()).toEqual([])
  })

  it('does nothing when disabled or without a key', async () => {
    const off = setup({ sources: [source('a')], config: { enabled: false } })
    expect((await off.engine.run()).state).toBe('disabled')
    expect(off.readDigest).not.toHaveBeenCalled()
    const noKey = setup({ sources: [source('a')], key: '' })
    expect((await noKey.engine.run()).state).toBe('no-key')
  })

  it('stops on a rejected key and reports item errors without stopping', async () => {
    const fatal = setup({ sources: [source('a'), source('b')], chat: async () => { throw new OpenRouterError('OpenRouter rejected the API key.', 401) } })
    const status = await fatal.engine.run()
    expect(status).toMatchObject({ state: 'error', lastError: 'OpenRouter rejected the API key.' })

    let calls = 0
    const flaky = setup({
      sources: [source('a'), source('b')],
      chat: async (request) => {
        calls++
        if (request.jsonSchema && calls === 1) return { content: 'not json', usage: { promptTokens: 1, completionTokens: 1 } }
        return { content: request.jsonSchema ? SUMMARY : '## Status\nok', usage: { promptTokens: 1, completionTokens: 1 } }
      }
    })
    const result = await flaky.engine.run()
    expect(result.state).toBe('idle')
    expect(result.lastError).toMatch(/1 item\(s\) failed.*not valid JSON/)
    expect(result.projects).toBe(1)
  })

  it('shares one run between concurrent callers and can forget or clear', async () => {
    const { engine, store, readDigest, project } = setup({ sources: [source('a')] })
    const [first, second] = await Promise.all([engine.run(), engine.run()])
    expect(first).toEqual(second)
    expect(readDigest).toHaveBeenCalledTimes(1)
    engine.forget(project)
    expect(store.listProjects()).toEqual([])
    engine.clear()
    expect(engine.getStatus()).toMatchObject({ state: 'idle', projects: 0 })
  })
})
