import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bookmark, Bot, Braces, Clock3, Command, Download, GitBranch, Loader2, Radio, RefreshCw, Server, ShieldCheck, Smartphone, Sparkles, SquareTerminal, X, FolderTree } from 'lucide-react'
import type { AgentPermissionMode } from '../../../shared/types'
import type { GitStatus, ProjectInfo } from '../../../shared/ipc'
import { agentForProfile, sshFromProfileId } from '../../../shared/profiles'
import { remoteSessionName, sshTarget } from '../../../shared/sshArgs'
import { useSettingsStore } from '../store/settingsStore'
import { broadcastTargetIds, useTerminalStore } from '../store/terminalStore'
import { useCommandHistoryStore } from '../store/commandHistoryStore'
import { useAgentSessionStore } from '../store/agentSessionStore'
import { useTaskPaletteStore } from '../store/taskPaletteStore'
import { useSavedCommandStore } from '../store/savedCommandStore'
import { useAgentEventStore } from '../store/agentEventStore'
import { initUpdateStatusBridge, shouldShowUpdateBadge, updateBadgeLabel, updateBadgeTitle, useUpdateStore } from '../store/updateStore'
import { agentProfileOptions, switchActiveAgentProfile, switchActivePermissionMode } from '../agentHandover'
import { IdeMenu, MenuItem, anchorOf, type MenuAnchor } from '../shells/ide/IdeMenu'
import { useToastStore } from '../store/toastStore'
import { OutputPulse } from './OutputPulse'
import { useFilePanelStore } from '../store/filePanelStore'
import { useStatsStore } from '../store/statsStore'
import { phonesLabel, useConnectedPhones } from '../remoteStatus'

const PERMISSION_MODES: AgentPermissionMode[] = ['safe', 'workspace', 'full']
const PERMISSION_LABELS: Record<AgentPermissionMode, string> = {
  safe: 'Safe',
  workspace: 'Workspace',
  full: 'Full access'
}
const PERMISSION_HINTS: Record<AgentPermissionMode, string> = {
  safe: 'read-only',
  workspace: 'project + approvals',
  full: 'no approvals'
}

const CONFIRM_RESET_MS = 6000

import { UsageMeter } from '../usage/UsageMeter'
import { IdeStatusExtras } from '../shells/ide/IdeStatusExtras'

/** Shown while a paired phone is connected through Remote Access; opens its settings. */
function RemoteBadge(): React.JSX.Element | null {
  const phones = useConnectedPhones()
  if (phones.length === 0) return null
  const title = `${phonesLabel(phones)} through Remote Access`
  return (
    <button className="status-item status-action status-remote" onClick={() => useSettingsStore.getState().openSettings('remote')} title={title} aria-label={title}>
      <Smartphone size={12} />{phones.length}
    </button>
  )
}

