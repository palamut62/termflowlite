import type { AppSettings } from '../../../../shared/types'
import { useRemote } from '../../store'
import { NumberField, Row, Select, TextField, Toggle } from '../../ui'

type Key = keyof AppSettings

/**
 * Declarative setting rows: one line per desktop setting, rendered and saved
 * the same way, so the phone mirrors Settings without per-field code.
 */
export type FieldSpec =
  | { kind: 'toggle'; key: Key; label: string; hint?: string }
  | { kind: 'number'; key: Key; label: string; hint?: string; min: number; max: number; step?: number }
  | { kind: 'select'; key: Key; label: string; hint?: string; options: { value: string; label: string }[]; numeric?: boolean }
  | { kind: 'text'; key: Key; label: string; hint?: string; placeholder?: string; mono?: boolean }

export function SettingRows({ fields }: { fields: FieldSpec[] }): React.JSX.Element | null {
  const settings = useRemote((s) => s.settings)
  const update = useRemote((s) => s.updateSettings)
  if (!settings) return null
  const value = (key: Key): unknown => (settings as unknown as Record<string, unknown>)[key]
  const save = (key: Key, next: unknown): void => { void update({ [key]: next } as Partial<AppSettings>) }
  return (
    <>
      {fields.map((field) => {
        switch (field.kind) {
          case 'toggle':
            return (
              <Row key={field.key} label={field.label} hint={field.hint}>
                <Toggle label={field.label} checked={value(field.key) === true} onChange={(on) => save(field.key, on)} />
              </Row>
            )
          case 'number':
            return (
              <Row key={field.key} label={field.label} hint={field.hint}>
                <NumberField label={field.label} value={Number(value(field.key))} min={field.min} max={field.max} step={field.step} onCommit={(n) => save(field.key, n)} />
              </Row>
            )
          case 'select':
            return (
              <Row key={field.key} label={field.label} hint={field.hint}>
                <Select label={field.label} value={String(value(field.key) ?? '')} options={field.options} onChange={(v) => save(field.key, field.numeric ? Number(v) : v)} />
              </Row>
            )
          case 'text':
            return (
              <div key={field.key} className="row stacked">
                <span className="row-text">
                  <span className="row-label">{field.label}</span>
                  {field.hint && <span className="row-hint">{field.hint}</span>}
                </span>
                <TextField label={field.label} mono={field.mono} placeholder={field.placeholder} value={String(value(field.key) ?? '')} onCommit={(v) => save(field.key, v)} />
              </div>
            )
        }
      })}
    </>
  )
}

const opts = (pairs: [string, string][]): { value: string; label: string }[] => pairs.map(([value, label]) => ({ value, label }))

