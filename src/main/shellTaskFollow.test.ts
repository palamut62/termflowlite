import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it, vi } from 'vitest'
import { followShellTask } from './shellTaskFollow'

it('explains empty output and streams partial lines and split UTF-8 bytes', () => {
  vi.useFakeTimers()
  const dir = mkdtempSync(join(tmpdir(), 'shell-follow-'))
  const file = join(dir, 'task.output')
  writeFileSync(file, '')
  let output = ''
  const stop = followShellTask(file, text => { output += text })
  try {
    expect(output).toContain('No output yet')
    output = ''
    appendFileSync(file, 'progress 10%')
    vi.advanceTimersByTime(250)
    expect(output).toBe('progress 10%')
    const bytes = Buffer.from('ş')
    appendFileSync(file, bytes.subarray(0, 1))
    vi.advanceTimersByTime(250)
    expect(output).toBe('progress 10%')
    appendFileSync(file, bytes.subarray(1))
    vi.advanceTimersByTime(250)
    expect(output).toBe('progress 10%ş')
    writeFileSync(file, 'new')
    vi.advanceTimersByTime(250)
    expect(output).toContain('[Output file reset]\r\nnew')
  } finally {
    stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  }
})
