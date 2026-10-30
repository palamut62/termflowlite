import { existsSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'
import type { AgentKind } from '../../shared/types'
import { runCli } from '../terminal/cli'
import { digestFromJsonl, digestFromOpenCodeExport, type SessionDigest } from './extract'

/** Hafızaya girebilecek bir session; içerik ancak gerekirse okunur. */
export interface SessionSource {
  agent: AgentKind
  id: string
  mtime: number
  size: number
  path?: string
}

export interface SourceRoots {
  claude: string
  codex: string
  opencode: boolean
}

export const defaultRoots = (): SourceRoots => ({
  claude: join(homedir(), '.claude', 'projects'),
  codex: join(homedir(), '.codex', 'sessions'),
  opencode: true
})

/** Kökteki .jsonl dosyaları (cutoff sonrası değişenler). Claude alt ajan kayıtları atlanır. */
export async function jsonlSources(agent: 'claude' | 'codex', root: string, cutoff: number): Promise<SessionSource[]> {
  if (!existsSync(root)) return []
  const found: SessionSource[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'subagents' || entry.name === 'memory') return
        return walk(path)
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return
      const info = await stat(path).catch(() => null)
      if (!info || info.mtimeMs < cutoff || info.size === 0) return
      found.push({ agent, id: sessionIdFromFile(agent, path), mtime: Math.floor(info.mtimeMs), size: info.size, path })
    }))
  }
  await walk(root)
  return found
}

/** Claude: dosya adı = session id. Codex: rollout-<tarih>-<uuid>.jsonl. */
export function sessionIdFromFile(agent: 'claude' | 'codex', path: string): string {
  const name = basename(path, '.jsonl')
  if (agent === 'claude') return name
  const uuid = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  return uuid ? uuid[1] : name
}

export async function openCodeSources(cutoff: number): Promise<SessionSource[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await runCli('opencode', ['session', 'list', '--format', 'json', '--max-count', '200']) || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((value): SessionSource[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    const raw = typeof item.updated === 'number' ? item.updated : typeof item.updatedAt === 'number' ? item.updatedAt : 0
    const updated = raw < 10_000_000_000 ? raw * 1000 : raw
    return id && updated >= cutoff ? [{ agent: 'opencode', id, mtime: updated, size: 0 }] : []
  })
}

export async function listSources(cutoff: number, roots: SourceRoots = defaultRoots()): Promise<SessionSource[]> {
  const results = await Promise.all([
    jsonlSources('claude', roots.claude, cutoff),
    jsonlSources('codex', roots.codex, cutoff),
    roots.opencode ? openCodeSources(cutoff) : Promise.resolve([])
  ])
  return results.flat().sort((a, b) => b.mtime - a.mtime)
}

export async function readDigest(source: SessionSource): Promise<SessionDigest> {
  if (source.agent === 'opencode') {
    const stdout = await runCli('opencode', ['export', source.id], 16 * 1024 * 1024)
    const digest = digestFromOpenCodeExport(JSON.parse(stdout))
    digest.id ||= source.id
    return digest
  }
  if (!source.path) throw new Error('Session file is missing')
  const digest = await digestFromJsonl(source.path, source.agent)
  digest.id ||= source.id
  return digest
}
