import { describe, expect, it } from 'vitest'
import { pickDrawnCaret, planSelectionEdit, type CellGrid, type InverseGrid } from './selectionEdit'

/** Satırları düz metin olarak alan sahte ızgara; '~' geniş karakter devam hücresi. */
function grid(rows: string[], cols: number, wrapped: number[] = []): CellGrid {
  return {
    cols,
    width: (row, col) => (rows[row]?.[col] === '~' ? 0 : 1),
    chars: (row, col) => rows[row]?.[col] ?? '',
    isWrapped: (row) => wrapped.includes(row)
  }
}

describe('planSelectionEdit', () => {
  // "PS> git commit -m fix" ; imleç satır sonunda (x=21)
  const line = grid(['PS> git commit -m fix'], 80)

  it('moves left to the selection end and deletes the word', () => {
    // "commit" = x 8..14
    expect(planSelectionEdit(line, { x: 8, y: 0 }, { x: 14, y: 0 }, { x: 21, y: 0 })).toEqual({ moves: -7, deletes: 6 })
  })

  it('moves right when the cursor is before the selection', () => {
    expect(planSelectionEdit(line, { x: 8, y: 0 }, { x: 14, y: 0 }, { x: 4, y: 0 })).toEqual({ moves: 10, deletes: 6 })
  })

  it('needs no move when the cursor already sits at the selection end', () => {
    expect(planSelectionEdit(line, { x: 18, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 0 })).toEqual({ moves: 0, deletes: 3 })
  })

  it('ignores selections on another, unwrapped line', () => {
    const g = grid(['old output', 'PS> echo hi'], 80)
    expect(planSelectionEdit(g, { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 11, y: 1 })).toBeNull()
  })

  it('follows soft-wrapped continuation rows', () => {
    const g = grid(['PS> echo aaaa', 'bbbb cc'], 13, [1])
    // "bbbb" satır 1, x 0..4; imleç satır 1 sonunda (x=7)
    expect(planSelectionEdit(g, { x: 0, y: 1 }, { x: 4, y: 1 }, { x: 7, y: 1 })).toEqual({ moves: -3, deletes: 4 })
    // satır 0'daki "echo", imleç satır 1'de
    expect(planSelectionEdit(g, { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 7, y: 1 })).toEqual({ moves: -12, deletes: 4 })
  })

  it('counts wide characters once', () => {
    const g = grid(['> 日~本~ ok'], 80)
    expect(planSelectionEdit(g, { x: 2, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 })).toEqual({ moves: -3, deletes: 2 })
  })

  it('clips a selection that runs past the typed text', () => {
    expect(planSelectionEdit(line, { x: 18, y: 0 }, { x: 30, y: 0 }, { x: 21, y: 0 })).toEqual({ moves: 0, deletes: 3 })
  })

  it('clears the whole input when the whole line is selected (triple-click)', () => {
    // Prompt de seçime girer; fazladan backspace inputun başında etkisizdir.
    expect(planSelectionEdit(line, { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 21, y: 0 })).toEqual({ moves: 0, deletes: 21 })
  })

  it('clips Select All to the line the cursor is on', () => {
    const g = grid(['old output', 'PS> echo hi', ''], 80)
    expect(planSelectionEdit(g, { x: 0, y: 0 }, { x: 80, y: 2 }, { x: 11, y: 1 })).toEqual({ moves: 0, deletes: 11 })
  })

  it('works from a caret drawn by a TUI (Claude Code) with trailing blank cells', () => {
    // "❯ alpha bravo charlie" + inverse boşluk caret (x=21)
    const g = grid(['❯ alpha bravo charlie ', '', '──────'], 40)
    expect(planSelectionEdit(g, { x: 8, y: 0 }, { x: 13, y: 0 }, { x: 21, y: 0 })).toEqual({ moves: -8, deletes: 5 })
    expect(planSelectionEdit(g, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 21, y: 0 })).toEqual({ moves: 0, deletes: 21 })
  })

  it('refuses empty selections', () => {
    expect(planSelectionEdit(line, { x: 8, y: 0 }, { x: 8, y: 0 }, { x: 21, y: 0 })).toBeNull()
  })
})

/**
 * Sahte inverse ızgarası: '#' caret hücresi, '~' geniş karakterin devamı,
 * başka her karakter normal.
 */
function inv(rows: string[], cols: number): InverseGrid {
  return {
    cols,
    isInverse: (row, col) => rows[row]?.[col] === '#' || rows[row]?.[col] === '~',
    width: (row, col) => (rows[row]?.[col] === '~' ? 0 : 1)
  }
}

describe('pickDrawnCaret', () => {
  it('finds a lone caret on the selection row', () => {
    const g = inv(['> alpha bravo charlie #'], 40)
    expect(pickDrawnCaret(g, 0, 2, { x: 13, y: 0 })).toEqual({ x: 22, y: 0 })
  })

  it('finds a caret parked on another row of a multi-line prompt box', () => {
    const g = inv(['> alpha bravo charlie', '  #'], 40)
    expect(pickDrawnCaret(g, 0, 2, { x: 13, y: 0 })).toEqual({ x: 2, y: 1 })
  })

  it('ignores inverse runs longer than one character (status bar, highlighted row)', () => {
    // İki hücrelik etiket seçime caret'ten DAHA yakın: filtre olmazsa o seçilirdi.
    const g = inv(['> alpha bravo## charlie #'], 40)
    expect(pickDrawnCaret(g, 0, 2, { x: 13, y: 0 })).toEqual({ x: 24, y: 0 })
  })

  it('accepts a wide-character caret (two cells, continuation width 0)', () => {
    const g = inv(['> alpha bravo #~'], 40)
    expect(pickDrawnCaret(g, 0, 2, { x: 13, y: 0 })).toEqual({ x: 14, y: 0 })
  })

  it('picks the candidate nearest to the selection end', () => {
    const g = inv(['#', '> alpha bravo charlie #', '#'], 40)
    expect(pickDrawnCaret(g, 0, 2, { x: 13, y: 1 })).toEqual({ x: 22, y: 1 })
  })

  it('returns null when the screen holds no single-cell inverse run', () => {
    const g = inv(['> alpha bravo charlie', ' ### '], 40)
    expect(pickDrawnCaret(g, 0, 2, { x: 13, y: 0 })).toBeNull()
  })
})
