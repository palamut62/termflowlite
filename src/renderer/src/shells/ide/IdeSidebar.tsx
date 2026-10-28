import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Bell, CalendarClock, CircleHelp, Crosshair, Ellipsis, FolderPlus, Images, Kanban, ListTodo, PanelLeft, Plus, Search, Settings, SlidersHorizontal, Smartphone, SquareTerminal } from 'lucide-react'
import type { WorktreeProp } from '../../../../shared/types'
import { resolveDefaultProfileId, useSettingsStore } from '../../store/settingsStore'
import { useJumpPaletteStore } from '../../store/jumpPaletteStore'
import { useAgentEventStore } from '../../store/agentEventStore'
import { useTaskPaletteStore } from '../../store/taskPaletteStore'
import { useTerminalStore } from '../../store/terminalStore'
import { NewProjectModal } from '../../tabs/NewProjectModal'
import { WorktreeLauncherModal } from '../../tabs/WorktreeLauncherModal'
import { toggleUiMode } from '../uiMode'
import { ProjectTree, addProject, saveIde } from './ProjectTree'
import { ResizeHandle } from './ResizeHandle'
import { IdeMenu, MenuItem, anchorOf, type MenuAnchor } from './IdeMenu'
import { canGo, go, onHistoryChange } from './tabHistory'
import { useIdePageStore, type IdePage } from './pages/idePageStore'
import { PRODUCT } from '../../../../shared/edition'

const LINKS = {
  site: 'https://www.termflowlite.lol',
  releases: PRODUCT.releases,
  github: 'https://github.com/palamut62',
  x: 'https://x.com/palamut62'
}

const PROPS: [WorktreeProp, string][] = [['note', 'Notes'], ['link', 'Linked work'], ['sessions', 'Agent activity']]

type OpenMenu ={ kind: 'app' | 'options' | 'help'; anchor: MenuAnchor } | null

function newTab(): void {
  const { settings, shells } = useSettingsStore.getState()
  useTerminalStore.getState().addTab(resolveDefaultProfileId(settings, shells))
}

/**
 * Agent IDE sol kenar cubugu (PRD 4.2, 4.9), Orca yerlesimi: ust satir (logo, uygulama menusu, gizle, geri/ileri),
 * gezinme, Projects basligi (etkinlik, Workspace options, proje ekle, yeni worktree), agac, alt cubuk.
 */
