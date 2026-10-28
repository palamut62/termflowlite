import { useMemo } from 'react'
import { ChevronLeft, GitBranch, Plus } from 'lucide-react'
import type { RemoteTab } from '../../../shared/remote'
import { useRemote } from '../store'
import { Empty } from '../ui'

const ACTIVITY: Record<string, string> = { running: 'Working', waiting: 'Waiting for you', unread: 'New output', completed: 'Done', error: 'Failed' }
const folderName = (path?: string): string => (path ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
const norm = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

interface Workspace { key: string; name: string; branch?: string; child: boolean; tabs: RemoteTab[] }
interface Project { key: string; name: string; workspaces: Workspace[] }

/** Tabs of one workspace (worktree or folder) share this key. */
export const workspaceKey = (tab: RemoteTab): string => norm(tab.worktree?.path || tab.cwd || '')

/** Tabs -> project (repository or folder) -> workspace (worktree or folder), in the order the tabs appear. */
export function groupWorkspaces(tabs: readonly RemoteTab[]): Project[] {
  const projects = new Map<string, Project>()
  for (const tab of tabs) {
    const root = tab.worktree?.repoRoot || tab.cwd || ''
    const projectKey = norm(root)
    let project = projects.get(projectKey)
    if (!project) { project = { key: projectKey, name: folderName(root) || 'No folder', workspaces: [] }; projects.set(projectKey, project) }
    const place = tab.worktree?.path || tab.cwd || ''
    const key = workspaceKey(tab)
    let workspace = project.workspaces.find((w) => w.key === key)
    if (!workspace) {
      workspace = { key, name: tab.worktree?.branch || folderName(place) || tab.title, branch: tab.worktree?.branch, child: Boolean(tab.worktree), tabs: [] }
      project.workspaces.push(workspace)
    }
    workspace.tabs.push(tab)
  }
  // The checkout of the repository itself comes first, its worktrees after it.
  for (const project of projects.values()) project.workspaces.sort((a, b) => Number(a.child) - Number(b.child))
  return [...projects.values()]
}

/** Phone workspaces list (Orca Mobile): projects with their worktrees and the agent state of each. */
export function WorkspacesScreen(): React.JSX.Element {
  const tabs = useRemote((s) => s.tabs)
  const computer = useRemote((s) => s.computer)
  const connection = useRemote((s) => s.connection)
  const setScreen = useRemote((s) => s.setScreen)
  const setCurrentTab = useRemote((s) => s.setCurrentTab)
  const projects = useMemo(() => groupWorkspaces(tabs), [tabs])
  const platform = useRemote((s) => s.platform)

  return (
    <div className="page ws">
      <header className="ws-head">
        <button className="ws-back" onClick={() => setScreen('home')} aria-label="Back"><ChevronLeft size={22} /></button>
        <span className={`home-dot ${connection}`} />
        <span className="ws-title"><strong>{computer || 'Computer'}</strong><span>{platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'}</span></span>
      </header>
      {projects.length === 0 && <Empty title="No workspaces" text="Open a terminal on the computer or press + to start one." />}
      {projects.map((project) => (
        <section key={project.key} className="ws-project">
          <h3 className="ws-project-name">{project.name}<span>{project.workspaces.length}</span></h3>
          {project.workspaces.map((workspace) => (
            <div key={workspace.key} className={`ws-card${workspace.child ? ' child' : ''}`}>
              <button className="ws-card-main" onClick={() => setCurrentTab(workspace.tabs[0]!.id)}>
                <span className="ws-card-name">{workspace.name}<em>{workspace.tabs.length}</em></span>
                <span className="ws-card-sub">{workspace.child && <span className="badge"><GitBranch size={11} /> Child</span>}{folderName(workspace.key)}</span>
              </button>
              {workspace.tabs.map((tab) => (
                <button key={tab.id} className="ws-session" onClick={() => setCurrentTab(tab.id)}>
                  <i className={`dot ${tab.activity}`} />{tab.title}<span>{ACTIVITY[tab.activity] ?? tab.activity}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
      ))}
      <button className="ws-fab" onClick={() => setScreen('terminal')} aria-label="Open terminal"><Plus size={24} /></button>
    </div>
  )
}
