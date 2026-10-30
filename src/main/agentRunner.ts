// Orchestration dilim 1 (docs/agent-ide/orchestration.md): devredilen isi baska bir ajan CLI'inda,
// tek kullanimlik worktree'de headless calistirir; sonucu diff + kontrol komutuyla olcer.
// Kuyruk ve MCP `orchestration/`'da; burasi yalniz tek gorevi calistirir.

import { execFile, spawn } from 'child_process'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { DELEGATE_AGENT_KINDS, type DelegateAgentKind } from '../shared/types'
import { cliInvocation } from './terminal/cli'
import { createWorktree, removeWorktree } from './worktree'
import { killProcessTree, runSetupCommand } from './worktreeSetup'

const execFileAsync = promisify(execFile)

export const DELEGATE_AGENTS = DELEGATE_AGENT_KINDS
export type DelegateAgent = DelegateAgentKind

export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60_000
const OUTPUT_LIMIT = 2 * 1024 * 1024
const CHECK_TAIL_LINES = 40
const OUTPUT_TAIL_CHARS = 8000
// Codex son mesaji dosyaya yazar; worktree'nin icinde kalir ama diff'e girmeden silinir.
const CODEX_LAST_MESSAGE = '.termflow-last-message.txt'

export const isDelegateAgent = (value: unknown): value is DelegateAgent =>
  typeof value === 'string' && (DELEGATE_AGENTS as readonly string[]).includes(value)

/** Prompt arguman olarak gecer; '-' ile baslarsa CLI onu bayrak sanmasin. */
const safePrompt = (prompt: string): string => (/^\s*-/.test(prompt) ? `Task: ${prompt}` : prompt)

/**
 * Dilim 0'da bu PC'de dogrulanan headless komutlar. Tam izin bayraklari yalniz tek kullanimlik worktree
 * icindir: Codex `workspace-write` Windows'ta dosya yazamadi, Grok `acceptEdits` gorevi iptal etti.
 * Klasor her ajana acikca verilir: OpenCode spawn cwd'sini degil miras `PWD`'yi kullanip baska depoya yazdi.
 */
export function headlessCommand(agent: DelegateAgent, prompt: string, cwd: string, model?: string): { command: string; args: string[] } {
  const text = safePrompt(prompt)
  const m = model?.trim()
  switch (agent) {
    case 'opencode':
      return { command: 'opencode', args: ['run', '--dir', cwd, ...(m ? ['-m', m] : []), '--auto', '--format', 'json', text] }
    case 'codex':
      return {
        command: 'codex',
        args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json', '-C', cwd, '-o', join(cwd, CODEX_LAST_MESSAGE), ...(m ? ['-m', m] : []), text]
      }
    case 'grok':
      return { command: 'grok', args: ['-p', text, '--always-approve', '--output-format', 'json', '--cwd', cwd, ...(m ? ['-m', m] : [])] }
    // Claude'un klasor bayragi yok: spawn cwd + PWD (runDelegatedTask) yeter. Saglayici profilleri model/anahtari env ile verir.
    case 'claude':
      return { command: 'claude', args: ['-p', text, '--dangerously-skip-permissions', '--output-format', 'json', ...(m ? ['--model', m] : [])] }
    // Asagidakiler `--help` ile dogrulandi; cikti duz metin (son mesaj = stdout sonu). Klasor spawn cwd'sinden gelir.
    case 'agy':
      return { command: 'agy', args: ['-p', text, '--dangerously-skip-permissions', ...(m ? ['--model', m] : [])] }
    case 'gemini':
      return { command: 'gemini', args: ['--approval-mode', 'yolo', ...(m ? ['-m', m] : []), '-p', text] }
    case 'qwen':
      return { command: 'qwen', args: ['--approval-mode', 'yolo', ...(m ? ['-m', m] : []), '-p', text] }
    case 'copilot':
      return { command: 'copilot', args: ['--allow-all', ...(m ? ['--model', m] : []), '-p', text] }
    case 'kimi':
      return { command: 'kimi', args: ['--auto', ...(m ? ['-m', m] : []), '-p', text] }
    case 'droid':
      return { command: 'droid', args: ['exec', '--auto', 'high', '--cwd', cwd, ...(m ? ['-m', m] : []), text] }
  }
}

export interface AgentOutput {
  lastMessage: string
  error?: string
  /** Saglayicinin bildirdigi maliyet (USD); bilinmiyorsa yok. */
  cost?: number
  tokens?: number
}

const jsonLines = (stdout: string): Record<string, unknown>[] =>
  stdout.split(/\r?\n/).flatMap((line) => {
    if (!line.trim().startsWith('{')) return []
    try {
      return [JSON.parse(line) as Record<string, unknown>]
    } catch {
      return []
    }
  })

