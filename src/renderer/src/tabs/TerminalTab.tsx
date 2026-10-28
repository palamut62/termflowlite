import { useEffect, useRef, useState } from 'react'
import { Layers, X } from 'lucide-react'
import type { TerminalTab as TerminalTabModel } from '../../../shared/types'
import { TabIcon } from './TabIcon'
import { ATTENTION_LABELS } from '../attention/AttentionBell'
import { activeTasks, openTaskTab, useAgentTasks } from './agentTasks'

interface TerminalTabProps {
  tab: TerminalTabModel
  active: boolean
  onSelect: () => void
  onClose: () => void
  onRename: (title: string) => void
  /** Drag & drop reorder (PRD §14). */
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOverTab: (targetId: string, before: boolean) => void
  /** Insertion indicator: null | 'before' | 'after' (hedef tab'a göre). */
  dropPos: 'before' | 'after' | null
  /** Agent IDE sekme menusu. */
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
}

const MAX_TITLE_LENGTH = 60

/**
 * Single tab: icon + title + close button (hover-visible; always faint when
 * active). Double-click the title to rename inline (PRD §14); draggable for
 * native HTML5 drag & drop reordering.
 */
export function TerminalTab({
  tab,
  active,
  onSelect,
  onClose,
  onRename,
  onDragStart,
  onDragEnd,
  onDragOverTab,
  dropPos,
  onContextMenu
}: TerminalTabProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tab.title)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const live = activeTasks(useAgentTasks(tab.agentHook?.sessionId), Date.now())

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = (): void => {
    if (editing) return
    setDraft(tab.title)
    setEditing(true)
  }

  // Sekme menusundeki "Rename" bu sekmeyi duzenlemeye acar.
  useEffect(() => {
    const onRename = (event: Event): void => { if ((event as CustomEvent<string>).detail === tab.id) startEdit() }
    window.addEventListener('termflow:rename-tab', onRename)
    return () => window.removeEventListener('termflow:rename-tab', onRename)
  })

  const commit = (): void => {
    setEditing(false)
    const value = draft.trim().slice(0, MAX_TITLE_LENGTH)
    if (value && value !== tab.title) onRename(value)
  }

  const cancel = (): void => {
    setEditing(false)
    setDraft(tab.title)
  }

  const dragPosClass = dropPos === 'before' ? ' tab-drop-before' : dropPos === 'after' ? ' tab-drop-after' : ''

  return (
    <div
      data-tab-id={tab.id}
      className={`tab${active ? ' tab-active' : ''}${dragging ? ' tab-dragging' : ''}${dragPosClass}${tab.color ? ' tab-colored' : ''}`}
      style={tab.color ? { '--tab-color': tab.color } as React.CSSProperties : undefined}
      draggable={!editing}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onAuxClick={(e) => {
        // Middle click closes the tab (PRD §14).
        if (e.button === 1) {
          e.preventDefault()
          onClose()
        }
      }}
      onDoubleClick={startEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', tab.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(true)
        onDragStart(tab.id)
      }}
      onDragEnd={() => {
        setDragging(false)
        onDragEnd()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        onDragOverTab(tab.id, e.clientX < rect.left + rect.width / 2)
      }}
      title={editing ? undefined : tab.title}
    >
      <TabIcon shellId={tab.profileId} />
      {editing ? (
        <input
          ref={inputRef}
          className="tab-edit-input"
          value={draft}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') cancel()
          }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{ width: `${Math.max(draft.length, 4)}ch` }}
        />
      ) : (
        <span className="tab-title">{tab.title}</span>
      )}
      {tab.lastCommand && (
        <span
          key={tab.lastCommand.finishedAt}
          className={`tab-result-flash ${tab.lastCommand.exitCode === 0 ? 'tab-result-ok' : 'tab-result-fail'}`}
          aria-hidden="true"
        />
      )}
      {live.length > 0 && (
        <button
          className="tab-tasks"
          onClick={(e) => { e.stopPropagation(); for (const task of live) openTaskTab(task, tab.cwd || tab.launchCwd) }}
          onDoubleClick={(e) => e.stopPropagation()}
          title={`${live.length} background task${live.length === 1 ? '' : 's'} or subagent${live.length === 1 ? '' : 's'} with recent output - click to watch each in its own tab`}
          aria-label={`Watch ${live.length} background task${live.length === 1 ? '' : 's'} or subagent${live.length === 1 ? '' : 's'}`}
        >
          <Layers size={10} aria-hidden="true" />{live.length}
        </button>
      )}
      {tab.attention && <span className={`tab-attention tab-attention-${tab.attention}`} role="status" aria-label={ATTENTION_LABELS[tab.attention]} title={ATTENTION_LABELS[tab.attention]} />}
      <span className={`tab-process-indicator tab-activity-${tab.activity}`} aria-label={`Activity: ${tab.activity}`} title={`Activity: ${tab.activity}`} />
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        title="Close tab"
        aria-label={`Close ${tab.title}`}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  )
}
