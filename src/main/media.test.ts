import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  nativeImage: {
    createThumbnailFromPath: vi.fn(async () => ({ isEmpty: () => true })),
    createFromPath: vi.fn(() => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }))
  }
}))

import { handleMediaRequest, inspectMedia, isGranted, mediaKind, mediaUrl, parseRange, shouldIgnore } from './media'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'termflow-media-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('media', () => {
  it('classifies images and videos by extension', () => {
    expect(mediaKind('C:\\shots\\a.PNG')).toBe('image')
    expect(mediaKind('/tmp/clip.webm')).toBe('video')
    expect(mediaKind('/tmp/notes.txt')).toBeNull()
    expect(mediaKind('/tmp/run.exe')).toBeNull()
  })

  it('ignores build output and dependency folders', () => {
    expect(shouldIgnore('node_modules/pkg/logo.png')).toBe(true)
    expect(shouldIgnore('dist/assets/hero.webp')).toBe(true)
    expect(shouldIgnore('.git/x.png')).toBe(true)
    expect(shouldIgnore('test-results/run-1/video.webm')).toBe(false)
    expect(shouldIgnore('screenshot.png')).toBe(false)
  })

  it('parses single byte ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=5000-', 1000)).toBeNull()
    expect(parseRange(null, 1000)).toBeNull()
  })

  it('only grants real media files', async () => {
    const image = join(dir, 'shot.png')
    writeFileSync(image, 'png-bytes')
    writeFileSync(join(dir, 'empty.png'), '')
    writeFileSync(join(dir, 'notes.txt'), 'text')
    expect(await inspectMedia('relative.png')).toBeNull()
    expect(await inspectMedia(join(dir, 'missing.png'))).toBeNull()
    expect(await inspectMedia(join(dir, 'empty.png'))).toBeNull()
    expect(await inspectMedia(join(dir, 'notes.txt'))).toBeNull()
    const info = await inspectMedia(image)
    expect(info).toMatchObject({ path: image, name: 'shot.png', kind: 'image', size: 9 })
    expect(isGranted(image)).toBe(true)
  })

  it('serves granted files with byte ranges and refuses everything else', async () => {
    const video = join(dir, 'clip.mp4')
    writeFileSync(video, '0123456789')
    const secret = join(dir, 'other.mp4')
    writeFileSync(secret, 'secret')
    await inspectMedia(video)

    const full = await handleMediaRequest(new Request(mediaUrl(video)))
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(await full.text()).toBe('0123456789')

    const part = await handleMediaRequest(new Request(mediaUrl(video), { headers: { range: 'bytes=2-5' } }))
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await part.text()).toBe('2345')

    expect((await handleMediaRequest(new Request(mediaUrl(secret)))).status).toBe(403)
    expect((await handleMediaRequest(new Request(mediaUrl(join(dir, 'notes.txt'))))).status).toBe(403)
    expect((await handleMediaRequest(new Request('termflow-media://evil/x'))).status).toBe(404)
  })

  it('answers with an empty body when a granted file is truncated', async () => {
    const clip = join(dir, 'live.mp4')
    writeFileSync(clip, '0123456789')
    await inspectMedia(clip)
    writeFileSync(clip, '') // the stream would be asked for bytes 0..-1
    const res = await handleMediaRequest(new Request(mediaUrl(clip)))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})
