import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, FolderOpen, FolderPlus, X } from 'lucide-react'
import { availableProfiles, providerProfileId } from '../../../shared/profiles'
import { useSettingsStore } from '../store/settingsStore'
import { useTerminalStore } from '../store/terminalStore'
import type { AgentPermissionMode } from '../../../shared/types'

const LAST_KEY = 'termflow.newProject'

/** Creates `<parent>\<name>` and opens a tab in it with the chosen shell or agent. */
export function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (path: string) => void }): React.JSX.Element {
  const shells = useSettingsStore((s) => s.shells)
  const settings = useSettingsStore((s) => s.settings)
  const options = useMemo(() => [
    ...availableProfiles(settings.profiles, settings.installedAgents).map((profile) => ({ id: profile.id, name: profile.name, group: 'Profiles' })),
    ...settings.providerProfiles.map((provider) => ({ id: providerProfileId(provider.id), name: provider.name, group: 'Providers' })),
    ...shells.map((shell) => ({ id: shell.id, name: shell.name, group: 'Shells' }))
  ], [settings.profiles, settings.installedAgents, settings.providerProfiles, shells])
  const last = useMemo(() => { try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as { parent?: string; profileId?: string } } catch { return {} as { parent?: string; profileId?: string } } }, [])
  const [profileId, setProfileId] = useState(options.some((o) => o.id === last.profileId) ? last.profileId! : options[0]?.id ?? settings.defaultProfileId)
  const [parent, setParent] = useState(last.parent ?? '')
  const [name, setName] = useState('')
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>(settings.defaultAgentPermissionMode)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = async (): Promise<void> => {
    setBusy(true); setError('')
    const result = await window.termflow.files.createProject(parent.trim(), name)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    localStorage.setItem(LAST_KEY, JSON.stringify({ parent: parent.trim(), profileId }))
    useTerminalStore.getState().addTab(profileId, true, result.path, undefined, permissionMode)
    onCreated?.(result.path)
    onClose()
  }

  return createPortal(
    <div className="settings-backdrop path-launch-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="path-launch-panel" role="dialog" aria-modal="true" aria-label="New project">
        <header className="settings-header">
          <span className="settings-header-title"><FolderPlus size={16} /> New project</span>
          <button className="settings-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="path-launch-content">
          <label className="path-launch-label" htmlFor="new-project-parent"><FolderOpen size={14} /> Parent folder</label>
          <div className="path-launch-row">
            <input id="new-project-parent" className="settings-input" value={parent} onChange={(event) => setParent(event.target.value)} placeholder="C:\\projects" />
            <button className="settings-btn" onClick={async () => { const path = await window.termflow.dialog.openDir(); if (path) setParent(path) }}><FolderOpen size={13} /> Browse</button>
          </div>
          <label className="path-launch-label" htmlFor="new-project-name"><FolderPlus size={14} /> Project name</label>
          <input id="new-project-name" className="settings-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="my-app" autoFocus
            onKeyDown={(event) => { if (event.key === 'Enter' && parent.trim() && name.trim() && !busy) void create() }} />
          {parent.trim() && name.trim() && <div className="path-launch-label">{parent.trim().replace(/[\\/]+$/, '')}\{name.trim()}</div>}
          <label className="path-launch-label" htmlFor="new-project-profile"><Bot size={14} /> Agent or shell</label>
          <select id="new-project-profile" className="settings-input settings-select path-launch-select" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            {['Profiles', 'Providers', 'Shells'].map((group) => (
              <optgroup label={group} key={group}>
                {options.filter((option) => option.group === group).map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}
              </optgroup>
            ))}
          </select>
          <label className="path-launch-label" htmlFor="new-project-permission">Agent permission mode</label>
          <select id="new-project-permission" className="settings-input settings-select path-launch-select" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as AgentPermissionMode)}>
            <option value="safe">Safe - read only</option><option value="workspace">Workspace - project writes</option><option value="full">Full Access</option>
          </select>
          {error && <div className="path-launch-label" role="alert" style={{ color: 'var(--danger, #e5534b)' }}>{error}</div>}
        </div>
        <div className="path-launch-actions">
          <button className="settings-btn" onClick={onClose}>Cancel</button>
          <button className="settings-btn settings-btn-primary" disabled={!parent.trim() || !name.trim() || !profileId || busy} onClick={() => void create()}>Create and open</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