/** Ajanin stdout'undan son mesaj, hata ve maliyet. Codex'in son mesaji dosyadan gelir (`codexLastMessage`). */
export function parseAgentOutput(agent: DelegateAgent, stdout: string, codexLastMessage?: string): AgentOutput {
  if (agent === 'opencode') {
    const out: AgentOutput = { lastMessage: '' }
    for (const event of jsonLines(stdout)) {
      const part = (event.part ?? {}) as { type?: string; text?: string; cost?: number; tokens?: { total?: number } }
      if (event.type === 'text' && typeof part.text === 'string') out.lastMessage = part.text
      if (event.type === 'step_finish') {
        if (typeof part.cost === 'number') out.cost = (out.cost ?? 0) + part.cost
        if (typeof part.tokens?.total === 'number') out.tokens = (out.tokens ?? 0) + part.tokens.total
      }
      if (event.type === 'error') {
        const error = event.error as { name?: string; data?: { message?: string } } | undefined
        out.error = error?.data?.message || error?.name || 'Agent error'
      }
    }
    return out
  }
  if (agent === 'codex') {
    const out: AgentOutput = { lastMessage: codexLastMessage?.trim() ?? '' }
    for (const event of jsonLines(stdout)) {
      if (event.type === 'error' || event.type === 'turn.failed') {
        const error = event.error as { message?: string } | undefined
        out.error = (typeof event.message === 'string' ? event.message : error?.message) || 'Agent error'
      }
    }
    return out
  }
  if (agent === 'claude') {
    try {
      const result = JSON.parse(stdout.slice(stdout.indexOf('{'))) as {
        result?: string; is_error?: boolean; subtype?: string; total_cost_usd?: number
        usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
      }
      const usage = result.usage
      const tokens = usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) : undefined
      const out: AgentOutput = { lastMessage: result.result ?? '', ...(typeof result.total_cost_usd === 'number' ? { cost: result.total_cost_usd } : {}), ...(tokens !== undefined ? { tokens } : {}) }
      if (result.is_error || (result.subtype && result.subtype !== 'success')) out.error = result.result || `Agent stopped: ${result.subtype ?? 'error'}`
      return out
    } catch {
      return { lastMessage: '', error: 'Unreadable agent output' }
    }
  }
  // JSON bilmeyen ajanlar: duz metin cikti; son mesaj stdout'un sonu (ANSI kodlari temizlenir).
  if (agent !== 'grok') return { lastMessage: stdout.replace(/\[[0-9;?]*[ -/]*[@-~]/g, '').trim().slice(-OUTPUT_TAIL_CHARS) }
  // Grok: tek JSON nesnesi (girintili, cok satir).
  try {
    const result = JSON.parse(stdout.slice(stdout.indexOf('{'))) as { text?: string; stopReason?: string }
    const out: AgentOutput = { lastMessage: result.text ?? '' }
    if (result.stopReason && result.stopReason !== 'end_turn') out.error = `Agent stopped: ${result.stopReason}`
    return out
  } catch {
    return { lastMessage: '', error: 'Unreadable agent output' }
  }
}

export type TaskStatus = 'done' | 'failed' | 'timeout' | 'cancelled'

export interface DelegatedTaskInput {
  id: string
  repoRoot: string
  agent: DelegateAgent
  model?: string
  prompt: string
  /** Kabul kriteri; worktree'de sistem kabugunda calisir, cikis 0 olmali. */
  checkCommand?: string
  timeoutMs?: number
  /** Ajana eklenecek ortam (saglayici profilinin base URL / model / anahtari). Sonuca yazilmaz. */
  env?: Record<string, string>
  /** Worktree olusur olusmaz cagrilir: kayit hemen diske yazilsin, surec coktugunde yetim kalmasin. */
  onWorktree?: (path: string) => void
  /** Testler icin: ajan CLI'i yerine calisacak surec. */
  invocation?: { file: string; args: string[] }
}

export interface DelegatedTaskResult {
  id: string
  agent: DelegateAgent
  model?: string
  status: TaskStatus
  error?: string
  worktreePath?: string
  branch: string
  lastMessage: string
  cost?: number
  tokens?: number
  exitCode: number | null
  /** stdout + stderr sonu; ajanin ne yaptigini incelemek icin. */
  outputTail: string
  durationMs: number
  diffStat: string
  changedFiles: string[]
  /** Gorev dalindaki commit (degisiklik varsa). */
  commit?: string
  check?: { code: number | null; timedOut: boolean; output: string }
}

export interface DelegatedTaskRun {
  done: Promise<DelegatedTaskResult>
  cancel(): void
}

