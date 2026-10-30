import { useEffect, useState } from 'react'
import { ChevronRight, KeyRound, Plus } from 'lucide-react'
import { BUILTIN_PROFILES, defaultFullPermissionArgs, mergeProfiles } from '../../../../shared/profiles'
import { formatArguments, splitCommandLine } from '../../../../shared/commandLine'
import { validateSshConnection } from '../../../../shared/sshArgs'
import type { ProviderProfile, SshConnection, TerminalProfile } from '../../../../shared/types'
import { client, errorText, useRemote } from '../../store'
import { Confirm, Empty, Group, Row, Sheet, Toggle } from '../../ui'

const newId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('').slice(0, 10)
}

function Input({ label, value, onChange, placeholder, mono, type = 'text', hint }: { label: string; value: string; onChange(v: string): void; placeholder?: string; mono?: boolean; type?: string; hint?: string }): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input className={mono ? 'input mono' : 'input'} type={type} value={value} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }): React.JSX.Element {
  return (
    <div className="field inline">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  )
}

function FormActions({ onSave, onDelete, deleteLabel = 'Delete', saving, canSave = true }: { onSave(): void; onDelete?(): void; deleteLabel?: string; saving?: boolean; canSave?: boolean }): React.JSX.Element {
  return (
    <div className="form-actions">
      {onDelete && <button className="btn danger" onClick={onDelete}>{deleteLabel}</button>}
      <button className="btn primary" disabled={!canSave || saving} onClick={onSave}>{saving ? 'Saving...' : 'Save'}</button>
    </div>
  )
}

// ---------------- Profiles ----------------

interface ProfileDraft {
  name: string
  command: string
  args: string
  cwd: string
  startupCommand: string
  model: string
  color: string
  fullPermissions: boolean
  fullPermissionArgs: string
  env: string
}

