import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { claudeTasksRoot, followCommand, listAgentTasks, listSubagents } from './agentTasks'

describe('listAgentTasks', () => {
  it('lists the session task outputs newest first and ignores other sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tasks-'))
    const dir = join(root, 'C--proj', 'sess-1', 'tasks')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(root, 'C--proj', 'sess-2', 'tasks'), { recursive: true })
    writeFileSync(join(dir, 'old.output'), 'a')
    writeFileSync(join(dir, 'new.output'), 'hello')
    writeFileSync(join(dir, 'note.txt'), 'x')
    writeFileSync(join(root, 'C--proj', 'sess-2', 'tasks', 'other.output'), 'x')
    utimesSync(join(dir, 'old.output'), new Date(1000), new Date(1000))
    const tasks = await listAgentTasks('sess-1', root)
    expect(tasks.map((t) => t.id)).toEqual(['new', 'old'])
    expect(tasks[0]).toMatchObject({ size: 5, path: join(dir, 'new.output') })
  })

  it('returns nothing when the folder is missing and rejects unsafe ids', async () => {
    expect(await listAgentTasks('sess-1', join(tmpdir(), 'no-such-root-xyz'))).toEqual([])
    await expect(listAgentTasks('../x', tmpdir())).rejects.toThrow()
  })

  it('honours CLAUDE_CODE_TMPDIR', () => {
    expect(claudeTasksRoot({ CLAUDE_CODE_TMPDIR: join('t') })).toBe(join('t', 'claude'))
  })
})

const follower = { exe: 'C:\\App\\TermFlow.exe', script: 'C:\\Data\\follow-transcript.cjs' }

describe('listSubagents', () => {
  it('lists the session transcripts newest first with a meta label and a follow command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'subs-'))
    const dir = join(root, 'C--proj', 'sess-1', 'subagents')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(root, 'C--proj', 'sess-2', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 'agent-old.jsonl'), '{}\n')
    writeFileSync(join(dir, 'agent-old.meta.json'), JSON.stringify({ agentType: 'Explore' }))
    writeFileSync(join(dir, 'agent-new.jsonl'), '{}\n{}\n')
    writeFileSync(join(dir, 'agent-new.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Find auth code' }))
    writeFileSync(join(dir, 'agent-bare.jsonl'), '{}\n')
    writeFileSync(join(root, 'C--proj', 'sess-2', 'subagents', 'agent-other.jsonl'), '{}\n')
    utimesSync(join(dir, 'agent-old.jsonl'), new Date(2000), new Date(2000))
    utimesSync(join(dir, 'agent-bare.jsonl'), new Date(1000), new Date(1000))
    const tasks = await listSubagents('sess-1', follower, root)
    expect(tasks.map((t) => [t.id, t.label])).toEqual([['agent-new', 'Find auth code'], ['agent-old', 'Explore'], ['agent-bare', 'agent-bare']])
    expect(tasks[0]).toMatchObject({ path: join(dir, 'agent-new.jsonl'), command: followCommand(follower, join(dir, 'agent-new.jsonl')) })
  })

  it('returns nothing when the folder is missing and rejects unsafe ids', async () => {
    expect(await listSubagents('sess-1', follower, join(tmpdir(), 'no-such-root-xyz'))).toEqual([])
    await expect(listSubagents('../x', follower, tmpdir())).rejects.toThrow()
  })
})

describe('followCommand', () => {
  it('bypasses PowerShell line buffering for shell output', () => {
    const command = followCommand(follower, "C:\\it's\\task.output", 'win32', true)
    expect(command).toContain('Start-Process -Wait -NoNewWindow')
    expect(command).toContain('"C:\\it\'\'s\\task.output" --shell')
    expect(command).not.toContain('| Out-Host')
  })
  it('waits for the GUI-subsystem exe on Windows and quotes every path', () => {
    expect(followCommand(follower, "C:\\Users\\it's\\a.jsonl", 'win32')).toBe(
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $env:ELECTRON_RUN_AS_NODE = '1'; & 'C:\\App\\TermFlow.exe' 'C:\\Data\\follow-transcript.cjs' 'C:\\Users\\it''s\\a.jsonl' | Out-Host"
    )
  })

  it('uses an env prefix and sh quoting elsewhere', () => {
    expect(followCommand({ exe: '/opt/App', script: '/d/f.cjs' }, "/h/it's/a.jsonl", 'linux')).toBe("ELECTRON_RUN_AS_NODE=1 '/opt/App' '/d/f.cjs' '/h/it'\\''s/a.jsonl'")
  })
})
