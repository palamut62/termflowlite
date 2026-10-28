import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Columns2, PanelTopClose, PictureInPicture2, Play, Plus, Rows2, PanelLeft, PanelRight, Smartphone } from 'lucide-react'
import { useWidgetStore } from '../widget/widgetStore'
import { resolveDefaultProfileId, useSettingsStore } from '../store/settingsStore'
import { useTerminalStore } from '../store/terminalStore'
import { NewTabMenu } from './NewTabMenu'
import { PathLauncherModal } from './PathLauncherModal'
import { NewProjectModal } from './NewProjectModal'
import { WorktreeLauncherModal } from './WorktreeLauncherModal'
import { GitHubPanel } from '../components/GitHubPanel'
import { TerminalTab } from './TerminalTab'
import { openTaskTab, taskName, useAgentTasks } from './agentTasks'
import { formatAge } from '../shells/ide/ideTreeModel'
import { useTaskPaletteStore } from '../store/taskPaletteStore'
import { useSavedCommandStore } from '../store/savedCommandStore'
import { useToastStore } from '../store/toastStore'
import { IdeMenu, MenuItem, anchorOf, type MenuAnchor } from '../shells/ide/IdeMenu'
import { canGo, go, onHistoryChange } from '../shells/ide/tabHistory'
import { scopedTabs, useWorkspaceScopeStore } from '../shells/ide/workspaceScope'
import type { TerminalProfile, TerminalTab as TerminalTabModel } from '../../../shared/types'
import { claudeAccounts } from '../../../shared/claudeAccounts'
import { continueWithAccount } from '../claudeFailover'
import { AttentionBell } from '../attention/AttentionBell'
import { effectiveMotion } from '../motion'
import { phonesLabel, useConnectedPhones } from '../remoteStatus'

/** Top-right sign that a phone is controlling this window; opens Remote Access settings. */
function RemoteIndicator(): React.JSX.Element | null {
  const phones = useConnectedPhones()
  if (phones.length === 0) return null
  const title = `${phonesLabel(phones)}. Open Remote Access settings`
  return (
    <button className="split-tab-btn remote-indicator" onClick={() => useSettingsStore.getState().openSettings('remote')} title={title} aria-label={title}>
      <Smartphone size={14} />
      <span className="remote-indicator-dot" aria-hidden="true" />
      {phones.length > 1 && <span className="remote-indicator-count">{phones.length}</span>}
    </button>
  )
}

function setIde(patch: { sidebarOpen?: boolean; rightOpen?: boolean }): void {
  const current = useSettingsStore.getState().settings.ide
  void useSettingsStore.getState().update({ ide: { ...current, ...patch } })
}

/** Kenar cubugu gizliyken Orca'daki gibi ust sol kume sekme seridine gecer: ac, geri, ileri. */
function IdeTabBarLead(): React.JSX.Element {
  const [, setTick] = useState(0)
  useEffect(() => onHistoryChange(() => setTick((n) => n + 1)), [])
  return (
    <div className="ide-tab-lead">
      <button className="split-tab-btn" onClick={() => setIde({ sidebarOpen: true })} title="Show sidebar" aria-label="Show sidebar"><PanelLeft size={14} /></button>
      <button className="split-tab-btn" disabled={!canGo(-1)} onClick={() => go(-1)} title="Back" aria-label="Back"><ArrowLeft size={13} /></button>
      <button className="split-tab-btn" disabled={!canGo(1)} onClick={() => go(1)} title="Forward" aria-label="Forward"><ArrowRight size={13} /></button>
    </div>
  )
}

