import { worktreeKey, type TerminalTab, type WorktreeMeta, type WorktreeStatus } from '../../../../shared/types'
import type { WorktreeEntry } from '../../../../shared/ipc'
import { pathLabel } from '../../sessionRail'

/**
 * Agent IDE sol agaci (docs/agent-ide/PRD.md F1.2): proje > worktree > oturum.
 * Saf fonksiyon: store'lardan turetilir, kendi durumu yok.
 */
export type SessionState = 'working' | 'needs-input' | 'done' | 'error' | 'idle'

export interface IdeSession {
  tabId: string
  title: string
  /** Calisan ajan CLI'inin adi (`claude`, `gemini`...), duz kabukta null. */
  agent: string | null
  state: SessionState
  /** Bu durumun basladigi an (epoch ms); "6m" gibi gosterilir. */
  since: number
  active: boolean
}

export interface IdeWorktree {
  path: string
  /** null: dal yok (detached HEAD ya da git olmayan klasor). */
  branch: string | null
  /** Deponun ana checkout'u. */
  primary: boolean
  /** Kimin actigi (Orca "Non-Orca worktrees"): TermFlow'un kendi klasoru, Claude Code, baska yer. */
  source: WorktreeSource
  detached: boolean
  sessions: IdeSession[]
  /** Kullanici verisi (ad, not, durum, pin, uyku, parent). */
  meta: WorktreeMeta
}

export type WorktreeSource = 'primary' | 'termflow' | 'claude' | 'other'

/** Workspace options (Orca): gorunurluk, siralama, kart duzeni. */
export interface IdeTreeView {
  /** Kaynak basina goster (varsayilan gizli). */
  showClaude: boolean
  showOther: boolean
  /** Tek tek gosterilen worktree yollari. */
  shown: readonly string[]
  hideDefaultBranch: boolean
  hideDetached: boolean
  hideSleeping?: boolean
  sort: 'activity' | 'name' | 'recent'
}

export const DEFAULT_TREE_VIEW: IdeTreeView = { showClaude: false, showOther: false, shown: [], hideDefaultBranch: false, hideDetached: false, sort: 'activity' }

export interface IdeProject {
  root: string
  label: string
  worktrees: IdeWorktree[]
  /** Kaynak ya da filtre yuzunden gizlenen worktree'ler (Show hidden worktrees). */
  hidden: IdeWorktree[]
}

export interface IdeTreeInput {
  /** Kullanicinin ekledigi projeler (depo kokleri ya da klasorler), siraya gore. */
  projects: readonly string[]
  /** Proje koku -> `git worktree list` (bilinmiyorsa yok). */
  worktrees: ReadonlyMap<string, readonly WorktreeEntry[]>
  /** Sekme klasoru -> depo koku (SessionRail ile ayni cozumleme). */
  repoRoots: ReadonlyMap<string, string>
  tabs: readonly TerminalTab[]
  activeTabId: string | null
  agentOf: (tab: TerminalTab) => string | null
  /** agent-hooks acik mi (ayar). */
  hooked?: boolean
  view?: IdeTreeView
  meta?: Readonly<Record<string, WorktreeMeta>>
}

