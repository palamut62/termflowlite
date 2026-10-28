import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import type { TerminalProfile } from '../../../shared/types'
import { BUILTIN_PROFILES, defaultFullPermissionArgs } from '../../../shared/profiles'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { Field, TextInput, Toggle } from './Settings'
import { splitCommandLine, formatArguments } from '../../../shared/commandLine'
import { agentKindForCommand } from '../../../shared/agentEvents'
import { scanAgents, syncClaudeAccounts } from '../agentDetect'
import { AGENT_NPM_PACKAGES, type AgentUpdateItem, type AgentUpdateSnapshot } from '../../../shared/agentUpdate'
import type { ClaudeLogin } from '../../../shared/claudeAccounts'

interface EnvRow {
  key: string
  value: string
}

interface ProfileDraft {
  name: string
  command: string
  args: string
  cwd: string
  icon: string
  startupCommand: string
  model: string
  color: string
  fullPermissions: boolean
  fullPermissionArgs: string
  env: EnvRow[]
}

const emptyDraft = (): ProfileDraft => ({
  name: '',
  command: '',
  args: '',
  cwd: '',
  icon: '',
  startupCommand: '',
  model: '',
  color: '',
  fullPermissions: true,
  fullPermissionArgs: '',
  env: []
})

function toDraft(p: TerminalProfile): ProfileDraft {
  return {
    name: p.name,
    command: p.command,
    args: formatArguments(p.args ?? []),
    cwd: p.cwd ?? '',
    icon: p.icon ?? '',
    startupCommand: p.startupCommand ?? '',
    model: p.model ?? '',
    color: p.color ?? '',
    fullPermissions: p.fullPermissions !== false,
    fullPermissionArgs: p.fullPermissionArgs ?? defaultFullPermissionArgs(p.startupCommand || p.command),
    env: Object.entries(p.env ?? {}).map(([key, value]) => ({ key, value }))
  }
}

function fromDraft(d: ProfileDraft, id: string): TerminalProfile {
  const args = d.args.trim() ? splitCommandLine(d.args) : undefined
  const env: Record<string, string> = {}
  for (const row of d.env) {
    const key = row.key.trim()
    if (key) env[key] = row.value
  }
  return {
    id,
    name: d.name.trim(),
    command: d.command.trim(),
    args,
    cwd: d.cwd.trim() || undefined,
    icon: d.icon.trim() || undefined,
    startupCommand: d.startupCommand.trim() || undefined,
    model: d.model.trim() || undefined,
    color: d.color.trim() || undefined,
    fullPermissions: d.fullPermissions,
    fullPermissionArgs: d.fullPermissionArgs.trim() || undefined,
    env: Object.keys(env).length > 0 ? env : undefined
  }
}

/**
 * Geçerlilik: ad zorunlu; komut VEYA startup command'dan en az biri gerekir —
 * komut boş bırakılınca profil platformun varsayılan kabuğunda açılıp startup
 * command ile başlatılır (CLI ajan profilleri).
 */
function isValid(d: ProfileDraft): boolean {
  return d.name.trim().length > 0 && (d.command.trim().length > 0 || d.startupCommand.trim().length > 0)
}

/** Custom profiller (PRD §36): ekle/düzenle/sil; silme onay istemez. */
const UPDATE_TEXT: Record<AgentUpdateItem['state'], string> = {
  checking: 'checking...', updating: 'updating...', current: 'up to date', updated: 'updated', failed: 'update failed'
}

function updateLabel(item: AgentUpdateItem | undefined, id: string): string {
  if (!item) return id in AGENT_NPM_PACKAGES ? '' : ' · self-updating / manual'
  const version = item.version ? ` v${item.version}` : ''
  const target = item.state === 'updating' && item.latest ? ` -> v${item.latest}` : ''
  return ` ·${version}${target} ${UPDATE_TEXT[item.state]}${item.state === 'failed' && item.error ? ` (${item.error})` : ''}`
}

function lastCheckText(s: AgentUpdateSnapshot, enabled: boolean): string {
  if (s.running) return 'Checking now...'
  if (!s.lastRunAt) return enabled ? 'Not checked yet since launch (first check runs shortly after startup).' : 'Auto-update is off; not checked.'
  const when = new Date(s.lastRunAt).toLocaleString()
  return s.lastError ? `Last check: ${when} - failed (${s.lastError})` : `Last check: ${when}`
}

