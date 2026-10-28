import { mkdtemp, mkdir, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createProjectFolder, validateProjectName } from './projectCreate'

describe('validateProjectName', () => {
  it('accepts normal names', () => expect(validateProjectName('my-app')).toBeNull())
  it.each(['', '..', 'a/b', 'a\b', 'CON', 'nul.txt', 'x.', 'a:b'])('rejects %j', (n) => expect(validateProjectName(n)).not.toBeNull())
})

describe('createProjectFolder', () => {
  it('creates, reuses empty, refuses non-empty', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'tfp-'))
    const first = await createProjectFolder(parent, 'app')
    expect(first).toEqual({ ok: true, path: join(parent, 'app') })
    expect((await stat(join(parent, 'app'))).isDirectory()).toBe(true)
    expect((await createProjectFolder(parent, 'app')).ok).toBe(true)
    await mkdir(join(parent, 'full')); await writeFile(join(parent, 'full', 'f.txt'), 'x')
    expect((await createProjectFolder(parent, 'full')).ok).toBe(false)
    expect((await createProjectFolder(join(parent, 'nope'), 'x')).ok).toBe(false)
  })
})
