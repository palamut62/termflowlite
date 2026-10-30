import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '../../../../shared/types'
import type { WorktreeEntry } from '../../../../shared/ipc'
import { buildIdeTree, DEFAULT_TREE_VIEW, formatAge, groupWorktrees, nestChildren, isInside, mostUrgent, sessionState, sortWorktrees, worktreeSource, type IdeWorktree } from './ideTreeModel'

const tab = (id: string, cwd: string, extra: Partial<TerminalTab> = {}): TerminalTab =>
  ({ id, title: id, profileId: 'claude', running: true, activity: 'completed', startedAt: 1000, cwd, launchCwd: cwd, ...extra }) as TerminalTab
const wt = (path: string, branch: string | null): WorktreeEntry => ({ path, head: 'abc', branch, detached: !branch, bare: false, locked: false })

describe('buildIdeTree', () => {
  const root = 'C:\\repo'
  const feature = 'C:\\repo\\.termflow-worktrees\\fix-login'
  const base = {
    projects: [root],
    worktrees: new Map([[root, [wt('C:/repo', 'main'), wt('C:/repo/.termflow-worktrees/fix-login', 'fix-login')]]]),
    repoRoots: new Map<string, string>(),
    activeTabId: 'b',
    agentOf: () => 'claude' as const
  }

  it('puts each tab under the deepest worktree, primary checkout first', () => {
    const tree = buildIdeTree({ ...base, tabs: [tab('a', 'C:\\repo\\src'), tab('b', feature, { worktree: { path: feature, branch: 'fix-login', repoRoot: root } as TerminalTab['worktree'] })] })
    expect(tree).toHaveLength(1)
    const [primary, child] = tree[0].worktrees
    expect(primary).toMatchObject({ branch: 'main', primary: true })
    expect(primary.sessions.map((s) => s.tabId)).toEqual(['a'])
    expect(child).toMatchObject({ branch: 'fix-login', primary: false })
    expect(child.sessions[0]).toMatchObject({ tabId: 'b', active: true })
  })

  it('adds the project of an open tab even when it was never added, and keeps non-git folders', () => {
    const tree = buildIdeTree({ ...base, projects: [], worktrees: new Map(), repoRoots: new Map([['D:\\notes', 'D:\\notes']]), tabs: [tab('n', 'D:\\notes')] })
    expect(tree[0]).toMatchObject({ root: 'D:\\notes', label: 'notes' })
    expect(tree[0].worktrees[0]).toMatchObject({ primary: true, branch: null })
    expect(tree[0].worktrees[0].sessions[0].tabId).toBe('n')
  })

  it('lists a project once regardless of slashes and case', () => {
    expect(buildIdeTree({ ...base, projects: ['C:\\repo', 'c:/repo/'], tabs: [] })).toHaveLength(1)
  })
})

describe('session state', () => {
  it('prefers what the agent reported, then the shell activity', () => {
    expect(sessionState(tab('x', '/', { agentHook: { state: 'needs-input', at: 5 } }), 'claude')).toBe('needs-input')
    expect(sessionState(tab('x', '/', { activity: 'running' }), 'claude')).toBe('working')
    expect(sessionState(tab('x', '/', { activity: 'running' }), null)).toBe('idle')
    expect(sessionState(tab('x', '/', { activity: 'error' }), null)).toBe('error')
    // Hook'lu Claude ilk olaydan once prompt bekliyor; cikti tahmini "Working" demesin.
    expect(sessionState(tab('x', '/', { activity: 'running' }), 'claude', true)).toBe('idle')
    expect(sessionState(tab('x', '/', { activity: 'running' }), 'opencode', true)).toBe('working')
    // Hook'u olmayan katalog ajanlari da "Working" gosterir, sadece uc ajan degil.
    expect(sessionState(tab('x', '/', { activity: 'running' }), 'gemini', true)).toBe('working')
  })

  it('picks the most urgent state for a collapsed group', () => {
    expect(mostUrgent([{ state: 'done' }, { state: 'needs-input' }, { state: 'working' }] as never)).toBe('needs-input')
    expect(mostUrgent([{ state: 'idle' }] as never)).toBeNull()
  })
})

it('matches folders by path segment and formats ages', () => {
  expect(isInside('C:\\repo\\src', 'c:/repo')).toBe(true)
  expect(isInside('C:\\repo2', 'C:\\repo')).toBe(false)
  expect([formatAge(0, 30_000), formatAge(0, 6 * 60_000), formatAge(0, 6 * 3_600_000), formatAge(0, 50 * 3_600_000)]).toEqual(['now', '6m', '6h', '2d'])
})

