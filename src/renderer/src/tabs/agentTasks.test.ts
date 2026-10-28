import { describe, expect, it } from 'vitest'
import { ACTIVE_TASK_MS, activeTasks, watchTaskCommand } from './agentTasks'

const task = (id: string, mtimeMs: number) => ({ id, path: `/t/${id}.output`, size: 1, mtimeMs })

describe('agent tasks', () => {
  it('counts only tasks written recently as active', () => {
    const now = 10 * ACTIVE_TASK_MS
    expect(activeTasks([task('a', now - 1000), task('b', now - ACTIVE_TASK_MS - 1)], now).map((t) => t.id)).toEqual(['a'])
  })

  it('builds a quoted live-follow command per platform', () => {
    expect(watchTaskCommand("C:\Temp\it's\b1.output", 'win32')).toContain("-LiteralPath 'C:\Temp\it''s\b1.output' -Encoding UTF8 -Tail 1000 -Wait")
    expect(watchTaskCommand("/tmp/it's/b1.output", 'linux')).toBe("tail -n 1000 -F '/tmp/it'\\''s/b1.output'")
  })
})
