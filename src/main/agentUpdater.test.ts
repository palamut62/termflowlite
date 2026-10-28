import { describe, expect, it } from 'vitest'
import { AgentUpdater, type NpmRunner } from './agentUpdater'
import { isNewerVersion } from '../shared/agentUpdate'

describe('isNewerVersion', () => {
  it('compares numerically and ignores unparsable versions', () => {
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false)
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', 'latest')).toBe(false)
  })
})

describe('AgentUpdater', () => {
  it('updates only outdated global npm agents and reports failures', async () => {
    const calls: string[][] = []
    const npm: NpmRunner = async (args) => {
      calls.push(args)
      if (args[0] === 'ls') return JSON.stringify({ dependencies: { '@openai/codex': { version: '0.1.0' }, 'opencode-ai': { version: '2.0.0' }, '@google/gemini-cli': { version: '1.0.0' } } })
      if (args[0] === 'view') return args[1] === '@openai/codex' ? '0.2.0\n' : args[1] === 'opencode-ai' ? '2.0.0\n' : '1.1.0\n'
      if (args[1] === '-g' && args[2]?.startsWith('@google/gemini-cli')) throw new Error('EBUSY: locked')
      return ''
    }
    const result = await new AgentUpdater(() => undefined, npm, () => 42).run()
    const by = Object.fromEntries(result.items.map((i) => [i.id, i]))
    expect(by.codex).toMatchObject({ state: 'updated', version: '0.2.0' })
    expect(by.opencode).toMatchObject({ state: 'current' })
    expect(by.gemini).toMatchObject({ state: 'failed', version: '1.0.0', error: 'EBUSY: locked' })
    expect(by.claude).toBeUndefined()
    expect(calls.filter((c) => c[0] === 'install').map((c) => c[2])).toEqual(['@openai/codex@0.2.0', '@google/gemini-cli@1.1.0'])
    expect(result.running).toBe(false)
    expect(result.lastRunAt).toBe(42)
  })

  it('records the time and error when the whole run fails', async () => {
    const npm: NpmRunner = async () => { throw new Error('npm bulunamadi.') }
    const result = await new AgentUpdater(() => undefined, npm, () => 7).run()
    expect(result).toMatchObject({ lastRunAt: 7, lastError: expect.any(String) })
  })
})