export function IdeSidebar(): React.JSX.Element {
  const ide = useSettingsStore((s) => s.settings.ide)
  const unseen = useTerminalStore((s) => s.tabs.filter((t) => t.attention).length)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const page = useIdePageStore((s) => s.page)
  const navClass = (p: IdePage): string => `ide-nav-item${page === p ? ' ide-nav-on' : ''}`
  const [menu, setMenu] = useState<OpenMenu>(null)
  const [, setHistoryTick] = useState(0)
  useEffect(() => onHistoryChange(() => setHistoryTick((n) => n + 1)), [])
  // Arama paletindeki "New Worktree..." aksiyonu.
  useEffect(() => {
    const open = (): void => setWorktreeOpen(true)
    window.addEventListener('termflow:ide-new-worktree', open)
    return () => window.removeEventListener('termflow:ide-new-worktree', open)
  }, [])

  const openMenu = (kind: NonNullable<OpenMenu>['kind']) => (e: React.MouseEvent<HTMLElement>): void => {
    const anchor = anchorOf(e.currentTarget)
    setMenu((current) => (current?.kind === kind ? null : { kind, anchor }))
  }
  const close = (): void => setMenu(null)
  const pick = (fn: () => void) => (): void => { close(); fn() }
  const external = (url: string) => pick(() => void window.termflow.system.openExternal(url))

  return (
    <aside className="ide-sidebar" style={{ width: ide.sidebarWidth }} aria-label="Projects and agents">
      <div className="ide-sidebar-top">
        <span className="ide-logo" aria-hidden="true"><SquareTerminal size={16} /></span>
        <button className="ide-icon-btn" onClick={openMenu('app')} title="Menu" aria-label="Application menu" aria-haspopup="menu"><Ellipsis size={15} /></button>
        <button className="ide-icon-btn" onClick={() => saveIde({ sidebarOpen: false })} title="Hide sidebar" aria-label="Hide sidebar"><PanelLeft size={15} /></button>
        <span className="ide-sidebar-top-spacer" />
        <button className="ide-icon-btn" disabled={!canGo(-1)} onClick={() => go(-1)} title="Back" aria-label="Back"><ArrowLeft size={14} /></button>
        <button className="ide-icon-btn" disabled={!canGo(1)} onClick={() => go(1)} title="Forward" aria-label="Forward"><ArrowRight size={14} /></button>
      </div>
      <nav className="ide-nav" aria-label="Agent IDE">
        <button className="ide-nav-item ide-nav-search" onClick={() => useJumpPaletteStore.getState().toggle()} title="Search tabs, worktrees and sessions">
          <Search size={14} /><span>Search</span><kbd className="ide-nav-kbd">Ctrl Shift J</kbd>
        </button>
        <button className={navClass('tasks')} aria-current={page === 'tasks' ? 'page' : undefined} onClick={() => useIdePageStore.getState().open('tasks')} title="GitHub issues and pull requests"><ListTodo size={14} /><span>Tasks</span></button>
        <button className={navClass('artifacts')} aria-current={page === 'artifacts' ? 'page' : undefined} onClick={() => useIdePageStore.getState().open('artifacts')} title="Images and videos from agents"><Images size={14} /><span>Artifacts</span></button>
        <button className={navClass('automations')} aria-current={page === 'automations' ? 'page' : undefined} onClick={() => useIdePageStore.getState().open('automations')} title="Saved and scheduled commands"><CalendarClock size={14} /><span>Automations</span></button>
        <button className={navClass('mobile')} aria-current={page === 'mobile' ? 'page' : undefined} onClick={() => useIdePageStore.getState().open('mobile')} title="Control this computer from your phone"><Smartphone size={14} /><span>Mobile</span></button>
      </nav>
      <div className="ide-section-head">
        <span>Projects</span>
        <button className="ide-icon-btn ide-bell" onClick={() => useAgentEventStore.getState().show()} title="Agent activity" aria-label={unseen ? `Agent activity, ${unseen} not seen` : 'Agent activity'}>
          <Bell size={13} />{unseen > 0 && <span className="ide-bell-dot" aria-hidden="true" />}
        </button>
        <button className={`ide-icon-btn${menu?.kind === 'options' ? ' ide-icon-on' : ''}`} onClick={openMenu('options')} title="Workspace options" aria-label="Workspace options" aria-haspopup="menu"><SlidersHorizontal size={13} /></button>
        <button className="ide-icon-btn" onClick={() => void addProject()} title="Add project folder" aria-label="Add project folder"><FolderPlus size={13} /></button>
        <button className="ide-icon-btn" onClick={() => setNewProjectOpen(true)} title="New project with an agent" aria-label="New project"><Plus size={14} /></button>
      </div>
      <ProjectTree onNewWorktree={() => setWorktreeOpen(true)} />
      <div className="ide-sidebar-foot">
        <button className="ide-icon-btn" onClick={() => useSettingsStore.getState().openSettings()} title="Settings (Ctrl+,)" aria-label="Settings"><Settings size={14} /></button>
        <button className="ide-icon-btn" onClick={openMenu('help')} title="Help" aria-label="Help" aria-haspopup="menu"><CircleHelp size={14} /></button>
        <span className="ide-sidebar-top-spacer" />
        <button className="ide-icon-btn" onClick={() => window.dispatchEvent(new Event('termflow:ide-reveal'))} title="Reveal active workspace" aria-label="Reveal active workspace"><Crosshair size={14} /></button>
        <button className="ide-icon-btn" onClick={() => window.dispatchEvent(new Event('termflow:ide-board'))} title="Workspace board" aria-label="Workspace board"><Kanban size={14} /></button>
      </div>
      <ResizeHandle edge="right" width={ide.sidebarWidth} min={200} max={400} label="Resize projects sidebar" onChange={(sidebarWidth) => saveIde({ sidebarWidth })} />

      {menu?.kind === 'app' && (
        <IdeMenu anchor={menu.anchor} label="Application menu" onClose={close} width={240}>
          <MenuItem onSelect={pick(newTab)} hint="Ctrl+Shift+T">New Terminal</MenuItem>
          <MenuItem onSelect={pick(() => setNewProjectOpen(true))}>New Project...</MenuItem>
          <MenuItem onSelect={pick(() => setWorktreeOpen(true))}>New Worktree...</MenuItem>
          <MenuItem onSelect={pick(() => void addProject())}>Add Project Folder...</MenuItem>
          <div className="ctx-menu-divider" />
          <MenuItem onSelect={pick(() => useJumpPaletteStore.getState().toggle())} hint="Ctrl+Shift+J">Search</MenuItem>
          <MenuItem onSelect={pick(() => useTaskPaletteStore.getState().toggle())} hint="Ctrl+Shift+P">Command Palette</MenuItem>
          <MenuItem onSelect={pick(toggleUiMode)} hint="Ctrl+Shift+I">Switch to Terminal Layout</MenuItem>
          <div className="ctx-menu-divider" />
          <MenuItem onSelect={pick(() => useSettingsStore.getState().openSettings())} hint="Ctrl+,">Settings</MenuItem>
          <MenuItem onSelect={pick(() => useSettingsStore.getState().openSettings('about'))}>About and Updates</MenuItem>
        </IdeMenu>
      )}
      {menu?.kind === 'options' && (
        <IdeMenu anchor={menu.anchor} label="Workspace options" onClose={close} width={250}>
          <div className="ctx-menu-section" role="presentation">Group by</div>
          <MenuItem checked={ide.groupBy === 'project'} onSelect={() => saveIde({ groupBy: 'project' })}>Project</MenuItem>
          <MenuItem checked={ide.groupBy === 'status'} onSelect={() => saveIde({ groupBy: 'status' })}>Status</MenuItem>
          <MenuItem checked={ide.groupBy === 'pr'} onSelect={() => saveIde({ groupBy: 'pr' })}>Pull Request</MenuItem>
          <MenuItem checked={ide.groupBy === 'none'} onSelect={() => saveIde({ groupBy: 'none' })}>None</MenuItem>
          <div className="ctx-menu-section" role="presentation">Sort by</div>
          <MenuItem checked={ide.sort === 'activity'} onSelect={() => saveIde({ sort: 'activity' })}>Agent Activity</MenuItem>
          <MenuItem checked={ide.sort === 'recent'} onSelect={() => saveIde({ sort: 'recent' })}>Recent</MenuItem>
          <MenuItem checked={ide.sort === 'name'} onSelect={() => saveIde({ sort: 'name' })}>Name</MenuItem>
          <div className="ctx-menu-section" role="presentation">Card layout</div>
          <MenuItem checked={ide.cardLayout === 'detailed'} onSelect={() => saveIde({ cardLayout: 'detailed' })}>Detailed</MenuItem>
          <MenuItem checked={ide.cardLayout === 'compact'} onSelect={() => saveIde({ cardLayout: 'compact' })}>Compact</MenuItem>
          <div className="ctx-menu-section" role="presentation">Show properties</div>
          {PROPS.map(([prop, label]) => (
            <MenuItem key={prop} checked={!ide.hiddenProps.includes(prop)} onSelect={() => saveIde({ hiddenProps: ide.hiddenProps.includes(prop) ? ide.hiddenProps.filter((p) => p !== prop) : [...ide.hiddenProps, prop] })}>{label}</MenuItem>
          ))}
          <div className="ctx-menu-section" role="presentation">Filters</div>
          <MenuItem checked={ide.hideSleeping} onSelect={() => saveIde({ hideSleeping: !ide.hideSleeping })}>Hide sleeping</MenuItem>
          <MenuItem checked={ide.hideDefaultBranch} onSelect={() => saveIde({ hideDefaultBranch: !ide.hideDefaultBranch })}>Hide default branch</MenuItem>
          <MenuItem checked={ide.hideDetached} onSelect={() => saveIde({ hideDetached: !ide.hideDetached })}>Hide detached HEAD</MenuItem>
          <MenuItem checked={ide.showClaudeWorktrees} onSelect={() => saveIde({ showClaudeWorktrees: !ide.showClaudeWorktrees })}>Show Claude Code worktrees</MenuItem>
          <MenuItem checked={ide.showOtherWorktrees} onSelect={() => saveIde({ showOtherWorktrees: !ide.showOtherWorktrees })}>Show other worktrees</MenuItem>
        </IdeMenu>
      )}
      {menu?.kind === 'help' && (
        <IdeMenu anchor={menu.anchor} up label="Help" onClose={close} width={220}>
          <MenuItem onSelect={pick(() => useSettingsStore.getState().openSettings('keyboard'))}>Keyboard Shortcuts</MenuItem>
          <MenuItem onSelect={external(LINKS.site)}>Website</MenuItem>
          <MenuItem onSelect={external(LINKS.releases)}>Changelog and Releases</MenuItem>
          <div className="ctx-menu-divider" />
          <MenuItem onSelect={external(LINKS.github)}>GitHub</MenuItem>
          <MenuItem onSelect={external(LINKS.x)}>X</MenuItem>
          <div className="ctx-menu-divider" />
          <MenuItem onSelect={pick(() => useSettingsStore.getState().openSettings('about'))}>Check for Updates</MenuItem>
        </IdeMenu>
      )}
      {newProjectOpen && <NewProjectModal onClose={() => setNewProjectOpen(false)} onCreated={(path) => { const ide = useSettingsStore.getState().settings.ide; if (!ide.projects.includes(path)) saveIde({ projects: [...ide.projects, path] }) }} />}
      {worktreeOpen && <WorktreeLauncherModal onClose={() => setWorktreeOpen(false)} />}
    </aside>
  )
}
