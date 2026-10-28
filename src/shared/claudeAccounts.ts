import { BUILTIN_PROFILES, mergeProfiles, profileExecutable } from './profiles'
import type { TerminalProfile } from './types'

export const CLAUDE_CONFIG_ENV = 'CLAUDE_CONFIG_DIR'

/** A Claude subscription login found on this computer. `configDir` is undefined for the default account. */
export interface ClaudeLogin {
  configDir?: string
  email: string
  name?: string
  billing?: string
}

/** Reads the signed-in account out of a `.claude.json` (no tokens live there). */
export function parseClaudeLogin(json: unknown, configDir?: string): ClaudeLogin | null {
  const o = (json as { oauthAccount?: Record<string, unknown> } | null)?.oauthAccount
  if (!o || typeof o.emailAddress !== 'string' || !o.emailAddress) return null
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  return { configDir, email: o.emailAddress, name: str(o.displayName), billing: str(o.billingType) }
}

const sameDir = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/** New profiles for signed-in accounts that have a config folder but no profile yet. */
export function missingAccountProfiles(logins: readonly ClaudeLogin[], userProfiles: readonly TerminalProfile[]): TerminalProfile[] {
  const known = userProfiles.map(claudeConfigDir).filter((d): d is string => !!d)
  return logins
    .filter((l) => l.configDir && !known.some((d) => sameDir(d, l.configDir!)))
    .map((l) => ({
      id: `claude-${l.configDir!.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(-40)}`,
      name: `Claude Code (${l.email})`,
      command: '',
      startupCommand: 'claude',
      model: 'opus',
      color: '#d97757',
      fullPermissions: true,
      fullPermissionArgs: '--dangerously-skip-permissions',
      env: { [CLAUDE_CONFIG_ENV]: l.configDir! }
    }))
}

/** Claude Code config folder a profile signs in with; undefined means the default account. */
export const claudeConfigDir = (profile: Pick<TerminalProfile, 'env'>): string | undefined =>
  profile.env?.[CLAUDE_CONFIG_ENV]?.trim() || undefined

/** Profiles that can resume a Claude session: the default `claude` plus profiles with their own config folder. */
export function claudeAccounts(userProfiles: readonly TerminalProfile[]): TerminalProfile[] {
  return mergeProfiles(userProfiles).filter((p) =>
    profileExecutable(p) === 'claude' && (BUILTIN_PROFILES.some((b) => b.id === p.id) || claudeConfigDir(p)))
}

/** How long an account is skipped after it reported a usage limit (the 5-hour window). */
export const LIMIT_SKIP_MS = 5 * 60 * 60 * 1000

/** Next account that is not the current one and has not hit its limit recently; undefined when none is left. */
export function nextClaudeAccount(accounts: readonly TerminalProfile[], currentId: string, limitedAt: ReadonlyMap<string, number>, now: number): TerminalProfile | undefined {
  return accounts.find((a) => a.id !== currentId && now - (limitedAt.get(a.id) ?? -Infinity) > LIMIT_SKIP_MS)
}
