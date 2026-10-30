import { closeSync, openSync, readSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { StringDecoder } from 'string_decoder'
import { existsSync } from 'fs'
import { claudeConfigDirs } from './claudeAccount'

/** Resolve the originating command for display only. Never execute transcript content. */
export async function shellTaskDescription(file: string): Promise<string | undefined> {
  const session = dirname(dirname(file))
  // Ikinci bir Claude hesabiyla acilmis oturumun dokumu kendi config klasorundedir.
  const candidates = claudeConfigDirs().map((dir) => join(dir, 'projects', basename(dirname(session)), `${basename(session)}.jsonl`))
  const transcript = candidates.find((file) => existsSync(file)) ?? candidates[0]
  const id = basename(file, '.output')
  try {
    const calls = new Map<string, string>()
    for (const line of (await readFile(transcript, 'utf8')).split('\n')) {
      try {
        const entry = JSON.parse(line)
        const blocks = entry.message?.content
        if (!Array.isArray(blocks)) continue
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string') calls.set(block.id, block.input.command)
          if (block.type === 'tool_result' && entry.toolUseResult?.backgroundTaskId === id) {
            return calls.get(block.tool_use_id)
          }
        }
      } catch { /* partial transcript line */ }
    }
  } catch { /* transcript unavailable */ }
  return undefined
}

/** Read bytes rather than lines so progress without a newline is visible immediately. */
export function followShellTask(file: string, write: (text: string) => void, pollMs = 250): () => void {
  let pos = 0
  let decoder = new StringDecoder('utf8')
  let error = ''
  write(`Watching shell output: ${file}\r\nOutput appears as the command writes it. Buffered commands and pipes such as tail may delay output.\r\n\r\n`)
  const pump = (): void => {
    try {
      const size = statSync(file).size
      if (size < pos) { pos = 0; decoder = new StringDecoder('utf8'); write('\r\n[Output file reset]\r\n') }
      if (size === pos) return
      const fd = openSync(file, 'r')
      try {
        const buf = Buffer.alloc(Math.min(size - pos, 64 * 1024))
        const count = readSync(fd, buf, 0, buf.length, pos)
        pos += count
        write(decoder.write(buf.subarray(0, count)))
      } finally { closeSync(fd) }
      error = ''
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message !== error) write(`\r\n[Cannot read output: ${message}; retrying]\r\n`)
      error = message
    }
  }
  pump()
  if (pos === 0 && !error) write('[No output yet; waiting for the command to write.]\r\n')
  const timer = setInterval(pump, pollMs)
  return () => clearInterval(timer)
}
