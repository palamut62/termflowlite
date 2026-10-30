import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Bookmark, Bot, ChevronRight, History, Play, RefreshCw } from 'lucide-react'
import { BUILTIN_PROFILES, agentCliForProfile, agentForProfile, availableProfiles, providerProfileId } from '../../../shared/profiles'
import type { RemoteSavedCommand } from '../../../shared/remote'
import type { AgentEvent, AgentKind, AgentPermissionMode, AgentSession, AppSettings } from '../../../shared/types'
import { client, errorText, useRemote } from '../store'
import { profileName } from '../profiles'
import { Empty, Group, Row, Select, Sheet, timeAgo } from '../ui'

// Olaylar katalogdaki her ajandan gelebilir; etiket yerlesik profillerden.
const AGENT_NAME: Record<string, string> = Object.fromEntries(BUILTIN_PROFILES.map((p) => [p.id, p.name]))
const ACTIVITY: Record<string, string> = { running: 'Working', waiting: 'Waiting for you', unread: 'New output', completed: 'Done', error: 'Failed' }
const EVENT_ATTENTION = new Set<AgentEvent['kind']>(['approval', 'question', 'error'])

/** Profiles and providers that start the given agent, for resuming its sessions. */
function profilesFor(settings: AppSettings, agent: AgentKind): { id: string; name: string }[] {
  const profiles = availableProfiles(settings.profiles, settings.installedAgents).filter((p) => agentForProfile(settings, p.id) === agent).map((p) => ({ id: p.id, name: p.name }))
  const providers = settings.providerProfiles
    .filter((p) => agentForProfile(settings, providerProfileId(p.id)) === agent)
    .map((p) => ({ id: providerProfileId(p.id), name: p.name }))
  return [...profiles, ...providers]
}