describe('worktree visibility (Orca "Non-Orca worktrees")', () => {
  const root = 'C:/repo'
  const listed = [
    wt('C:/repo', 'main'),
    wt('C:/repo/.termflow-worktrees/ours', 'ours'),
    wt('C:/repo/.claude/worktrees/claude-1', 'claude/one'),
    wt('D:/elsewhere/other', 'other'),
    wt('C:/repo/.claude/worktrees/busy', null)
  ]
  const input = (view = DEFAULT_TREE_VIEW, tabs: TerminalTab[] = []) => buildIdeTree({
    projects: [root], worktrees: new Map([[root, listed]]), repoRoots: new Map(), tabs, activeTabId: null, agentOf: () => null, view
  })[0]

  it('classifies worktrees by who created them', () => {
    expect(worktreeSource('C:/repo', root)).toBe('primary')
    expect(worktreeSource('C:/repo/.termflow-worktrees/x', root)).toBe('termflow')
    // main/worktree.ts defaultWorktreePath: deponun yaninda.
    expect(worktreeSource('C:/.termflow-worktrees/repo/fix-login', root)).toBe('termflow')
    expect(worktreeSource('C:/repo/.claude/worktrees/x', root)).toBe('claude')
    expect(worktreeSource('D:/x', root)).toBe('other')
  })

  it('hides other tools worktrees by default but never one with a live session', () => {
    const project = input(DEFAULT_TREE_VIEW, [tab('t', 'C:/repo/.claude/worktrees/busy')])
    expect(project.worktrees.map((w) => w.branch ?? 'busy')).toEqual(['main', 'busy', 'ours'])
    expect(project.hidden.map((w) => w.branch)).toEqual(['claude/one', 'other'])
  })

  it('shows a source, a single worktree, and applies the default-branch and detached filters', () => {
    expect(input({ ...DEFAULT_TREE_VIEW, showClaude: true }).worktrees.map((w) => w.branch)).toContain('claude/one')
    expect(input({ ...DEFAULT_TREE_VIEW, shown: ['d:/elsewhere/other'] }).worktrees.map((w) => w.branch)).toContain('other')
    expect(input({ ...DEFAULT_TREE_VIEW, hideDefaultBranch: true }).worktrees.some((w) => w.primary)).toBe(false)
    expect(input({ ...DEFAULT_TREE_VIEW, showClaude: true, hideDetached: true }).worktrees.some((w) => w.detached)).toBe(false)
  })

  it('sorts by name or keeps the most urgent first', () => {
    const a: IdeWorktree = { path: 'b', branch: 'b', primary: false, source: 'other', detached: false, sessions: [], meta: {} }
    const b = { path: 'a', branch: 'a', primary: false, source: 'other', detached: false, sessions: [{ state: 'needs-input', since: 1 }], meta: {} } as never
    expect(sortWorktrees([a, b], 'name').map((w) => w.branch)).toEqual(['a', 'b'])
    expect(sortWorktrees([{ ...a, branch: 'z' }, b], 'activity')[0]).toBe(b)
    // Pinlenen, aciliyetten bile once gelir.
    expect(sortWorktrees([b, { ...a, meta: { pinned: true } }], 'activity')[0]?.branch).toBe('b')
  })

  it('attaches meta, hides sleeping worktrees on request and groups by status', () => {
    const meta = { 'c:/repo/.termflow-worktrees/ours': { status: 'in-review' as const, sleeping: true, name: 'Ours' } }
    const build = (hideSleeping: boolean) => buildIdeTree({
      projects: [root], worktrees: new Map([[root, listed]]), repoRoots: new Map(), tabs: [], activeTabId: null, agentOf: () => null,
      view: { ...DEFAULT_TREE_VIEW, hideSleeping }, meta
    })
    const visible = build(false)
    expect(visible[0]?.worktrees.find((w) => w.branch === 'ours')?.meta.name).toBe('Ours')
    expect(build(true)[0]?.worktrees.map((w) => w.branch)).toEqual(['main'])
    const groups = groupWorktrees(visible, 'status')
    expect(groups.map((g) => [g.label, g.items.map((i) => i.worktree.branch)])).toEqual([['Todo', ['main']], ['In progress', []], ['In review', ['ours']], ['Done', []]])
    expect(groupWorktrees(visible, 'none')[0]?.items).toHaveLength(2)
    const byPr = groupWorktrees(visible, 'pr', new Map([[visible[0]!.root, [{ number: 7, title: 'Fix login', headRefName: 'ours' }]]]))
    expect(byPr.map((g) => [g.label, g.items.map((i) => i.worktree.branch)])).toEqual([['#7 Fix login', ['ours']], ['No pull request', ['main']]])
    expect(groupWorktrees(visible, 'pr').map((g) => g.label)).toEqual(['No pull request'])
  })
})

it('nests a worktree under its parent and survives missing parents and cycles', () => {
  const w = (path: string, parent?: string): IdeWorktree => ({ path, branch: path, primary: false, source: 'termflow', detached: false, sessions: [], meta: parent ? { parent } : {} })
  const nested = nestChildren([w('C:/a'), w('C:/b', 'c:\\a'), w('C:/c', 'C:/gone'), w('C:/x', 'C:/y'), w('C:/y', 'C:/x')])
  expect(nested.get('')?.map((x) => x.path)).toEqual(['C:/a', 'C:/c', 'C:/x', 'C:/y'])
  expect(nested.get('c:/a')?.map((x) => x.path)).toEqual(['C:/b'])
})