function profileDraft(p?: TerminalProfile): ProfileDraft {
  return {
    name: p?.name ?? '',
    command: p?.command ?? '',
    args: formatArguments(p?.args ?? []),
    cwd: p?.cwd ?? '',
    startupCommand: p?.startupCommand ?? '',
    model: p?.model ?? '',
    color: p?.color ?? '',
    fullPermissions: p ? p.fullPermissions !== false : true,
    fullPermissionArgs: p ? p.fullPermissionArgs ?? defaultFullPermissionArgs(p.startupCommand || p.command) : '',
    env: Object.entries(p?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
  }
}

function profileFromDraft(d: ProfileDraft, id: string, icon?: string): TerminalProfile {
  const env: Record<string, string> = {}
  for (const line of d.env.split('\n')) {
    const at = line.indexOf('=')
    const key = (at > 0 ? line.slice(0, at) : '').trim()
    if (key) env[key] = line.slice(at + 1)
  }
  return {
    id,
    name: d.name.trim(),
    command: d.command.trim(),
    args: d.args.trim() ? splitCommandLine(d.args) : undefined,
    cwd: d.cwd.trim() || undefined,
    icon,
    startupCommand: d.startupCommand.trim() || undefined,
    model: d.model.trim() || undefined,
    color: d.color.trim() || undefined,
    fullPermissions: d.fullPermissions,
    fullPermissionArgs: d.fullPermissionArgs.trim() || undefined,
    env: Object.keys(env).length > 0 ? env : undefined
  }
}

export function ProfilesPage(): React.JSX.Element {
  const settings = useRemote((s) => s.settings)
  const update = useRemote((s) => s.updateSettings)
  const toast = useRemote((s) => s.toast)
  const [editing, setEditing] = useState<{ id: string | null; draft: ProfileDraft } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!settings) return <></>
  const builtinIds = new Set(BUILTIN_PROFILES.map((p) => p.id))
  const merged = mergeProfiles(settings.profiles)

  const set = (patch: Partial<ProfileDraft>): void => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e))
  const valid = !!editing && editing.draft.name.trim().length > 0 && (editing.draft.command.trim().length > 0 || editing.draft.startupCommand.trim().length > 0)

  const save = async (): Promise<void> => {
    if (!editing || !valid) return
    const id = editing.id ?? newId()
    const existing = settings.profiles.find((p) => p.id === id)
    let payload: TerminalProfile
    // An unclosed quote in the arguments field throws; without this the save
    // button would do nothing at all (the desktop editor shows the same text).
    try { payload = profileFromDraft(editing.draft, id, existing?.icon) } catch (error) { return toast(errorText(error), 'error') }
    const profiles = existing ? settings.profiles.map((p) => (p.id === id ? payload : p)) : [...settings.profiles, payload]
    if (await update({ profiles })) setEditing(null)
  }

  const remove = async (): Promise<void> => {
    if (!editing?.id) return
    setConfirmDelete(false)
    if (await update({ profiles: settings.profiles.filter((p) => p.id !== editing.id) })) setEditing(null)
  }

  const isBuiltin = editing?.id ? builtinIds.has(editing.id) : false
  const isOverridden = editing?.id ? settings.profiles.some((p) => p.id === editing.id) : false

  return (
    <>
      <Group>
        {merged.map((p) => (
          <Row key={p.id} label={<><span className="swatch" style={{ background: p.color ?? 'var(--muted)' }} />{p.name}</>} hint={p.startupCommand || p.command || 'Default shell'} onClick={() => setEditing({ id: p.id, draft: profileDraft(p) })}>
            {builtinIds.has(p.id) && <span className="badge">Built-in</span>}
            <ChevronRight size={16} />
          </Row>
        ))}
      </Group>
      <button className="btn wide" onClick={() => setEditing({ id: null, draft: profileDraft() })}><Plus size={16} /> Add profile</button>

      {editing && (
        <Sheet title={editing.id ? 'Edit profile' : 'New profile'} onClose={() => setEditing(null)}>
          <Input label="Name" value={editing.draft.name} onChange={(name) => set({ name })} />
          <Input label="Command" mono value={editing.draft.command} onChange={(command) => set({ command })} placeholder="Empty: platform default shell" />
          <Input label="Arguments" mono value={editing.draft.args} onChange={(args) => set({ args })} />
          <Input label="Startup command" mono value={editing.draft.startupCommand} onChange={(startupCommand) => set({ startupCommand })} placeholder="claude" hint="Typed once the shell is ready (CLI agents)" />
          <Input label="Starting folder" mono value={editing.draft.cwd} onChange={(cwd) => set({ cwd })} />
          <Input label="Model" mono value={editing.draft.model} onChange={(model) => set({ model })} placeholder="CLI default" />
          <Input label="Color" mono value={editing.draft.color} onChange={(color) => set({ color })} placeholder="#d97757" />
          <Check label="Full permissions" checked={editing.draft.fullPermissions} onChange={(fullPermissions) => set({ fullPermissions })} />
          {editing.draft.fullPermissions && <Input label="Full permission arguments" mono value={editing.draft.fullPermissionArgs} onChange={(fullPermissionArgs) => set({ fullPermissionArgs })} />}
          <label className="field">
            <span>Environment variables</span>
            <textarea className="input mono" rows={3} value={editing.draft.env} placeholder="KEY=value" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set({ env: e.target.value })} />
            <small>One KEY=value per line</small>
          </label>
          <FormActions
            canSave={valid}
            onSave={() => void save()}
            onDelete={editing.id && (!isBuiltin || isOverridden) ? () => setConfirmDelete(true) : undefined}
            deleteLabel={isBuiltin ? 'Reset' : 'Delete'}
          />
        </Sheet>
      )}
      {confirmDelete && editing && (
        <Confirm
          title={isBuiltin ? 'Reset this profile?' : 'Delete this profile?'}
          text={isBuiltin ? `"${editing.draft.name}" goes back to its built-in defaults.` : `"${editing.draft.name}" is removed from your computer.`}
          confirmLabel={isBuiltin ? 'Reset' : 'Delete'}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  )
}

// ---------------- Providers ----------------

type SecretState = 'missing' | 'ready' | 'unavailable' | 'recovery-required'

