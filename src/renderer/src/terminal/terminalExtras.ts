import type { AgentKind } from '../../../shared/types'

/** terminal-polish (docs/orca-parity/terminal-polish.md) saf yardimcilari. */

const MAX_OSC52_BASE64 = Math.ceil((1024 * 1024 * 4) / 3)

/**
 * OSC 52 pano yazma: `<secici>;<base64>`. Okuma istegi (`?`) her zaman reddedilir:
 * bir uzak program panoyu sessizce okuyamamali.
 */
export function parseOsc52(payload: string): string | null {
  const split = payload.indexOf(';')
  if (split < 0) return null
  const selector = payload.slice(0, split)
  const data = payload.slice(split + 1)
  if (!/^[cpqs0-7]*$/.test(selector) || data === '?' || data.length > MAX_OSC52_BASE64) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null
  try {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

/** Satirdaki web adresi (1 tabanli sutun imlecin altindaysa). */
export function urlAt(line: string, col: number): string | null {
  for (const match of line.matchAll(/https?:\/\/[^\s"'<>`]+/g)) {
    const start = (match.index ?? 0) + 1
    const url = match[0].replace(/[.,;:!?)\]}]+$/, '')
    if (col >= start && col < start + url.length) return url
  }
  return null
}

/**
 * Ajan giris kutusunda Shift+Enter ile yeni satir. Claude Code Meta+Enter'i (ESC CR)
 * yeni satir sayar (2.1.289'da denendi); Codex ve OpenCode Ctrl+J (LF) kullanir.
 * shortcut: katalogdaki diger ajanlar icin LF varsayiliyor (yaygin TUI davranisi,
 * tek tek denenmedi); birinde Enter gibi davranirsa buraya istisna eklenir.
 */
export function shiftEnterSequence(agent: string | null): string | null {
  if (!agent) return null
  return agent === 'claude' ? '\x1b\r' : '\n'
}
