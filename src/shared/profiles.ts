import { agentKindForCommand } from './agentEvents'
import type { AgentKind, AppSettings, ProviderProfile, SshConnection, TerminalProfile } from './types'

export const providerProfileId = (id: string): string => `provider:${id}`

export const sshProfileId = (id: string): string => `ssh:${id}`

export function defaultFullPermissionArgs(command: string): string {
  const executable = command.trim().split(/\s+/)[0]?.toLowerCase().replace(/\.cmd$|\.exe$/, '')
  if (executable === 'claude') return '--dangerously-skip-permissions'
  if (executable === 'codex') return '--dangerously-bypass-approvals-and-sandbox'
  if (executable === 'opencode') return '--auto'
  return ''
}

export function commandWithPermissions(
  command: string | undefined,
  fullPermissions: boolean | undefined,
  configuredArgs: string | undefined
): string | undefined {
  const base = command?.trim()
  if (!base) return undefined
  if (fullPermissions === false) return base
  const args = configuredArgs?.trim() || defaultFullPermissionArgs(base)
  return args ? `${base} ${args}` : base
}

export function commandWithModel(command: string | undefined, model: string | undefined): string | undefined {
  const base = command?.trim()
  const selected = model?.trim()
  if (!base || !selected) return base || undefined
  return `${base} --model ${selected}`
}

export function providerFromProfileId(settings: Pick<AppSettings, 'providerProfiles'>, profileId: string): ProviderProfile | undefined {
  if (!profileId.startsWith('provider:')) return undefined
  return settings.providerProfiles.find((provider) => provider.id === profileId.slice('provider:'.length))
}

/** Bir profil/provider'ın çalıştırdığı native CLI ajanını tek yerde çözer. */
export function agentForProfile(settings: Pick<AppSettings, 'providerProfiles' | 'profiles'>, profileId: string): AgentKind | null {
  const provider = providerFromProfileId(settings, profileId)
  if (provider) return agentKindForCommand(provider.command)
  const profile = mergeProfiles(settings.profiles).find((item) => item.id === profileId)
  return agentKindForCommand(profile?.startupCommand || profile?.command)
}

/**
 * `agentForProfile` yalnızca derin entegrasyonu olan üç ajanı (hook, izin kipi,
 * kullanım sayacı) tanır. Sekmede bir ajan CLI'ı mı çalışıyor sorusunun cevabı
 * ise bu: yerleşik katalogdaki her ajan için çalıştırdığı program adını döner
 * (`claude`, `gemini`, `qwen`...), düz kabukta null. `ollama serve` bir ajan
 * değil, sunucudur: listede yoktur.
 */
/** Lazily built: BUILTIN_PROFILES is declared further down in this module. */
let agentExecutables: Set<string> | null = null

export function agentCliForCommand(command: string | undefined): string | null {
  if (!command?.trim()) return null
  const executable = profileExecutable({ command, startupCommand: undefined })
  agentExecutables ??= new Set(BUILTIN_PROFILES.map(profileExecutable).filter((name) => name !== 'ollama'))
  return agentExecutables.has(executable) ? executable : null
}

export function agentCliForProfile(settings: Pick<AppSettings, 'providerProfiles' | 'profiles'>, profileId: string): string | null {
  const provider = providerFromProfileId(settings, profileId)
  if (provider) return agentCliForCommand(provider.command)
  const profile = mergeProfiles(settings.profiles).find((item) => item.id === profileId)
  return agentCliForCommand(profile?.startupCommand || profile?.command)
}

/** `ssh:<connectionId>` profil id'sini kayıtlı SSH bağlantısına çözer. */
export function sshFromProfileId(settings: AppSettings, profileId: string): SshConnection | undefined {
  if (!profileId.startsWith('ssh:')) return undefined
  return (settings.sshConnections ?? []).find((conn) => conn.id === profileId.slice('ssh:'.length))
}

/**
 * Yerleşik CLI ajan profilleri (TermFlow paritesi). Bunlar KABUK DEĞİL: her biri
 * platformun varsayılan kabuğunda açılıp `startupCommand` ile başlatılır — bu
 * yüzden `command` bilinçli olarak boştur (profileResolver platforma göre çözer).
 *
 * Windows'ta bu profiller PowerShell yerine cmd.exe altında açılır: `claude.cmd`
 * / `codex.cmd` gibi npm shim'leri PowerShell altında argüman/çıkış kodu
 * aktarımını bozabiliyor, cmd.exe altında doğru çalışıyor.
 *
 * Kullanıcı ayarlarında (settings.profiles) aynı id tanımlanırsa kullanıcının
 * profili kazanır (mergeProfiles).
 */
