import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'
import type { DelegatedTaskInput, DelegatedTaskResult } from '../agentRunner'
import { listTargets, resolveTarget, TaskManager, type ResolvedTarget, type TargetContext } from './manager'

const REPO = join(tmpdir(), 'repo')

function settingsWith(patch: Partial<AppSettings['orchestration']> = {}, providers: AppSettings['providerProfiles'] = []): AppSettings {
  return { ...DEFAULT_SETTINGS, providerProfiles: providers, orchestration: { ...DEFAULT_SETTINGS.orchestration, ...patch } }
}

const DEEPSEEK = { id: 'deepseek', name: 'DeepSeek', command: 'claude', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/anthropic', apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN', modelEnv: 'ANTHROPIC_MODEL', baseUrlEnv: 'ANTHROPIC_BASE_URL' }
const OLLAMA = { id: 'ollama', name: 'Ollama', command: 'ollama run gemma3' }

describe('listTargets / resolveTarget', () => {
  const ctx = (settings: AppSettings, installed = ['opencode', 'claude', 'grok']): TargetContext => ({ settings, installed, hasSecret: (id) => id === 'deepseek' })

  it('lists built-in agents plus claude-based provider profiles only', () => {
    const targets = listTargets(ctx(settingsWith({}, [DEEPSEEK, OLLAMA])))
    expect(targets.map((t) => t.id)).toEqual(['opencode', 'codex', 'grok', 'claude', 'agy', 'gemini', 'qwen', 'copilot', 'kimi', 'droid', 'provider:deepseek'])
    expect(targets.find((t) => t.id === 'codex')?.installed).toBe(false)
    expect(targets.find((t) => t.id === 'opencode')?.model).toBe('opencode/deepseek-v4.1-flash-free')
    expect(targets.at(-1)).toMatchObject({ agent: 'claude', model: 'deepseek-v4-pro', hasCredential: true, providerId: 'deepseek' })
  })

  it('refuses missing, disabled and unknown targets', () => {
    const settings = settingsWith({ targets: { grok: { enabled: false, model: '' } } })
    expect(resolveTarget(ctx(settings), 'codex', undefined, () => undefined)).toEqual({ error: 'Codex CLI is not installed on this computer.' })
    expect(resolveTarget(ctx(settings), 'grok', undefined, () => undefined)).toEqual({ error: 'Grok is turned off in TermFlow Settings > Orchestration.' })
    expect(resolveTarget(ctx(settings), 'aider', undefined, () => undefined)).toMatchObject({ error: expect.stringContaining('Unknown agent') })
  })

  it('passes a provider profile through env and never as an argument', () => {
    const resolved = resolveTarget(ctx(settingsWith({}, [DEEPSEEK])), 'provider:deepseek', 'deepseek-v4-flash', () => 'sk-secret') as ResolvedTarget
    expect(resolved).toEqual({
      id: 'provider:deepseek', label: 'DeepSeek (Claude Code)', agent: 'claude',
      env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-secret', ANTHROPIC_MODEL: 'deepseek-v4-flash' }
    })
    expect(resolveTarget(ctx(settingsWith({}, [DEEPSEEK])), 'provider:deepseek', undefined, () => undefined)).toMatchObject({ error: expect.stringContaining('no API key') })
  })

  it('uses the model override, then the saved model', () => {
    expect(resolveTarget(ctx(settingsWith()), 'opencode', ' opencode/glm-5.3-flash-free ', () => undefined)).toMatchObject({ model: 'opencode/glm-5.3-flash-free' })
    expect(resolveTarget(ctx(settingsWith()), 'claude', undefined, () => undefined)).toMatchObject({ agent: 'claude', model: undefined, env: {} })
  })
})

interface Pending {
  input: DelegatedTaskInput
  finish: (patch?: Partial<DelegatedTaskResult>) => void
  cancel: ReturnType<typeof vi.fn>
}