const norm = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** `child` `parent`in kendisi ya da altinda mi (Windows'ta buyuk/kucuk harf duyarsiz). */
export function isInside(child: string, parent: string): boolean {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(`${p}/`)
}

/**
 * `hooked`: ajan durumunu kendisi bildiriyor (agent-hooks acik, Claude/Codex). O zaman ilk olaydan once
 * ajan prompt bekliyordur; cikti tahminine bakilmaz (ilk acilista "Working" gorunmesin).
 */
export function sessionState(tab: TerminalTab, agent: string | null, hooked = false): SessionState {
  if (tab.agentHook) return tab.agentHook.state === 'idle' ? 'idle' : tab.agentHook.state
  if (tab.activity === 'error') return 'error'
  if (hooked && (agent === 'claude' || agent === 'codex')) return 'idle'
  if (tab.activity === 'running' || tab.activity === 'unread') return agent ? 'working' : 'idle'
  return 'idle'
}

export function worktreeSource(path: string, root: string): WorktreeSource {
  if (norm(path) === norm(root)) return 'primary'
  // TermFlow worktree'leri deponun YANINDA acar (`../.termflow-worktrees/<repo>/<dal>`, main/worktree.ts); tam yola bakilir.
  if (/\/\.termflow-worktrees\//.test(norm(path))) return 'termflow'
  if (/\/\.claude\/worktrees\//.test(norm(path))) return 'claude'
  return 'other'
}

/** Acik oturumu olan worktree hic gizlenmez; TermFlow'un actiklari ve ana checkout her zaman gorunur. */
export function isWorktreeVisible(worktree: IdeWorktree, view: IdeTreeView): boolean {
  if (worktree.sessions.length > 0) return true
  if (worktree.primary) return !view.hideDefaultBranch
  if (view.hideSleeping && worktree.meta.sleeping) return false
  if (view.hideDetached && worktree.detached) return false
  if (view.shown.some((p) => norm(p) === norm(worktree.path))) return true
  if (worktree.source === 'termflow') return true
  return worktree.source === 'claude' ? view.showClaude : view.showOther
}

const URGENCY_RANK: Record<SessionState, number> = { 'needs-input': 0, error: 1, working: 2, done: 3, idle: 4 }
const nameOf = (w: IdeWorktree): string => (w.branch ?? w.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '').toLowerCase()
const lastActive = (w: IdeWorktree): number => Math.max(0, ...w.sessions.map((s) => s.since))
const urgency = (w: IdeWorktree): number => Math.min(5, ...w.sessions.map((s) => URGENCY_RANK[s.state]))

export function sortWorktrees(list: IdeWorktree[], sort: IdeTreeView['sort']): IdeWorktree[] {
  return [...list].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1
    if (Boolean(a.meta.pinned) !== Boolean(b.meta.pinned)) return a.meta.pinned ? -1 : 1
    if (sort === 'activity' && urgency(a) !== urgency(b)) return urgency(a) - urgency(b)
    if (sort !== 'name' && lastActive(a) !== lastActive(b)) return lastActive(b) - lastActive(a)
    return nameOf(a).localeCompare(nameOf(b))
  })
}

function tabPath(tab: TerminalTab): string {
  return tab.worktree?.path || tab.cwd || tab.launchCwd || ''
}

export function buildIdeTree(input: IdeTreeInput): IdeProject[] {
  const roots: string[] = []
  const seen = new Set<string>()
  const add = (root: string): void => {
    if (!root || seen.has(norm(root))) return
    seen.add(norm(root))
    roots.push(root)
  }
  input.projects.forEach(add)
  // Acik sekmenin projesi listede olmasa da gorunur (bir oturum agactan hic kaybolmaz).
  for (const tab of input.tabs) {
    const path = tabPath(tab)
    if (!path || roots.some((root) => isInside(path, root))) continue
    add(tab.worktree?.repoRoot || input.repoRoots.get(tab.launchCwd || tab.cwd || '') || path)
  }

  const projects: IdeProject[] = roots.map((root) => {
    const listed = input.worktrees.get(root) ?? []
    const worktrees: IdeWorktree[] = listed.filter((w) => !w.bare).map((w) => ({
      path: w.path,
      branch: w.branch,
      primary: norm(w.path) === norm(root),
      source: worktreeSource(w.path, root),
      detached: w.detached,
      sessions: [],
      meta: input.meta?.[worktreeKey(w.path)] ?? {}
    }))
    if (!worktrees.some((w) => w.primary)) worktrees.unshift({ path: root, branch: null, primary: true, source: 'primary', detached: false, sessions: [], meta: input.meta?.[worktreeKey(root)] ?? {} })
    return { root, label: pathLabel(root), worktrees, hidden: [] }
  })

  for (const tab of input.tabs) {
    const path = tabPath(tab)
    if (!path) continue
    // En derin eslesen worktree (ic ice klasorlerde dogru checkout).
    let best: IdeWorktree | null = null
    for (const project of projects) {
      for (const worktree of project.worktrees) {
        if (isInside(path, worktree.path) && (!best || norm(worktree.path).length > norm(best.path).length)) best = worktree
      }
    }
    if (!best) continue
    const agent = input.agentOf(tab)
    best.sessions.push({
      tabId: tab.id,
      title: tab.title,
      agent,
      state: sessionState(tab, agent, input.hooked),
      since: tab.agentHook?.at ?? tab.busySince ?? tab.startedAt,
      active: tab.id === input.activeTabId
    })
  }
  const view = input.view ?? DEFAULT_TREE_VIEW
  for (const project of projects) {
    const all = sortWorktrees(project.worktrees, view.sort)
    project.worktrees = all.filter((w) => isWorktreeVisible(w, view))
    project.hidden = all.filter((w) => !isWorktreeVisible(w, view))
  }
  return projects
}

/** Agacin ozeti: en acil durum (kapali proje basliginda gosterilir). */
const URGENCY: SessionState[] = ['needs-input', 'error', 'working', 'done']

export function mostUrgent(sessions: readonly IdeSession[]): SessionState | null {
  return URGENCY.find((state) => sessions.some((s) => s.state === state)) ?? null
}

export function formatAge(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export const STATUS_LABELS: Record<WorktreeStatus, string> = { todo: 'Todo', 'in-progress': 'In progress', 'in-review': 'In review', done: 'Done' }
export const STATUSES = Object.keys(STATUS_LABELS) as WorktreeStatus[]

export interface WorktreeGroup { label: string; items: { project: IdeProject; worktree: IdeWorktree }[] }

/** Group by PR icin projenin acik PR'lari (dal adi -> PR); gh yoksa bos. */
export interface ProjectPr { number: number; title: string; headRefName: string }

/**
 * Group by (Orca Workspace options): `status` = Todo / In progress / In review / Done (durumsuz Todo'ya),
 * `pr` = dalinin acik PR'ina gore (projenin `gh pr list` sonucu), PR'siz olanlar en sonda,
 * `none` = tek duz liste. `project` agacin kendisidir, burada kullanilmaz.
 */
export function groupWorktrees(projects: readonly IdeProject[], by: 'status' | 'pr' | 'none', prs: ReadonlyMap<string, readonly ProjectPr[]> = new Map()): WorktreeGroup[] {
  const all = projects.flatMap((project) => project.worktrees.map((worktree) => ({ project, worktree })))
  if (by === 'none') return [{ label: '', items: all }]
  if (by === 'pr') {
    const groups = new Map<string, WorktreeGroup>()
    const none: WorktreeGroup = { label: 'No pull request', items: [] }
    for (const item of all) {
      const pr = item.worktree.branch ? prs.get(item.project.root)?.find((p) => p.headRefName === item.worktree.branch) : undefined
      if (!pr) { none.items.push(item); continue }
      const key = `${item.project.root}#${pr.number}`
      if (!groups.has(key)) groups.set(key, { label: `#${pr.number} ${pr.title}`, items: [] })
      groups.get(key)!.items.push(item)
    }
    return [...groups.values(), none]
  }
  return STATUSES.map((status) => ({ label: STATUS_LABELS[status], items: all.filter(({ worktree }) => (worktree.meta.status ?? 'todo') === status) }))
}

/**
 * Change Parent (Orca): parent'i gorunen baska bir alt worktree olan kart onun altinda gosterilir. Anahtar '' = ust
 * seviye. Parent gorunmuyorsa ya da zincir dongu yapiyorsa (A -> B -> A) kart ust seviyede kalir, kaybolmaz.
 */
export function nestChildren(children: readonly IdeWorktree[]): Map<string, IdeWorktree[]> {
  const byKey = new Map(children.map((w) => [worktreeKey(w.path), w]))
  const parentOf = (w: IdeWorktree): string => {
    const key = w.meta.parent ? worktreeKey(w.meta.parent) : ''
    return key && key !== worktreeKey(w.path) && byKey.has(key) ? key : ''
  }
  const cyclic = (w: IdeWorktree): boolean => {
    const seen = new Set([worktreeKey(w.path)])
    for (let key = parentOf(w); key; key = parentOf(byKey.get(key) as IdeWorktree)) {
      if (seen.has(key)) return true
      seen.add(key)
    }
    return false
  }
  const nested = new Map<string, IdeWorktree[]>()
  for (const w of children) {
    const key = cyclic(w) ? '' : parentOf(w)
    nested.set(key, [...(nested.get(key) ?? []), w])
  }
  return nested
}
