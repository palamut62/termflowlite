import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ScmDiff } from '../../../shared/ipc'
import { parseUnifiedDiff } from '../../../renderer/src/shells/ide/review/diffModel'
import { client, errorText } from '../store'
import { Empty, Sheet } from '../ui'

/** Uncommitted changes of a folder (desktop `scm:diff`), read-only: review an agent's work from the phone. */
export function ChangesSheet({ folder, onClose }: { folder: string; onClose(): void }): React.JSX.Element {
  const [diff, setDiff] = useState<ScmDiff | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    client().ipc<ScmDiff>('scm:diff', folder, '')
      .then(setDiff)
      .catch((error) => setDiff({ text: '', error: errorText(error) }))
  }, [folder])

  const files = useMemo(() => (diff?.text ? parseUnifiedDiff(diff.text) : []), [diff])
  const toggle = (path: string): void => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  return (
    <Sheet title="Changes" onClose={onClose}>
      {!diff && <p className="sheet-note">Loading...</p>}
      {diff?.error && <p className="sheet-note">{diff.error}</p>}
      {diff && !diff.error && files.length === 0 && <Empty title="No uncommitted changes" />}
      {diff?.truncated && <p className="sheet-note">The diff is large; only the first part is shown.</p>}
      <div className="diff-files">
        {files.map((file) => {
          const expanded = open.has(file.path)
          return (
            <div key={file.path} className="diff-file">
              <button className="diff-file-head" onClick={() => toggle(file.path)} aria-expanded={expanded}>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="diff-path mono">{file.path || file.oldPath}</span>
                <span className="diff-count add">+{file.additions}</span>
                <span className="diff-count del">-{file.deletions}</span>
              </button>
              {expanded && (
                <pre className="diff-body mono">
                  {file.binary && <span className="diff-line hunk">Binary file</span>}
                  {file.hunks.map((hunk, h) => (
                    <span key={h}>
                      <span className="diff-line hunk">{hunk.header}</span>
                      {hunk.lines.map((line, i) => (
                        <span key={i} className={`diff-line ${line.kind}`}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}{line.text}</span>
                      ))}
                    </span>
                  ))}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}
