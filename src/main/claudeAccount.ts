import { readdirSync } from 'fs'
import { lstat, mkdir, readdir, readFile, rmdir, symlink } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join, normalize } from 'path'
import { CLAUDE_CONFIG_ENV, parseClaudeLogin, type ClaudeLogin } from '../shared/claudeAccounts'

/** Folders shared with the default account so a session started there can be resumed here. */
const SHARED = ['projects', 'skills']

export const defaultClaudeDir = (): string => process.env[CLAUDE_CONFIG_ENV] || join(homedir(), '.claude')

/**
 * Bu bilgisayardaki butun Claude config klasorleri: varsayilan (ya da
 * CLAUDE_CONFIG_DIR) + `~/.claude*` kardesleri. Ikinci hesapla acilmis bir
 * sekmenin dokumu/alt ajanlari varsayilan klasorde degil, kendi klasorundedir.
 */
export function claudeConfigDirs(home = homedir()): string[] {
  const dirs = [process.env[CLAUDE_CONFIG_ENV] || join(home, '.claude')]
  const same = (a: string, b: string): boolean => a.replace(/[\/]+$/, '').toLowerCase() === b.replace(/[\/]+$/, '').toLowerCase()
  try {
    for (const entry of readdirSync(home, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('.claude')) continue
      const dir = join(home, entry.name)
      if (!dirs.some((known) => same(known, dir))) dirs.push(dir)
    }
  } catch {
    // Home okunamadi: varsayilan klasorle devam.
  }
  return dirs
}

export function suggestAccountDir(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account'
  return join(homedir(), `.claude-${slug}`)
}

/** Creates the config folder and junctions `projects`/`skills` to the default account's. Never deletes user data. */
export async function linkClaudeAccount(configDir: string): Promise<{ ok: boolean; error?: string }> {
  if (!isAbsolute(configDir)) return { ok: false, error: 'The Claude config folder must be an absolute path.' }
  const dir = normalize(configDir)
  const source = defaultClaudeDir()
  if (dir.toLowerCase() === normalize(source).toLowerCase()) return { ok: true }
  try {
    await mkdir(dir, { recursive: true })
    for (const name of SHARED) {
      const from = join(source, name)
      const to = join(dir, name)
      await mkdir(from, { recursive: true })
      const existing = await lstat(to).catch(() => null)
      if (existing?.isSymbolicLink()) continue
      if (existing) {
        if (!existing.isDirectory() || (await readdir(to)).length > 0) return { ok: false, error: `${to} already has its own ${name}; move or delete it so it can be shared.` }
        await rmdir(to)
      }
      await symlink(from, to, 'junction')
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Could not prepare the account folder: ${(e as Error).message}` }
  }
}

async function readLogin(file: string, configDir?: string): Promise<ClaudeLogin | null> {
  try { return parseClaudeLogin(JSON.parse(await readFile(file, 'utf8')), configDir) } catch { return null }
}

/** Claude subscriptions signed in on this computer: the default one plus every `~/.claude*` folder with its own login. */
export async function detectClaudeLogins(home = homedir()): Promise<ClaudeLogin[]> {
  const found: ClaudeLogin[] = []
  const main = await readLogin(join(home, '.claude.json'))
  if (main) found.push(main)
  const names = await readdir(home, { withFileTypes: true }).catch(() => [])
  for (const entry of names) {
    if (!entry.isDirectory() || !entry.name.startsWith('.claude')) continue
    const dir = join(home, entry.name)
    const login = await readLogin(join(dir, '.claude.json'), dir)
    if (login) found.push(login)
  }
  return found
}
