import { mkdtemp, lstat, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { claudeHookEvent } from '../shared/agentHooks'
import { linkClaudeAccount } from './claudeAccount'
import { claudeAccounts, missingAccountProfiles, nextClaudeAccount, parseClaudeLogin } from '../shared/claudeAccounts'

describe('linkClaudeAccount', () => {
  it('links projects and refuses a folder that has its own data', async () => {
    const base = await mkdtemp(join(tmpdir(), 'tfa-'))
    process.env.CLAUDE_CONFIG_DIR = join(base, 'default')
    const dir = join(base, 'acc')
    expect((await linkClaudeAccount(dir)).ok).toBe(true)
    expect((await lstat(join(dir, 'projects'))).isSymbolicLink()).toBe(true)
    expect((await linkClaudeAccount(dir)).ok).toBe(true)
    const other = join(base, 'acc2')
    await mkdir(join(other, 'projects'), { recursive: true })
    await writeFile(join(other, 'projects', 'x'), '1')
    expect((await linkClaudeAccount(other)).ok).toBe(false)
    expect((await linkClaudeAccount('relative')).ok).toBe(false)
    delete process.env.CLAUDE_CONFIG_DIR
  })
})

describe('claudeAccounts', () => {
  it('lists default claude and config-dir profiles only', () => {
    const list = claudeAccounts([
      { id: 'a', name: 'A', command: '', startupCommand: 'claude', env: { CLAUDE_CONFIG_DIR: 'C:\\x' } },
      { id: 'b', name: 'B', command: '', startupCommand: 'claude' },
      { id: 'c', name: 'C', command: '', startupCommand: 'codex', env: { CLAUDE_CONFIG_DIR: 'C:\\y' } }
    ]).map((p) => p.id)
    expect(list).toEqual(['claude', 'a'])
  })
})

describe('account detection', () => {
  it('parses a login and registers only unknown config folders', () => {
    expect(parseClaudeLogin({}, 'C:\\x')).toBeNull()
    const a = parseClaudeLogin({ oauthAccount: { emailAddress: 'a@b.c', billingType: 'stripe_subscription' } }, 'C:\\Users\\u\\.claude-two')!
    expect(a.email).toBe('a@b.c')
    const added = missingAccountProfiles([a, { email: 'd@e.f' }], [])
    expect(added).toHaveLength(1)
    expect(added[0].env).toEqual({ CLAUDE_CONFIG_DIR: 'C:\\Users\\u\\.claude-two' })
    expect(missingAccountProfiles([a], added)).toEqual([])
    expect(missingAccountProfiles([a], [{ id: 'x', name: 'x', command: '', env: { CLAUDE_CONFIG_DIR: 'c:\\users\\u\\.claude-two\\' } }])).toEqual([])
  })
})

describe('limit failover', () => {
  it('flags usage-limit failures and skips accounts that were limited recently', () => {
    expect(claudeHookEvent({ hook_event_name: 'StopFailure', error: 'rate_limit' })?.limit).toBe(true)
    expect(claudeHookEvent({ hook_event_name: 'StopFailure', error: 'server_error' })?.limit).toBeUndefined()
    const accounts = [{ id: 'claude', name: 'A', command: '' }, { id: 'b', name: 'B', command: '' }, { id: 'c', name: 'C', command: '' }]
    const limited = new Map([['b', 1000]])
    expect(nextClaudeAccount(accounts, 'claude', limited, 2000)?.id).toBe('c')
    expect(nextClaudeAccount(accounts, 'claude', new Map([['b', 1000], ['c', 1500]]), 2000)).toBeUndefined()
    expect(nextClaudeAccount(accounts, 'claude', limited, 1000 + 6 * 3600 * 1000)?.id).toBe('b')
  })
})
