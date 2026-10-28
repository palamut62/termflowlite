import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, GitBranch, Search, Settings, Zap } from 'lucide-react'
import { worktreeKey, type AgentSession } from '../../../shared/types'
import { JUMP_SOURCES, idleTabs, searchCommands, searchJump, type JumpCommand, type JumpItem, type JumpSource } from '../jumpRanking'
import { SECTIONS } from '../settings/Settings'
import { isInside } from '../shells/ide/ideTreeModel'
import { toggleUiMode } from '../shells/uiMode'
import { addProject, openProjectAt, saveIde } from '../shells/ide/ProjectTree'
import { useTaskPaletteStore } from '../store/taskPaletteStore'
import { useIdePageStore } from '../shells/ide/pages/idePageStore'
import { pathLabel } from '../sessionRail'
import { lastSeen, useJumpPaletteStore } from '../store/jumpPaletteStore'
import { resolveDefaultProfileId, useSettingsStore } from '../store/settingsStore'
import { useTerminalStore } from '../store/terminalStore'
import { useToastStore } from '../store/toastStore'
import { agentProfileOptions, continueAgentSession } from '../agentHandover'
import { ATTENTION_LABELS } from '../attention/AttentionBell'
import { TabIcon } from '../tabs/TabIcon'
import { relativeTime } from './AgentSessions'