export function ProvidersPage(): React.JSX.Element {
  const settings = useRemote((s) => s.settings)
  const update = useRemote((s) => s.updateSettings)
  const toast = useRemote((s) => s.toast)
  const [draft, setDraft] = useState<ProviderProfile | null>(null)
  const [models, setModels] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState<SecretState | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const providers = settings?.providerProfiles ?? []

  useEffect(() => {
    if (!draft) return
    setSecret(null)
    void client().ipc<SecretState>('provider-secret:health', draft.id).then(setSecret).catch(() => setSecret(null))
  }, [draft?.id])

  const open = (provider?: ProviderProfile): void => {
    const next = provider ? { ...provider } : { id: newId(), name: '', command: '', model: '', models: [], color: '#6467f2', fullPermissions: false }
    setDraft(next)
    setModels((next.models ?? []).join(', '))
    setApiKey('')
  }
  const set = (patch: Partial<ProviderProfile>): void => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async (): Promise<void> => {
    if (!draft?.name.trim() || !draft.command.trim()) return
    setSaving(true)
    const payload: ProviderProfile = {
      ...draft,
      name: draft.name.trim(),
      command: draft.command.trim(),
      model: draft.model?.trim() || undefined,
      models: models.split(',').map((m) => m.trim()).filter(Boolean),
      baseUrl: draft.baseUrl?.trim() || undefined,
      apiKeyEnv: draft.apiKeyEnv?.trim() || undefined,
      modelEnv: draft.modelEnv?.trim() || undefined,
      baseUrlEnv: draft.baseUrlEnv?.trim() || undefined,
      color: draft.color?.trim() || undefined,
      fullPermissions: draft.fullPermissions !== false,
      fullPermissionArgs: draft.fullPermissionArgs?.trim() || undefined
    }
    try {
      // The key goes straight into the desktop's encrypted store; it is never read back.
      if (apiKey.trim()) await client().ipc('provider-secret:set', payload.id, apiKey)
    } catch (error) {
      toast(errorText(error), 'error')
      setSaving(false)
      return
    }
    const exists = providers.some((p) => p.id === payload.id)
    const ok = await update({ providerProfiles: exists ? providers.map((p) => (p.id === payload.id ? payload : p)) : [...providers, payload] })
    setSaving(false)
    if (ok) {
      setApiKey('')
      setDraft(null)
    }
  }

  const removeKey = async (): Promise<void> => {
    if (!draft) return
    try {
      await client().ipc('provider-secret:delete', draft.id)
      setSecret('missing')
      toast('API key removed.')
    } catch (error) {
      toast(errorText(error), 'error')
    }
  }

  const remove = async (): Promise<void> => {
    if (!draft) return
    setConfirmDelete(false)
    try {
      await client().ipc('provider-secret:delete', draft.id)
    } catch {
      /* the provider is removed either way */
    }
    if (await update({ providerProfiles: providers.filter((p) => p.id !== draft.id) })) setDraft(null)
  }

  const exists = draft ? providers.some((p) => p.id === draft.id) : false

  return (
    <>
      {providers.length === 0
        ? <Empty title="No providers yet" text="Add a CLI agent that runs against another API (for example DeepSeek through Claude Code)." />
        : (
          <Group>
            {providers.map((p) => (
              <Row key={p.id} label={<><span className="swatch" style={{ background: p.color ?? 'var(--muted)' }} />{p.name}</>} hint={[p.command, p.model].filter(Boolean).join(' · ')} onClick={() => open(p)}>
                <ChevronRight size={16} />
              </Row>
            ))}
          </Group>
        )}
      <button className="btn wide" onClick={() => open()}><Plus size={16} /> Add provider</button>

      {draft && (
        <Sheet title={exists ? 'Edit provider' : 'New provider'} onClose={() => setDraft(null)}>
          <Input label="Name" value={draft.name} onChange={(name) => set({ name })} />
          <Input label="CLI command" mono value={draft.command} onChange={(command) => set({ command })} placeholder="claude" />
          <Input label="Active model" mono value={draft.model ?? ''} onChange={(model) => set({ model })} />
          <Input label="Models" mono value={models} onChange={setModels} hint="Comma separated, shown as choices" />
          <Input label="Base URL" mono value={draft.baseUrl ?? ''} onChange={(baseUrl) => set({ baseUrl })} placeholder="https://api.example.com" />
          <Input label="API key variable" mono value={draft.apiKeyEnv ?? ''} onChange={(apiKeyEnv) => set({ apiKeyEnv })} placeholder="ANTHROPIC_AUTH_TOKEN" />
          <Input label="Model variable" mono value={draft.modelEnv ?? ''} onChange={(modelEnv) => set({ modelEnv })} />
          <Input label="Base URL variable" mono value={draft.baseUrlEnv ?? ''} onChange={(baseUrlEnv) => set({ baseUrlEnv })} />
          <div className="secret-box">
            <div className="secret-head">
              <KeyRound size={16} />
              <span>
                API key
                <small>{secret === 'ready' ? 'Stored encrypted on the computer. Paste a new key to replace it.' : secret === 'recovery-required' || secret === 'unavailable' ? 'The saved key cannot be decrypted. Enter it again.' : 'Not stored yet.'}</small>
              </span>
              {secret === 'ready' && <button className="btn small danger" onClick={() => void removeKey()}>Remove</button>}
            </div>
            <input className="input mono" type="password" autoComplete="off" value={apiKey} placeholder={secret === 'ready' ? 'Stored securely' : 'Paste the key'} onChange={(e) => setApiKey(e.target.value)} />
            <small>Sent once to your computer, never shown again.</small>
          </div>
          <Input label="Color" mono value={draft.color ?? ''} onChange={(color) => set({ color })} />
          <Check label="Full permissions" checked={draft.fullPermissions !== false} onChange={(fullPermissions) => set({ fullPermissions })} />
          {draft.fullPermissions !== false && <Input label="Full permission arguments" mono value={draft.fullPermissionArgs ?? ''} onChange={(fullPermissionArgs) => set({ fullPermissionArgs })} />}
          <FormActions canSave={!!draft.name.trim() && !!draft.command.trim()} saving={saving} onSave={() => void save()} onDelete={exists ? () => setConfirmDelete(true) : undefined} />
        </Sheet>
      )}
      {confirmDelete && draft && (
        <Confirm title="Delete this provider?" text={`"${draft.name}" and its stored API key are removed from your computer.`} confirmLabel="Delete" danger onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} />
      )}
    </>
  )
}