export const taskBranch = (id: string): string => `deleg/${id}`

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: OUTPUT_LIMIT })
  return stdout
}

/**
 * Yeni dosyalar da sayilsin diye her sey index'e alinir (worktree tek kullanimlik) ve degisiklik varsa
 * gorev dalina commit edilir; koordinator `git cherry-pick <commit>` ile alir. Kullanicinin hook'lari calismaz.
 */
async function collectDiff(cwd: string, message: string): Promise<{ diffStat: string; changedFiles: string[]; commit?: string }> {
  await git(cwd, ['add', '-A'])
  const [stat, names] = await Promise.all([git(cwd, ['diff', '--cached', '--stat']), git(cwd, ['diff', '--cached', '--name-only'])])
  const changedFiles = names.split(/\r?\n/).filter(Boolean)
  if (!changedFiles.length) return { diffStat: '', changedFiles }
  await git(cwd, ['-c', 'user.name=TermFlow delegate', '-c', 'user.email=delegate@termflow.local', 'commit', '--no-verify', '-q', '-m', message])
  const commit = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  return { diffStat: stat.trim(), changedFiles, commit }
}

export const commitMessage = (agent: DelegateAgent, prompt: string): string =>
  `deleg(${agent}): ${prompt.trim().split(/\r?\n/)[0].slice(0, 72) || 'task'}`

/** Gorev commit'inin tam diff'i; cok buyukse kesilir. */
export async function taskDiff(worktreePath: string, commit: string, limit = 200_000): Promise<string> {
  const diff = await git(worktreePath, ['show', '--format=', '--no-color', commit])
  return diff.length > limit ? `${diff.slice(0, limit)}\n... (diff truncated at ${limit} characters)` : diff
}

const tailLines = (text: string, count: number): string => text.split(/\r?\n/).slice(-count).join('\n').trim()

