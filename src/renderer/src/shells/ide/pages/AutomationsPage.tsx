import { CalendarClock, Play, Plus } from 'lucide-react'
import { describeSchedule, type CommandSchedule } from '../../../store/commandSchedule'
import { resolveDefaultProfileId, useSettingsStore } from '../../../store/settingsStore'
import { useSavedCommandStore, type SavedCommand } from '../../../store/savedCommandStore'
import { useTerminalStore } from '../../../store/terminalStore'
import { relativeTime } from '../../../components/AgentSessions'

/**
 * Orca'daki sablonlar. Ajana giden metin CLI argumani olarak verilir (`claude -p`), gecikmeli kabuk girdisi degil.
 * Sablon DEVRE DISI eklenir ve duzenleyici acilir: kullanici gozden gecirmeden hicbir ajan zamanli calismaz.
 */
const TEMPLATES: { name: string; detail: string; prompt: string; schedule: CommandSchedule }[] = [
  { name: 'Weekday repo audit', detail: 'Every day at 09:00', schedule: { kind: 'daily', time: '09:00' }, prompt: 'Audit this repository: list failing tests, outdated dependencies and TODOs that block a release. Do not change files.' },
  { name: 'Release readiness', detail: 'Fridays at 16:00', schedule: { kind: 'weekly', time: '16:00', weekday: 5 }, prompt: 'Check if the main branch is ready to release: build, tests, changelog and open blockers. Report only.' },
  { name: 'Daily change review', detail: 'Every day at 18:00', schedule: { kind: 'daily', time: '18:00' }, prompt: 'Review the commits merged today and point out risky changes or missing tests. Do not change files.' },
  { name: 'Hourly queue check', detail: 'Every 60 minutes', schedule: { kind: 'interval', minutes: 60 }, prompt: 'Look at open pull requests and issues waiting on me and summarise what needs attention.' }
]

function runNow(item: SavedCommand): void {
  if (item.activeTabId) { useTerminalStore.getState().setActiveTab(item.activeTabId); return }
  const tabId = useTerminalStore.getState().addTab(item.profileId, true, item.cwd, item.command)
  useSavedCommandStore.getState().startRun(item.id, tabId, Date.now())
}

function addTemplate(template: (typeof TEMPLATES)[number]): void {
  const { settings, shells } = useSettingsStore.getState()
  const store = useSavedCommandStore.getState()
  const command = `claude -p "${template.prompt.replace(/"/g, "'")}"`
  if (!store.add(template.name, command, resolveDefaultProfileId(settings, shells), template.schedule)) return
  const created = useSavedCommandStore.getState().commands.find((c) => c.name === template.name && c.command === command)
  // Aktif calisma alaninda calissin (repo denetimi); duraklatilmis baslar.
  const { tabs, activeTabId } = useTerminalStore.getState()
  const active = tabs.find((t) => t.id === activeTabId)
  if (created) store.configure(created.id, active?.worktree?.path || active?.cwd || active?.launchCwd || '', false)
  store.show(created?.id)
}

/** Automations (PRD F3.2, Orca): kayitli / zamanli komutlar, sablonlar ve calisma gecmisi (savedCommandStore). */
export function AutomationsPage(): React.JSX.Element {
  const commands = useSavedCommandStore((s) => s.commands)
  const runs = commands.flatMap((c) => (c.results ?? []).map((r) => ({ ...r, name: c.name, id: c.id }))).sort((a, b) => b.at - a.at).slice(0, 50)
  const cards = [
    { label: 'Automations', value: commands.length },
    { label: 'Scheduled', value: commands.filter((c) => c.schedule && c.enabled !== false).length },
    { label: 'Runs', value: commands.reduce((n, c) => n + (c.results?.length ?? 0), 0) },
    { label: 'Failed runs', value: commands.reduce((n, c) => n + (c.results ?? []).filter((r) => r.exitCode !== 0).length, 0) }
  ]

  return (
    <div className="ide-page-body">
      <div className="ide-page-actions">
        <button className="settings-btn settings-btn-primary" onClick={() => useSavedCommandStore.getState().show()}><Plus size={13} /> New Automation</button>
      </div>
      <div className="stats-cards">{cards.map((c) => <div key={c.label} className="stats-card"><strong>{c.value}</strong><span>{c.label}</span></div>)}</div>

      {commands.length > 0 && (
        <table className="ide-table ide-table-fit" aria-label="Automations">
          <thead><tr><th>Name</th><th>Schedule</th><th>Last run</th><th /></tr></thead>
          <tbody>
            {commands.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong><div className="ide-table-sub">{item.command}</div></td>
                <td>{item.schedule ? `${describeSchedule(item.schedule)}${item.enabled === false ? ' (paused)' : ''}` : 'Manual'}</td>
                <td>{item.lastRunAt ? relativeTime(item.lastRunAt) : '-'}</td>
                <td className="ide-table-actions">
                  <button className="settings-btn settings-btn-small" onClick={() => runNow(item)}><Play size={11} /> {item.activeTabId ? 'Running' : 'Run now'}</button>
                  <button className="settings-btn settings-btn-small" onClick={() => useSavedCommandStore.getState().show(item.id)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="ide-page-subhead">Start from a template</h3>
      <div className="ide-templates">
        {TEMPLATES.map((t) => (
          <button key={t.name} className="ide-template" onClick={() => addTemplate(t)}>
            <CalendarClock size={16} />
            <strong>{t.name}</strong>
            <span>{t.detail}</span>
            <small>{t.prompt}</small>
          </button>
        ))}
      </div>

      <h3 className="ide-page-subhead">Runs</h3>
      {runs.length === 0 ? <div className="ide-note">No runs yet.</div> : (
        <table className="ide-table" aria-label="Runs">
          <thead><tr><th>When</th><th>Automation</th><th>Result</th><th>Duration</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={`${r.id}:${r.at}`}>
                <td>{relativeTime(r.at)}</td><td>{r.name}</td>
                <td className={r.exitCode === 0 ? 'ide-run-ok' : 'ide-run-fail'}>{r.exitCode === 0 ? 'Succeeded' : `Failed (${r.exitCode})`}</td>
                <td>{Math.round(r.durationMs / 1000)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