// ---------------- SSH ----------------

export function SshPage(): React.JSX.Element {
  const settings = useRemote((s) => s.settings)
  const update = useRemote((s) => s.updateSettings)
  const [draft, setDraft] = useState<SshConnection | null>(null)
  const [port, setPort] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const connections = settings?.sshConnections ?? []

  const open = (conn?: SshConnection): void => {
    setDraft(conn ? { ...conn } : { id: newId(), name: '', host: '' })
    setPort(conn?.port ? String(conn.port) : '')
    setError(null)
  }
  const set = (patch: Partial<SshConnection>): void => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Name is required.')
      return
    }
    const n = Number.parseInt(port.trim(), 10)
    const payload: SshConnection = {
      id: draft.id,
      name: draft.name.trim(),
      host: draft.host.trim(),
      user: draft.user?.trim() || undefined,
      port: Number.isFinite(n) ? n : undefined,
      identityFile: draft.identityFile?.trim() || undefined,
      jumpHost: draft.jumpHost?.trim() || undefined,
      remoteCwd: draft.remoteCwd?.trim() || undefined,
      remoteCommand: draft.remoteCommand?.trim() || undefined,
      forwardAgent: draft.forwardAgent || undefined,
      persistentSession: draft.persistentSession || undefined,
      multiplexer: draft.persistentSession ? draft.multiplexer ?? 'tmux' : undefined,
      sessionName: draft.persistentSession ? draft.sessionName?.trim() || undefined : undefined,
      extraArgs: draft.extraArgs?.trim() || undefined,
      color: draft.color?.trim() || undefined
    }
    const problem = validateSshConnection(payload)
    if (problem) {
      setError(problem)
      return
    }
    const exists = connections.some((c) => c.id === payload.id)
    if (await update({ sshConnections: exists ? connections.map((c) => (c.id === payload.id ? payload : c)) : [...connections, payload] })) setDraft(null)
  }

  const remove = async (): Promise<void> => {
    if (!draft) return
    setConfirmDelete(false)
    if (await update({ sshConnections: connections.filter((c) => c.id !== draft.id) })) setDraft(null)
  }

  const exists = draft ? connections.some((c) => c.id === draft.id) : false

  return (
    <>
      {connections.length === 0
        ? <Empty title="No SSH connections" text="Saved connections use the computer's OpenSSH, keys and ~/.ssh/config. No password is ever stored." />
        : (
          <Group>
            {connections.map((c) => (
              <Row key={c.id} label={<><span className="swatch" style={{ background: c.color ?? 'var(--muted)' }} />{c.name}</>} hint={`${c.user ? `${c.user}@` : ''}${c.host}${c.port ? `:${c.port}` : ''}`} onClick={() => open(c)}>
                <ChevronRight size={16} />
              </Row>
            ))}
          </Group>
        )}
      <button className="btn wide" onClick={() => open()}><Plus size={16} /> Add connection</button>

      {draft && (
        <Sheet title={exists ? 'Edit connection' : 'New connection'} onClose={() => setDraft(null)}>
          <Input label="Name" value={draft.name} onChange={(name) => set({ name })} />
          <Input label="Host" mono value={draft.host} onChange={(host) => set({ host })} placeholder="server.example.com" />
          <Input label="User" mono value={draft.user ?? ''} onChange={(user) => set({ user })} />
          <Input label="Port" mono value={port} onChange={setPort} placeholder="22" />
          <Input label="Identity file" mono value={draft.identityFile ?? ''} onChange={(identityFile) => set({ identityFile })} placeholder="ssh-agent / ~/.ssh/config" />
          <Input label="Jump host" mono value={draft.jumpHost ?? ''} onChange={(jumpHost) => set({ jumpHost })} placeholder="user@bastion" />
          <Input label="Remote folder" mono value={draft.remoteCwd ?? ''} onChange={(remoteCwd) => set({ remoteCwd })} />
          <Input label="Remote command" mono value={draft.remoteCommand ?? ''} onChange={(remoteCommand) => set({ remoteCommand })} />
          <Check label="Forward agent" checked={draft.forwardAgent === true} onChange={(forwardAgent) => set({ forwardAgent })} />
          <Check label="Persistent session" hint="tmux/screen keeps remote work running" checked={draft.persistentSession === true} onChange={(persistentSession) => set({ persistentSession })} />
          {draft.persistentSession && (
            <>
              <label className="field inline">
                <span>Multiplexer</span>
                <select className="select" value={draft.multiplexer ?? 'tmux'} onChange={(e) => set({ multiplexer: e.target.value as 'tmux' | 'screen' })}>
                  <option value="tmux">tmux</option>
                  <option value="screen">screen</option>
                </select>
              </label>
              <Input label="Session name" mono value={draft.sessionName ?? ''} onChange={(sessionName) => set({ sessionName })} placeholder="termflow" />
            </>
          )}
          <Input label="Extra arguments" mono value={draft.extraArgs ?? ''} onChange={(extraArgs) => set({ extraArgs })} />
          <Input label="Color" mono value={draft.color ?? ''} onChange={(color) => set({ color })} />
          {error && <p className="form-error">{error}</p>}
          <FormActions onSave={() => void save()} onDelete={exists ? () => setConfirmDelete(true) : undefined} />
        </Sheet>
      )}
      {confirmDelete && draft && (
        <Confirm title="Delete this connection?" text={`"${draft.name}" is removed from your computer.`} confirmLabel="Delete" danger onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} />
      )}
    </>
  )
}
