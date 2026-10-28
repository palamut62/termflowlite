import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { extname, join } from 'path'
import type { IncomingMessage } from 'http'

/** Bir telefon yuklemesi icin ust sinir; tek istekte bellege alinmaz, diske akar. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Telefonun verdigi adi guvenli bir dosya adina indirger (yol, kontrol karakteri, Windows ozel adlari). */
export function safeUploadName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? ''
  const name = last.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120)
  if (!name) return 'upload'
  return RESERVED.test(name.replace(/\.[^.]*$/, '')) ? `_${name}` : name
}

function freePath(dir: string, name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 0; n < 1000; n++) {
    const file = join(dir, n === 0 ? name : `${stem} (${n})${ext}`)
    if (!existsSync(file)) return file
  }
  return join(dir, `${stem}-${Date.now()}${ext}`)
}

/** Istek govdesini `dir` altina akitir; dosya yolunu doner. Sinir asilirsa yarim dosya silinir. */
export function saveUpload(req: IncomingMessage, dir: string, rawName: string, limit = MAX_UPLOAD_BYTES): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const file = freePath(dir, safeUploadName(rawName))
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file, { flags: 'wx' })
    let size = 0
    const fail = (error: Error): void => {
      out.destroy()
      try { unlinkSync(file) } catch { /* yazilmadan kesildi */ }
      reject(error)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        fail(new Error('File too large'))
        req.destroy()
      }
    })
    req.on('error', fail)
    req.on('aborted', () => fail(new Error('Upload interrupted')))
    out.on('error', fail)
    out.on('finish', () => resolve(file))
    req.pipe(out)
  })
}
