import { useEffect, useMemo, useState } from 'react'
import { agentCliForProfile } from '../../../shared/profiles'
import type { AgentPermissionMode, AppSettings } from '../../../shared/types'
import { client, errorText, useRemote } from '../store'
import { launchOptions, type LaunchOption } from '../profiles'
import { Select, Sheet, Toggle } from '../ui'

const PERMISSIONS: { value: AgentPermissionMode; label: string }[] = [
  { value: 'safe', label: 'Safe' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'full', label: 'Full access' }
]

/** Folders worth offering: open tabs, the last used and the startup folder. */
function folderSuggestions(settings: { lastCwd?: string; customStartupDirectory: string }, tabCwds: (string | undefined)[]): string[] {
  const all = [...tabCwds, settings.lastCwd, settings.customStartupDirectory].filter((v): v is string => !!v && v.trim().length > 0)
  return [...new Set(all)].slice(0, 6)
}

export function NewTabSheet({ onClose, initialCwd, launchCommand }: { onClose(): void; initialCwd?: string; launchCommand?: string }): React.JSX.Element {
  const settings = useRemote((s) => s.settings)
  const shells = useRemote((s) => s.shells)
  const tabs = useRemote((s) => s.tabs)
  const setCurrentTab = useRemote((s) => s.setCurrentTab)
  const toast = useRemote((s) => s.toast)
  const [cwd, setCwd] = useState(initialCwd ?? '')
  const [permission, setPermission] = useState<AgentPermissionMode>(settings?.defaultAgentPermissionMode ?? 'workspace')
  const [busy, setBusy] = useState<string | null>(null)
  // Administrator tab: only offered once the PC set it up (Settings > Remote on the desktop).
  const [adminReady, setAdminReady] = useState(false)
  const [admin, setAdmin] = useState(false)
  const [pin, setPin] = useState('')
  useEffect(() => { void client().call<string>('elevation.status').then((s) => setAdminReady(s === 'on')).catch(() => undefined) }, [])

  const options = useMemo(() => (settings ? launchOptions(settings, shells) : []), [settings, shells])
  const groups = useMemo(() => {
    const map = new Map<LaunchOption['group'], LaunchOption[]>()
    for (const option of options) map.set(option.group, [...(map.get(option.group) ?? []), option])
    return [...map.entries()]
  }, [options])
  const folders = settings ? folderSuggestions(settings, tabs.map((t) => t.cwd)) : []

  const open = async (option: LaunchOption): Promise<void> => {
    if (admin && !/^\d{6,12}$/.test(pin)) { toast('Enter the 6 to 12 digit administrator PIN.', 'error'); return }
    setBusy(option.id)
    try {
      const isAgent = settings ? !!agentCliForProfile(settings as AppSettings, option.id) : false
      const tabId = await client().call<string>('tab.open', {
        profileId: option.id,
        cwd: cwd.trim() || undefined,
        launchCommand,
        permissionMode: isAgent ? permission : undefined,
        ...(admin ? { elevated: true, pin } : {}),
        ...useRemote.getState().termSize
      })
      setCurrentTab(tabId)
      onClose()
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet title={launchCommand ? 'Run in a new tab' : 'New tab'} onClose={onClose}>
      {launchCommand && <p className="sheet-note mono">{launchCommand}</p>}
      <label className="field">
        <span>Folder</span>
        <input
          className="input mono"
          placeholder="Startup folder from settings"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
        />
      </label>
      {folders.length > 0 && (
        <div className="chips">
          {folders.map((folder) => (
            <button key={folder} className={folder === cwd ? 'chip on' : 'chip'} onClick={() => setCwd(folder === cwd ? '' : folder)}>
              {folder.split(/[\\/]/).filter(Boolean).pop() ?? folder}
            </button>
          ))}
        </div>
      )}
      <label className="field inline">
        <span>Agent permissions</span>
        <Select<AgentPermissionMode> label="Agent permissions" value={permission} options={PERMISSIONS} onChange={setPermission} />
      </label>
      {adminReady && (
        <label className="field inline">
          <span>Run as administrator</span>
          <Toggle label="Run as administrator" checked={admin} onChange={setAdmin} />
        </label>
      )}
      {admin && (
        <label className="field">
          <span>Administrator PIN (set on the PC)</span>
          <input className="input mono" type="password" inputMode="numeric" autoComplete="off" maxLength={12}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      {groups.map(([group, items]) => (
        <section key={group} className="launch-group">
          <h3 className="group-title">{group}</h3>
          <div className="launch-grid">
            {items.map((option) => (
              <button key={option.id} className="launch-item" disabled={busy !== null} onClick={() => void open(option)}>
                <span className="launch-dot" style={{ background: option.color ?? 'var(--accent)' }} />
                <span className="launch-text">
                  <strong>{busy === option.id ? 'Opening...' : option.name}</strong>
                  {option.detail && <span className="mono">{option.detail}</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
