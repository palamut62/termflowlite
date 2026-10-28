// Kurulu ajan CLI'larini tarar (acilista ve pencere odak alinca); degisirse `installedAgents`
// ayarina yazar, menuler (yeni sekme, telefon, Gezgin sag tik) kendiliginden guncellenir.

import { BUILTIN_PROFILES } from '../../shared/profiles'
import { CLAUDE_CONFIG_ENV, missingAccountProfiles, type ClaudeLogin } from '../../shared/claudeAccounts'
import { useSettingsStore } from './store/settingsStore'
import { useToastStore } from './store/toastStore'

/** Registers a profile for every signed-in Claude account that has none, and shares its history folders. */
export async function syncClaudeAccounts(): Promise<ClaudeLogin[]> {
  const logins = await window.termflow.files.detectClaudeLogins().catch(() => [])
  const { settings, update } = useSettingsStore.getState()
  const added = missingAccountProfiles(logins, settings.profiles)
  if (added.length === 0) return logins
  for (const profile of added) await window.termflow.files.linkClaudeAccount(profile.env![CLAUDE_CONFIG_ENV])
  await update({ profiles: [...settings.profiles, ...added] })
  useToastStore.getState().show(`Claude account added: ${added.map((p) => p.name.replace('Claude Code ', '')).join(', ')}`, 'success')
  return logins
}

const MIN_INTERVAL_MS = 30_000
let lastScan = 0

export async function scanAgents(force = false): Promise<string[] | undefined> {
  if (!force && Date.now() - lastScan < MIN_INTERVAL_MS) return undefined
  lastScan = Date.now()
  void syncClaudeAccounts()
  const installed = await window.termflow.detectAgents()
  const previous = useSettingsStore.getState().settings.installedAgents
  if (previous && previous.join() === installed.join()) return installed
  await useSettingsStore.getState().update({ installedAgents: installed })
  // Ilk taramada degil, sonradan kurulan ajan icin haber ver.
  const added = previous ? installed.filter((id) => !previous.includes(id)) : []
  const names = BUILTIN_PROFILES.filter((p) => added.includes(p.id)).map((p) => p.name)
  if (names.length > 0) useToastStore.getState().show(`${names.join(', ')} found. Open it from the New Tab menu.`, 'success')
  return installed
}

export function startAgentDetection(): () => void {
  void scanAgents(true)
  const onFocus = (): void => void scanAgents()
  window.addEventListener('focus', onFocus)
  return () => window.removeEventListener('focus', onFocus)
}
