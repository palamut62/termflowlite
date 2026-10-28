import { readdir, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentTask } from '../shared/ipc'
import { defaultClaudeDir } from './claudeAccount'

const SESSION_ID = /^[\w-]{1,100}$/

/** Claude Code arka plan gorev ciktilari: <tmp>/claude/<proje>/<oturum>/tasks/<id>.output. */
export function claudeTasksRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CODE_TMPDIR || tmpdir(), 'claude')
}

/** Oturumun gorev ciktilari, en son yazilan once. Dosya gorev bitince de kalir; "calisiyor" bilgisi yok. */
export async function listAgentTasks(sessionId: string, root = claudeTasksRoot()): Promise<AgentTask[]> {
  if (!SESSION_ID.test(sessionId)) throw new Error('invalid session id')
  const projects = await readdir(root).catch(() => [] as string[])
  const tasks: AgentTask[] = []
  for (const project of projects) {
    const dir = join(root, project, sessionId, 'tasks')
    const files = await readdir(dir).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.output')) continue
      const info = await stat(join(dir, file)).catch(() => null)
      if (info?.isFile()) tasks.push({ id: file.slice(0, -'.output'.length), path: join(dir, file), size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  return tasks.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 50)
}

/** Alt ajan dokumunu okunur satirlara ceviren paketli betik (transcriptFollowEntry) ve onu calistiracak exe. */
export interface TranscriptFollower { exe: string; script: string }

/** Izleme sekmesinde calisan komut. Electron exe'si GUI alt sistemi: PowerShell `| Out-Host` olmadan beklemez, sekme hemen kapanir. */
export function followCommand(f: TranscriptFollower, file: string, platform: NodeJS.Platform = process.platform, shell = false): string {
  if (platform === 'win32') {
    const q = (v: string): string => `'${v.replace(/'/g, "''")}'`
    // Inherit console handles directly: PowerShell pipelines buffer partial lines.
    if (shell) return `$env:ELECTRON_RUN_AS_NODE = '1'; Start-Process -Wait -NoNewWindow -FilePath ${q(f.exe)} -ArgumentList ${q(`"${f.script}" "${file}" --shell`)}`
    return `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $env:ELECTRON_RUN_AS_NODE = '1'; & ${q(f.exe)} ${q(f.script)} ${q(file)}${shell ? ' --shell' : ''} | Out-Host`
  }
  const q = (v: string): string => `'${v.replace(/'/g, "'\\''")}'`
  return `ELECTRON_RUN_AS_NODE=1 ${q(f.exe)} ${q(f.script)} ${q(file)}${shell ? ' --shell' : ''}`
}

/** Etiket: .meta.json'daki aciklama, yoksa ajan turu, yoksa dosya adi. */
async function subagentLabel(jsonl: string, id: string): Promise<string> {
  try {
    const meta = JSON.parse(await readFile(jsonl.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as { description?: unknown; agentType?: unknown }
    const label = [meta.description, meta.agentType].find((v): v is string => typeof v === 'string' && v.trim() !== '')
    if (label) return label.trim().slice(0, 40)
  } catch { /* eski surumde meta dosyasi yok */ }
  return id
}

/**
 * Claude Code alt ajanlari (Task/Agent araci): <claude>/projects/<proje>/<oturum>/subagents/agent-<id>.jsonl.
 * shortcut: yalniz varsayilan Claude config dizini taranir; baska hesaplarin (CLAUDE_CONFIG_DIR) alt ajanlari listelenmez.
 */
export async function listSubagents(sessionId: string, follower: TranscriptFollower, root = join(defaultClaudeDir(), 'projects')): Promise<AgentTask[]> {
  if (!SESSION_ID.test(sessionId)) throw new Error('invalid session id')
  const found: AgentTask[] = []
  for (const project of await readdir(root).catch(() => [] as string[])) {
    const dir = join(root, project, sessionId, 'subagents')
    for (const file of await readdir(dir).catch(() => [] as string[])) {
      if (!file.endsWith('.jsonl')) continue
      const path = join(dir, file)
      const info = await stat(path).catch(() => null)
      if (info?.isFile()) found.push({ id: file.slice(0, -'.jsonl'.length), path, size: info.size, mtimeMs: info.mtimeMs, command: followCommand(follower, path) })
    }
  }
  const newest = found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20)
  for (const task of newest) task.label = await subagentLabel(task.path, task.id)
  return newest
}
