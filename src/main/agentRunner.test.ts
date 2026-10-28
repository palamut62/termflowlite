import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { discardTask, finishRemoval, headlessCommand, isDelegateAgent, parseAgentOutput, taskBranch } from './agentRunner'

const WT = join('/repo', '.termflow-worktrees', 'app', 'deleg-x')

describe('headlessCommand', () => {
  it('builds the verified OpenCode command with an optional model', () => {
    expect(headlessCommand('opencode', 'fix it', WT, 'opencode/glm-5.3-flash-free')).toEqual({
      command: 'opencode',
      args: ['run', '--dir', WT, '-m', 'opencode/glm-5.3-flash-free', '--auto', '--format', 'json', 'fix it']
    })
    expect(headlessCommand('opencode', 'fix it', WT).args).toEqual(['run', '--dir', WT, '--auto', '--format', 'json', 'fix it'])
  })

  it('always names the worktree explicitly (OpenCode ignored the spawn cwd)', () => {
    const codex = headlessCommand('codex', 'x', WT).args
    expect(codex[codex.indexOf('-C') + 1]).toBe(WT)
    expect(codex[codex.indexOf('-o') + 1]).toBe(join(WT, '.termflow-last-message.txt'))
    const grok = headlessCommand('grok', 'x', WT).args
    expect(grok[grok.indexOf('--cwd') + 1]).toBe(WT)
  })

  it('builds Codex and Grok commands with full permissions for the throwaway worktree', () => {
    const codex = headlessCommand('codex', 'x', WT, 'gpt-5')
    expect(codex.args.slice(0, 4)).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json'])
    expect(codex.args).toContain('-o')
    expect(codex.args.slice(-3)).toEqual(['-m', 'gpt-5', 'x'])
    expect(headlessCommand('grok', 'x', WT).args).toEqual(['-p', 'x', '--always-approve', '--output-format', 'json', '--cwd', WT])
  })

  it('keeps a multi-line prompt with quotes as one argument', () => {
    const prompt = 'line "one"\nline \'two\' & | > %PATH%'
    expect(headlessCommand('opencode', prompt, WT).args.at(-1)).toBe(prompt)
  })

  it('never lets a prompt be parsed as a flag', () => {
    expect(headlessCommand('opencode', '--help', WT).args.at(-1)).toBe('Task: --help')
    expect(headlessCommand('grok', ' -rf', WT).args[1]).toBe('Task:  -rf')
  })

  it('builds the Claude print command (model optional, folder comes from cwd + PWD)', () => {
    expect(headlessCommand('claude', 'x', WT, 'haiku').args).toEqual(['-p', 'x', '--dangerously-skip-permissions', '--output-format', 'json', '--model', 'haiku'])
    expect(headlessCommand('claude', 'x', WT).args).not.toContain('--model')
  })

  it('ignores a blank model', () => {
    expect(headlessCommand('grok', 'x', WT, '  ').args).not.toContain('-m')
  })
})

describe('parseAgentOutput', () => {
  it('reads the last text, summed cost and tokens from OpenCode events', () => {
    const stdout = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"first"}}',
      '{"type":"step_finish","part":{"type":"step-finish","cost":0.01,"tokens":{"total":100}}}',
      'not json',
      '{"type":"text","part":{"type":"text","text":"tamam"}}',
      '{"type":"step_finish","part":{"type":"step-finish","cost":0.02,"tokens":{"total":50}}}'
    ].join('\n')
    const out = parseAgentOutput('opencode', stdout)
    expect(out.lastMessage).toBe('tamam')
    expect(out.cost).toBeCloseTo(0.03)
    expect(out.tokens).toBe(150)
    expect(out.error).toBeUndefined()
  })

  it('surfaces an OpenCode provider error (402 balance)', () => {
    const stdout = '{"type":"error","error":{"name":"APIError","data":{"message":"Insufficient Balance","statusCode":402}}}'
    expect(parseAgentOutput('opencode', stdout).error).toBe('Insufficient Balance')
  })

  it('takes the Codex message from the last-message file and reports failed turns', () => {
    expect(parseAgentOutput('codex', '{"type":"turn.completed"}', ' done \n').lastMessage).toBe('done')
    expect(parseAgentOutput('codex', '{"type":"turn.failed","error":{"message":"quota"}}').error).toBe('quota')
  })

  it('reads the Grok JSON object and treats a non end_turn stop as an error', () => {
    const ok = '{\n  "text": "ok",\n  "stopReason": "end_turn"\n}'
    expect(parseAgentOutput('grok', ok)).toEqual({ lastMessage: 'ok' })
    const cancelled = 'warning\n{\n  "text": "half",\n  "stopReason": "cancelled"\n}'
    expect(parseAgentOutput('grok', cancelled).error).toBe('Agent stopped: cancelled')
    expect(parseAgentOutput('grok', 'garbage').error).toBe('Unreadable agent output')
  })
})