export function AgentsScreen(): React.JSX.Element {
  const settings = useRemote((s) => s.settings)
  const shells = useRemote((s) => s.shells)
  const tabs = useRemote((s) => s.tabs)
  const setCurrentTab = useRemote((s) => s.setCurrentTab)
  const toast = useRemote((s) => s.toast)
  const [sessions, setSessions] = useState<AgentSession[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [saved, setSaved] = useState<RemoteSavedCommand[] | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [filter, setFilter] = useState<AgentKind | 'all'>('all')
  const [resume, setResume] = useState<AgentSession | null>(null)
  const [loading, setLoading] = useState(false)

  // Each source fills in on its own: scanning agent sessions on disk can take
  // seconds and must not hold back the quick lists.
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const c = client()
    void c.call<RemoteSavedCommand[]>('saved.list').then(setSaved).catch(() => setSaved([]))
    void c.ipc<AgentEvent[]>('agent-events:list', 40).then((list) => setEvents(list.slice(-40).reverse())).catch(() => undefined)
    void c.ipc<string[]>('agent-sessions:warnings').then(setWarnings).catch(() => undefined)
    try {
      setSessions(await c.ipc<AgentSession[]>('agent-sessions:list', { limit: 60 }))
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  const agentTabs = useMemo(() => (settings ? tabs.filter((t) => agentCliForProfile(settings as AppSettings, t.profileId)) : []), [tabs, settings])
  const visibleSessions = (sessions ?? []).filter((s) => filter === 'all' || s.agent === filter)

  const runSaved = async (item: RemoteSavedCommand): Promise<void> => {
    try {
      const tabId = await client().call<string>('saved.run', { id: item.id, ...useRemote.getState().termSize })
      toast(`Started "${item.name}"`)
      setCurrentTab(tabId)
    } catch (error) {
      toast(errorText(error), 'error')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Agents</h1>
        <button className="icon-btn" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={18} className={loading ? 'spin' : undefined} /></button>
      </div>

      <Group title="Running now">
        {agentTabs.length === 0 && <Row label="No agent tab is open" hint="Open one from the Terminal screen with +" />}
        {agentTabs.map((tab) => (
          <Row key={tab.id} label={<><span className={`dot ${tab.activity}`} />{tab.title}</>} hint={`${ACTIVITY[tab.activity] ?? tab.activity}${tab.cwd ? ` · ${tab.cwd}` : ''}`} onClick={() => setCurrentTab(tab.id)}>
            <ChevronRight size={16} />
          </Row>
        ))}
      </Group>

      {events.some((e) => EVENT_ATTENTION.has(e.kind)) && (
        <Group title="Needs attention">
          {events.filter((e) => EVENT_ATTENTION.has(e.kind)).slice(0, 8).map((e) => (
            <Row key={e.id} label={<><Bell size={14} className="bad" /> {e.title}</>} hint={`${AGENT_NAME[e.agent] ?? e.agent} · ${timeAgo(e.createdAt)}${e.detail ? ` · ${e.detail}` : ''}`} onClick={tabs.some((t) => t.id === e.tabId) ? () => setCurrentTab(e.tabId) : undefined} />
          ))}
        </Group>
      )}

      <Group title="Saved commands">
        {saved === null && <Row label="Loading..." />}
        {saved?.length === 0 && <Row label="No saved commands" hint="Save commands on the computer to start them from here" />}
        {saved?.map((item) => (
          <Row key={item.id} label={<><Bookmark size={14} /> {item.name}</>} hint={`${item.command}${item.profileId && settings ? ` · ${profileName(settings, shells, item.profileId)}` : ''}`} onClick={() => void runSaved(item)}>
            <Play size={16} />
          </Row>
        ))}
      </Group>

      <div className="section-head">
        <h3 className="group-title"><History size={14} /> Recent sessions</h3>
        <div className="chips">
          {(['all', 'claude', 'codex', 'opencode'] as const).map((a) => (
            <button key={a} className={filter === a ? 'chip on' : 'chip'} onClick={() => setFilter(a)}>{a === 'all' ? 'All' : AGENT_NAME[a]}</button>
          ))}
        </div>
      </div>
      {warnings.map((w, i) => <p key={i} className="page-note warn">{w}</p>)}
      {!sessions && <Group><Row label="Scanning sessions on the computer..." /></Group>}
      {sessions && visibleSessions.length === 0 && <Empty icon={<Bot size={24} />} title="No sessions found" />}
      {visibleSessions.length > 0 && (
        <Group>
          {visibleSessions.map((s) => (
            <Row key={`${s.agent}:${s.id}`} label={s.title || s.id} hint={`${AGENT_NAME[s.agent]} · ${timeAgo(s.updatedAt)}${s.cwd ? ` · ${s.cwd}` : ''}`} onClick={() => setResume(s)}>
              <ChevronRight size={16} />
            </Row>
          ))}
        </Group>
      )}

      {resume && settings && <ResumeSheet session={resume} settings={settings as AppSettings} onClose={() => setResume(null)} />}
    </div>
  )
}

function ResumeSheet({ session, settings, onClose }: { session: AgentSession; settings: AppSettings; onClose(): void }): React.JSX.Element {
  const setCurrentTab = useRemote((s) => s.setCurrentTab)
  const toast = useRemote((s) => s.toast)
  const options = profilesFor(settings, session.agent)
  const [profileId, setProfileId] = useState(session.profileId && options.some((o) => o.id === session.profileId) ? session.profileId : options[0]?.id ?? '')
  const [permission, setPermission] = useState<AgentPermissionMode>(settings.defaultAgentPermissionMode)
  const [busy, setBusy] = useState(false)

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const tabId = await client().call<string>('agent.resume', { profileId, session: { agent: session.agent, id: session.id }, cwd: session.cwd, permissionMode: permission, ...useRemote.getState().termSize })
      setCurrentTab(tabId)
      onClose()
    } catch (error) {
      toast(errorText(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Resume session" onClose={onClose}>
      <p className="sheet-note"><strong>{session.title || session.id}</strong></p>
      <p className="sheet-note mono">{session.cwd ?? 'No folder recorded'}</p>
      {options.length === 0
        ? <p className="form-error">No profile on the computer starts {AGENT_NAME[session.agent]}.</p>
        : (
          <>
            <label className="field inline">
              <span>Profile</span>
              <Select label="Profile" value={profileId} options={options.map((o) => ({ value: o.id, label: o.name }))} onChange={setProfileId} />
            </label>
            <label className="field inline">
              <span>Permissions</span>
              <Select<AgentPermissionMode> label="Permissions" value={permission} options={[{ value: 'safe', label: 'Safe' }, { value: 'workspace', label: 'Workspace' }, { value: 'full', label: 'Full access' }]} onChange={setPermission} />
            </label>
            <div className="form-actions">
              <button className="btn primary" disabled={busy || !profileId} onClick={() => void start()}>{busy ? 'Starting...' : 'Resume in a new tab'}</button>
            </div>
          </>
        )}
    </Sheet>
  )
}
