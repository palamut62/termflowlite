import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import { ArrowLeft, BarChart3, Bell, Bot, Brain, Info, Keyboard, Mic, Network, Palette, Server, ShieldCheck, Smartphone, SquareTerminal, UserRound, X } from 'lucide-react'
import { useSettingsStore } from '../store/settingsStore'
import { AppearanceSettings } from './AppearanceSettings'
import { TerminalSettings } from './TerminalSettings'
import { ProfileSettings } from './ProfileSettings'
import { KeyboardSettings } from './KeyboardSettings'
import { AboutSettings } from './AboutSettings'
import { ProviderSettings } from './ProviderSettings'
import { SshSettings } from './SshSettings'
import { AgentSecuritySettings } from './AgentSecuritySettings'
import { NotificationSettings } from './NotificationSettings'
import { ProfileHealthSettings } from './ProfileHealthSettings'
import { WorkspaceSettings } from './WorkspaceSettings'
import { BackupSettings } from './BackupSettings'
import { MemorySettings } from './MemorySettings'
import { RemoteSettings } from './RemoteSettings'
import { VoiceSettings } from './VoiceSettings'
import { StatsSettings } from './StatsSettings'
import { OrchestrationSettings } from './OrchestrationSettings'

type SectionId = 'appearance' | 'terminal' | 'profiles' | 'providers' | 'agent-security' | 'ssh' | 'keyboard' | 'about' | 'health' | 'workspaces' | 'backup' | 'memory' | 'remote' | 'voice' | 'notifications' | 'stats' | 'orchestration'

export const SECTIONS: { id: SectionId; label: string; icon: ReactNode; keywords: string; ideOnly?: boolean }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={14} />, keywords: 'theme font size family weight ligatures line height letter spacing cursor blink effect trail blaze glow gpu webgl rendering inline images opacity blur backdrop mica acrylic transparency tint window border corner radius tab height padding custom theme motion animation transition reduce motion retro crt scanlines confetti celebrate agent animation companion mascot face pixel scenes style character ember miso piko ascii weather rain snow sunny city background picture image photo wallpaper art density characters' },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} />, keywords: 'shift enter newline osc 52 clipboard copy ssh tmux default profile startup directory scrollback shell integration osc 133 command blocks inline suggestions autosuggest media previews image video thumbnail exit code duration notifications bell sounds keyboard click copy on select right click clickable paths confirm before close restore session tray quake hotkey hide on blur' },
  { id: 'profiles', label: 'Profiles', icon: <UserRound size={14} />, keywords: 'custom command profiles arguments icon color startup command starting directory default model permissions environment variables' },
  { id: 'health', label: 'Profile Health', icon: <ShieldCheck size={14} />, keywords: 'profile health check missing cli' },
  { id: 'workspaces', label: 'Workspaces', icon: <SquareTerminal size={14} />, keywords: 'project workspaces folders worktree setup copy env install' },
  { id: 'backup', label: 'Backup & Restore', icon: <Server size={14} />, keywords: 'backup restore import export json' },
  { id: 'providers', label: 'Providers', icon: <Bot size={14} />, keywords: 'ai providers api key base url model cli command permissions' },
  { id: 'memory', label: 'Memory', icon: <Brain size={14} />, keywords: 'agent memory session history summary openrouter model project unfinished mcp connect claude codex opencode exclude' },
  { id: 'orchestration', label: 'Orchestration', icon: <Network size={14} />, keywords: 'orchestration delegate delegation sub agent subagent worker free model opencode glm deepseek grok codex claude provider limit usage threshold mcp termflow-agents worktree task queue', ideOnly: true },
  { id: 'voice', label: 'Voice Input', icon: <Mic size={14} />, keywords: 'voice input dictation microphone speech speak talk transcribe hold space push to talk openrouter audio model' },
  { id: 'remote', label: 'Remote Access', icon: <Smartphone size={14} />, keywords: 'remote access phone mobile tailscale qr pair pairing device disconnect web control' },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={14} />, keywords: 'notifications alerts agent needs you approval finished done error sound chime volume badge taskbar bell unread' },
  { id: 'agent-security', label: 'Agent Security', icon: <ShieldCheck size={14} />, keywords: 'agent security permission mode safe workspace full access status hooks' },
  { id: 'ssh', label: 'SSH', icon: <Server size={14} />, keywords: 'ssh connections host user port identity file key jump host proxyjump remote directory command persistent tmux screen multiplexer forward agent extra arguments' },
  { id: 'keyboard', label: 'Keyboard', icon: <Keyboard size={14} />, keywords: 'keyboard shortcuts keybindings hotkeys' },
  { id: 'stats', label: 'Stats & Usage', icon: <BarChart3 size={14} />, keywords: 'stats usage statistics agent sessions commands time wrapped' },
  { id: 'about', label: 'About', icon: <Info size={14} />, keywords: 'about updates automatic update version license product owner' }
]

