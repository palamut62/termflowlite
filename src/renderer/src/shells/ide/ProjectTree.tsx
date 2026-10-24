import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDot, Ellipsis, GitBranch, Link2, LoaderCircle, Moon, Pin, Plus } from 'lucide-react'
import type { WorktreeEntry } from '../../../../shared/ipc'
import { worktreeKey, type IdeSettings } from '../../../../shared/types'
import { agentForProfile, availableProfiles } from '../../../../shared/profiles'
import { resolveDefaultProfileId, useSettingsStore } from '../../store/settingsStore'
import { useTerminalStore } from '../../store/terminalStore'
import { useToastStore } from '../../store/toastStore'
import { TabIcon } from '../../tabs/TabIcon'
import { useRepoRoots } from '../../useRepoRoots'
import { STATUSES, STATUS_LABELS, buildIdeTree, formatAge, groupWorktrees, mostUrgent, nestChildren, type IdeProject, type IdeSession, type IdeTreeView, type IdeWorktree, type ProjectPr, type SessionState } from './ideTreeModel'
import { HiddenWorktreesDialog } from './HiddenWorktreesDialog'
import { WorktreeDetailsDialog, saveWorktreeMeta } from './WorktreeDetailsDialog'
import { WorkspaceBoard } from './WorkspaceBoard'
import { useIdePageStore } from './pages/idePageStore'
import { lastUsedTab, scopeMapEquals, useWorkspaceScopeStore } from './workspaceScope'
import { lastSeen } from '../../store/jumpPaletteStore'

const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' } as const
const STATE_LABELS: Record<SessionState, string> = { working: 'Working', 'needs-input': 'Needs input', done: 'Done', error: 'Error', idle: 'Idle' }
const DOT: Record<SessionState, string> = { working: 'ide-dot-working', 'needs-input': 'ide-dot-needs-input', error: 'ide-dot-error', done: 'ide-dot-done', idle: 'ide-dot-idle' }

function StateIcon({ state }: { state: SessionState }): React.JSX.Element {
  if (state === 'working') return <LoaderCircle size={12} className="ide-state ide-state-working" aria-hidden="true" />
  if (state === 'needs-input') return <CircleDot size={12} className="ide-state ide-state-needs-input" aria-hidden="true" />
  if (state === 'error') return <CircleAlert size={12} className="ide-state ide-state-error" aria-hidden="true" />
  if (state === 'done') return <CircleCheck size={12} className="ide-state ide-state-done" aria-hidden="true" />
  return <span className="ide-state ide-state-idle" aria-hidden="true" />
}

/** Ayarlardaki agac gorunumu (Workspace options). */
export function treeViewOf(ide: IdeSettings): IdeTreeView {
  return {
    showClaude: ide.showClaudeWorktrees,
    showOther: ide.showOtherWorktrees,
    shown: ide.shownWorktrees,
    hideDefaultBranch: ide.hideDefaultBranch,
    hideDetached: ide.hideDetached,
    hideSleeping: ide.hideSleeping,
    sort: ide.sort
  }
}

export function saveIde(patch: Partial<IdeSettings>): void {
  void useSettingsStore.getState().update({ ide: { ...useSettingsStore.getState().settings.ide, ...patch } })
}

function openTerminalAt(path: string): void {
  const { settings, shells } = useSettingsStore.getState()
  useTerminalStore.getState().addTab(resolveDefaultProfileId(settings, shells), true, path)
}

/** Proje/worktree menusu: kurulu ajan ve ozel profiller (Claude Code, Codex...) o klasorde acilir. */
function ProfileItems({ path, act }: { path: string; act: (fn: () => void) => (e: React.MouseEvent) => void }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  return (
    <>
      {availableProfiles(settings.profiles, settings.installedAgents).map((p) => (
        <button key={p.id} className="ctx-menu-item ide-menu-item" role="menuitem" title={p.command || p.startupCommand} onClick={act(() => useTerminalStore.getState().addTab(p.id, true, path))}>
          <TabIcon shellId={p.id} />
          <span className="ide-menu-text">{p.name}</span>
        </button>
      ))}
    </>
  )
}

