import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPin, grantElevation, hashPin, resetElevationBridge, runElevatedHost, spawnElevated, type ElevatedSpawn, type HostDeps } from './elevation'

const SPAWN: ElevatedSpawn = { file: 'pwsh.exe', args: [], cwd: 'C:\\', env: {}, cols: 80, rows: 24 }

afterEach(() => resetElevationBridge())

describe('PIN check', () => {
  it('accepts the right PIN and resets the fail counter', () => {
    const record = { ...hashPin('123456'), fails: 3 }
    const result = checkPin(record, '123456')
    expect(result.ok).toBe(true)
    expect(result.record.fails).toBe(0)
  })

  it('locks for 15 minutes after five wrong PINs, even for the right one', () => {
    let record = hashPin('123456')
    for (let i = 0; i < 4; i++) {
      const result = checkPin(record, '000000', 1000)
      expect(result).toMatchObject({ ok: false, error: 'Wrong PIN.' })
      record = result.record
    }
    const locked = checkPin(record, '000000', 1000)
    expect(locked.error).toMatch(/Too many/)
    expect(checkPin(locked.record, '123456', 2000).ok).toBe(false)
    expect(checkPin(locked.record, '123456', 1000 + 15 * 60_000 + 1).ok).toBe(true)
  })

  it('rejects malformed PINs without comparing', () => {
    expect(checkPin(hashPin('123456'), '12345').ok).toBe(false)
    expect(() => grantElevation('abc')).toThrow(/6 to 12 digits/)
  })
})

describe('elevated bridge', () => {
  function host(pin: string) {
    const path = process.platform === 'win32' ? `\\\\.\\pipe\\termflow-test-${randomBytes(6).toString('hex')}` : join(tmpdir(), `tf-${randomBytes(6).toString('hex')}.sock`)
    const recordFile = join(mkdtempSync(join(tmpdir(), 'tf-elev-')), 'elevation.json')
    writeFileSync(recordFile, JSON.stringify(hashPin(pin)))
    const written: string[] = []
    const spawned: ElevatedSpawn[] = []
    let emitData: (d: string) => void = () => undefined
    let emitExit: (e: { exitCode: number }) => void = () => undefined
    const deps: HostDeps = {
      path,
      recordFile,
      spawn: (request) => {
        spawned.push(request)
        return {
          pid: 4242,
          onData: (l: (d: string) => void) => { emitData = l; return { dispose: () => undefined } },
          onExit: (l: (e: { exitCode: number }) => void) => { emitExit = l; return { dispose: () => undefined } },
          write: (d: string) => { written.push(d) },
          resize: () => undefined,
          kill: () => undefined
        } as never
      }
    }
    const startTask = async (): Promise<{ code: number; output: string }> => {
      void runElevatedHost(deps)
      return { code: 0, output: '' }
    }
    return { path, recordFile, written, spawned, startTask, data: (d: string) => emitData(d), exit: (code: number) => emitExit({ exitCode: code }) }
  }

  const until = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10))
    expect(check()).toBe(true)
  }

  it('needs a phone grant first', () => {
    const h = host('123456')
    expect(() => spawnElevated(SPAWN, { path: h.path, startTask: h.startTask })).toThrow(/approval from your phone/)
  })

  it('relays output, queued input and exit through the elevated host', async () => {
    const h = host('123456')
    grantElevation('123456')
    const proc = spawnElevated(SPAWN, { path: h.path, startTask: h.startTask })
    const output: string[] = []
    let exitCode: number | null = null
    proc.onData((d) => output.push(d))
    proc.onExit(({ exitCode: code }) => { exitCode = code })
    proc.write('whoami\r') // before the host is ready: queued
    await until(() => h.written.length === 1)
    expect(h.spawned[0]).toMatchObject({ file: 'pwsh.exe', cols: 80, rows: 24 })
    expect(h.written).toEqual(['whoami\r'])
    expect(proc.pid).toBe(4242)
    h.data('nt authority\r\n')
    await until(() => output.length === 1)
    expect(output).toEqual(['nt authority\r\n'])
    h.exit(0)
    await until(() => exitCode !== null)
    expect(exitCode).toBe(0)
  })

  it('prints a wrong PIN into the tab, exits and counts the failure', async () => {
    const h = host('123456')
    grantElevation('654321')
    const proc = spawnElevated(SPAWN, { path: h.path, startTask: h.startTask })
    const output: string[] = []
    let exitCode: number | null = null
    proc.onData((d) => output.push(d))
    proc.onExit(({ exitCode: code }) => { exitCode = code })
    await until(() => exitCode !== null)
    expect(output.join('')).toContain('Wrong PIN.')
    expect(h.spawned).toEqual([])
    expect(JSON.parse(readFileSync(h.recordFile, 'utf8')).fails).toBe(1)
  })

  it('fails the tab when the task is not installed', async () => {
    const h = host('123456')
    grantElevation('123456')
    const proc = spawnElevated(SPAWN, { path: h.path, startTask: async () => ({ code: 1, output: '' }) })
    const output: string[] = []
    proc.onData((d) => output.push(d))
    await until(() => output.length > 0)
    expect(output.join('')).toMatch(/not set up/)
  })
})
