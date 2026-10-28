import { useTerminalStore } from '../store/terminalStore'
import { TerminalView } from '../terminal/TerminalView'
import { PaneLeaf } from '../terminal/PaneLeaf'
import { paneTerminalIds, type PaneNode } from '../paneUtils'

/**
 * Sekmelerin terminalleri + split agaci. Terminal ve Agent IDE kabuklari ayni bileseni kullanir.
 * Tüm tab'lar mount kalır (mount = PTY create); aktif olmayanlar CSS ile
 * gizlenir ama layout boyutunu korur, böylece arka plandaki process
 * ölmez ve gizli terminal doğru cols/rows'a fit olmaya devam eder.
 * Split düzeninde ağaç dışı sekmeler de gizli mount edilir — aksi halde
 * PTY'leri hiç spawn edilmezdi (zamanlanmış komutlar sessizce
 * hiç çalışmıyordu).
 */
export function TerminalArea(): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const splitRatio = useTerminalStore((s) => s.splitRatio)
  const paneTree = useTerminalStore((s) => s.paneTree)
  // Split düzeninde ağaç dışı (arka plan) sekmeleri: gizli TerminalView olarak
  // mount edilirler (PTY yaşar); setActiveTab onları aktif yaprağa getirir.
  const paneTabIds = paneTree ? new Set(paneTerminalIds(paneTree)) : null
  const backgroundTabs = paneTabIds ? tabs.filter((tab) => !paneTabIds.has(tab.id)) : []
  return (
    <div className="terminal-area" style={{ '--split-percent': `${splitRatio * 100}%` } as React.CSSProperties}>
      {paneTree ? (
        <>
          <PaneRenderer pane={paneTree} path={[]} activeTabId={activeTabId} />
          {backgroundTabs.map((tab) => <TerminalView key={tab.id} tabId={tab.id} active={false} visible={false} />)}
        </>
      ) : tabs.map((tab) => <TerminalView key={tab.id} tabId={tab.id} active={tab.id === activeTabId} />)}
    </div>
  )
}

function PaneRenderer({ pane, path, activeTabId }: { pane: PaneNode; path: number[]; activeTabId: string | null }): React.JSX.Element {
  if (pane.type === 'leaf') {
    return <PaneLeaf terminalId={pane.terminalId} active={pane.terminalId === activeTabId} />
  }
  const basis = (ratio: number): React.CSSProperties => ({ flex: `${ratio} 1 0`, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' })
  return <div className={`pane-tree-split pane-tree-${pane.dir}`}>
    <div style={basis(pane.ratio)}><PaneRenderer pane={pane.a} path={[...path, 0]} activeTabId={activeTabId} /></div>
    <PaneDivider direction={pane.dir} path={path} ratio={pane.ratio} />
    <div style={basis(1 - pane.ratio)}><PaneRenderer pane={pane.b} path={[...path, 1]} activeTabId={activeTabId} /></div>
  </div>
}

function PaneDivider({ direction, path, ratio }: { direction: 'vertical' | 'horizontal'; path: number[]; ratio: number }): React.JSX.Element {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const divider = event.currentTarget
    const container = divider.parentElement
    if (!container) return
    divider.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      const rect = container.getBoundingClientRect()
      const ratio = direction === 'vertical'
        ? (move.clientX - rect.left) / rect.width
        : (move.clientY - rect.top) / rect.height
      useTerminalStore.getState().setPaneRatio(path, ratio)
    }
    const onUp = (up: PointerEvent): void => {
      try { divider.releasePointerCapture(up.pointerId) } catch { /* already released */ }
      divider.removeEventListener('pointermove', onMove)
      divider.removeEventListener('pointerup', onUp)
    }
    divider.addEventListener('pointermove', onMove)
    divider.addEventListener('pointerup', onUp)
  }
  return <div className={`pane-tree-divider pane-tree-divider-${direction}`} onPointerDown={onPointerDown} role="separator" aria-label="Resize split terminals" aria-valuenow={Math.round(ratio * 100)} />
}