/** Proje/worktree acilisi: Claude Code kuruluysa onunla, degilse varsayilan kabukla baslar. */
export function openProjectAt(path: string): void {
  const { settings } = useSettingsStore.getState()
  if (availableProfiles(settings.profiles, settings.installedAgents).some((p) => p.id === 'claude')) {
    useTerminalStore.getState().addTab('claude', true, path)
  } else openTerminalAt(path)
}

function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

function worktreeName(worktree: IdeWorktree): string {
  if (worktree.meta.name) return worktree.meta.name
  return worktree.primary ? worktree.branch ?? folderName(worktree.path) : folderName(worktree.path)
}

/** Projenin rengi: ada gore sabit (Orca'daki proje avatari). */
function avatarColor(label: string): string {
  let hash = 0
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 55% 42%)`
}

type TreeMenu =
  | { kind: 'project'; x: number; y: number; project: IdeProject }
  | { kind: 'worktree'; x: number; y: number; project: IdeProject; worktree: IdeWorktree }

/** Proje > worktree > oturum agaci (PRD F1.2, Orca 4.9). Durumlar store'dan canli turetilir. */
export function ProjectTree({ onNewWorktree }: { onNewWorktree: () => void }): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const settings = useSettingsStore((s) => s.settings)
  const repoRoots = useRepoRoots(tabs)
  const [worktrees, setWorktrees] = useState<Map<string, WorktreeEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const [details, setDetails] = useState<{ project: IdeProject; worktree: IdeWorktree } | null>(null)
  const [boardOpen, setBoardOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  const tree = useMemo(() => buildIdeTree({
    projects: settings.ide.projects,
    worktrees,
    repoRoots,
    tabs,
    activeTabId,
    agentOf: (tab) => agentForProfile(settings, tab.profileId),
    hooked: settings.agentHooks,
    view: treeViewOf(settings.ide),
    meta: settings.ide.worktreeMeta
  }), [settings, worktrees, repoRoots, tabs, activeTabId])

  // Group by PR: proje basina tek `gh pr list` (worktree basina degil); yalniz bu gruplama seciliyken.
  const [prs, setPrs] = useState<Map<string, ProjectPr[]>>(new Map())
  const projectRoots = settings.ide.projects.join('|')
  useEffect(() => {
    if (settings.ide.groupBy !== 'pr') return
    let cancelled = false
    void Promise.all(settings.ide.projects.map(async (root) => [root, await window.termflow.github.pullRequests('', root).catch(() => [])] as const))
      .then((entries) => { if (!cancelled) setPrs(new Map(entries)) })
    return () => { cancelled = true }
  }, [settings.ide.groupBy, projectRoots]) // eslint-disable-line react-hooks/exhaustive-deps

  // Worktree listeleri: proje ya da sekme worktree'leri degisince ve pencere odaklaninca yenilenir.
  const rootsKey = tree.map((p) => p.root).join('|') + '#' + tabs.map((t) => t.worktree?.path ?? '').join('|')
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const next = new Map<string, WorktreeEntry[]>()
      for (const root of rootsKey.split('#')[0].split('|').filter(Boolean)) {
        next.set(root, await window.termflow.worktree.list(root).catch(() => []))
      }
      if (!cancelled) setWorktrees(next)
    }
    void load()
    window.addEventListener('focus', load)
    return () => { cancelled = true; window.removeEventListener('focus', load) }
  }, [rootsKey])

  // "6m" yaslari dakikada bir tazelenir.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // "Reveal active workspace" (alt cubuk): aktif oturumun projesini acip ona kaydir; projede degilse soyle.
  useEffect(() => {
    const reveal = (): void => {
      const owner = tree.find((p) => p.worktrees.some((w) => w.sessions.some((s) => s.active)))
      if (!owner) { useToastStore.getState().show('The active terminal is not in any project.', 'info'); return }
      setExpanded((prev) => (prev.has(owner.root) ? prev : new Set(prev).add(owner.root)))
      requestAnimationFrame(() => {
        const active = document.querySelector<HTMLElement>('.ide-tree .ide-tree-active')
        active?.scrollIntoView({ block: 'center' })
        active?.focus()
      })
    }
    const board = (): void => setBoardOpen(true)
    window.addEventListener('termflow:ide-reveal', reveal)
    window.addEventListener('termflow:ide-board', board)
    return () => {
      window.removeEventListener('termflow:ide-reveal', reveal)
      window.removeEventListener('termflow:ide-board', board)
    }
  }, [tree])

  const toggle = (key: string): void => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  /** Projeye tiklaninca: sekme seridi projenin tum terminallerini gosterir; aktif sekme projede degilse en son bakilan acilir. */
  const openProject = (project: IdeProject): void => {
    toggle(project.root)
    const ids = project.worktrees.flatMap((w) => w.sessions.map((s) => s.tabId))
    if (ids.length === 0 || ids.includes(activeTabId ?? '')) return
    const last = lastUsedTab(ids, lastSeen)
    if (last) useTerminalStore.getState().setActiveTab(last)
  }

  /** Worktree'ye tiklaninca: oturumu varsa ilkine gider, yoksa o klasorde yeni sekme acar. */
  const openWorktree = (worktree: IdeWorktree): void => {
    if (worktree.meta.sleeping) saveWorktreeMeta(worktree.path, { sleeping: undefined })
    // Orca: worktree'nin kendi sekmelerine don (en son bakilan); terminali hic yoksa bir tane ac.
    const last = lastUsedTab(worktree.sessions.map((s) => s.tabId), lastSeen)
    if (last) useTerminalStore.getState().setActiveTab(last)
    else openProjectAt(worktree.path)
  }

  // Sekme -> proje eslemesi: IDE sekme seridi yalniz etkin projenin sekmelerini (tum worktree'ler) gosterir.
  useEffect(() => {
    const byTab = new Map<string, string>()
    for (const project of tree) for (const worktree of project.worktrees) for (const session of worktree.sessions) byTab.set(session.tabId, project.root)
    const store = useWorkspaceScopeStore.getState()
    if (!scopeMapEquals(store.byTab, byTab)) store.set(byTab)
  }, [tree])

  // Yukari/asagi ok: agac satirlari arasinda odak (role=tree).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tree-row]')]
    const index = rows.indexOf(document.activeElement as HTMLElement)
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) { next.focus(); e.preventDefault() }
  }

  if (tree.length === 0) {
    return (
      <div className="ide-tree-empty">
        <p>Add a project folder to see its worktrees and agents here.</p>
        <button className="settings-btn" onClick={() => void addProject()}><Plus size={13} /> Add project folder</button>
      </div>
    )
  }

  const compact = settings.ide.cardLayout === 'compact'
  const hiddenProject = tree.find((p) => p.root === hiddenFor) ?? null
  const worktreeMenu = (project: IdeProject) => (e: React.MouseEvent, worktree: IdeWorktree): void => {
    e.preventDefault()
    setMenu({ kind: 'worktree', x: e.clientX, y: e.clientY, project, worktree })
  }
  const overlays = (
    <>
      {menu && <TreeContextMenu menu={menu} onClose={() => setMenu(null)} onShowHidden={(root) => setHiddenFor(root)} onDetails={(project, worktree) => setDetails({ project, worktree })} onOpen={openWorktree} />}
      {hiddenProject && <HiddenWorktreesDialog project={hiddenProject} onClose={() => setHiddenFor(null)} />}
      {details && <WorktreeDetailsDialog project={details.project} worktree={details.worktree} onClose={() => setDetails(null)} />}
      {boardOpen && <WorkspaceBoard projects={tree} onOpen={openWorktree} onClose={() => setBoardOpen(false)} />}
    </>
  )

  // Group by Status / PR / None (Workspace options): proje basliksiz duz kartlar, kartta proje adi.
  if (settings.ide.groupBy !== 'project') {
    return (
      <div className={`ide-tree${compact ? ' ide-tree-compact' : ''}`} role="tree" aria-label="Projects" onKeyDown={onKeyDown}>
        {groupWorktrees(tree, settings.ide.groupBy, prs).map((group) => (
          <div key={group.label || 'all'} role="group" aria-label={group.label || 'Workspaces'} className="ide-tree-group">
            {group.label && <div className="ide-tree-group-head">{group.label}<span className="ide-count">{group.items.length}</span></div>}
            {group.items.map(({ project, worktree }) => (
              <WorktreeCard key={worktree.path} worktree={worktree} projectLabel={project.label} nested={new Map()} now={now} onOpen={openWorktree} onMenu={worktreeMenu(project)} />
            ))}
          </div>
        ))}
        {overlays}
      </div>
    )
  }

  return (
    <div className={`ide-tree${compact ? ' ide-tree-compact' : ''}`} role="tree" aria-label="Projects" onKeyDown={onKeyDown}>
      {tree.map((project) => {
        const isCollapsed = !expanded.has(project.root)
        const urgent = mostUrgent(project.worktrees.flatMap((w) => w.sessions))
        return (
          <div key={project.root} role="treeitem" aria-expanded={!isCollapsed} aria-label={project.label} className="ide-tree-project-wrap">
            <div className="ide-tree-project-row">
              <button data-tree-row className="ide-tree-project" title={project.root} onClick={() => openProject(project)}>
                <span className="ide-avatar" style={{ background: avatarColor(project.label) }} aria-hidden="true">{project.label.slice(0, 1).toUpperCase()}</span>
                <span className="ide-tree-label">{project.label}</span>
                {isCollapsed && urgent && <StateIcon state={urgent} />}
              </button>
              <span className="ide-row-actions">
                <button className="ide-icon-btn" onClick={() => toggle(project.root)} title={isCollapsed ? 'Expand' : 'Collapse'} aria-label={isCollapsed ? `Expand ${project.label}` : `Collapse ${project.label}`}>
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button className="ide-icon-btn" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: 'project', x: r.left, y: r.bottom + 2, project }) }} onMouseDown={(e) => e.stopPropagation()} title="Project actions" aria-label={`${project.label} actions`}>
                  <Ellipsis size={13} />
                </button>
                <button className="ide-icon-btn" onClick={onNewWorktree} title="New worktree" aria-label={`New worktree in ${project.label}`}><Plus size={13} /></button>
              </span>
            </div>
            {!isCollapsed && (
              <ProjectCards
                project={project}
                now={now}
                showPrimary={!settings.ide.hideDefaultBranch || project.worktrees.some((w) => w.primary)}
                onOpen={openWorktree}
                onMenu={worktreeMenu(project)}
              />
            )}
          </div>
        )
      })}
      {overlays}
    </div>
  )
}

/**
 * Ana checkout karti; diger worktree'ler "N child" ile icinde acilir. Orca gibi yalniz etkin grup (aktif oturumu
 * iceren) cerceveli kart, digerleri duz.
 */
function ProjectCards({ project, now, showPrimary, onOpen, onMenu }: {
  project: IdeProject
  now: number
  showPrimary: boolean
  onOpen: (worktree: IdeWorktree) => void
  onMenu: (e: React.MouseEvent, worktree: IdeWorktree) => void
}): React.JSX.Element {
  const primary = project.worktrees.find((w) => w.primary)
  const children = project.worktrees.filter((w) => !w.primary)
  const nested = nestChildren(children)
  const top = nested.get('') ?? []
  const [childrenOpen, setChildrenOpen] = useState(true)
  const hiddenProps = useSettingsStore((s) => s.settings.ide.hiddenProps)
  const groupActive = project.worktrees.some(isActive)
  const childCards = top.map((worktree) => <WorktreeCard key={worktree.path} worktree={worktree} nested={nested} now={now} onOpen={onOpen} onMenu={onMenu} />)
  if (!primary || !showPrimary) return <div role="group" className="ide-card-stack">{childCards}</div>
  return (
    <div role="group" className={`ide-card${groupActive ? ' ide-card-on' : ''}`}>
      <WorktreeHeader worktree={primary} onOpen={() => onOpen(primary)} onMenu={(e) => onMenu(e, primary)} />
      <WorktreeExtras worktree={primary} />
      {children.length > 0 && (
        <button className="ide-child-chip" onClick={() => setChildrenOpen((v) => !v)} aria-expanded={childrenOpen}>
          <GitBranch size={11} /> {children.length} {children.length === 1 ? 'child' : 'children'} {childrenOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      )}
      {!hiddenProps.includes('sessions') && primary.sessions.map((session) => <SessionRow key={session.tabId} session={session} now={now} onMenu={(e) => onMenu(e, primary)} />)}
      {childrenOpen && childCards}
    </div>
  )
}

const isActive = (w: IdeWorktree): boolean => w.sessions.some((s) => s.active)

/** Alt worktree karti; Change Parent ile altina baglananlar icinde (nestChildren). */
function WorktreeCard({ worktree, nested, now, onOpen, onMenu, projectLabel }: {
  worktree: IdeWorktree
  nested: Map<string, IdeWorktree[]>
  now: number
  onOpen: (worktree: IdeWorktree) => void
  onMenu: (e: React.MouseEvent, worktree: IdeWorktree) => void
  /** Group by Status / None: kartin hangi projeden oldugu. */
  projectLabel?: string
}): React.JSX.Element {
  const hiddenProps = useSettingsStore((s) => s.settings.ide.hiddenProps)
  const kids = nested.get(worktreeKey(worktree.path)) ?? []
  return (
    <div role="group" className={`ide-card ide-card-child${isActive(worktree) ? ' ide-card-on' : ''}${worktree.meta.sleeping ? ' ide-card-sleeping' : ''}`}>
      <WorktreeHeader worktree={worktree} projectLabel={projectLabel} onOpen={() => onOpen(worktree)} onMenu={(e) => onMenu(e, worktree)} />
      <WorktreeExtras worktree={worktree} />
      {!hiddenProps.includes('sessions') && worktree.sessions.map((session) => <SessionRow key={session.tabId} session={session} now={now} onMenu={(e) => onMenu(e, worktree)} />)}
      {kids.map((kid) => <WorktreeCard key={kid.path} worktree={kid} nested={nested} now={now} onOpen={onOpen} onMenu={onMenu} />)}
    </div>
  )
}

function WorktreeHeader({ worktree, projectLabel, onOpen, onMenu }: { worktree: IdeWorktree; projectLabel?: string; onOpen: () => void; onMenu: (e: React.MouseEvent) => void }): React.JSX.Element {
  const name = worktreeName(worktree)
  const state = mostUrgent(worktree.sessions) ?? (worktree.sessions.length ? 'idle' : null)
  const branch = worktree.branch ?? (worktree.detached ? 'detached HEAD' : 'no branch')
  return (
    <button data-tree-row role="treeitem" aria-label={name} className="ide-tree-worktree" title={worktree.path} onClick={onOpen} onContextMenu={onMenu}>
      <span className="ide-tree-worktree-line">
        <span className={`ide-dot ${state ? DOT[state] : 'ide-dot-none'}`} aria-hidden="true" />
        <span className="ide-tree-label ide-tree-name">{name}</span>
        {worktree.meta.pinned && <Pin size={11} className="ide-meta-icon" aria-label="Pinned" />}
        {worktree.meta.sleeping && <Moon size={11} className="ide-meta-icon" aria-label="Sleeping" />}
        {worktree.meta.status && <span className={`ide-status ide-status-${worktree.meta.status}`}>{STATUS_LABELS[worktree.meta.status]}</span>}
        {worktree.primary && <span className="ide-badge">primary</span>}
      </span>
      <span className="ide-tree-branch">{projectLabel ? `${projectLabel} - ${branch}` : branch}</span>
    </button>
  )
}

/** Kartta not ve bagli is (Show properties ile gizlenebilir); baslik dugmesinin disinda, ic ice dugme olmasin. */
function WorktreeExtras({ worktree }: { worktree: IdeWorktree }): React.JSX.Element | null {
  const hiddenProps = useSettingsStore((s) => s.settings.ide.hiddenProps)
  const { note, link } = worktree.meta
  const showNote = note && !hiddenProps.includes('note')
  const showLink = link && !hiddenProps.includes('link')
  if (!showNote && !showLink) return null
  const url = link && /^https?:\/\//i.test(link) ? link : ''
  return (
    <div className="ide-tree-extras">
      {showLink && (url
        ? <button className="ide-link-chip" onClick={() => void window.termflow.system.openExternal(url)} title={url}><Link2 size={11} />{link.replace(/^https?:\/\/(www\.)?/i, '')}</button>
        : <span className="ide-link-chip"><Link2 size={11} />{link}</span>)}
      {showNote && <p className="ide-tree-note" title={note}>{note}</p>}
    </div>
  )
}

function SessionRow({ session, now, onMenu }: { session: IdeSession; now: number; onMenu: (e: React.MouseEvent) => void }): React.JSX.Element {
  const profileId = useTerminalStore((s) => s.tabs.find((t) => t.id === session.tabId)?.profileId ?? '')
  const who = session.agent ? AGENT_NAMES[session.agent] : session.title
  const label = session.agent ? `${STATE_LABELS[session.state]} - ${who}` : who
  return (
    <button
      data-tree-row
      role="treeitem"
      aria-selected={session.active}
      aria-label={`${label}, ${formatAge(session.since, now)}`}
      className={`ide-tree-session ide-session-${session.state}${session.active ? ' ide-tree-active' : ''}`}
      onClick={() => useTerminalStore.getState().setActiveTab(session.tabId)}
      onContextMenu={onMenu}
      title={session.title}
    >
      <StateIcon state={session.state} />
      <TabIcon shellId={profileId} />
      <span className="ide-tree-label">{label}</span>
      <span className="ide-tree-age">{formatAge(session.since, now)}</span>
    </button>
  )
}

function TreeContextMenu({ menu, onClose, onShowHidden, onDetails, onOpen }: {
  menu: TreeMenu
  onClose: () => void
  onShowHidden: (root: string) => void
  onDetails: (project: IdeProject, worktree: IdeWorktree) => void
  onOpen: (worktree: IdeWorktree) => void
}): React.JSX.Element {
  const act = (fn: () => void) => (e: React.MouseEvent): void => { e.stopPropagation(); fn(); onClose() }
  const copy = (text: string, what: string): void => {
    void navigator.clipboard.writeText(text).then(() => useToastStore.getState().show(`${what} copied`, 'success')).catch(() => undefined)
  }
  // Menu yuksekligi olculur; ekran disina tasarsa tetikleyicinin ustune/yukari kaydirilir, hep gorunur kalir.
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))
    })
  }, [menu])
  const style = pos
  if (menu.kind === 'project') {
    const { project } = menu
    return (
      <div ref={ref} className="ctx-menu ide-menu" role="menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
        <button className="ctx-menu-item" role="menuitem" onClick={act(() => openTerminalAt(project.root))}>New Terminal Here</button>
        <ProfileItems path={project.root} act={act} />
        <button className="ctx-menu-item" role="menuitem" onClick={act(() => void window.termflow.system.openInEditor(project.root, 1))}>Open in VS Code</button>
        <button className="ctx-menu-item" role="menuitem" onClick={act(() => void window.termflow.system.openPath(project.root))}>Open in File Explorer</button>
        <button className="ctx-menu-item" role="menuitem" onClick={act(() => onShowHidden(project.root))}>
          Show hidden worktrees{project.hidden.length ? ` (${project.hidden.length})` : ''}
        </button>
        <div className="ctx-menu-divider" />
        <button className="ctx-menu-item ide-menu-danger" role="menuitem" onClick={act(() => {
          const ide = useSettingsStore.getState().settings.ide
          saveIde({ projects: ide.projects.filter((p) => p !== project.root) })
        })}>Remove Project</button>
      </div>
    )
  }
  const { project, worktree } = menu
  const sessionIds = worktree.sessions.map((s) => s.tabId)
  const parent = worktree.meta.parent ? project.worktrees.find((w) => worktreeKey(w.path) === worktreeKey(worktree.meta.parent ?? '')) : undefined
  // Sleep (Orca): terminalleri kapatir, kart "uyuyor" olur; tiklayinca uyanir. Kapatma onayi sekme basina.
  const sleep = (): void => {
    for (const id of sessionIds) useTerminalStore.getState().requestCloseTab(id)
    saveWorktreeMeta(worktree.path, { sleeping: true })
  }
  return (
    <div ref={ref} className="ctx-menu ide-menu" role="menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ctx-menu-section" role="presentation">Workspace</div>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => onDetails(project, worktree))}>Update...</button>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => saveWorktreeMeta(worktree.path, { pinned: !worktree.meta.pinned || undefined }))}>{worktree.meta.pinned ? 'Unpin' : 'Pin'}</button>
      {!worktree.primary && (worktree.meta.sleeping
        ? <button className="ctx-menu-item" role="menuitem" onClick={act(() => onOpen(worktree))}>Wake</button>
        : <button className="ctx-menu-item" role="menuitem" onClick={act(sleep)}>Sleep</button>)}
      {parent && <button className="ctx-menu-item" role="menuitem" onClick={act(() => onOpen(parent))}>Open Parent</button>}
      {!worktree.primary && <button className="ctx-menu-item" role="menuitem" onClick={act(() => onDetails(project, worktree))}>Change Parent...</button>}
      <div className="ctx-menu-section" role="presentation">Move to status</div>
      {STATUSES.map((status) => (
        <button key={status} className="ctx-menu-item ide-menu-item" role="menuitemradio" aria-checked={worktree.meta.status === status} onClick={act(() => saveWorktreeMeta(worktree.path, { status: worktree.meta.status === status ? undefined : status }))}>
          <span className="ide-menu-check" aria-hidden="true">{worktree.meta.status === status ? '✓' : ''}</span>
          <span className="ide-menu-text">{STATUS_LABELS[status]}</span>
        </button>
      ))}
      <div className="ctx-menu-divider" />
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => openTerminalAt(worktree.path))}>New Terminal Here</button>
      <ProfileItems path={worktree.path} act={act} />
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => useIdePageStore.getState().open('review', { cwd: worktree.path }))}>Review Changes</button>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => useIdePageStore.getState().open('notes', { cwd: worktree.path }))}>Open Notes</button>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => void window.termflow.system.openInEditor(worktree.path, 1))}>Open in VS Code</button>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => void window.termflow.system.openPath(worktree.path))}>Open in File Explorer</button>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => copy(worktree.path, 'Path'))}>Copy Path</button>
      <button className="ctx-menu-item" role="menuitem" onClick={act(() => copy(worktreeName(worktree), 'Worktree name'))}>Copy Worktree Name</button>
      {sessionIds.length > 0 && (
        <button className="ctx-menu-item" role="menuitem" onClick={act(() => { for (const id of sessionIds) useTerminalStore.getState().markAttention(id, 'done') })}>Mark Unread</button>
      )}
      {useSettingsStore.getState().settings.ide.shownWorktrees.includes(worktree.path) && (
        <button className="ctx-menu-item" role="menuitem" onClick={act(() => {
          const ide = useSettingsStore.getState().settings.ide
          saveIde({ shownWorktrees: ide.shownWorktrees.filter((p) => p !== worktree.path) })
        })}>Hide from Sidebar</button>
      )}
      {!worktree.primary && (
        <>
          <div className="ctx-menu-divider" />
          <button className="ctx-menu-item ide-menu-danger" role="menuitem" onClick={act(() => useTerminalStore.setState({ pendingWorktreeCleanup: { path: worktree.path, branch: worktree.branch ?? '', repoRoot: project.root, createdByApp: true } }))}>
            Delete Worktree...
          </button>
        </>
      )}
    </div>
  )
}

/** Klasor sec, depo kokune cevir, listeye ekle. */
export async function addProject(): Promise<void> {
  const picked = await window.termflow.dialog.openDir()
  if (!picked) return
  const root = (await window.termflow.worktree.repoInfo(picked).catch(() => null))?.root ?? picked
  const ide = useSettingsStore.getState().settings.ide
  if (ide.projects.includes(root)) { useToastStore.getState().show('This project is already in the list.', 'info'); return }
  saveIde({ projects: [...ide.projects, root] })
}