export function ProfileSettings(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft())
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [logins, setLogins] = useState<ClaudeLogin[]>([])
  useEffect(() => { void syncClaudeAccounts().then(setLogins) }, [])

  const [updates, setUpdates] = useState<AgentUpdateSnapshot>({ running: false, items: [] })
  useEffect(() => {
    void window.termflow.agentUpdates.status().then(setUpdates)
    return window.termflow.agentUpdates.onChanged(setUpdates)
  }, [])
  const updateById = new Map(updates.items.map((item) => [item.id, item]))

  const editing = editingId !== null || creating

  const startEdit = (p: TerminalProfile): void => {
    setEditingId(p.id)
    setCreating(false)
    setDraft(toDraft(p))
  }

  const startClaudeAccount = async (): Promise<void> => {
    const n = settings.profiles.filter((x) => x.env?.CLAUDE_CONFIG_DIR).length + 2
    const dir = await window.termflow.files.suggestClaudeDir(`account ${n}`)
    setEditingId(null)
    setCreating(true)
    setDraft({ ...emptyDraft(), name: `Claude Code (Account ${n})`, startupCommand: 'claude', model: 'opus', color: '#d97757', fullPermissionArgs: '--dangerously-skip-permissions', env: [{ key: 'CLAUDE_CONFIG_DIR', value: dir }] })
  }

  const startCreate = (): void => {
    setEditingId(null)
    setCreating(true)
    setDraft(emptyDraft())
  }

  const cancel = (): void => {
    setEditingId(null)
    setCreating(false)
  }

  const save = (): void => {
    if (!isValid(draft)) return
    const id = editingId ?? nanoid(10)
    let payload: TerminalProfile
    try { payload = fromDraft(draft, id); setError('') } catch (error) { setError((error as Error).message); return }
    const exists = editingId ? settings.profiles.some((p) => p.id === editingId) : false
    const profiles = exists
      ? settings.profiles.map((p) => (p.id === editingId ? payload : p))
      : [...settings.profiles, payload]
    // defaultProfileId'ye dokunulmaz — yeni profil otomatik default olmaz.
    void update({ profiles })
    const configDir = payload.env?.CLAUDE_CONFIG_DIR?.trim()
    if (configDir) {
      void window.termflow.files.linkClaudeAccount(configDir).then((r) => useToastStore.getState().show(r.ok ? 'Claude account ready. Sign in with /login in its first tab.' : r.error ?? 'Could not prepare the account.', r.ok ? 'info' : 'error'))
    }
    cancel()
  }

  const remove = (id: string): void => {
    void update({ profiles: settings.profiles.filter((p) => p.id !== id) })
    if (editingId === id) cancel()
  }

  const setEnv = (idx: number, patch: Partial<EnvRow>): void => {
    setDraft((d) => ({ ...d, env: d.env.map((row, i) => (i === idx ? { ...row, ...patch } : row)) }))
  }

  const addEnv = (): void => setDraft((d) => ({ ...d, env: [...d.env, { key: '', value: '' }] }))
  const removeEnv = (idx: number): void => setDraft((d) => ({ ...d, env: d.env.filter((_, i) => i !== idx) }))

  const valid = isValid(draft)
  const installed = settings.installedAgents
  const builtinIds = new Set(BUILTIN_PROFILES.map((profile) => profile.id))
  const effectiveBuiltins = BUILTIN_PROFILES.map(
    (profile) => settings.profiles.find((candidate) => candidate.id === profile.id) ?? profile
  )
  const customProfiles = settings.profiles.filter((profile) => !builtinIds.has(profile.id))

  return (
    <section>
      <div className="settings-section-title">Command Profiles</div>
      <p className="settings-note">Agent CLIs installed on this computer are detected automatically and appear in the New Tab menu; the list updates when you install or remove one. Built-in profiles launch with full permissions by default. Edit any profile to disable it or change its CLI-specific permission arguments. Reset restores the built-in defaults.</p>
      <div className="profile-form-actions">
        <button className="settings-btn settings-btn-small" disabled={scanning} onClick={() => { setScanning(true); void scanAgents(true).finally(() => setScanning(false)) }}>
          {scanning ? 'Scanning...' : 'Rescan installed agents'}
        </button>
        {installed && <span className="settings-note">{installed.length} of {BUILTIN_PROFILES.length} found</span>}
      </div>
      <Field label="Auto-update agent CLIs" hint="Checked in the background at startup and once a day; only npm-installed CLIs are updated. A running agent may need a restart to use the new version.">
        <Toggle checked={settings.autoUpdateAgents} onChange={(v) => void update({ autoUpdateAgents: v })} label="Auto-update agent CLIs" />
      </Field>
      <div className="profile-form-actions">
        <button className="settings-btn settings-btn-small" disabled={updates.running} onClick={() => void window.termflow.agentUpdates.run()}>
          {updates.running ? 'Checking...' : 'Check for CLI updates now'}
        </button>
        <span className="settings-note">{lastCheckText(updates, settings.autoUpdateAgents)}</span>
      </div>
      {effectiveBuiltins.map((p) => {
        const isOverridden = settings.profiles.some((candidate) => candidate.id === p.id)
        const found = !installed || installed.includes(p.id)
        const access = agentKindForCommand(p.startupCommand) ? 'Uses session security mode'
          : p.fullPermissions === false ? 'Asks for approval' : `Full access${p.fullPermissionArgs ? `: ${p.fullPermissionArgs}` : ''}`
        return editingId !== p.id && (
          <div className={`profile-row${found ? '' : ' profile-row-missing'}`} key={p.id}>
            <span className="menu-item-dot" style={{ background: p.color || '#6467f2' }} />
            <span className="profile-row-info">
              <span className="profile-row-name">{p.name}{found ? '' : ' · Not installed'}{updateLabel(updateById.get(p.id), p.id)}</span>
              <span className="profile-row-command">{p.startupCommand}{p.model ? ` · ${p.model}` : ''} · {access}</span>
            </span>
            <button className="settings-btn settings-btn-small" onClick={() => startEdit(p)}>Edit</button>
            {isOverridden && (
              <button className="settings-btn settings-btn-small" onClick={() => remove(p.id)} title="Restore built-in defaults">Reset</button>
            )}
          </div>
        )
      })}
      <div className="settings-section-title">Claude accounts</div>
      <p className="settings-note">Signed-in Claude subscriptions are found automatically and get a profile of their own. Right-click a Claude tab and choose Continue session with... to carry a session over when one account hits its limit.</p>
      <Toggle checked={settings.autoSwitchClaudeAccount} disabled={!settings.agentHooks} onChange={(value) => { void update({ autoSwitchClaudeAccount: value }) }} label="Switch account automatically when a limit is reached" />
      {logins.length === 0 && <div className="settings-empty">No signed-in Claude account found. Run /login in Claude Code.</div>}
      {logins.map((login) => (
        <div className="profile-row" key={login.configDir ?? 'default'}>
          <span className="menu-item-dot" style={{ background: '#d97757' }} />
          <span className="profile-row-info">
            <span className="profile-row-name">{login.email}{login.configDir ? '' : ' · Default'}</span>
            <span className="profile-row-command">{[login.name, login.billing?.replace(/_/g, ' '), login.configDir].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
      ))}
      <div className="profile-form-actions">
        <button className="settings-btn settings-btn-small" onClick={() => void syncClaudeAccounts().then(setLogins)}>Rescan Claude accounts</button>
      </div>
      <div className="settings-section-title">Custom Profiles</div>
      {customProfiles.length === 0 && !editing && (
        <div className="settings-empty">No custom profiles yet — add one below.</div>
      )}

      {customProfiles.map(
        (p) =>
          editingId !== p.id && (
            <div className="profile-row" key={p.id}>
              <span className="profile-row-icon">{p.icon ?? '▸'}</span>
              <span className="profile-row-info">
                <span className="profile-row-name">{p.name}</span>
                <span className="profile-row-command">{p.command || p.startupCommand}</span>
              </span>
              <button className="settings-btn settings-btn-small" onClick={() => startEdit(p)}>
                Edit
              </button>
              <button className="settings-btn settings-btn-small settings-btn-danger" onClick={() => remove(p.id)} aria-label={`Delete ${p.name}`}>
                <Trash2 size={12} />
              </button>
            </div>
          )
      )}

      {editing && (
        <div className="profile-form">
          {error && <p role="alert">{error}</p>}
          <Field label="Name">
            <TextInput value={draft.name} placeholder="My Terminal" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Command" hint="empty = default shell">
            <TextInput
              className="settings-input-wide"
              value={draft.command}
              placeholder="C:\path\app.exe"
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            />
          </Field>
          <Field label="Arguments" hint="space-separated">
            <TextInput
              className="settings-input-wide"
              value={draft.args}
              placeholder="--flag arg1"
              onChange={(e) => setDraft({ ...draft, args: e.target.value })}
            />
          </Field>
          <Field label="Starting Directory">
            <TextInput
              className="settings-input-wide"
              value={draft.cwd}
              placeholder="C:\work"
              onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
            />
          </Field>
          <Field label="Icon" hint="emoji or a single character">
            <TextInput
              className="settings-input-narrow"
              value={draft.icon}
              placeholder="🐚"
              onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
            />
          </Field>
          <Field label="Startup Command" hint="typed once the shell is ready">
            <TextInput
              className="settings-input-wide"
              value={draft.startupCommand}
              placeholder="claude"
              onChange={(e) => setDraft({ ...draft, startupCommand: e.target.value })}
            />
          </Field>
          <Field label="Color" hint="#rrggbb — tab/menu dot">
            <TextInput
              className="settings-input-narrow"
              value={draft.color}
              placeholder="#d97757"
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
          </Field>
          <Field label="Default Model" hint="empty = CLI default; passed via --model">
            <TextInput
              className="settings-input-wide"
              value={draft.model}
              placeholder="opus"
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </Field>
          <Field label="Full Permissions" hint="Legacy custom CLI option; supported agents use the session security mode in Agent Security">
            <Toggle checked={draft.fullPermissions} onChange={(fullPermissions) => setDraft({ ...draft, fullPermissions })} label="Command profile full permissions" />
          </Field>
          <Field label="Permission Arguments" hint="Supported agent permission flags are normalized to the session security mode">
            <TextInput
              className="settings-input-wide"
              value={draft.fullPermissionArgs}
              placeholder="--dangerously-skip-permissions"
              onChange={(e) => setDraft({ ...draft, fullPermissionArgs: e.target.value })}
            />
          </Field>
          <div className="settings-field">
            <div className="settings-field-info">
              <div className="settings-field-label">Environment Variables</div>
            </div>
            <div className="settings-env-list">
              {draft.env.map((row, i) => (
                <div className="settings-env-row" key={i}>
                  <TextInput
                    className="settings-input-env-key"
                    value={row.key}
                    placeholder="KEY"
                    onChange={(e) => setEnv(i, { key: e.target.value })}
                  />
                  <TextInput
                    className="settings-input-env-value"
                    value={row.value}
                    placeholder="value"
                    onChange={(e) => setEnv(i, { value: e.target.value })}
                  />
                  <button className="settings-icon-btn" onClick={() => removeEnv(i)} aria-label="Remove variable">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button className="settings-btn settings-btn-small" onClick={addEnv}>
                <Plus size={12} /> Add variable
              </button>
            </div>
          </div>
          <div className="profile-form-actions">
            <button className="settings-btn settings-btn-primary" disabled={!valid} onClick={save}>
              Save
            </button>
            <button className="settings-btn" onClick={cancel}>
              Cancel
            </button>
            {editingId && !builtinIds.has(editingId) && (
              <button className="settings-btn settings-btn-danger" onClick={() => remove(editingId)}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {!editing && (
        <div className="profile-form-actions">
          <button className="settings-btn settings-btn-primary" onClick={startCreate}>
            <Plus size={12} /> Add Profile
          </button>
          <button className="settings-btn" onClick={() => void startClaudeAccount()} title="A second Claude login that can resume sessions started on this one">
            <Plus size={12} /> Add Claude account
          </button>
        </div>
      )}
    </section>
  )
}