export const APPEARANCE_FIELDS: FieldSpec[] = [
  { kind: 'text', key: 'fontFamily', label: 'Font family', mono: true },
  { kind: 'number', key: 'fontSize', label: 'Font size', min: 8, max: 32 },
  { kind: 'select', key: 'fontWeight', label: 'Font weight', options: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w })) },
  { kind: 'toggle', key: 'fontLigatures', label: 'Font ligatures' },
  { kind: 'number', key: 'lineHeight', label: 'Line height', min: 0.8, max: 2, step: 0.05 },
  { kind: 'number', key: 'letterSpacing', label: 'Letter spacing', min: -1, max: 10 },
  { kind: 'select', key: 'cursorStyle', label: 'Cursor style', options: opts([['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']]) },
  { kind: 'toggle', key: 'cursorBlink', label: 'Cursor blink' },
  { kind: 'number', key: 'cursorWidth', label: 'Cursor width', min: 1, max: 4 },
  { kind: 'text', key: 'cursorColor', label: 'Cursor color', hint: 'Empty uses the theme color', placeholder: '#ffffff', mono: true },
  { kind: 'select', key: 'cursorEffect', label: 'Cursor effect', options: opts([['none', 'None'], ['trail', 'Trail'], ['blaze', 'Blaze']]) },
  { kind: 'select', key: 'motion', label: 'Motion', options: opts([['off', 'Off'], ['subtle', 'Subtle'], ['full', 'Full']]) },
  { kind: 'select', key: 'terminalEffect', label: 'Terminal effect', options: opts([['none', 'None'], ['scanlines', 'Scanlines'], ['crt', 'CRT']]) },
  { kind: 'number', key: 'opacity', label: 'Window opacity', hint: '%', min: 30, max: 100 },
  { kind: 'select', key: 'backdrop', label: 'Backdrop', hint: 'Windows 11', options: opts([['none', 'None'], ['mica', 'Mica'], ['acrylic', 'Acrylic'], ['tabbed', 'Tabbed']]) },
  { kind: 'number', key: 'backdropTint', label: 'Backdrop tint', hint: '%', min: 20, max: 100 },
  { kind: 'toggle', key: 'windowBorder', label: 'Window border' },
  { kind: 'number', key: 'cornerRadius', label: 'Corner radius', min: 0, max: 20 },
  { kind: 'number', key: 'tabHeight', label: 'Tab height', min: 28, max: 48 },
  { kind: 'number', key: 'terminalPadding', label: 'Terminal padding', min: 0, max: 48 },
  { kind: 'select', key: 'gpuAcceleration', label: 'GPU acceleration', options: opts([['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]) },
  { kind: 'toggle', key: 'imageSupport', label: 'Inline images' },
  { kind: 'toggle', key: 'celebrate', label: 'Celebrate passing builds' },
  { kind: 'select', key: 'soundTheme', label: 'Sounds', options: opts([['off', 'Off'], ['mechanical', 'Mechanical'], ['soft', 'Soft']]) }
]

/** Terminal page, grouped like the desktop Settings > Terminal. */
export const TERMINAL_GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'Startup',
    fields: [
      { kind: 'select', key: 'startupDirectory', label: 'Startup folder', options: opts([['home', 'Home'], ['last', 'Last used'], ['custom', 'Custom']]) },
      { kind: 'text', key: 'customStartupDirectory', label: 'Custom startup folder', mono: true, placeholder: 'C:\Users\me\projects' },
      { kind: 'toggle', key: 'restoreSession', label: 'Restore tabs on start' }
    ]
  },
  {
    title: 'Terminal',
    fields: [
      { kind: 'select', key: 'scrollback', label: 'Scrollback', numeric: true, options: ['1000', '5000', '10000', '50000', '100000'].map((v) => ({ value: v, label: `${Number(v).toLocaleString()} lines` })) },
      { kind: 'toggle', key: 'shellIntegration', label: 'Shell integration', hint: 'Command blocks, exit codes, durations' },
      { kind: 'toggle', key: 'inlineSuggestions', label: 'Inline suggestions' },
      { kind: 'select', key: 'mediaPreviews', label: 'Media previews', options: opts([['off', 'Off'], ['manual', 'Drop and paste'], ['all', 'Also new files']]) },
      { kind: 'toggle', key: 'commandNotifications', label: 'Notify when long commands finish' },
      { kind: 'toggle', key: 'bell', label: 'Bell' },
      { kind: 'toggle', key: 'confirmBeforeClose', label: 'Confirm before closing tabs' }
    ]
  },
  {
    title: 'Mouse and paths',
    fields: [
      { kind: 'toggle', key: 'copyOnSelect', label: 'Copy on select' },
      { kind: 'select', key: 'rightClickBehavior', label: 'Right click', options: opts([['context-menu', 'Menu'], ['paste', 'Paste']]) },
      { kind: 'toggle', key: 'clickablePaths', label: 'Clickable paths' },
      { kind: 'toggle', key: 'pathContextMenu', label: 'Path menu' }
    ]
  },
  {
    title: 'Window',
    fields: [
      { kind: 'toggle', key: 'showSessionRail', label: 'Session rail' },
      { kind: 'toggle', key: 'closeToTray', label: 'Keep running in the tray', hint: 'Phones stay connected when the window is closed' },
      { kind: 'toggle', key: 'launchAtLogin', label: 'Launch at startup', hint: 'Start with Windows sign-in (installed app only)' },
      { kind: 'toggle', key: 'autoCheckUpdates', label: 'Check for updates on start' },
      { kind: 'toggle', key: 'autoUpdateAgents', label: 'Auto-update agent CLIs', hint: 'npm-installed agents, at start and daily' },
      { kind: 'toggle', key: 'showTips', label: 'Show tips' }
    ]
  },
  {
    title: 'Quake mode',
    fields: [
      { kind: 'toggle', key: 'quakeMode', label: 'Quake mode', hint: 'Drop-down window on a global hotkey' },
      { kind: 'text', key: 'quakeHotkey', label: 'Hotkey', mono: true },
      { kind: 'toggle', key: 'quakeHideOnBlur', label: 'Hide on blur' },
      { kind: 'number', key: 'quakeHeightPercent', label: 'Height', hint: '%', min: 20, max: 100 }
    ]
  }
]

export const SECURITY_FIELDS: FieldSpec[] = [
  { kind: 'select', key: 'defaultAgentPermissionMode', label: 'Default agent permissions', hint: 'For new agent tabs', options: opts([['safe', 'Safe'], ['workspace', 'Workspace'], ['full', 'Full access']]) }
]
