import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUp, ChevronRight, File, FileDiff, Folder, FolderGit2, GitBranch, GitPullRequest, Play, RefreshCw, SquareTerminal } from 'lucide-react'
import type { DirListing, GitHubPullRequest, GitHubStatus, GitRepoInfo, GitStatus, ProjectInfo, ProjectTask, WorktreeEntry } from '../../../shared/ipc'
import { client, errorText, useRemote } from '../store'
import { Empty, Group, Row, Sheet, timeAgo } from '../ui'
import { NewTabSheet } from './NewTabSheet'
import { ChangesSheet } from './ChangesSheet'

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function parentOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (at <= 0) return null
  const parent = trimmed.slice(0, at)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

interface Overview {
  git: GitStatus | null
  project: ProjectInfo | null
  repo: GitRepoInfo | null
  worktrees: WorktreeEntry[]
}

export function ProjectScreen(): React.JSX.Element {
  const tabs = useRemote((s) => s.tabs)
  const currentTabId = useRemote((s) => s.currentTabId)
  const settings = useRemote((s) => s.settings)
  const setCurrentTab = useRemote((s) => s.setCurrentTab)
  const toast = useRemote((s) => s.toast)
  const home = useRemote((s) => s.home)

  const folders = useMemo(() => {
    const current = tabs.find((t) => t.id === currentTabId)?.cwd
    const all = [current, ...tabs.map((t) => t.cwd), settings?.lastCwd, settings?.customStartupDirectory, home]
    return [...new Set(all.filter((v): v is string => !!v && v.trim().length > 0))]
  }, [tabs, currentTabId, settings, home])

  const [folder, setFolder] = useState<string | null>(folders[0] ?? null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<ProjectTask | null>(null)
  const [newTab, setNewTab] = useState<{ cwd: string; command?: string } | null>(null)
  const [browse, setBrowse] = useState<string | null>(null)
  const [prs, setPrs] = useState<{ repo: string; list: GitHubPullRequest[] } | null>(null)
  const [changes, setChanges] = useState(false)

  useEffect(() => {
    if (!folder && folders[0]) setFolder(folders[0])
  }, [folder, folders])

  const load = useCallback(async (dir: string): Promise<void> => {
    setLoading(true)
    const c = client()
    const [git, project, repo] = await Promise.allSettled([
      c.ipc<GitStatus | null>('git:status', dir),
      c.ipc<ProjectInfo | null>('project:detect', dir),
      c.ipc<GitRepoInfo | null>('worktree:repo-info', dir)
    ])
    const repoInfo = repo.status === 'fulfilled' ? repo.value : null
    const worktrees = repoInfo ? await c.ipc<WorktreeEntry[]>('worktree:list', repoInfo.root).catch(() => []) : []
    setOverview({
      git: git.status === 'fulfilled' ? git.value : null,
      project: project.status === 'fulfilled' ? project.value : null,
      repo: repoInfo,
      worktrees
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (folder) void load(folder).catch((error) => { setLoading(false); toast(errorText(error), 'error') })
  }, [folder, load, toast])

  const current = tabs.find((t) => t.id === currentTabId) ?? null

  const runInCurrent = (command: string): void => {
    if (!current) return
    if (!client().send({ t: 'input', tabId: current.id, data: `${command}\r` })) {
      toast('Not connected to the desktop.', 'error')
      return
    }
    setTask(null)
    setCurrentTab(current.id)
  }

  const loadPrs = async (): Promise<void> => {
    if (!folder) return
    try {
      const status = await client().ipc<GitHubStatus>('github:status')
      if (!status.installed || !status.authenticated) {
        toast(status.error || 'GitHub CLI (gh) is not signed in on the computer.', 'error')
        return
      }
      const repo = await client().ipc<string>('github:current-repo', folder)
      if (!repo) {
        toast('This folder has no GitHub remote.', 'error')
        return
      }
      setPrs({ repo, list: await client().ipc<GitHubPullRequest[]>('github:pull-requests', repo, folder) })
    } catch (error) {
      toast(errorText(error), 'error')
    }
  }

  if (!folder) {
    return (
      <div className="page">
        <h1 className="page-title">Project</h1>
        <Empty icon={<FolderGit2 size={28} />} title="No folder yet" text="Open a tab first; its folder shows up here." />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{baseName(folder)}</h1>
        <button className="icon-btn" onClick={() => void load(folder)} aria-label="Refresh"><RefreshCw size={18} className={loading ? 'spin' : undefined} /></button>
      </div>
      <p className="page-note mono">{folder}</p>
      {folders.length > 1 && (
        <div className="chips">
          {folders.map((f) => <button key={f} className={f === folder ? 'chip on' : 'chip'} onClick={() => setFolder(f)}>{baseName(f)}</button>)}
        </div>
      )}

      <Group>
        <Row label={<><GitBranch size={14} /> {overview?.git?.branch ?? (loading ? 'Loading...' : 'Not a git repository')}</>} hint={overview?.git ? `${overview.git.changedFiles} changed file${overview.git.changedFiles === 1 ? '' : 's'}` : undefined} />
        {overview?.git && overview.git.changedFiles > 0 && <Row label={<><FileDiff size={14} /> Review changes</>} onClick={() => setChanges(true)}><ChevronRight size={16} /></Row>}
        <Row label={<><SquareTerminal size={14} /> Open a terminal here</>} onClick={() => setNewTab({ cwd: folder })}><ChevronRight size={16} /></Row>
        <Row label={<><Folder size={14} /> Browse files</>} onClick={() => setBrowse(folder)}><ChevronRight size={16} /></Row>
        {overview?.git && <Row label={<><GitPullRequest size={14} /> Pull requests</>} onClick={() => void loadPrs()}><ChevronRight size={16} /></Row>}
      </Group>

      {overview?.project && overview.project.technologies.length > 0 && (
        <div className="chips static">{overview.project.technologies.map((t) => <span key={t} className="chip">{t}</span>)}</div>
      )}

      <Group title="Tasks">
        {(!overview?.project || overview.project.tasks.length === 0) && <Row label={loading ? 'Loading...' : 'No tasks found'} hint="Scripts from package.json, Makefile, Cargo, Go and more" />}
        {overview?.project?.tasks.map((t) => (
          <Row key={t.id} label={t.label} hint={`${t.command} · ${t.source}`} onClick={() => setTask(t)}><Play size={16} /></Row>
        ))}
      </Group>

      {overview && overview.worktrees.length > 1 && (
        <Group title="Worktrees">
          {overview.worktrees.map((w) => (
            <Row key={w.path} label={w.branch ?? (w.detached ? 'detached HEAD' : baseName(w.path))} hint={w.path} onClick={() => setNewTab({ cwd: w.path })}>
              <SquareTerminal size={16} />
            </Row>
          ))}
        </Group>
      )}

      {task && (
        <Sheet title={task.label} onClose={() => setTask(null)}>
          <p className="sheet-note mono">{task.command}</p>
          <div className="menu-list">
            <button className="menu-item" disabled={!current} onClick={() => runInCurrent(task.command)}>Run in {current ? `"${current.title}"` : 'the current tab'}</button>
            <button className="menu-item" onClick={() => { setNewTab({ cwd: folder, command: task.command }); setTask(null) }}>Run in a new tab</button>
          </div>
        </Sheet>
      )}
      {newTab && <NewTabSheet initialCwd={newTab.cwd} launchCommand={newTab.command} onClose={() => setNewTab(null)} />}
      {changes && <ChangesSheet folder={folder} onClose={() => setChanges(false)} />}
      {browse && <FilesSheet start={browse} onClose={() => setBrowse(null)} onOpenTerminal={(cwd) => { setBrowse(null); setNewTab({ cwd }) }} />}
      {prs && (
        <Sheet title={`Pull requests · ${prs.repo}`} onClose={() => setPrs(null)}>
          {prs.list.length === 0 && <Empty title="No open pull requests" />}
          <Group>
            {prs.list.map((pr) => (
              <Row key={pr.number} label={`#${pr.number} ${pr.title}`} hint={`${pr.author} · ${pr.headRefName}${pr.isDraft ? ' · draft' : ''} · ${timeAgo(new Date(pr.updatedAt).getTime())}`} />
            ))}
          </Group>
        </Sheet>
      )}
    </div>
  )
}

function FilesSheet({ start, onClose, onOpenTerminal }: { start: string; onClose(): void; onOpenTerminal(cwd: string): void }): React.JSX.Element {
  const toast = useRemote((s) => s.toast)
  const [dir, setDir] = useState(start)
  const [listing, setListing] = useState<DirListing | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setListing(null)
    client().ipc<DirListing | null>('files:list', dir, hidden)
      .then((result) => {
        if (result) setListing(result)
        else toast('This folder cannot be read.', 'error')
      })
      .catch((error) => toast(errorText(error), 'error'))
  }, [dir, hidden, toast])

  const parent = parentOf(dir)
  return (
    <Sheet title={baseName(dir)} onClose={onClose} actions={<button className="btn small" onClick={() => onOpenTerminal(dir)}><SquareTerminal size={14} /> Terminal here</button>}>
      <p className="sheet-note mono">{dir}</p>
      <div className="chips">
        <button className={hidden ? 'chip on' : 'chip'} onClick={() => setHidden((v) => !v)}>Hidden files</button>
      </div>
      <Group>
        {parent && <Row label={<><ArrowUp size={14} /> ..</>} onClick={() => setDir(parent)} />}
        {!listing && <Row label="Loading..." />}
        {listing?.entries.map((e) => (
          <Row key={e.path} label={<>{e.isDirectory ? <Folder size={14} /> : <File size={14} />} {e.name}</>} onClick={e.isDirectory ? () => setDir(e.path) : undefined}>
            {e.isDirectory && <ChevronRight size={16} />}
          </Row>
        ))}
        {listing?.truncated && <Row label="List cut at 500 entries" />}
      </Group>
    </Sheet>
  )
}
