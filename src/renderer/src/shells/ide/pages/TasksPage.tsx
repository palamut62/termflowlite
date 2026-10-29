import { useEffect, useState } from 'react'
import { GitBranch, GitPullRequest, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { GitHubStatus, GitHubTask, GitHubTaskFilter, GitHubTaskKind } from '../../../../../shared/ipc'
import { useTerminalStore } from '../../../store/terminalStore'
import { WorktreeLauncherModal } from '../../../tabs/WorktreeLauncherModal'
import { relativeTime } from '../../../components/AgentSessions'

const FILTERS: Record<GitHubTaskKind, { id: GitHubTaskFilter; label: string }[]> = {
  issues: [{ id: 'open', label: 'Open' }, { id: 'mine', label: 'Assigned to me' }, { id: 'closed', label: 'Closed' }],
  prs: [{ id: 'open', label: 'Open' }, { id: 'mine', label: 'Mine' }, { id: 'review', label: 'Needs review' }, { id: 'closed', label: 'Closed' }]
}

/** Tasks (PRD F3.1, Orca): GitHub issue / PR tablosu; satirdan "Start worktree" Create worktree modalini doldurur. */
export function TasksPage(): React.JSX.Element {
  const cwd = useTerminalStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab?.worktree?.repoRoot || tab?.cwd || tab?.launchCwd || ''
  })
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [repo, setRepo] = useState('')
  const [kind, setKind] = useState<GitHubTaskKind>('issues')
  const [filter, setFilter] = useState<GitHubTaskFilter>('open')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<GitHubTask[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [start, setStart] = useState<string | null>(null)

  useEffect(() => {
    void window.termflow.github.status().then(setStatus)
    if (cwd) void window.termflow.github.currentRepo(cwd).then((r) => setRepo((current) => current || r))
  }, [cwd])

  // Yazarken her tusa gh calistirmamak icin kisa bekleme.
  useEffect(() => {
    if (status && (!status.installed || !status.authenticated)) return
    let stale = false
    setRows(null)
    setError('')
    const timer = window.setTimeout(() => {
      window.termflow.github.tasks(kind, filter, search, repo.trim(), cwd || undefined)
        .then((r) => { if (!stale) setRows(r) })
        .catch((e: Error) => { if (!stale) { setRows([]); setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } })
    }, 300)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [kind, filter, search, repo, cwd, status, reload])

  const unavailable = status && (!status.installed || !status.authenticated)
  const noRepo = !repo.trim() && /not a git repository/i.test(error)
  const targetOf = (task: GitHubTask): string => (kind === 'prs' ? (repo ? `https://github.com/${repo}/pull/${task.number}` : `#${task.number}`) : task.url || `issue-${task.number}`)

  return (
    <div className="ide-page-body ide-tasks">
      <div className="ide-tasks-bar">
        <div className="ide-segment" role="radiogroup" aria-label="Task type">
          {(['issues', 'prs'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'ide-segment-on' : ''} onClick={() => { setKind(k); setFilter('open') }}>{k === 'issues' ? 'Issues' : 'Pull requests'}</button>
          ))}
        </div>
        <div className="ide-segment" role="radiogroup" aria-label="Filter">
          {FILTERS[kind].map((f) => <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? 'ide-segment-on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        <label className="ide-search ide-tasks-search"><Search size={12} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search (GitHub syntax, e.g. label:bug)" aria-label="Search tasks" /></label>
        <input className="ide-search ide-tasks-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" aria-label="Repository" spellCheck={false} />
        <button className="ide-icon-btn" onClick={() => setReload((n) => n + 1)} title="Refresh" aria-label="Refresh tasks"><RefreshCw size={14} /></button>
      </div>
      {unavailable && <div className="ide-note ide-note-error">{status.installed ? 'GitHub CLI is not signed in. Run "gh auth login" in a terminal.' : 'GitHub CLI (gh) is not installed.'}</div>}
      {/* No repository to read: a guiding line, not the raw git error. */}
      {noRepo && <div className="ide-note">Open a terminal in a repository folder, or type an <code>owner/repo</code> above, to see its issues and pull requests.</div>}
      {error && !noRepo && <div className="ide-note ide-note-error">{error}</div>}
      {!unavailable && rows === null && !error && <div className="ide-note"><LoaderCircle size={14} className="spin" /> Loading {kind === 'prs' ? 'pull requests' : 'issues'}...</div>}
      {rows && rows.length === 0 && !error && <div className="ide-note">Nothing here.</div>}
      {rows && rows.length > 0 && (
        <table className="ide-table" aria-label={kind === 'prs' ? 'Pull requests' : 'Issues'}>
          <thead><tr><th>ID</th><th>Title</th><th>{kind === 'prs' ? 'Author' : 'Assignees'}</th><th>Status</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.number}>
                <td className="ide-table-id">#{task.number}</td>
                <td>
                  <button className="ide-table-title" onClick={() => task.url && void window.termflow.system.openExternal(task.url)} title={task.url}>{task.title}</button>
                  {task.branch && <span className="ide-table-chip"><GitPullRequest size={10} />{task.branch}</span>}
                  {task.labels.map((l) => <span key={l} className="ide-table-chip">{l}</span>)}
                </td>
                <td>{kind === 'prs' ? task.author : task.assignees.join(', ') || '-'}</td>
                <td>{task.draft ? 'Draft' : task.state.toLowerCase()}</td>
                <td>{task.updatedAt ? relativeTime(Date.parse(task.updatedAt)) : ''}</td>
                <td><button className="settings-btn settings-btn-small" onClick={() => setStart(targetOf(task))}><GitBranch size={12} /> Start worktree</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {start && <WorktreeLauncherModal initialBranch={start} initialRepoPath={cwd} onClose={() => setStart(null)} />}
    </div>
  )
}