/** Agent IDE sekme seridinin sag ucu (Orca): Quick Commands ve sag panel dugmesi. */
function IdeTabBarActions({ rightOpen }: { rightOpen: boolean }): React.JSX.Element {
  const commands = useSavedCommandStore((s) => s.commands)
  const splitDirection = useTerminalStore((s) => s.splitDirection)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const close = (): void => setAnchor(null)
  const run = (id: string): void => {
    close()
    const item = useSavedCommandStore.getState().commands.find((c) => c.id === id)
    if (!item || item.activeTabId) return
    const tabId = useTerminalStore.getState().addTab(item.profileId, true, item.cwd, item.command)
    useSavedCommandStore.getState().startRun(item.id, tabId, Date.now())
  }
  return (
    <>
      <span className="ide-tab-spacer" />
      <button className="ide-command-btn" onClick={(e) => setAnchor(anchor ? null : anchorOf(e.currentTarget))} title="Quick commands" aria-haspopup="menu" aria-expanded={Boolean(anchor)}><Play size={11} /> Command</button>
      {/* Lite ile ayni: widget gorunumu ve split kapatma IDE'de de var (split dugmeleri pane araclarinda). */}
      {splitDirection && <button className="split-tab-btn" onClick={() => useTerminalStore.getState().closeSplit()} title="Close split view" aria-label="Close split view"><PanelTopClose size={14} /></button>}
      <button className="split-tab-btn" onClick={() => void useWidgetStore.getState().enter()} title="Widget view (compact status, always on top)" aria-label="Switch to widget view"><PictureInPicture2 size={14} /></button>
      {/* Panel acikken dugmesi panelin kendi ust satirinda (Orca). */}
      {!rightOpen && (
        <button className="split-tab-btn" onClick={() => setIde({ rightOpen: true })} title="Show right panel" aria-label="Show right panel"><PanelRight size={14} /></button>
      )}
      {anchor && (
        <IdeMenu anchor={anchor} label="Quick commands" onClose={close} width={280}>
          <div className="ctx-menu-section" role="presentation">Quick commands</div>
          {commands.length === 0 && <div className="ide-menu-empty">No saved commands yet.</div>}
          {commands.map((item) => (
            <MenuItem key={item.id} onSelect={() => run(item.id)} hint={item.activeTabId ? 'running' : undefined}>{item.name}</MenuItem>
          ))}
          <div className="ctx-menu-divider" />
          <MenuItem onSelect={() => { close(); useSavedCommandStore.getState().show() }}>Add or edit commands...</MenuItem>
          <MenuItem onSelect={() => { close(); useTaskPaletteStore.getState().toggle() }} hint="Ctrl+Shift+P">Command Palette</MenuItem>
        </IdeMenu>
      )}
    </>
  )
}