describe('TaskManager', () => {
  let dir = ''
  let pending: Pending[] = []
  let settings = settingsWith()
  let ids = 0

  const fakeRun = (input: DelegatedTaskInput) => {
    let resolve!: (result: DelegatedTaskResult) => void
    const done = new Promise<DelegatedTaskResult>((r) => { resolve = r })
    const base: DelegatedTaskResult = { id: input.id, agent: input.agent, status: 'done', branch: `deleg/${input.id}`, lastMessage: 'ok', exitCode: 0, outputTail: '', durationMs: 1, diffStat: '1 file', changedFiles: ['a.txt'], worktreePath: join(dir, input.id), commit: 'abc' }
    const cancel = vi.fn(() => resolve({ ...base, status: 'cancelled', error: 'Cancelled' }))
    input.onWorktree?.(join(dir, input.id)) // gercek runner da worktree'yi hemen bildirir
    pending.push({ input, finish: (patch = {}) => resolve({ ...base, ...patch }), cancel })
    return { done, cancel }
  }

  const manager = (extra: Partial<ConstructorParameters<typeof TaskManager>[0]> = {}): TaskManager => new TaskManager({
    file: join(dir, 'tasks.json'),
    getSettings: () => settings,
    resolve: async (target, model) => target === 'missing' ? { error: 'nope' } : { id: target, label: target, agent: target === 'oc' ? 'opencode' : 'codex', model, env: { K: 'v' } },
    run: fakeRun,
    repoInfo: async (cwd) => cwd.startsWith(REPO) ? { root: REPO, branch: 'main' } : null,
    discard: vi.fn(async () => ({ ok: true as const })),
    newId: () => `t${++ids}`,
    ...extra
  })
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'termflow-orch-'))
    pending = []
    settings = settingsWith()
    ids = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('validates the request before queueing', async () => {
    const m = manager()
    expect(await m.submit({ target: 'cx', prompt: '  ', cwd: REPO })).toEqual({ error: 'prompt is empty.' })
    expect(await m.submit({ target: 'cx', prompt: 'x', cwd: 'relative' })).toMatchObject({ error: expect.stringContaining('absolute') })
    expect(await m.submit({ target: 'cx', prompt: 'x', cwd: join(tmpdir(), 'elsewhere') })).toMatchObject({ error: expect.stringContaining('Not inside a git repository') })
    expect(await m.submit({ target: 'missing', prompt: 'x', cwd: REPO })).toEqual({ error: 'nope' })
    expect(await m.submit({ target: 'cx', prompt: 'x'.repeat(20_001), cwd: REPO })).toMatchObject({ error: expect.stringContaining('longer') })
    expect(m.list()).toEqual([])
  })

  it('runs a task with the resolved target, env and timeout, then records the result', async () => {
    const changes = vi.fn()
    const m = manager({ onChange: changes })
    const task = await m.submit({ target: 'cx', model: 'gpt', prompt: 'do it', cwd: join(REPO, 'src'), checkCommand: 'npm test', timeoutS: 5, requestedBy: 'claude-code' })
    expect(task).toMatchObject({ id: 't1', status: 'running', repoRoot: REPO, branch: 'deleg/t1', requestedBy: 'claude-code' })
    expect(pending[0].input).toMatchObject({ id: 't1', repoRoot: REPO, agent: 'codex', model: 'gpt', prompt: 'do it', checkCommand: 'npm test', timeoutMs: 30_000, env: { K: 'v' } })
    pending[0].finish()
    await tick()
    expect(m.get('t1')).toMatchObject({ status: 'done', lastMessage: 'ok', commit: 'abc', changedFiles: ['a.txt'] })
    expect(m.get('t1')?.finishedAt).toBeTypeOf('number')
    expect(changes).toHaveBeenCalled()
  })

  it('respects the concurrency limit and runs OpenCode one at a time', async () => {
    settings = settingsWith({ maxConcurrent: 2 })
    const m = manager()
    await m.submit({ target: 'oc', prompt: 'a', cwd: REPO })
    await m.submit({ target: 'oc', prompt: 'b', cwd: REPO })
    await m.submit({ target: 'cx', prompt: 'c', cwd: REPO })
    await m.submit({ target: 'cx', prompt: 'd', cwd: REPO })
    expect(m.list().map((t) => [t.id, t.status])).toEqual([['t4', 'queued'], ['t3', 'running'], ['t2', 'queued'], ['t1', 'running']])
    pending[0].finish()
    await tick()
    // t1 bitti: siradaki en eski (t2, OpenCode) baslar.
    expect(m.get('t2')?.status).toBe('running')
    expect(m.get('t4')?.status).toBe('queued')
  })

  it('cancels queued and running tasks and waits for completion', async () => {
    settings = settingsWith({ maxConcurrent: 1 })
    const m = manager()
    await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
    await m.submit({ target: 'cx', prompt: 'b', cwd: REPO })
    expect(m.cancel('t2')?.status).toBe('cancelled')
    const waiting = m.wait('t1', 5_000)
    m.cancel('t1')
    expect(pending[0].cancel).toHaveBeenCalled()
    expect((await waiting)?.status).toBe('cancelled')
    expect(await m.wait('t1', 10)).toMatchObject({ status: 'cancelled' })
    expect(await m.wait('nope', 10)).toBeUndefined()
  })

  it('wait returns the current state when the time runs out', async () => {
    const m = manager()
    await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
    expect((await m.wait('t1', 20))?.status).toBe('running')
  })

  it('discards the worktree and drops the record', async () => {
    const discard = vi.fn(async () => ({ ok: true as const }))
    const m = manager({ discard })
    await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
    pending[0].finish()
    await tick()
    expect(await m.discard('t1')).toEqual({ ok: true })
    expect(discard).toHaveBeenCalledWith(REPO, { worktreePath: join(dir, 't1'), branch: 'deleg/t1' })
    expect(m.list()).toEqual([])
    expect(await m.discard('t1')).toMatchObject({ ok: false })
  })

  it('records the worktree while the task runs, so a crash does not orphan it', async () => {
    const discard = vi.fn(async () => ({ ok: true as const }))
    const file = join(dir, 'tasks.json')
    const m = manager({ discard, file })
    await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
    expect(m.get('t1')).toMatchObject({ status: 'running', worktreePath: join(dir, 't1') })
    // Yeniden acilis: gorev 'failed' olur ama yol kayitli oldugu icin Discard silebilir.
    const reopened = manager({ discard, file, newId: () => 'tx' })
    expect(reopened.get('t1')).toMatchObject({ status: 'failed', worktreePath: join(dir, 't1') })
    expect(await reopened.discard('t1')).toEqual({ ok: true })
    expect(discard).toHaveBeenCalledWith(REPO, { worktreePath: join(dir, 't1'), branch: 'deleg/t1' })
  })

  it('removes the worktree of a record that falls out of the list', async () => {
    const discard = vi.fn(async () => ({ ok: true as const }))
    const m = manager({ discard })
    for (let i = 0; i < 51; i++) {
      await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
      pending[i].finish()
      await tick()
    }
    expect(m.list()).toHaveLength(50)
    expect(m.get('t1')).toBeUndefined()
    expect(discard).toHaveBeenCalledWith(REPO, { worktreePath: join(dir, 't1'), branch: 'deleg/t1' })
  })

  it('reports a runner that throws as a failed task', async () => {
    const m = manager({ run: () => { throw new Error('CLI not found: grok') } })
    await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
    expect(m.get('t1')).toMatchObject({ status: 'failed', error: 'CLI not found: grok' })
  })

  it('persists tasks and marks unfinished ones failed after a restart', async () => {
    const m = manager()
    await m.submit({ target: 'cx', prompt: 'a', cwd: REPO })
    expect(JSON.parse(readFileSync(join(dir, 'tasks.json'), 'utf8')).tasks[0].status).toBe('running')
    const reloaded = manager()
    expect(reloaded.get('t1')).toMatchObject({ status: 'failed', error: 'TermFlow closed before the task finished' })
  })

  it('ignores a corrupt task file', () => {
    writeFileSync(join(dir, 'tasks.json'), '{not json')
    expect(manager().list()).toEqual([])
  })
})
