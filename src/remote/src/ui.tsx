import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useRemote } from './store'

/** Keeps a focused field visible once the on-screen keyboard has finished opening. */
function revealFocused(e: React.FocusEvent): void {
  const target = e.target as HTMLElement
  if (!target.matches('input, textarea, select')) return
  setTimeout(() => {
    if (document.activeElement === target) target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 300)
}

/** Bottom sheet; closes on backdrop tap and Escape. */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose(): void; children: ReactNode; actions?: ReactNode }): React.JSX.Element {
  const downOnBackdrop = useRef(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="sheet-backdrop"
      // The keyboard shifts the layout mid-tap; only a tap that starts and ends on the backdrop closes (and loses the edits).
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget && !document.activeElement?.matches('input, textarea, select')) onClose() }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="sheet-body" onFocus={revealFocused}>{children}</div>
      </section>
    </div>
  )
}

/** In-app confirmation; the platform's native confirm() is never used. */
export function Confirm({ title, text, confirmLabel, danger, onConfirm, onCancel }: {
  title: string
  text: string
  confirmLabel: string
  danger?: boolean
  onConfirm(): void
  onCancel(): void
}): React.JSX.Element {
  return (
    <div className="sheet-backdrop center" onClick={onCancel}>
      <section className="dialog" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? 'switch on' : 'switch'}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function Row({ label, hint, children, onClick }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; onClick?(): void }): React.JSX.Element {
  const body = (
    <>
      <span className="row-text">
        <span className="row-label">{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </span>
      {children && <span className="row-control">{children}</span>}
    </>
  )
  return onClick
    ? <button type="button" className="row clickable" onClick={onClick}>{body}</button>
    : <div className="row">{body}</div>
}

export function Group({ title, children }: { title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="group">
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group-card">{children}</div>
    </section>
  )
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(value: T): void; label: string }): React.JSX.Element {
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

/** Number field that commits on blur/Enter, clamped to its range. */
export function NumberField({ value, min, max, step = 1, onCommit, label }: { value: number; min: number; max: number; step?: number; onCommit(value: number): void; label: string }): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Number(text)
    if (!Number.isFinite(n)) { setText(String(value)); return }
    const clamped = Math.min(max, Math.max(min, step >= 1 ? Math.round(n) : Math.round(n * 100) / 100))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <input
      className="input number"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

/** Text field that commits on blur/Enter. */
export function TextField({ value, onCommit, label, placeholder, type = 'text', mono }: { value: string; onCommit(value: string): void; label: string; placeholder?: string; type?: string; mono?: boolean }): React.JSX.Element {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className={mono ? 'input mono' : 'input'}
      type={type}
      aria-label={label}
      placeholder={placeholder}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== value) onCommit(text) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useRemote((s) => s.toasts)
  const dismiss = useRemote((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>{t.text}</button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, text, children }: { icon?: ReactNode; title: string; text?: string; children?: ReactNode }): React.JSX.Element {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {text && <span>{text}</span>}
      {children}
    </div>
  )
}

export const timeAgo = (time: number): string => {
  const s = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} d ago`
}
