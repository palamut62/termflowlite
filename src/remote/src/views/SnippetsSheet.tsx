import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Sheet } from '../ui'

const SNIPPETS_KEY = 'termflow.remote.snippets'
const DEFAULT_SNIPPETS = ['continue', 'Run the tests and fix any failures.', 'Commit the changes with a short message.', '/review']

export function loadSnippets(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SNIPPETS_KEY) ?? 'null') as unknown
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string') : DEFAULT_SNIPPETS
  } catch {
    return DEFAULT_SNIPPETS
  }
}

function saveSnippets(list: string[]): void {
  try {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list))
  } catch {
    /* private mode: kept until the page closes */
  }
}

/** Saved prompts kept on this phone; a tap sends one to the current tab with Enter. */
export function SnippetsSheet({ target, onSend, onClose }: { target: string; onSend(text: string): void; onClose(): void }): React.JSX.Element {
  const [list, setList] = useState(loadSnippets)
  const [draft, setDraft] = useState('')
  const update = (next: string[]): void => {
    setList(next)
    saveSnippets(next)
  }
  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    update([...list.filter((s) => s !== text), text])
    setDraft('')
  }

  return (
    <Sheet title="Quick prompts" onClose={onClose}>
      <p className="sheet-note">Tap to send to "{target}" with Enter.</p>
      <div className="menu-list">
        {list.map((text) => (
          <div key={text} className="snippet-row">
            <button className="menu-item snippet-text" onClick={() => onSend(text)}>{text}</button>
            <button className="icon-btn" onClick={() => update(list.filter((s) => s !== text))} aria-label={`Delete "${text}"`}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <form className="snippet-add" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input className="input" value={draft} placeholder="New prompt" onChange={(e) => setDraft(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        <button className="btn" type="submit" disabled={!draft.trim()} aria-label="Add prompt"><Plus size={16} /></button>
      </form>
    </Sheet>
  )
}