const TAB_COLORS = ['#3b82f6', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#94a3b8']

/** Agent IDE sekme sag tik menusu (Orca 4.9). */
function TabContextMenu({ tabs, tabId, anchor, onClose }: { tabs: TerminalTabModel[]; tabId: string; anchor: MenuAnchor; onClose: () => void }): React.JSX.Element {
  const index = tabs.findIndex((t) => t.id === tabId)
  const tab = tabs[index]
  const tasks = useAgentTasks(tab?.agentHook?.sessionId)
  const store = useTerminalStore.getState()
  const pick = (fn: () => void) => (): void => { onClose(); fn() }
  const settings = useSettingsStore.getState().settings
  if (!tab) return <></>
  const sessionId = tab.agentHook?.sessionId
  const now = Date.now()
  const accounts = claudeAccounts(settings.profiles)
  const isClaude = accounts.some((a) => a.id === tab.profileId)
  const continueWith = (target: TerminalProfile): Promise<boolean> => continueWithAccount(tabId, target)
  const others = tabs.filter((t) => t.id !== tabId).map((t) => t.id)
  const right = tabs.slice(index + 1).map((t) => t.id)
  const left = tabs.slice(0, index).map((t) => t.id)
  const split = (dir: 'vertical' | 'horizontal'): void => { store.setActiveTab(tabId); store.splitActive(dir) }
  const closeMany = (ids: string[]): void => {
    const kept = store.closeTabs(ids)
    if (kept > 0) useToastStore.getState().show(`Kept ${kept} running tab${kept === 1 ? '' : 's'}. Close ${kept === 1 ? 'it' : 'them'} one by one to confirm.`, 'info')
  }
  return (
    <IdeMenu anchor={anchor} label="Tab actions" onClose={onClose} width={240}>
      <MenuItem onSelect={pick(() => store.addTab(tab.profileId, true, tab.cwd || tab.launchCwd))}>New Terminal Like This</MenuItem>
      <MenuItem onSelect={pick(() => split('vertical'))} hint={'Ctrl+\\'}>Split Right</MenuItem>
      <MenuItem onSelect={pick(() => split('horizontal'))}>Split Down</MenuItem>
      {isClaude && accounts.filter((a) => a.id !== tab.profileId).map((a) => (
        <MenuItem key={a.id} onSelect={pick(() => void continueWith(a))}>{sessionId ? `Continue session with ${a.name}` : `Continue with ${a.name} (no session yet)`}</MenuItem>
      ))}
      {tasks.length > 0 && <div className="ctx-menu-section" role="presentation">Background tasks</div>}
      {tasks.slice(0, 10).map((task) => (
        <MenuItem key={task.path} onSelect={pick(() => openTaskTab(task, tab.cwd || tab.launchCwd))} hint={formatAge(task.mtimeMs, now)}>{`Watch ${taskName(task)}`}</MenuItem>
      ))}
      <div className="ctx-menu-divider" />
      <MenuItem onSelect={pick(() => window.dispatchEvent(new CustomEvent('termflow:rename-tab', { detail: tabId })))}>Change Title</MenuItem>
      <MenuItem onSelect={pick(() => store.markAttention(tabId, 'done'))}>Mark as Unread</MenuItem>
      <div className="ctx-menu-section" role="presentation">Tab color</div>
      <div className="ide-color-row" role="group" aria-label="Tab color">
        <button className={`ide-color-swatch ide-color-none${!tab.color ? ' ide-color-on' : ''}`} onClick={pick(() => store.setTabColor(tabId, undefined))} aria-label="No color" title="No color" />
        {TAB_COLORS.map((color) => (
          <button key={color} className={`ide-color-swatch${tab.color === color ? ' ide-color-on' : ''}`} style={{ background: color }} onClick={pick(() => store.setTabColor(tabId, color))} aria-label={`Color ${color}`} title={color} />
        ))}
      </div>
      <div className="ctx-menu-divider" />
      <MenuItem onSelect={pick(() => store.requestCloseTab(tabId))} hint="Ctrl+Shift+W">Close</MenuItem>
      {others.length > 0 && <MenuItem onSelect={pick(() => closeMany(others))}>Close Others</MenuItem>}
      {right.length > 0 && <MenuItem onSelect={pick(() => closeMany(right))}>Close Tabs to the Right</MenuItem>}
      {left.length > 0 && <MenuItem onSelect={pick(() => closeMany(left))}>Close Tabs to the Left</MenuItem>}
    </IdeMenu>
  )
}

interface TabBarProps {
  height: number
  /** Agent IDE: sekme seridi orta sutunda; pencere dugmeleri payi yalniz sag panel kapaliyken. */
  ide?: { sidebarOpen: boolean; rightOpen: boolean }
}

/**
 * Custom title bar (PRD §68): tab bar pencere başlığının yerini alır. Windows'ta
 * native pencere düğmeleri overlay olarak sağ üstte durur, macOS'ta trafik
 * ışıkları sol üstte — bu kadar yer boş bırakılır. Linux'ta native title bar
 * korunduğu için ekstra boşluk yok.
 */
const WINDOWS_OVERLAY_WIDTH = 140
const MACOS_TRAFFIC_LIGHTS_WIDTH = 78

export function TabBar({ height, ide }: TabBarProps): React.JSX.Element {
  const allTabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const scope = useWorkspaceScopeStore((s) => s.byTab)
  // Agent IDE (Orca): serit yalniz etkin worktree'nin sekmelerini gosterir; Terminal gorunumu hepsini.
  const tabs = useMemo(() => (ide ? scopedTabs(allTabs, scope, activeTabId) : allTabs), [ide, allTabs, scope, activeTabId])
  const splitDirection = useTerminalStore((s) => s.splitDirection)
  const showSessionRail = useSettingsStore((s) => s.settings.showSessionRail)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pathLauncherOpen, setPathLauncherOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [worktreeLauncherOpen, setWorktreeLauncherOpen] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ tabId: string; anchor: MenuAnchor } | null>(null)
  const caretRef = useRef<HTMLButtonElement>(null)
  // Native HTML5 DnD reorder (PRD §14): dragged tab + insertion indicator.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropPos, setDropPos] = useState<{ tabId: string; before: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  /** Önceki render'daki sekme x konumları (FLIP). */
  const tabLefts = useRef(new Map<string, number>())

  // FLIP: sekme açılıp kapanınca ya da yer değiştirince kalanlar yeni yerlerine
  // kayar; aktif sekme çizgisi de hedef sekmeye süzülür. Sürüklerken FLIP
  // yapılmaz, yoksa dönüştürülmüş dikdörtgen hover hesabını şaşırtır.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const motion = effectiveMotion(useSettingsStore.getState().settings.motion)
    const next = new Map<string, number>()
    let activeEl: HTMLElement | null = null
    for (const el of list.querySelectorAll<HTMLElement>('[data-tab-id]')) {
      const id = el.dataset.tabId ?? ''
      const left = el.offsetLeft
      next.set(id, left)
      if (id === activeTabId) activeEl = el
      const prev = tabLefts.current.get(id)
      if (motion !== 'off' && !draggedId && prev !== undefined && prev !== left) {
        el.animate([{ transform: `translateX(${prev - left}px)` }, { transform: 'none' }], {
          duration: motion === 'full' ? 240 : 170,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
        })
      }
    }
    tabLefts.current = next
    const indicator = indicatorRef.current
    if (!indicator) return
    if (!activeEl) {
      indicator.style.opacity = '0'
      return
    }
    // İlk konumlandırma animasyonsuz olsun (soldan kayarak gelmesin).
    const instant = indicator.style.opacity !== '1'
    indicator.classList.toggle('tab-indicator-instant', instant)
    indicator.style.transform = `translateX(${activeEl.offsetLeft}px)`
    indicator.style.width = `${activeEl.offsetWidth}px`
    indicator.style.opacity = '1'
    if (instant) void indicator.offsetWidth
    indicator.classList.remove('tab-indicator-instant')
  }, [tabs, activeTabId, draggedId])

  // "+" opens a tab with the default profile (PRD §15); the caret beside it
  // opens the NewTabMenu with every shell + custom profile.
  const newTab = (): void => {
    const { settings, shells } = useSettingsStore.getState()
    // IDE: the new terminal belongs to the worktree on screen, so it stays in this strip (Orca).
    const worktreePath = ide && activeTabId ? scope.get(activeTabId) : undefined
    useTerminalStore.getState().addTab(resolveDefaultProfileId(settings, shells), true, worktreePath)
  }

  const handleDragEnd = (): void => {
    setDraggedId(null)
    setDropPos(null)
  }

  /**
   * Live reorder while dragging: the tab under the cursor is the insertion
   * point — mouse in the left half inserts before it, right half after it.
   */
  const handleDragOverTab = (targetId: string, before: boolean): void => {
    if (!draggedId || draggedId === targetId) return
    const store = useTerminalStore.getState()
    const from = store.tabs.findIndex((t) => t.id === draggedId)
    const to = store.tabs.findIndex((t) => t.id === targetId)
    if (from < 0 || to < 0) return
    // Remove the dragged tab first, then insert: indices after `from` shift.
    let targetIndex = before ? to : to + 1
    if (from < to) targetIndex -= 1
    const clamped = Math.max(0, Math.min(targetIndex, store.tabs.length - 1))
    setDropPos({ tabId: targetId, before })
    if (clamped !== from) store.moveTab(draggedId, clamped)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    handleDragEnd()
  }

  const platform = window.termflow?.system.platform
  const titleBarInset: CSSProperties =
    ide && (ide.rightOpen || platform !== 'win32')
      ? {}
      : platform === 'win32'
      ? { paddingRight: WINDOWS_OVERLAY_WIDTH }
      : platform === 'darwin'
        ? { paddingLeft: MACOS_TRAFFIC_LIGHTS_WIDTH }
        : {}

  return (
    <div className="tab-bar" style={{ height, ...titleBarInset } as CSSProperties}>
      {ide && !ide.sidebarOpen && <IdeTabBarLead />}
      <div ref={listRef} className="tab-list" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        <div ref={indicatorRef} className="tab-indicator" aria-hidden="true" />
        {tabs.map((tab) => (
          <TerminalTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => useTerminalStore.getState().setActiveTab(tab.id)}
            onClose={() => useTerminalStore.getState().requestCloseTab(tab.id)}
            onRename={(title) => useTerminalStore.getState().renameTab(tab.id, title)}
            onDragStart={setDraggedId}
            onDragEnd={handleDragEnd}
            onDragOverTab={handleDragOverTab}
            onContextMenu={ide ? (e) => {
              e.preventDefault()
              setTabMenu({ tabId: tab.id, anchor: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY } })
            } : undefined}
            dropPos={
              dropPos && dropPos.tabId === tab.id ? (dropPos.before ? 'before' : 'after') : null
            }
          />
        ))}
      </div>
      <div className="new-tab-area">
        {!ide && <>
        <button
          className={`split-tab-btn${showSessionRail ? ' split-tab-btn-active' : ''}`}
          onClick={() => useSettingsStore.getState().update({ showSessionRail: !showSessionRail })}
          title="Toggle session rail"
          aria-label="Toggle session rail"
          aria-pressed={showSessionRail}
        ><PanelLeft size={14} /></button>
        <button className="split-tab-btn" onClick={() => void useWidgetStore.getState().enter()} title="Widget view (compact status, always on top)" aria-label="Switch to widget view"><PictureInPicture2 size={14} /></button>
        <button className={`split-tab-btn${splitDirection === 'vertical' ? ' split-tab-btn-active' : ''}`} onClick={() => useTerminalStore.getState().splitActive('vertical')} title="Split terminal right" aria-label="Split terminal right"><Columns2 size={14} /></button>
        <button className={`split-tab-btn${splitDirection === 'horizontal' ? ' split-tab-btn-active' : ''}`} onClick={() => useTerminalStore.getState().splitActive('horizontal')} title="Split terminal down" aria-label="Split terminal down"><Rows2 size={14} /></button>
        {splitDirection && <button className="split-tab-btn" onClick={() => useTerminalStore.getState().closeSplit()} title="Close split view" aria-label="Close split view"><PanelTopClose size={14} /></button>}
        </>}
        <button className="new-tab-btn" onClick={newTab} title="New Tab" aria-label="New tab">
          <Plus size={14} />
        </button>
        <button
          ref={caretRef}
          className="new-tab-caret"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="New tab options"
          aria-expanded={menuOpen}
          title="More"
        >
          <ChevronDown size={12} />
        </button>
        {menuOpen && caretRef.current && (
          <NewTabMenu
            anchor={caretRef.current}
            onClose={() => setMenuOpen(false)}
            onOpenAtPath={() => { setMenuOpen(false); setPathLauncherOpen(true) }}
            onOpenNewProject={() => { setMenuOpen(false); setNewProjectOpen(true) }}
            onOpenWorktree={() => { setMenuOpen(false); setWorktreeLauncherOpen(true) }}
            onOpenGithub={() => { setMenuOpen(false); setGithubOpen(true) }}
          />
        )}
        <AttentionBell />
        <RemoteIndicator />
        {ide && <IdeTabBarActions rightOpen={ide.rightOpen} />}
      </div>
      {pathLauncherOpen && <PathLauncherModal onClose={() => setPathLauncherOpen(false)} />}
      {newProjectOpen && <NewProjectModal onClose={() => setNewProjectOpen(false)} />}
      {worktreeLauncherOpen && <WorktreeLauncherModal onClose={() => setWorktreeLauncherOpen(false)} />}
      {githubOpen && <GitHubPanel onClose={() => setGithubOpen(false)} />}
      {tabMenu && <TabContextMenu tabs={tabs} tabId={tabMenu.tabId} anchor={tabMenu.anchor} onClose={() => setTabMenu(null)} />}
    </div>
  )
}
