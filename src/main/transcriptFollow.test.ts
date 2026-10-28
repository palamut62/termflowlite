import { appendFileSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { followFile, formatTranscriptLine } from './transcriptFollow'

const line = (type: string, content: unknown): string => JSON.stringify({ type, timestamp: '2026-10-05T08:09:10.000Z', message: { content } })
const TIME = /^\d\d:\d\d:\d\d /

describe('formatTranscriptLine', () => {
  it('prints the prompt, assistant text, tool calls and results one line each', () => {
    const lines = [
      ...formatTranscriptLine(line('user', 'Fix   the\nbug')),
      ...formatTranscriptLine(line('assistant', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking now' }])),
      ...formatTranscriptLine(line('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }, { type: 'tool_use', name: 'Grep', input: { foo: 1 } }])),
      ...formatTranscriptLine(line('user', [{ type: 'tool_result', content: 'a\nb' }, { type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'boom' }, { type: 'image' }] }]))
    ]
    expect(lines.every((l) => TIME.test(l))).toBe(true)
    expect(lines.map((l) => l.replace(TIME, ''))).toEqual([
      'PROMPT Fix the bug', 'SAID Looking now', 'CALL Bash ls -la', 'CALL Grep {"foo":1}', 'DONE a b', 'FAIL boom [image]'
    ])
  })

  it('clips long text and skips attachments, invalid lines and a missing timestamp', () => {
    const long = formatTranscriptLine(line('assistant', [{ type: 'text', text: 'x'.repeat(500) }]))[0]
    expect(long).toHaveLength('00:00:00 SAID '.length + 300)
    expect(long.endsWith('...')).toBe(true)
    expect(formatTranscriptLine(JSON.stringify({ type: 'attachment', attachment: {} }))).toEqual([])
    expect(formatTranscriptLine('{not json')).toEqual([])
    expect(formatTranscriptLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }))).toEqual(['--:--:-- SAID hi'])
  })
})

describe('followFile', () => {
  it('prints the last lines first, then only what is appended, holding back a partial line', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'follow-')), 'a.jsonl')
    const entry = (n: number): string => line('assistant', [{ type: 'text', text: `m${n}` }])
    writeFileSync(file, Array.from({ length: 250 }, (_, i) => entry(i)).join('\n') + '\n')
    const out: string[] = []
    const stop = followFile(file, (t) => out.push(t), 20)
    try {
      expect(out.join('').trim().split('\n')).toHaveLength(200)
      expect(out.join('')).toContain('SAID m249')
      expect(out.join('')).not.toContain('SAID m49\n')
      const half = entry(250)
      appendFileSync(file, half.slice(0, 20))
      await new Promise((r) => setTimeout(r, 80))
      expect(out.join('')).not.toContain('m250')
      appendFileSync(file, half.slice(20) + '\n')
      await new Promise((r) => setTimeout(r, 80))
      expect(out.join('')).toContain('SAID m250')
    } finally { stop() }
  })
})