export const BUILTIN_PROFILES: readonly TerminalProfile[] = [
  { id: 'claude', name: 'Claude Code', command: '', startupCommand: 'claude', model: 'opus', color: '#d97757', fullPermissions: true, fullPermissionArgs: '--dangerously-skip-permissions' },
  { id: 'codex', name: 'Codex', command: '', startupCommand: 'codex', color: '#3b82f6', fullPermissions: true, fullPermissionArgs: '--dangerously-bypass-approvals-and-sandbox' },
  { id: 'opencode', name: 'OpenCode', command: '', startupCommand: 'opencode', color: '#3fb950', fullPermissions: true, fullPermissionArgs: '--auto' },
  { id: 'ollama-serve', name: 'Ollama Serve', command: '', startupCommand: 'ollama serve', color: '#b48ead', fullPermissions: true, fullPermissionArgs: '' },
  // Tam yetki bayraklari kurulu CLI'larin `--help` ciktisindan (2026-10-14).
  { id: 'agy', name: 'Antigravity', command: '', startupCommand: 'agy', color: '#6366f1', fullPermissions: true, fullPermissionArgs: '--dangerously-skip-permissions' },
  { id: 'gemini', name: 'Gemini CLI', command: '', startupCommand: 'gemini', color: '#4285f4', fullPermissions: true, fullPermissionArgs: '--yolo' },
  { id: 'qwen', name: 'Qwen Code', command: '', startupCommand: 'qwen', color: '#615ced', fullPermissions: true, fullPermissionArgs: '--yolo' },
  { id: 'copilot', name: 'GitHub Copilot CLI', command: '', startupCommand: 'copilot', color: '#8957e5', fullPermissions: true, fullPermissionArgs: '--allow-all' },
  { id: 'grok', name: 'Grok', command: '', startupCommand: 'grok', color: '#a3a3a3', fullPermissions: true, fullPermissionArgs: '--always-approve' },
  { id: 'droid', name: 'Droid', command: '', startupCommand: 'droid', color: '#f97316', fullPermissions: true, fullPermissionArgs: '--auto high' },
  { id: 'kimi', name: 'Kimi', command: '', startupCommand: 'kimi', color: '#22d3ee', fullPermissions: true, fullPermissionArgs: '--yolo' },
  // Pi ve Codebuff onay sormaz; ek bayrak yok.
  { id: 'pi', name: 'Pi', command: '', startupCommand: 'pi', color: '#e5c07b', fullPermissions: true, fullPermissionArgs: '' },
  { id: 'codebuff', name: 'Codebuff', command: '', startupCommand: 'codebuff', color: '#10b981', fullPermissions: true, fullPermissionArgs: '' },
  // shortcut: bu dordunun bayragi yerel kurulumla dogrulanmadi (belgelerden); kurulu bir makinede `--help` ile bakilmali.
  { id: 'cursor-agent', name: 'Cursor Agent', command: '', startupCommand: 'cursor-agent', color: '#e5e5e5', fullPermissions: true, fullPermissionArgs: '--force' },
  { id: 'amp', name: 'Amp', command: '', startupCommand: 'amp', color: '#f43f5e', fullPermissions: true, fullPermissionArgs: '--dangerously-allow-all' },
  { id: 'aider', name: 'Aider', command: '', startupCommand: 'aider', color: '#14b8a6', fullPermissions: true, fullPermissionArgs: '--yes-always' },
  { id: 'crush', name: 'Crush', command: '', startupCommand: 'crush', color: '#d946ef', fullPermissions: true, fullPermissionArgs: '--yolo' }
]

/** Profilin calistirdigi program adi (`ollama serve` -> `ollama`, `C:\x\claude.cmd` -> `claude`). */
export function profileExecutable(profile: Pick<TerminalProfile, 'command' | 'startupCommand'>): string {
  const first = (profile.startupCommand?.trim() || profile.command.trim()).match(/^"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean) ?? ''
  return first.split(/[\\/]/).at(-1)!.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, '')
}

/**
 * Secicilerde gosterilen profiller: kurulu olmayan yerlesik ajan gizlenir, kullanicinin ayni
 * programi calistiran kendi profili varsa yerlesik kopyasi da gizlenir. `installed` hic
 * taranmadiysa (undefined) yerlesiklerin hepsi gorunur.
 */
export function availableProfiles(userProfiles: readonly TerminalProfile[], installed: readonly string[] | undefined): TerminalProfile[] {
  const builtinIds = new Set(BUILTIN_PROFILES.map((b) => b.id))
  // A profile with its own Claude config folder is a second account, not a replacement for the built-in one.
  const own = new Set(userProfiles.filter((p) => !builtinIds.has(p.id) && !p.env?.CLAUDE_CONFIG_DIR?.trim()).map(profileExecutable))
  return mergeProfiles(userProfiles).filter((p) =>
    !builtinIds.has(p.id) || ((!installed || installed.includes(p.id)) && !own.has(profileExecutable(p))))
}

/**
 * Yerleşik profiller + kullanıcı profilleri. Aynı id'de kullanıcının tanımı
 * yerleşiği ezer; yalnızca kullanıcıya ait olanlar sona eklenir. Yerleşikler
 * settings'e persist EDİLMEZ, bu yüzden eski kurulumlarda da görünürler.
 */
export function mergeProfiles(userProfiles: readonly TerminalProfile[]): TerminalProfile[] {
  const byId = new Map(userProfiles.map((p) => [p.id, p]))
  const merged = BUILTIN_PROFILES.map((b) => ({ ...b, ...(byId.get(b.id) ?? {}) }))
  const builtinIds = new Set(BUILTIN_PROFILES.map((b) => b.id))
  return [...merged, ...userProfiles.filter((p) => !builtinIds.has(p.id))]
}