export function runDelegatedTask(input: DelegatedTaskInput): DelegatedTaskRun {
  const started = Date.now()
  const branch = taskBranch(input.id)
  let child: ReturnType<typeof spawn> | undefined
  let checkRun: { cancel: () => void } | undefined
  let cancelled = false
  const base = { id: input.id, agent: input.agent, model: input.model, branch, lastMessage: '', exitCode: null, outputTail: '', diffStat: '', changedFiles: [] }
  const fail = (error: string, extra: Partial<DelegatedTaskResult> = {}): DelegatedTaskResult => ({ ...base, status: 'failed', error, durationMs: Date.now() - started, ...extra })

  const done = (async (): Promise<DelegatedTaskResult> => {
    const created = await createWorktree({ repoRoot: input.repoRoot, branch })
    if (!created.ok) return fail(created.error)
    const cwd = created.worktree.path
    input.onWorktree?.(cwd)
    if (cancelled) return { ...fail('Cancelled', { worktreePath: cwd }), status: 'cancelled' }

    let invocation: { file: string; args: string[] }
    try {
      const { command, args } = headlessCommand(input.agent, input.prompt, cwd, input.model)
      invocation = input.invocation ?? cliInvocation(command, args)
    } catch (error) {
      return fail((error as Error).message, { worktreePath: cwd })
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const exit = await new Promise<{ code: number | null; spawnError?: string }>((resolve) => {
      const proc = spawn(invocation.file, invocation.args, { cwd, env: { ...process.env, ...input.env, PWD: cwd }, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      child = proc
      // Windows'ta yalniz sarmalayiciyi oldurmek yetim opencode.exe birakir ve sonraki calistirmalari kilitler (dilim 0).
      const timer = setTimeout(() => { timedOut = true; killProcessTree(proc) }, input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS)
      proc.stdout.on('data', (chunk: Buffer) => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString() })
      proc.on('error', (error) => { clearTimeout(timer); resolve({ code: null, spawnError: error.message }) })
      proc.on('close', (code) => { clearTimeout(timer); resolve({ code }) })
    })

    let codexMessage: string | undefined
    if (input.agent === 'codex') {
      const file = join(cwd, CODEX_LAST_MESSAGE)
      try { codexMessage = readFileSync(file, 'utf8') } catch { /* ajan yazmadiysa mesaj bos */ }
      rmSync(file, { force: true })
    }
    const parsed = parseAgentOutput(input.agent, stdout, codexMessage)
    const outputTail = (stderr ? `${stdout}\n${stderr}` : stdout).slice(-OUTPUT_TAIL_CHARS)
    const common = { worktreePath: cwd, exitCode: exit.code, outputTail, lastMessage: parsed.lastMessage, cost: parsed.cost, tokens: parsed.tokens }

    if (cancelled) return { ...fail('Cancelled', common), status: 'cancelled' }
    if (timedOut) return { ...fail(`Timed out after ${Math.round((input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS) / 1000)} s`, common), status: 'timeout' }
    if (exit.spawnError) return fail(exit.spawnError, common)

    const diff = await collectDiff(cwd, commitMessage(input.agent, input.prompt)).catch((error: Error) => ({ diffStat: '', changedFiles: [] as string[], commit: undefined, error: error.message }))
    const withDiff = { ...common, diffStat: diff.diffStat, changedFiles: diff.changedFiles, ...(diff.commit ? { commit: diff.commit } : {}) }
    if ('error' in diff) return fail(`git diff failed: ${diff.error}`, withDiff)
    if (parsed.error) return fail(parsed.error, withDiff)
    if (exit.code !== 0) return fail(tailLines(stderr, 5) || `Agent exited with code ${exit.code}`, withDiff)
    // Cikis 0 basari degildir (big-pickle dosya yazmadan 0 dondu).
    if (diff.changedFiles.length === 0) return fail('Agent made no changes', withDiff)

    if (input.checkCommand?.trim()) {
      let output = ''
      const run = runSetupCommand(input.checkCommand, cwd, (text) => { if (output.length < OUTPUT_LIMIT) output += text })
      checkRun = run
      if (cancelled) run.cancel() // iptal ajan bittikten sonra geldiyse kontrol komutu da durur
      const result = await run.done
      checkRun = undefined
      const check = { code: result.code, timedOut: result.timedOut, output: tailLines(output, CHECK_TAIL_LINES) }
      if (result.code !== 0) return fail('Check command failed', { ...withDiff, check })
      return { ...base, ...withDiff, status: 'done', durationMs: Date.now() - started, check }
    }
    return { ...base, ...withDiff, status: 'done', durationMs: Date.now() - started }
  })()

  return {
    done,
    cancel: () => {
      cancelled = true
      if (child) killProcessTree(child)
      checkRun?.cancel()
    }
  }
}

const LOCKED = /permission denied|ebusy|resource busy|being used by another process/i

/**
 * Kilitli silmenin yarim kaldigi durum: git kaydi gitti ama klasor ve dal duruyor. Yalniz TermFlow'un kendi
 * alanina (`.termflow-worktrees` altindaki klasor, `deleg/` dali) dokunur.
 */
export async function finishRemoval(repoRoot: string, path: string, branch: string, waitMs = 2000, attempts = 8): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/[\\/]\.termflow-worktrees[\\/]/.test(path) || !branch.startsWith('deleg/')) return { ok: false, error: 'Not a delegated task worktree.' }
  try {
    // Claude'un Bash araci kabugu (shell-snapshot) claude.exe'den ~4 sn sonra kapanir; ebeveyni oldugu icin agac oldurme ona ulasmaz.
    for (let attempt = 1; ; attempt++) {
      try {
        rmSync(path, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= attempts || !LOCKED.test((error as Error).message)) throw error
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
    await git(repoRoot, ['worktree', 'prune'])
    await git(repoRoot, ['branch', '-D', branch]).catch(() => undefined)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export interface DiscardDeps {
  remove: typeof removeWorktree
  finish: typeof finishRemoval
  delays: readonly number[]
}

/**
 * Gorevin worktree'sini ve dalini siler; ana calisma agacina removeWorktree zaten dokunmaz. Windows'ta `claude -p`
 * cikistan sonra birkac saniye klasoru tutan kisa omurlu bir alt surec birakiyor (canli deneme): kilit hatasinda
 * artan beklemeyle yeniden denenir; ilk deneme git kaydini silip klasorde takildiysa is elle bitirilir.
 */
export async function discardTask(
  repoRoot: string,
  result: Pick<DelegatedTaskResult, 'worktreePath' | 'branch'>,
  deps: Partial<DiscardDeps> = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { remove = removeWorktree, finish = finishRemoval, delays = [1000, 2000, 4000, 8000] } = deps
  if (!result.worktreePath) return { ok: true }
  const input = { repoRoot, path: result.worktreePath, force: true, deleteBranch: true, branch: result.branch }
  let outcome = await remove(input)
  let locked = false
  for (const delay of delays) {
    if (outcome.ok) return outcome
    if (locked && /is not a working tree/i.test(outcome.error)) return finish(repoRoot, result.worktreePath, result.branch)
    if (!LOCKED.test(outcome.error)) return outcome
    locked = true
    await new Promise((resolve) => setTimeout(resolve, delay))
    outcome = await remove(input)
  }
  if (!outcome.ok && locked && /is not a working tree/i.test(outcome.error)) return finish(repoRoot, result.worktreePath, result.branch)
  return outcome
}