/** Sağ blokta güncelleme rozeti; 'downloaded' durumunda kurulum iki aşamalı onaylanır. */
function UpdateBadge(): React.JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion)
  const confirmingInstall = useUpdateStore((s) => s.confirmingInstall)

  useEffect(() => {
    if (!confirmingInstall) return
    const timer = window.setTimeout(() => useUpdateStore.getState().setConfirmingInstall(false), CONFIRM_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [confirmingInstall])

  if (!shouldShowUpdateBadge(status, dismissedVersion)) return null

  const title = updateBadgeTitle(status)
  const label = confirmingInstall && status.state === 'downloaded' ? 'Click again to restart' : updateBadgeLabel(status)
  const onClick = (): void => {
    if (status.state === 'available') void window.termflow.updater.download()
    else if (status.state === 'downloaded') {
      if (confirmingInstall) void window.termflow.updater.install()
      else useUpdateStore.getState().setConfirmingInstall(true)
    }
  }

  return (
    <span className="status-item status-update-group">
      <button
        className={`status-action status-update${status.state === 'downloaded' ? ' status-update-downloaded' : ''}`}
        onClick={onClick}
        disabled={status.state === 'downloading'}
        title={title}
        aria-label={title}
      >
        {status.state === 'available' && <Download size={12} />}
        {status.state === 'downloading' && <Loader2 size={12} className="status-update-spin" />}
        {status.state === 'downloaded' && <RefreshCw size={12} />}
        {label}
      </button>
      {status.state === 'available' && (
        <button
          className="status-action status-update-dismiss"
          onClick={() => useUpdateStore.getState().dismiss()}
          title="Dismiss update notification"
          aria-label="Dismiss update notification"
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}

export function StatusBar(): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const broadcastInput = useTerminalStore((s) => s.broadcastInput)
  const broadcastPanes = useTerminalStore((s) => broadcastTargetIds(s.activeTabId ?? '', s.splitTabIds, true).length)
  const settings = useSettingsStore((s) => s.settings)
  const uiMode = settings.uiMode
  const active = tabs.find((tab) => tab.id === activeTabId)
  const ssh = active ? sshFromProfileId(settings, active.profileId) : undefined
  const cwd = active?.cwd || active?.launchCwd || ''
  const [git, setGit] = useState<GitStatus | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [switchingProfile, setSwitchingProfile] = useState(false)
  const [securityAnchor, setSecurityAnchor] = useState<MenuAnchor | null>(null)
  const [applyingMode, setApplyingMode] = useState(false)
  const [profileSwitchError, setProfileSwitchError] = useState(false)
  const agentProfiles = useMemo(() => agentProfileOptions(settings), [settings])
  const activeAgent = active ? agentForProfile(settings, active.profileId) : null
  const permissionMode = active?.permissionMode ?? settings.defaultAgentPermissionMode
  const choosePermissionMode = async (mode: AgentPermissionMode): Promise<void> => {
    setSecurityAnchor(null)
    if (mode === permissionMode) return
    const label = PERMISSION_LABELS[mode]
    const toDefault = async (note: string): Promise<void> => {
      await useSettingsStore.getState().update({ defaultAgentPermissionMode: mode })
      useToastStore.getState().show(note)
    }
    if (!active || !activeAgent) return toDefault(`New agent tabs start in ${label}.`)
    setApplyingMode(true)
    try {
      const result = await switchActivePermissionMode(active, activeAgent, mode)
      if (result === 'no-session') await toDefault(`No session to resume; new agent tabs start in ${label}.`)
      else useToastStore.getState().show(`Session continues in ${label} in a new tab.`)
    } catch {
      useToastStore.getState().show('The permission level could not be changed.', 'error')
    } finally {
      setApplyingMode(false)
    }
  }
  const changeAgentProfile = async (profileId: string): Promise<void> => {
    if (!active || !activeAgent || profileId === active.profileId) return
    const target = agentProfiles.find((profile) => profile.id === profileId)
    if (!target) return
    setSwitchingProfile(true)
    setProfileSwitchError(false)
    try {
      await switchActiveAgentProfile(active, target, activeAgent)
    } catch {
      setProfileSwitchError(true)
    } finally {
      setSwitchingProfile(false)
    }
  }
  useEffect(() => initUpdateStatusBridge(), [])

  useEffect(() => {
    let current = true
    const refresh = (): void => {
      if (!cwd) {
        setGit(null)
        return
      }
      void window.termflow.git.status(cwd).then((value) => {
        if (current) setGit(value)
      })
    }
    refresh()
    // Interval yalnızca aynı dizindeki dosya değişimlerini yakalamak içindir;
    // dizin değişimi effect restart'ı ([cwd]) ile zaten anında yenilenir.
    const timer = window.setInterval(() => {
      if (document.hidden) return
      refresh()
    }, 30_000)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [cwd])

  useEffect(() => {
    let current = true
    if (!cwd) {
      setProject(null)
      return
    }
    void window.termflow.project.detect(cwd).then((value) => {
      if (current) setProject(value)
    })
    return () => { current = false }
  }, [cwd])

  return (
    <footer className="status-bar" aria-label="Terminal status">
      <button className="status-action" onClick={() => useCommandHistoryStore.getState().show()} title="Command history (Ctrl+Shift+H)"><Clock3 size={12} />History</button>
      <button className="status-action" onClick={() => useSavedCommandStore.getState().show()} title="Saved commands"><Bookmark size={12} />Saved</button>
      <button className="status-action" onClick={() => useAgentSessionStore.getState().show()} title="Saved agent sessions"><Bot size={12} />Sessions</button>
      <button className="status-action" onClick={() => useAgentEventStore.getState().show()} title="Live agent activity and timeline"><Radio size={12} />Agents</button>
      <button className="status-action" onClick={() => useTaskPaletteStore.getState().show()} title="Command palette (Ctrl+Shift+P)"><Command size={12} />Commands</button>
      <button className="status-action" onClick={() => useStatsStore.getState().show()} title="Your TermFlow stats and badges"><Sparkles size={12} />Wrapped</button>
      <button className="status-action status-files" onClick={() => useFilePanelStore.getState().toggle()} title="Files in this folder (Ctrl+Shift+E)"><FolderTree size={12} />Files</button>
      <span className="status-spacer" />
      {/* Yanlışlıkla açık kalmasın diye belirgin rozet; tıklama kapatır. */}
      {broadcastInput && (
        <button
          className="status-item status-broadcast"
          onClick={() => useTerminalStore.getState().toggleBroadcastInput()}
          title={broadcastPanes > 1
            ? `Input is sent to the ${broadcastPanes} framed panes — click to turn off (Ctrl+Alt+B)`
            : 'Broadcast is on but this tab is not in a split, so input goes only here — click to turn off (Ctrl+Alt+B)'}
        >
          <Radio size={12} />{broadcastPanes > 1 ? `BROADCAST · ${broadcastPanes}` : 'BROADCAST · this tab only'}
        </button>
      )}
      {ssh && (
        <span
          className="status-item status-ssh"
          title={ssh.persistentSession
            ? `SSH connection: ${ssh.name}\nPersistent ${ssh.multiplexer ?? 'tmux'} session "${remoteSessionName(ssh)}" — remote work survives a disconnect`
            : `SSH connection: ${ssh.name}`}
        >
          <Server size={12} />{sshTarget(ssh)}{ssh.persistentSession ? ' · persistent' : ''}
        </span>
      )}
      {project && <span className="status-item status-project" title={`Detected project: ${project.technologies.join(', ')}`}><Braces size={12} />{project.technologies.join(' · ')}</span>}
      {active?.worktree && (
        <span className="status-item status-worktree" title={`Isolated worktree of ${active.worktree.repoRoot}\n${active.worktree.path}`}>
          <GitBranch size={12} />worktree
        </span>
      )}
      {git && <span className="status-item status-git" title={`${git.changedFiles} changed file${git.changedFiles === 1 ? '' : 's'}`}><GitBranch size={12} />{git.branch}{git.changedFiles > 0 ? ` (${git.changedFiles})` : ''}</span>}
      <OutputPulse />
      {uiMode === 'ide' && <IdeStatusExtras />}
      {uiMode === 'ide'
        ? <span className="status-item ide-term-count" title={`${tabs.length} terminal${tabs.length === 1 ? '' : 's'}`}><SquareTerminal size={12} />{tabs.length}</span>
        : <span className="status-item">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>}
      <UsageMeter />
      <RemoteBadge />
      <UpdateBadge />
      {profileSwitchError && <span className="status-item status-switch-error" title="The active agent profile could not be changed"><AlertCircle size={12} />Switch failed</span>}
      {activeAgent && (
        <label className="status-agent-profile" title="Hand this work over to another profile or provider">
          <Bot size={12} />
          <select
            value={active?.profileId ?? ''}
            disabled={switchingProfile}
            onChange={(event) => void changeAgentProfile(event.target.value)}
            aria-label="Active agent profile"
          >
            {agentProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
      )}
      <button
        className={`status-action status-security status-security-${permissionMode}`}
        onClick={(event) => setSecurityAnchor((current) => (current ? null : anchorOf(event.currentTarget)))}
        disabled={applyingMode}
        title={`Active session: ${PERMISSION_LABELS[permissionMode]}. Click to change the permission level.`}
        aria-label={`Agent security profile: ${PERMISSION_LABELS[permissionMode]}`}
        aria-haspopup="menu"
      >
        <ShieldCheck size={12} />{applyingMode ? 'Switching...' : PERMISSION_LABELS[permissionMode]}
      </button>
      {securityAnchor && (
        <IdeMenu anchor={securityAnchor} up label="Agent permission level" onClose={() => setSecurityAnchor(null)} width={300}>
          <div className="ctx-menu-section" role="presentation">
            {activeAgent ? 'Active agent session' : 'New agent tabs'}
          </div>
          {PERMISSION_MODES.map((mode) => (
            <MenuItem key={mode} checked={mode === permissionMode} hint={PERMISSION_HINTS[mode]} onSelect={() => void choosePermissionMode(mode)}>
              {PERMISSION_LABELS[mode]}
            </MenuItem>
          ))}
          <p className="ide-awake-hint">
            {activeAgent
              ? 'The level is a launch argument, so the session continues in a new tab with the new level.'
              : 'No agent tab is active; the level becomes the default for new agent tabs.'}
          </p>
        </IdeMenu>
      )}
    </footer>
  )
}
