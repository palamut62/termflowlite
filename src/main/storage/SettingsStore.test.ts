import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'
import { SettingsStore, normalizeWorktreeMeta } from './SettingsStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'termflow-settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

const file = (): string => join(dir, 'settings.json')

describe('SettingsStore', () => {
  it('creates defaults when the file does not exist yet', () => {
    const store = new SettingsStore(file())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(existsSync(file())).toBe(false) // nothing written until update/flush
  })

  it('keeps TermFlow Lite in the terminal layout even if a settings file asks for the IDE', () => {
    writeFileSync(file(), JSON.stringify({ uiMode: 'ide' }))
    const settings = new SettingsStore(file()).get()
    expect(settings.uiMode).toBe('terminal')
    expect(Object.values(settings.shortcuts)).not.toContain('toggle-ui-mode')
  })
  it('migrates the legacy blur toggle to an acrylic backdrop', () => {
    const legacy: Partial<AppSettings> = { ...DEFAULT_SETTINGS, blur: true }
    delete legacy.backdrop
    writeFileSync(file(), JSON.stringify(legacy), 'utf-8')
    expect(new SettingsStore(file()).get().backdrop).toBe('acrylic')
  })

  it('keeps orchestration off by default and sanitizes it', () => {
    writeFileSync(file(), JSON.stringify({}))
    expect(new SettingsStore(file()).get().orchestration).toEqual(DEFAULT_SETTINGS.orchestration)
    writeFileSync(file(), JSON.stringify({ orchestration: {
      enabled: 'yes', maxConcurrent: 99, timeoutMinutes: -3, claudeThreshold: 'x',
      targets: { opencode: { enabled: false, model: ' m ' }, 'provider:deep-seek': { model: 3 }, 'rm -rf': { enabled: true }, grok: null }
    } }))
    expect(new SettingsStore(file()).get().orchestration).toEqual({
      enabled: false, maxConcurrent: 4, timeoutMinutes: 1, claudeThreshold: 70,
      targets: { opencode: { enabled: false, model: 'm' }, 'provider:deep-seek': { enabled: true, model: '' } }
    })
  })

  it('keeps agent memory off by default and sanitizes its settings', () => {
    writeFileSync(file(), JSON.stringify({ memory: { enabled: 'yes', model: '  ', excludedProjects: ['c:\a', 'c:\a', 3, ''] } }))
    expect(new SettingsStore(file()).get().memory).toEqual({ enabled: false, updateEvery: 'hourly', model: DEFAULT_SETTINGS.memory.model, excludedProjects: ['c:\a'] })
    writeFileSync(file(), JSON.stringify({ memory: { enabled: true, model: ' x/y ' } }))
    expect(new SettingsStore(file()).get().memory).toEqual({ enabled: true, updateEvery: 'hourly', model: 'x/y', excludedProjects: [] })
    writeFileSync(file(), JSON.stringify({ memory: { enabled: true, updateEvery: 'weekly' } }))
    expect(new SettingsStore(file()).get().memory.updateEvery).toBe('weekly')
    writeFileSync(file(), JSON.stringify({ memory: { updateEvery: 'every-minute' } }))
    expect(new SettingsStore(file()).get().memory.updateEvery).toBe('hourly')
  })

  it('keeps worktree setup steps but drops paths that leave the repository', () => {
    writeFileSync(file(), JSON.stringify({ worktreeSetup: { 'c:/app': { copyFiles: ['.env', '../secret'], commands: ['npm ci'] }, broken: 'x' } }), 'utf-8')
    expect(new SettingsStore(file()).get().worktreeSetup).toEqual({ 'c:/app': { copyFiles: ['.env'], commands: ['npm ci'], enabled: true } })
  })

  it('moves existing installs to Claude limits on once, then keeps their choice', () => {
    writeFileSync(file(), JSON.stringify({ claudeUsage: false, usageDisplay: 'used' }))
    const store = new SettingsStore(file())
    expect(store.get()).toMatchObject({ claudeUsage: true, usageDisplay: 'used', limitDefaultsApplied: true, limitClaudeStyleApplied: true })
    expect(store.update({ usageDisplay: 'used', claudeUsage: false })).toMatchObject({ claudeUsage: false, usageDisplay: 'used' })
  })

  it('switches a remaining-% install to Claude Code style used % once, keeps off and later choices', () => {
    writeFileSync(file(), JSON.stringify({ limitDefaultsApplied: true, usageDisplay: 'remaining' }))
    const store = new SettingsStore(file())
    expect(store.get().usageDisplay).toBe('used')
    expect(store.update({ usageDisplay: 'remaining' }).usageDisplay).toBe('remaining')
    store.flush()
    expect(new SettingsStore(file()).get().usageDisplay).toBe('remaining')
    writeFileSync(file(), JSON.stringify({ limitDefaultsApplied: true, usageDisplay: 'off' }))
    expect(new SettingsStore(file()).get().usageDisplay).toBe('off')
  })

  it('rejects an unknown backdrop material', () => {
    writeFileSync(file(), JSON.stringify({ ...DEFAULT_SETTINGS, backdrop: 'glass' }), 'utf-8')
    expect(new SettingsStore(file()).get().backdrop).toBe('none')
  })

  it('loads an existing file', () => {
    writeFileSync(file(), JSON.stringify({ ...DEFAULT_SETTINGS, fontSize: 17, themeId: 'nord' }), 'utf-8')
    const store = new SettingsStore(file())
    expect(store.get().fontSize).toBe(17)
    expect(store.get().themeId).toBe('nord')
  })

  it('falls back to defaults on corrupt JSON and leaves the file untouched', () => {
    writeFileSync(file(), '{not json!!', 'utf-8')
    const store = new SettingsStore(file())
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(readFileSync(file(), 'utf-8')).toBe('{not json!!') // load never writes
  })

  it('normalizes missing fields from an incomplete file', () => {
    writeFileSync(file(), JSON.stringify({ themeId: 'light' }), 'utf-8')
    const store = new SettingsStore(file())
    const settings = store.get()
    expect(settings.themeId).toBe('light')
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
    expect(settings.shortcuts).toEqual(DEFAULT_SETTINGS.shortcuts) // nested deep merge
    expect(settings.profiles).toEqual([]) // profiles is replaced whole
  })

  it('update merges a partial patch and returns a fresh snapshot', () => {
    const store = new SettingsStore(file())
    const next = store.update({ fontSize: 21, themeId: 'gruvbox' })
    expect(next.fontSize).toBe(21)
    expect(next.themeId).toBe('gruvbox')
    expect(next.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily) // untouched fields survive
    expect(store.get().fontSize).toBe(21)
  })

  it('flush writes the file synchronously (atomic temp + rename)', () => {
    const store = new SettingsStore(file())
    store.update({ fontSize: 14 })
    store.flush()
    const onDisk = JSON.parse(readFileSync(file(), 'utf-8')) as AppSettings
    expect(onDisk.fontSize).toBe(14)
    expect(onDisk.windowWidth).toBe(DEFAULT_SETTINGS.windowWidth)
    expect(existsSync(`${file()}.tmp`)).toBe(false) // temp file renamed away
  })

  it('persists debounced writes after the debounce window', () => {
    vi.useFakeTimers()
    const store = new SettingsStore(file())
    store.update({ fontSize: 15 })
    store.update({ fontSize: 16 }) // second update resets the debounce
    vi.advanceTimersByTime(299)
    expect(existsSync(file())).toBe(false) // still within the 300ms window
    vi.advanceTimersByTime(1)
    const onDisk = JSON.parse(readFileSync(file(), 'utf-8')) as AppSettings
    expect(onDisk.fontSize).toBe(16)
  })
})

