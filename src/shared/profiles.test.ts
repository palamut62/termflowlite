import { describe, expect, it } from 'vitest'
import { BUILTIN_PROFILES, agentCliForCommand, agentCliForProfile, availableProfiles, mergeProfiles, profileExecutable, sshFromProfileId, sshProfileId } from './profiles'
import { DEFAULT_SETTINGS, type AppSettings } from './types'

describe('mergeProfiles', () => {
  it('kullanıcı profili yoksa yerleşikleri döner', () => {
    expect(mergeProfiles([]).map((p) => p.id)).toEqual(BUILTIN_PROFILES.map((p) => p.id))
  })

  it('aynı id\'de kullanıcı profili yerleşiği ezer, sıra korunur', () => {
    const merged = mergeProfiles([{ id: 'codex', name: 'Benim Codex', command: 'codex.exe' }])
    const codex = merged.find((p) => p.id === 'codex')
    expect(codex?.name).toBe('Benim Codex')
    expect(merged).toHaveLength(BUILTIN_PROFILES.length)
  })

  it('yalnızca kullanıcıya ait profiller sona eklenir', () => {
    const merged = mergeProfiles([{ id: 'dev', name: 'Dev', command: 'tmux' }])
    expect(merged).toHaveLength(BUILTIN_PROFILES.length + 1)
    expect(merged[merged.length - 1].id).toBe('dev')
  })

  it('yerleşik CLI ajanlarının komutu boş, startupCommand ve rengi var', () => {
    for (const p of BUILTIN_PROFILES) {
      expect(p.command).toBe('')
      expect(p.startupCommand).toBeTruthy()
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps the Claude Opus default when a legacy override omits model', () => {
    const merged = mergeProfiles([{ id: 'claude', name: 'Claude Custom', command: '', startupCommand: 'claude' }])
    expect(merged.find((profile) => profile.id === 'claude')?.model).toBe('opus')
  })
})

describe('sshFromProfileId', () => {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    sshConnections: [{ id: 'srv1', name: 'Prod', host: 'prod.example.com', user: 'deploy' }]
  }

  it('ssh:<id> profil id\'sini bağlantıya çözer', () => {
    expect(sshFromProfileId(settings, sshProfileId('srv1'))?.name).toBe('Prod')
  })

  it('ssh öneki olmayan id\'ler için undefined döner', () => {
    expect(sshFromProfileId(settings, 'srv1')).toBeUndefined()
    expect(sshFromProfileId(settings, 'provider:deepseek')).toBeUndefined()
  })

  it('bilinmeyen bağlantı id\'si için undefined döner', () => {
    expect(sshFromProfileId(settings, 'ssh:yok')).toBeUndefined()
  })

  it('sshConnections tanımsızsa çökmez (eski ayar dosyaları)', () => {
    const legacy = { ...DEFAULT_SETTINGS, sshConnections: undefined as unknown as AppSettings['sshConnections'] }
    expect(sshFromProfileId(legacy, 'ssh:srv1')).toBeUndefined()
  })
})

describe('availableProfiles', () => {
  it('hides built-in agents that are not installed and keeps the user profiles', () => {
    const ids = availableProfiles([{ id: 'dev', name: 'Dev', command: 'tmux' }], ['claude', 'gemini']).map((p) => p.id)
    expect(ids).toEqual(['claude', 'gemini', 'dev'])
  })

  it('shows every built-in until the first scan', () => {
    expect(availableProfiles([], undefined)).toHaveLength(BUILTIN_PROFILES.length)
  })

  it('drops the built-in copy when the user already has a profile for the same program', () => {
    const ids = availableProfiles([{ id: 'my-gemini', name: 'Gemini (mine)', command: '', startupCommand: 'gemini.cmd --model x' }], ['gemini', 'codex']).map((p) => p.id)
    expect(ids).toEqual(['codex', 'my-gemini'])
  })

  it('every built-in agent opens with full access by default', () => {
    for (const p of BUILTIN_PROFILES) expect(p.fullPermissions).toBe(true)
  })
})

it('profileExecutable reads the program name from either command field', () => {
  expect(profileExecutable({ command: '', startupCommand: 'ollama serve' })).toBe('ollama')
  expect(profileExecutable({ command: '"C:\\Tools\\Claude.cmd" --x' })).toBe('claude')
  expect(profileExecutable({ command: '/usr/bin/aider' })).toBe('aider')
})

describe('agentCliForProfile', () => {
  const settings = { ...DEFAULT_SETTINGS, profiles: [{ id: 'mine', name: 'Mine', command: 'C:/tools/qwen.cmd' }], providerProfiles: [{ id: 'dsk', name: 'DeepSeek', command: 'claude', apiKeyEnv: '', baseUrl: '' }] } as unknown as AppSettings

  it('knows every built-in agent CLI, not only the three with hooks', () => {
    expect(agentCliForCommand('gemini --yolo')).toBe('gemini')
    expect(agentCliForCommand('"C:/Program Files/droid/droid.exe" --auto high')).toBe('droid')
    expect(agentCliForCommand('claude')).toBe('claude')
    // Shells and servers are not agents.
    expect(agentCliForCommand('ollama serve')).toBeNull()
    expect(agentCliForCommand('pwsh -NoLogo')).toBeNull()
    expect(agentCliForCommand(undefined)).toBeNull()
  })

  it('resolves built-in, user and provider profiles', () => {
    expect(agentCliForProfile(settings, 'gemini')).toBe('gemini')
    expect(agentCliForProfile(settings, 'mine')).toBe('qwen')
    expect(agentCliForProfile(settings, 'provider:dsk')).toBe('claude')
    expect(agentCliForProfile(settings, 'ollama-serve')).toBeNull()
    expect(agentCliForProfile(settings, 'nope')).toBeNull()
  })
})