/** Ctrl+Shift+J: sekme ve oturum atlama. Spec: docs/orca-parity/jump-palette.md */
export function JumpPalette(): React.JSX.Element {
  const hide = useJumpPaletteStore((s) => s.hide)
  const tabs = useTerminalStore((s) => s.tabs)
  const active = useTerminalStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId))
  // Acilis anindaki sira dondurulur; acikken gelen yeni olay satirlarin yerini degistirmez.
  const [frozen] = useState(() => idleTabs(useTerminalStore.getState().tabs, useTerminalStore.getState().activeTabId, lastSeen))
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [folder, setFolder] = useState<string | null>(null)
  const cwd = active?.cwd || active?.launchCwd || ''
  // Agent IDE (PRD F2.2): worktree, ayar ve aksiyon kaynaklari; Tab ile kaynak suzgeci. Lite'ta palet ayni kalir.
  const ide = useSettingsStore((s) => s.settings.uiMode === 'ide')
  const [source, setSource] = useState<JumpSource>('all')
  const [worktrees, setWorktrees] = useState<JumpCommand[]>([])

  useEffect(() => {
    void window.termflow.agentSessions.list({ limit: 50 }).then(setSessions).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!ide) return
    const { ide: settings } = useSettingsStore.getState().settings
    void Promise.all(settings.projects.map(async (root) => (await window.termflow.worktree.list(root).catch(() => [])).filter((w) => !w.bare).map((w): JumpCommand => {
      const name = settings.worktreeMeta[worktreeKey(w.path)]?.name || w.branch || pathLabel(w.path)
      return { id: `wt:${w.path}`, group: 'worktrees', label: name, detail: `${pathLabel(root)} - ${w.path}`, run: () => openWorktree(w.path) }
    }))).then((lists) => setWorktrees(lists.flat()))
  }, [ide])

  const commands = useMemo<JumpCommand[]>(() => ide ? [
    ...worktrees,
    ...SECTIONS.map((section): JumpCommand => ({ id: `set:${section.id}`, group: 'settings', label: section.label, detail: 'Settings', keywords: section.keywords, run: () => useSettingsStore.getState().openSettings(section.id) })),
    ...IDE_ACTIONS
  ] : [], [ide, worktrees])

  const items = useMemo<JumpItem[]>(() => {
    const idle = frozen.flatMap((item) => {
      // Kapanan sekme duser; kalanlar guncel baslik ve noktayla gorunur.
      const tab = item.kind === 'tab' ? tabs.find((t) => t.id === item.tab.id) : undefined
      return tab ? [{ kind: 'tab' as const, tab, at: item.at }] : []
    })
    const found = query.trim() ? searchJump(query, tabs, sessions, lastSeen) : []
    if (source === 'tabs') return query.trim() ? found.filter((i) => i.kind === 'tab') : idle
    if (source === 'sessions') {
      if (query.trim()) return found.filter((i) => i.kind === 'session')
      const open = new Set(tabs.flatMap((tab) => [tab.agentHook?.sessionId, tab.resumeSession?.id]))
      return sessions.filter((s) => !open.has(s.id)).slice(0, 30).map((session) => ({ kind: 'session' as const, session, at: session.updatedAt }))
    }
    if (source !== 'all') return searchCommands(query, commands.filter((c) => c.group === source))
    return query.trim() ? [...found, ...searchCommands(query, commands)] : idle
  }, [query, tabs, sessions, frozen, source, commands])

  // Hicbir sey eslesmezse ve sorgu var olan bir klasorse: "Open new tab in <klasor>".
  useEffect(() => {
    setFolder(null)
    const q = query.trim()
    if (!q || items.length > 0 || (!cwd && !/^([a-z]:|[\\/~])/i.test(q))) return
    let current = true
    void window.termflow.system.resolvePath(q, cwd).then((resolved) => {
      if (current && resolved?.isDirectory) setFolder(resolved.path)
    })
    return () => { current = false }
  }, [query, items.length, cwd])

  useEffect(() => setSelected(0), [query, source])
  useEffect(() => document.getElementById(`jump-row-${selected}`)?.scrollIntoView({ block: 'nearest' }), [selected])

  const count = items.length + (folder ? 1 : 0)

  const choose = (index: number, beside: boolean): void => {
    const item = items[index]
    if (!item && !(folder && index === items.length)) return
    hide()
    const store = useTerminalStore.getState()
    const { settings, shells } = useSettingsStore.getState()
    if (!item) {
      store.addTab(resolveDefaultProfileId(settings, shells), true, folder!)
    } else if (item.kind === 'command') {
      item.command.run()
    } else if (item.kind === 'tab') {
      if (beside) store.openBeside(item.tab.id)
      else store.setActiveTab(item.tab.id)
      store.clearAttention([item.tab.id])
    } else {
      const profiles = agentProfileOptions(settings)
      const target = profiles.find((p) => p.id === item.session.profileId) ?? profiles.find((p) => p.agent === item.session.agent)
      if (!target) {
        useToastStore.getState().show(`No ${item.session.agent} profile to resume this session with.`, 'error')
        return
      }
      void continueAgentSession(item.session, target, item.session.cwd, settings.defaultAgentPermissionMode)
        .catch(() => useToastStore.getState().show('Session could not be resumed.', 'error'))
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Rakam bos sorguda (Ctrl ile her zaman) o satira atlar.
    if (/^[1-9]$/.test(event.key) && (event.ctrlKey || !query)) {
      event.preventDefault()
      choose(Number(event.key) - 1, false)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((value) => Math.min(value + 1, count - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((value) => Math.max(value - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(selected, event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      hide()
    } else if (event.key === 'Tab' && ide) {
      event.preventDefault()
      const step = event.shiftKey ? -1 : 1
      setSource((current) => JUMP_SOURCES[(JUMP_SOURCES.indexOf(current) + step + JUMP_SOURCES.length) % JUMP_SOURCES.length] ?? 'all')
    }
  }

  const row = (index: number, label: string, content: React.ReactNode): React.JSX.Element => (
    <div
      key={index}
      id={`jump-row-${index}`}
      role="option"
      aria-selected={selected === index}
      aria-label={label}
      className={`palette-item jump-item${selected === index ? ' palette-item-selected' : ''}`}
      onMouseEnter={() => setSelected(index)}
      onClick={(event) => choose(index, event.shiftKey)}
    >
      <kbd className="jump-key">{!query && index < 9 ? index + 1 : ''}</kbd>
      {content}
    </div>
  )

  return (
    <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) hide() }}>
      <section className="task-palette" role="dialog" aria-label="Jump to tab or session">
        <label className="palette-search">
          <Search size={15} />
          {source !== 'all' && <span className="jump-source">{SOURCE_LABELS[source]}</span>}
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ide ? 'Search tabs, worktrees, sessions, settings and actions...' : 'Jump to a tab, folder, branch or session...'}
            role="combobox"
            aria-expanded="true"
            aria-controls="jump-list"
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? `jump-row-${selected}` : undefined}
          />
        </label>
        <div className="palette-results" id="jump-list" role="listbox" aria-label="Tabs and sessions">
          {count === 0 && <div className="palette-empty">{query.trim() ? 'No matching tabs or sessions' : 'No other tabs open'}</div>}
          {items.map((item, index) => {
            if (item.kind === 'tab') {
              const { tab } = item
              const where = tab.worktree?.branch ?? tab.cwd ?? tab.launchCwd ?? ''
              const status = tab.attention ? ATTENTION_LABELS[tab.attention] : ''
              return row(index, [tab.title, status, where].filter(Boolean).join(', '), <>
                <span className={tab.attention ? `tab-attention tab-attention-${tab.attention}` : 'jump-dot'} aria-hidden="true" />
                <TabIcon shellId={tab.profileId} />
                <span><strong>{tab.title}</strong><small title={where}>{where}</small></span>
                <time>{relativeTime(item.at)}</time>
              </>)
            }
            if (item.kind === 'command') {
              const { command } = item
              const Icon = command.group === 'worktrees' ? GitBranch : command.group === 'settings' ? Settings : Zap
              return row(index, `${command.label}, ${command.detail}`, <>
                <span className="jump-dot" aria-hidden="true" />
                <Icon size={14} />
                <span><strong>{command.label}</strong><small title={command.detail}>{command.detail}</small></span>
                <time>{SOURCE_LABELS[command.group]}</time>
              </>)
            }
            const { session } = item
            return row(index, `Resume ${session.agent} session ${session.title}, ${session.cwd ?? ''}`, <>
              <span className="jump-dot" aria-hidden="true" />
              <TabIcon shellId={session.profileId ?? session.agent} />
              <span><strong>{session.title}</strong><small title={session.cwd}>Resume · {session.cwd ? pathLabel(session.cwd) : 'Unknown folder'}</small></span>
              <time>{relativeTime(item.at)}</time>
            </>)
          })}
          {folder && row(items.length, `Open new tab in ${folder}`, <>
            <span className="jump-dot" aria-hidden="true" />
            <FolderPlus size={14} />
            <span><strong>Open new tab in {pathLabel(folder)}</strong><small title={folder}>{folder}</small></span>
            <time />
          </>)}
        </div>
        <footer className="palette-hint"><span>1-9 Jump</span><span>Enter Open</span><span>Shift+Enter Split</span>{ide && <span>Tab Filter</span>}<span>Esc Close</span></footer>
      </section>
    </div>
  )
}

