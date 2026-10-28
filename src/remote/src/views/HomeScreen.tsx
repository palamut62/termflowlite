import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronRight, CircleDot, GitPullRequest, History, ListTodo, Monitor, Plus, SquareTerminal } from 'lucide-react'
import { agentForProfile } from '../../../shared/profiles'
import type { GitHubTask } from '../../../shared/ipc'
import type { AgentKind, AgentSession, AppSettings } from '../../../shared/types'
import type { AgentUsage } from '../../../shared/usage'
import { client, useRemote } from '../store'
import { NewTabSheet } from './NewTabSheet'

const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }
const ACTIVITY: Record<string, string> = { running: 'Working', waiting: 'Waiting for you', unread: 'New output', completed: 'Done', error: 'Failed' }
const DAY = 24 * 60 * 60 * 1000
const PLATFORM: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }

/** Folder name for a tab's place, tolerating both separators. */
function folderName(path?: string): string {
  return (path ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

/**
 * Phone home screen, after Orca Mobile: what is happening on the computer at a glance, where to pick up,
 * GitHub tasks, quick actions and agent limits. Every card leads into the existing screens.
 */
export function HomeScreen(): React.JSX.Element {
  const settings = useRemote((s) => s.settings) as AppSettings | null
  const tabs = useRemote((s) => s.tabs)
  const connection = useRemote((s) => s.connection)
  const computer = useRemote((s) => s.computer)
  const platform = useRemote((s) => s.platform)
  const home = useRemote((s) => s.home)
  const desktopActiveTabId = useRemote((s) => s.desktopActiveTabId)
  const setScreen = useRemote((s) => s.setScreen)
  const setCurrentTab = useRemote((s) => s.setCurrentTab)
  const [sessions, setSessions] = useState<AgentSession[] | null>(null)
  const [usage, setUsage] = useState<AgentUsage[]>([])
  const [tasks, setTasks] = useState<GitHubTask[] | null>(null)
  const [newTab, setNewTab] = useState(false)

  // Each source fills in on its own; a slow session scan must not hold back the rest.
  useEffect(() => {
    const c = client()
    void c.ipc<AgentSession[]>('agent-sessions:list', { limit: 200 }).then(setSessions).catch(() => setSessions([]))
    void c.ipc<AgentUsage[]>('usage:get').then(setUsage).catch(() => undefined)
    const active = tabs.find((t) => t.id === desktopActiveTabId) ?? tabs[0]
    const cwd = active?.worktree?.repoRoot || active?.cwd || ''
    void c.ipc<GitHubTask[]>('github:tasks', 'prs', 'mine', '', '', cwd || undefined).then(setTasks).catch(() => setTasks(null))
    // Once per visit: the lists are snapshots, the live state comes from the tabs.
  }, [])

  const agentTabs = useMemo(() => (settings ? tabs.filter((t) => agentForProfile(settings, t.profileId)) : []), [tabs, settings])
  const working = agentTabs.filter((t) => t.activity === 'running' || t.activity === 'waiting').length
  const recentSessions = sessions?.filter((s) => s.updatedAt > Date.now() - 30 * DAY).length
  // Resume: the desktop's own tab first, then agents that need you, then the rest.
  const rank = (activity: string): number => (activity === 'waiting' ? 0 : activity === 'running' ? 1 : 2)
  const resume = [...agentTabs].sort((a, b) => Number(b.id === desktopActiveTabId) - Number(a.id === desktopActiveTabId) || rank(a.activity) - rank(b.activity)).slice(0, 3)
  const user = folderName(home)

  const openTab = (id: string): void => { setCurrentTab(id); setScreen('terminal') }

  return (
    <div className="page home">
      <h1 className="home-title">{user ? `Welcome back, ${user}` : 'Welcome back'}</h1>

      <div className="home-stats">
        <div className="home-stat"><strong>{working}</strong><span>Agents working</span></div>
        <div className="home-stat"><strong>{tabs.length}</strong><span>Open tabs</span></div>
        <div className="home-stat"><strong>{recentSessions ?? '-'}</strong><span>Sessions, 30 days</span></div>
      </div>

      <h3 className="home-label">Desktop</h3>
      <button className="home-card" onClick={() => setScreen('workspaces')}>
        <span className="home-icon"><Monitor size={18} /></span>
        <span className="home-text">
          <strong>{computer || `${PLATFORM[platform] ?? 'Your'} computer`}</strong>
          <span><i className={`home-dot ${connection}`} />{connection === 'online' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Offline'} · {tabs.length} tab{tabs.length === 1 ? '' : 's'} · {working} active</span>
        </span>
        <ChevronRight size={18} className="home-chevron" />
      </button>

      <h3 className="home-label">Resume</h3>
      {resume.length === 0
        ? (
          <button className="home-card" onClick={() => setScreen('agents')}>
            <span className="home-icon"><History size={18} /></span>
            <span className="home-text"><strong>Agent sessions</strong><span>No agent is open. Continue a saved conversation.</span></span>
            <ChevronRight size={18} className="home-chevron" />
          </button>
        )
        : resume.map((tab) => (
          <button key={tab.id} className="home-card" onClick={() => openTab(tab.id)}>
            <span className="home-icon"><SquareTerminal size={18} /></span>
            <span className="home-text">
              <strong>{tab.worktree?.branch || folderName(tab.cwd) || tab.title}</strong>
              <span><i className={`dot ${tab.activity}`} />{tab.title} · {ACTIVITY[tab.activity] ?? tab.activity}</span>
            </span>
            <ChevronRight size={18} className="home-chevron" />
          </button>
        ))}

      <h3 className="home-label">Tasks</h3>
      <button className="home-card" onClick={() => setScreen('project')}>
        <span className="home-icon"><ListTodo size={18} /></span>
        <span className="home-text">
          <strong>Tasks</strong>
          <span>{tasks === null ? 'GitHub' : `GitHub · ${tasks.length} open pull request${tasks.length === 1 ? '' : 's'} of yours`}</span>
        </span>
        <GitPullRequest size={16} className="home-chevron" />
        <ChevronRight size={18} className="home-chevron" />
      </button>

      <h3 className="home-label">Quick actions</h3>
      <div className="home-actions">
        <button className="home-action" onClick={() => setNewTab(true)}><span className="home-icon"><Plus size={18} /></span>New tab</button>
        <button className="home-action" onClick={() => setScreen('agents')}><span className="home-icon"><Bot size={18} /></span>Agents</button>
      </div>

      {usage.length > 0 && (
        <>
          <h3 className="home-label">Account usage</h3>
          {usage.map((item) => (
            <div key={item.agent} className="home-card home-usage">
              <span className="home-icon"><CircleDot size={18} /></span>
              <span className="home-text">
                <strong>{AGENT_NAME[item.agent] ?? item.agent}</strong>
                <span className="home-bars">
                  {item.windows.map((w) => (
                    <span key={w.label} className="home-bar" title={`${Math.round(w.usedPercent)}% used`}>
                      <em>{w.label}</em>
                      <span className="home-track"><span className={`home-fill${w.usedPercent >= 95 ? ' bad' : w.usedPercent >= 80 ? ' warn' : ''}`} style={{ width: `${Math.min(100, Math.max(0, w.usedPercent))}%` }} /></span>
                      <b>{Math.round(100 - Math.min(100, Math.max(0, w.usedPercent)))}% left</b>
                    </span>
                  ))}
                </span>
              </span>
            </div>
          ))}
        </>
      )}

      {newTab && <NewTabSheet onClose={() => setNewTab(false)} />}
    </div>
  )
}
