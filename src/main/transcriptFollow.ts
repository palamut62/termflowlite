import { closeSync, openSync, readSync, statSync } from 'fs'
import { StringDecoder } from 'string_decoder'

// Claude Code alt ajan dokumunu (JSONL) okunur satirlara cevirir. Electron'a bagimli degil:
// `out/mcp/follow-transcript.cjs` olarak paketlenir ve ELECTRON_RUN_AS_NODE=1 ile calisir.

const INITIAL_LINES = 200
const MAX_CHUNK = 1024 * 1024

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 3)}...` : t
}

function toolInput(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const v = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt
  return typeof v === 'string' ? v : JSON.stringify(input ?? {})
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : `[${b?.type}]`)).join(' ') : ''
}

/** Bir JSONL satiri = 0..n okunur satir (paralel arac cagrilari ayni satirda gelir). Dusunce ve ekler atlanir. */
export function formatTranscriptLine(line: string): string[] {
  let entry: { type?: string; timestamp?: string; message?: { content?: unknown } }
  try { entry = JSON.parse(line) } catch { return [] }
  const date = new Date(entry.timestamp ?? NaN)
  const time = Number.isNaN(date.getTime()) ? '--:--:--' : date.toTimeString().slice(0, 8)
  const role = entry.type === 'assistant' ? 'SAID' : 'USER'
  const content = entry.message?.content
  if (typeof content === 'string') return entry.type === 'user' ? [`${time} PROMPT ${clip(content, 300)}`] : []
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') out.push(`${time} ${role} ${clip(b.text, 300)}`)
    else if (b?.type === 'tool_use') out.push(`${time} CALL ${b.name} ${clip(toolInput(b.input), 160)}`)
    else if (b?.type === 'tool_result') out.push(`${time} ${b.is_error ? 'FAIL' : 'DONE'} ${clip(resultText(b.content), 160)}`)
  }
  return out
}

/** Dosyayi `tail -F` gibi izler: once son satirlari, sonra eklenenleri yazar. Durdurma fonksiyonu doner. */
export function followFile(file: string, write: (text: string) => void, pollMs = 500): () => void {
  let pos = 0
  let rest = ''
  const decoder = new StringDecoder('utf8')
  const pump = (emit: (lines: string[]) => void): void => {
    let size: number
    try { size = statSync(file).size } catch { return }
    if (size < pos) { pos = 0; rest = '' } // dosya bastan yazildi
    if (size === pos) return
    // Tek seferde en fazla MAX_CHUNK: uzun bir dokum tamamen belege alinmasin.
    // Kalani bir sonraki yoklamada okunur.
    const buf = Buffer.alloc(Math.min(size - pos, MAX_CHUNK))
    const fd = openSync(file, 'r')
    let count = 0
    try { count = readSync(fd, buf, 0, buf.length, pos) } finally { closeSync(fd) }
    if (count === 0) return
    pos += count
    const parts = (rest + decoder.write(buf.subarray(0, count))).split('\n')
    rest = parts.pop() ?? ''
    emit(parts.flatMap(formatTranscriptLine))
  }
  const send = (lines: string[]): void => { if (lines.length) write(`${lines.join('\n')}\n`) }
  // Ilk okuma dosyanin sonundan baslar; yarim kalan ilk satir JSON olmadigi icin elenir.
  try { pos = Math.max(0, statSync(file).size - MAX_CHUNK) } catch { /* dosya yoksa pump zaten cikar */ }
  pump((lines) => send(lines.slice(-INITIAL_LINES)))
  const timer = setInterval(() => pump(send), pollMs)
  return () => clearInterval(timer)
}