const SOURCE_LABELS: Record<JumpSource, string> = { all: 'All', tabs: 'Tabs', worktrees: 'Worktrees', sessions: 'Sessions', settings: 'Settings', actions: 'Actions' }

/** Worktree'ye git: icinde acik sekme varsa ona, yoksa o klasorde yeni sekme. */
function openWorktree(path: string): void {
  const store = useTerminalStore.getState()
  const tab = store.tabs.find((t) => isInside(t.worktree?.path || t.cwd || t.launchCwd || '', path))
  if (tab) { store.setActiveTab(tab.id); return }
  openProjectAt(path)
}

const rightPanel = (rightTab: 'explorer' | 'agents' | 'scm' | 'checks') => (): void => saveIde({ rightOpen: true, rightTab })
const IDE_ACTIONS: JumpCommand[] = [
  { id: 'act:new-terminal', group: 'actions', label: 'New Terminal', detail: 'Ctrl+Shift+T', run: () => { const { settings, shells } = useSettingsStore.getState(); useTerminalStore.getState().addTab(resolveDefaultProfileId(settings, shells)) } },
  { id: 'act:new-worktree', group: 'actions', label: 'New Worktree...', detail: 'Create a worktree with an agent', run: () => window.dispatchEvent(new Event('termflow:ide-new-worktree')) },
  { id: 'act:add-project', group: 'actions', label: 'Add Project Folder...', detail: 'Projects', run: () => void addProject() },
  { id: 'act:board', group: 'actions', label: 'Open Workspace Board', detail: 'Worktrees by status', run: () => window.dispatchEvent(new Event('termflow:ide-board')) },
  { id: 'act:reveal', group: 'actions', label: 'Reveal Active Workspace', detail: 'Sidebar', run: () => window.dispatchEvent(new Event('termflow:ide-reveal')) },
  { id: 'act:explorer', group: 'actions', label: 'Show Explorer', detail: 'Ctrl+Shift+E', run: rightPanel('explorer') },
  { id: 'act:agents', group: 'actions', label: 'Show Agents', detail: 'Ctrl+Shift+A', run: rightPanel('agents') },
  { id: 'act:scm', group: 'actions', label: 'Show Source Control', detail: 'Ctrl+Shift+G', run: rightPanel('scm') },
  { id: 'act:checks', group: 'actions', label: 'Show Checks', detail: 'Ctrl+Shift+K', run: rightPanel('checks') },
  { id: 'act:review', group: 'actions', label: 'Review Changes', detail: 'Diff and line comments', keywords: 'diff compare base ref', run: () => useIdePageStore.getState().open('review') },
  { id: 'act:notes', group: 'actions', label: 'Open Worktree Notes', detail: 'Markdown notes', keywords: 'note todo', run: () => useIdePageStore.getState().open('notes') },
  { id: 'act:sidebar', group: 'actions', label: 'Toggle Sidebar', detail: 'Projects sidebar', run: () => saveIde({ sidebarOpen: !useSettingsStore.getState().settings.ide.sidebarOpen }) },
  { id: 'act:layout', group: 'actions', label: 'Switch to Terminal Layout', detail: 'Ctrl+Shift+I', run: toggleUiMode },
  { id: 'act:commands', group: 'actions', label: 'Command Palette', detail: 'Ctrl+Shift+P', run: () => useTaskPaletteStore.getState().show() },
  { id: 'act:shortcuts', group: 'actions', label: 'Keyboard Shortcuts', detail: 'Settings', run: () => useSettingsStore.getState().openSettings('keyboard') }
]