describe('normalizeWorktreeMeta', () => {
  it('keeps valid fields, drops junk and empty records', () => {
    expect(normalizeWorktreeMeta({
      'c:/repo/a': { name: 'Login fix', status: 'in-review', pinned: true, sleeping: 'yes', note: '', extra: 1 },
      'c:/repo/b': { status: 'blocked' },
      'c:/repo/c': 'nope'
    })).toEqual({ 'c:/repo/a': { name: 'Login fix', status: 'in-review', pinned: true } })
    expect(normalizeWorktreeMeta([])).toEqual({})
  })
})

describe('phone push settings', () => {
  it('creates a topic when turned on and keeps it afterwards', () => {
    const store = new SettingsStore(file())
    expect(store.get().remote.push).toEqual({ enabled: false, server: 'https://ntfy.sh', topic: '' })
    const on = store.update({ remote: { ...store.get().remote, push: { enabled: true, server: 'https://ntfy.sh', topic: '' } } })
    expect(on.remote.push.topic).toMatch(/^termflow-/)
    const again = store.update({ remote: { ...on.remote, port: 47322 } })
    expect(again.remote.push.topic).toBe(on.remote.push.topic)
  })

  it('falls back to the default server for a bad URL and drops a bad topic', () => {
    const store = new SettingsStore(file())
    const next = store.update({ remote: { ...store.get().remote, push: { enabled: false, server: 'javascript:alert(1)', topic: 'x' } } })
    expect(next.remote.push).toEqual({ enabled: false, server: 'https://ntfy.sh', topic: '' })
  })
})