describe('parseAgentOutput claude', () => {
  it('reads result, cost and tokens', () => {
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Tamam.', total_cost_usd: 0.04, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1 } })
    expect(parseAgentOutput('claude', stdout)).toEqual({ lastMessage: 'Tamam.', cost: 0.04, tokens: 116 })
  })

  it('reports an error result', () => {
    expect(parseAgentOutput('claude', JSON.stringify({ subtype: 'success', is_error: true, result: 'Credit balance is too low' })).error).toBe('Credit balance is too low')
    expect(parseAgentOutput('claude', JSON.stringify({ subtype: 'error_max_turns', is_error: false })).error).toBe('Agent stopped: error_max_turns')
    expect(parseAgentOutput('claude', '').error).toBe('Unreadable agent output')
  })
})

describe('discardTask', () => {
  const task = { worktreePath: WT, branch: 'deleg/x' }

  it('retries while Windows still holds the folder, then succeeds', async () => {
    const remove = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "error: failed to delete 'C:/wt': Permission denied" })
      .mockResolvedValueOnce({ ok: false, error: 'EBUSY: resource busy or locked' })
      .mockResolvedValueOnce({ ok: true })
    expect(await discardTask('/repo', task, { remove, delays: [0, 0, 0] })).toEqual({ ok: true })
    expect(remove).toHaveBeenCalledTimes(3)
    expect(remove).toHaveBeenCalledWith({ repoRoot: '/repo', path: WT, force: true, deleteBranch: true, branch: 'deleg/x' })
  })

  it('does not retry other errors and gives up after the last delay', async () => {
    const other = vi.fn().mockResolvedValue({ ok: false, error: 'Refusing to remove the main working tree.' })
    expect(await discardTask('/repo', task, { remove: other, delays: [0, 0] })).toMatchObject({ ok: false })
    expect(other).toHaveBeenCalledTimes(1)
    const locked = vi.fn().mockResolvedValue({ ok: false, error: 'Permission denied' })
    expect(await discardTask('/repo', task, { remove: locked, delays: [0, 0] })).toMatchObject({ ok: false, error: 'Permission denied' })
    expect(locked).toHaveBeenCalledTimes(3)
  })

  it('finishes by hand when the locked first try already dropped the git record', async () => {
    const remove = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Permission denied' })
      .mockResolvedValueOnce({ ok: false, error: `fatal: '${WT}' is not a working tree` })
    const finish = vi.fn(async () => ({ ok: true as const }))
    expect(await discardTask('/repo', task, { remove, finish, delays: [0, 0] })).toEqual({ ok: true })
    expect(finish).toHaveBeenCalledWith('/repo', WT, 'deleg/x')
    // Kilit olmadan gelen "not a working tree" elle silmeye yol acmaz.
    const plain = vi.fn().mockResolvedValue({ ok: false, error: 'is not a working tree' })
    const never = vi.fn()
    expect(await discardTask('/repo', task, { remove: plain, finish: never, delays: [0] })).toMatchObject({ ok: false })
    expect(never).not.toHaveBeenCalled()
  })

  it('finishRemoval only touches TermFlow task worktrees and deleg/ branches', async () => {
    expect(await finishRemoval('/repo', '/home/me/project', 'deleg/x')).toEqual({ ok: false, error: 'Not a delegated task worktree.' })
    expect(await finishRemoval('/repo', WT, 'main')).toEqual({ ok: false, error: 'Not a delegated task worktree.' })
  })

  it('has nothing to do without a worktree', async () => {
    const remove = vi.fn()
    expect(await discardTask('/repo', { branch: 'deleg/x' }, { remove })).toEqual({ ok: true })
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('names the task branch and validates agent ids', () => {
    expect(taskBranch('ab12')).toBe('deleg/ab12')
    expect(isDelegateAgent('opencode')).toBe(true)
    expect(isDelegateAgent('claude')).toBe(true)
    expect(isDelegateAgent('gemini')).toBe(true)
    expect(isDelegateAgent('aider')).toBe(false)
  })
})

describe('plain-text delegate agents', () => {
  it('builds full-permission headless commands with model and cwd', () => {
    expect(headlessCommand('agy', 'do it', '/w', 'm1')).toEqual({ command: 'agy', args: ['-p', 'do it', '--dangerously-skip-permissions', '--model', 'm1'] })
    expect(headlessCommand('gemini', 'do it', '/w').args).toEqual(['--approval-mode', 'yolo', '-p', 'do it'])
    expect(headlessCommand('droid', 'do it', '/w', 'x').args).toEqual(['exec', '--auto', 'high', '--cwd', '/w', '-m', 'x', 'do it'])
  })

  it('uses cleaned stdout as the last message', () => {
    expect(parseAgentOutput('qwen', '\u001b[32mDone\u001b[0m\n').lastMessage).toBe('Done')
  })
})