/**
 * Settings modal (Faz 6, PRD §33): 5 bölüm — Appearance, Terminal, Profiles,
 * Keyboard, About. Backdrop tıklaması ve Escape kapatır; KeyboardSettings
 * kayıt modundayken Esc'i document capture'da yutar, bu listener tetiklenmez.
 */
/** Agent IDE tam sayfa ayarlarinda menu gruplari (Orca: AI Capabilities, Set Up, Workflows, Interface). */
const GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: 'AI Capabilities', ids: ['providers', 'profiles', 'health', 'orchestration', 'memory', 'voice', 'agent-security'] },
  { label: 'Set Up', ids: ['workspaces', 'remote', 'backup'] },
  { label: 'Workflows', ids: ['terminal', 'ssh'] },
  { label: 'Interface', ids: ['appearance', 'notifications', 'keyboard', 'stats'] },
  { label: 'About', ids: ['about'] }
]

export function Settings(): React.JSX.Element {
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  // Agent IDE: tam sayfa (Orca), "Back to app", gruplu menu, Ctrl+F arama.
  const fullPage = useSettingsStore((s) => s.settings.uiMode === 'ide')
  const searchRef = useRef<HTMLInputElement>(null)
  const [section, setSection] = useState<SectionId>(() => {
    const requested = useSettingsStore.getState().settingsSection
    return SECTIONS.some((s) => s.id === requested) ? requested as SectionId : 'appearance'
  })
  const [query, setQuery] = useState('')
  // Every word must appear in the section label or its field keywords.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // Orchestration yalniz Agent IDE yerlesiminde (PRD: IDE ozellikleri Terminal modunda gorunmez).
  const sections = SECTIONS.filter((s) => fullPage || !s.ideOnly)
  const visibleSections = sections.filter((s) => {
    const haystack = `${s.label} ${s.keywords}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
  const panelRef = useRef<HTMLDivElement>(null)

  // Modal focus management: opening the modal does NOT blur the xterm
  // textarea, whose keydown handler swallows events (Escape included) before
  // they bubble to this document listener — Escape could never close the
  // modal. Focus the panel instead so keys target the modal subtree.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings()
      if (fullPage && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeSettings, fullPage])

  return (
    <div
      className={fullPage ? 'settings-backdrop settings-fullpage' : 'settings-backdrop'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeSettings()
      }}
    >
      <div className="settings-panel" role="dialog" aria-label="Settings" ref={panelRef} tabIndex={-1}>
        <header className="settings-header">
          {fullPage && <button className="settings-btn settings-back" onClick={closeSettings}><ArrowLeft size={14} /> Back to app</button>}
          <span className="settings-header-title">Settings</span>
          {/* Tam sayfada "Back to app" zaten kapatiyor; ikinci bir X gereksiz. */}
          {!fullPage && (
            <button className="settings-icon-btn" onClick={closeSettings} aria-label="Close settings" title="Close (Esc)">
              <X size={16} />
            </button>
          )}
        </header>
        <div className="settings-body">
          <nav className="settings-nav">
            <input
              ref={searchRef}
              className="settings-input settings-search"
              type="search"
              value={query}
              placeholder={fullPage ? 'Search settings (Ctrl+F)' : 'Search settings'}
              aria-label="Search settings"
              onChange={(e) => {
                const next = e.target.value
                setQuery(next)
                // Jump to the first match so the result is visible immediately.
                const nextWords = next.trim().toLowerCase().split(/\s+/).filter(Boolean)
                const first = sections.find((s) => nextWords.every((word) => `${s.label} ${s.keywords}`.toLowerCase().includes(word)))
                if (nextWords.length > 0 && first) setSection(first.id)
              }}
            />
            {visibleSections.length === 0 && <div className="settings-search-empty">No matching settings</div>}
            {(fullPage && words.length === 0
              ? GROUPS.map((group) => ({ label: group.label, items: group.ids.map((id) => SECTIONS.find((s) => s.id === id)).filter((s) => s !== undefined) }))
              : [{ label: '', items: visibleSections }]
            ).map((group) => [
              group.label && <div key={`group:${group.label}`} className="settings-nav-group">{group.label}</div>,
              ...group.items.map((s) => (
                <button
                  key={s.id}
                  className={`settings-nav-item${s.id === section ? ' settings-nav-item-active' : ''}`}
                  onClick={() => setSection(s.id)}
                >
                  {s.icon}
                  <span>{s.label}</span>
                </button>
              ))
            ])}
          </nav>
          <div className="settings-content">
            {section === 'appearance' && <AppearanceSettings />}
            {section === 'terminal' && <TerminalSettings />}
            {section === 'profiles' && <ProfileSettings />}
            {section === 'health' && <ProfileHealthSettings />}
            {section === 'workspaces' && <WorkspaceSettings />}
            {section === 'backup' && <BackupSettings />}
            {section === 'providers' && <ProviderSettings />}
            {section === 'memory' && <MemorySettings />}
            {section === 'remote' && <RemoteSettings />}
            {section === 'voice' && <VoiceSettings />}
            {section === 'agent-security' && <AgentSecuritySettings />}
            {section === 'notifications' && <NotificationSettings />}
            {section === 'ssh' && <SshSettings />}
            {section === 'keyboard' && <KeyboardSettings />}
            {section === 'about' && <AboutSettings />}
            {section === 'stats' && <StatsSettings />}
            {section === 'orchestration' && fullPage && <OrchestrationSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---- Ortak form kontrolleri (CSS variable tabanlı) ---- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="settings-field">
      <div className="settings-field-info">
        <div className="settings-field-label">{label}</div>
        {hint && <div className="settings-field-hint">{hint}</div>}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  // Extra classes (e.g. settings-input-wide) extend the base style instead of replacing it.
  const { className, ...rest } = props
  return <input type="text" {...rest} className={className ? `settings-input ${className}` : 'settings-input'} />
}

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
}

export function NumberInput({ value, onChange, min, max, step = 1, className }: NumberInputProps): React.JSX.Element {
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = parseFloat(e.target.value)
    if (!Number.isFinite(raw)) return
    const clamped = Math.min(max ?? raw, Math.max(min ?? raw, raw))
    // step 0.05 gibi ondalık adımlarda kayan nokta kalıntısını yuvarla.
    onChange(step >= 1 ? Math.round(clamped) : Math.round(clamped * 100) / 100)
  }
  return (
    <input
      type="number"
      className={`settings-input settings-number ${className ?? ''}`.trim()}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={handleChange}
    />
  )
}

interface SelectOption {
  value: string
  label: string
}

export function Select({ value, onChange, options, disabled }: { value: string; onChange: (value: string) => void; options: SelectOption[]; disabled?: boolean }): React.JSX.Element {
  return (
    <select className="settings-input settings-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`settings-toggle${checked ? ' settings-toggle-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

interface ColorPickerProps {
  /** '#rrggbb' veya '' = tema default */
  value: string
  onChange: (value: string) => void
  /** Boş değere dönen "Default" butonu. */
  onReset?: () => void
  showReset?: boolean
}

/**
 * Renk seçici: swatch (input[type=color]) + hex text girişi. Text girişi
 * serbest yazılır, yalnızca geçerli '#rrggbb' dışarıya uygulanır.
 */
export function ColorPicker({ value, onChange, onReset, showReset = false }: ColorPickerProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return (
    <span className="settings-color-picker">
      <input
        type="color"
        className="settings-color-input"
        value={value || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick color"
      />
      <input
        type="text"
        className="settings-input settings-color-hex"
        value={draft}
        placeholder="Default"
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value.trim()
          setDraft(v)
          if (v === '' || /^#[0-9a-f]{6}$/i.test(v)) onChange(v)
        }}
      />
      {showReset && (
        <button className="settings-btn settings-btn-small" onClick={onReset}>
          Default
        </button>
      )}
    </span>
  )
}
