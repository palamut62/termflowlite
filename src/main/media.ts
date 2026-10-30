import { nativeImage } from 'electron'
import { createReadStream, existsSync, statSync, watch, type FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import { basename, extname, isAbsolute, join, normalize } from 'path'
import { Readable } from 'stream'
import type { MediaInfo, MediaKind } from '../shared/ipc'

/**
 * Terminal önizleme kartları için resim/video desteği.
 *
 * - Küçük resimler işletim sisteminin kendi servisiyle üretilir
 *   (`createThumbnailFromPath`, Windows/macOS): video karesi için ffmpeg gerekmez.
 * - Tam görünüm `termflow-media://` protokolüyle sunulur; YALNIZCA bu modülün
 *   izin verdiği (bırakılan, yapıştırılan ya da izlenen klasörde beliren) medya
 *   dosyaları açılır. Range istekleri desteklenir, video sarılabilir.
 * - Hiçbir şey diske yazılmaz; küçük resimler yalnızca bellekte, renderer'a
 *   data URL olarak gider.
 */

export const MEDIA_SCHEME = 'termflow-media'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.ico'])
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv'])
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg'
}

const THUMB = { width: 320, height: 200 }
/** Linux'ta resim küçültmek için belleğe alınacak en büyük dosya. */
const MAX_DECODE_BYTES = 40 * 1024 * 1024
const MAX_GRANTED = 400

export function mediaKind(path: string): MediaKind | null {
  const ext = extname(path).toLowerCase()
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  return null
}

/** Karşılaştırma anahtarı: Windows yolları büyük/küçük harf duyarsız. */
function key(path: string): string {
  const n = normalize(path)
  return process.platform === 'win32' ? n.toLowerCase() : n
}

const granted = new Map<string, string>()

function grant(path: string): void {
  granted.delete(key(path))
  granted.set(key(path), path)
  while (granted.size > MAX_GRANTED) granted.delete(granted.keys().next().value as string)
}

export function isGranted(path: string): boolean {
  return granted.has(key(path))
}

async function thumbnail(path: string, kind: MediaKind, size: number): Promise<{ dataUrl: string; width?: number; height?: number }> {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try {
      const thumb = await nativeImage.createThumbnailFromPath(path, THUMB)
      if (!thumb.isEmpty()) {
        const dims = kind === 'image' ? nativeImage.createFromPath(path).getSize() : undefined
        return { dataUrl: thumb.toDataURL(), width: dims?.width || undefined, height: dims?.height || undefined }
      }
    } catch {
      // Küçük resim servisi bu biçimi tanımıyor: aşağıdaki yola düş.
    }
  }
  if (kind === 'image' && size <= MAX_DECODE_BYTES) {
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) {
      const { width, height } = image.getSize()
      const scale = Math.min(1, THUMB.width / width, THUMB.height / height)
      const small = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : image
      return { dataUrl: small.toDataURL(), width, height }
    }
  }
  return { dataUrl: '' }
}

/**
 * Bir yolu doğrular, izin listesine ekler ve kart bilgisini döndürür.
 * Medya değilse, yoksa ya da klasörse null.
 */
export async function inspectMedia(path: unknown): Promise<MediaInfo | null> {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096 || !isAbsolute(path)) return null
  const kind = mediaKind(path)
  if (!kind) return null
  let info
  try {
    info = await stat(path)
  } catch {
    return null
  }
  if (!info.isFile() || info.size === 0) return null
  grant(path)
  const thumb = await thumbnail(path, kind, info.size)
  return { path, name: basename(path), kind, size: info.size, modifiedAt: info.mtimeMs, thumbnail: thumb.dataUrl, width: thumb.width, height: thumb.height }
}

export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(path)}`
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null
  let start = match[1] ? Number(match[1]) : NaN
  let end = match[2] ? Number(match[2]) : size - 1
  if (Number.isNaN(start)) {
    // "bytes=-500": son 500 bayt.
    start = Math.max(0, size - end)
    end = size - 1
  }
  if (start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

/** `termflow-media://file/<encoded path>` isteklerini karşılar. */
export async function handleMediaRequest(request: Request): Promise<Response> {
  let path: string
  try {
    const url = new URL(request.url)
    if (url.host !== 'file') return new Response('Not found', { status: 404 })
    path = decodeURIComponent(url.pathname.slice(1))
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (!isAbsolute(path) || !isGranted(path) || !mediaKind(path)) return new Response('Forbidden', { status: 403 })
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return new Response('Not found', { status: 404 })
    size = info.size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
  // Bos dosyada createReadStream({ end: -1 }) RangeError atar; bos govde don.
  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
  const range = parseRange(request.headers.get('range'), size)
  if (request.headers.get('range') && !range) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...headers, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) }
  })
}

/* ------------------------------------------------------------------ *
 * Klasör izleme: aktif çalışma klasöründe yeni beliren medya dosyaları
 * ------------------------------------------------------------------ */

/** Derleme çıktıları ve bağımlılıklar kart yağmuruna yol açmasın. */
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', 'coverage', 'target', '.venv', 'venv', '__pycache__', 'appdata'])
const SETTLE_MS = 700
const BURST_LIMIT = 6
const BURST_WINDOW_MS = 4000

interface WatchEntry {
  dir: string
  watcher: FSWatcher
  tabIds: Set<string>
  startedAt: number
  pending: Map<string, NodeJS.Timeout>
  seen: Set<string>
  burst: number[]
}

const watchers = new Map<string, WatchEntry>()

export function shouldIgnore(relative: string): boolean {
  return relative.split(/[\\/]/).slice(0, -1).some((part) => IGNORED_SEGMENTS.has(part.toLowerCase()) || part.startsWith('.'))
}

/**
 * Bir klasörü izler. Alt klasörler yalnızca Windows/macOS'ta ve klasör bir
 * proje köküyse (.git) izlenir; aksi halde (ör. ev klasörü) yalnızca üst seviye.
 */
export function watchMediaDir(dir: string, tabId: string, emit: (tabIds: string[], info: MediaInfo) => void): void {
  if (!isAbsolute(dir)) return
  const k = key(dir)
  const existing = watchers.get(k)
  if (existing) {
    existing.tabIds.add(tabId)
    return
  }
  try {
    if (!statSync(dir).isDirectory()) return
  } catch {
    return
  }
  const recursive = process.platform !== 'linux' && existsSync(join(dir, '.git'))
  let watcher: FSWatcher
  try {
    watcher = watch(dir, { recursive, persistent: false })
  } catch {
    return
  }
  const entry: WatchEntry = { dir, watcher, tabIds: new Set([tabId]), startedAt: Date.now(), pending: new Map(), seen: new Set(), burst: [] }
  watchers.set(k, entry)
  watcher.on('error', () => unwatchDir(k))
  watcher.on('change', (_event, filename) => {
    if (!filename) return
    const relative = filename.toString()
    if (!mediaKind(relative) || shouldIgnore(relative)) return
    const full = join(dir, relative)
    const fk = key(full)
    if (entry.seen.has(fk)) return
    clearTimeout(entry.pending.get(fk))
    // Yazma bitene kadar bekle: boyut iki ölçümde sabitse dosya hazırdır.
    entry.pending.set(fk, setTimeout(() => void settle(entry, full, fk, emit), SETTLE_MS))
  })
}

async function settle(entry: WatchEntry, full: string, fk: string, emit: (tabIds: string[], info: MediaInfo) => void, lastSize = -1): Promise<void> {
  entry.pending.delete(fk)
  let info
  try {
    info = await stat(full)
  } catch {
    return
  }
  if (!info.isFile() || info.size === 0) return
  // İzleme başlamadan önce var olan dosyalara dokunulunca kart çıkmasın.
  if (Math.max(info.birthtimeMs || 0, info.mtimeMs) < entry.startedAt - 1000) return
  if (info.size !== lastSize) {
    entry.pending.set(fk, setTimeout(() => void settle(entry, full, fk, emit, info.size), SETTLE_MS))
    return
  }
  const now = Date.now()
  entry.burst = entry.burst.filter((t) => now - t < BURST_WINDOW_MS)
  if (entry.burst.length >= BURST_LIMIT) return
  entry.burst.push(now)
  entry.seen.add(fk)
  if (entry.seen.size > 2000) entry.seen.clear()
  const media = await inspectMedia(full)
  if (media && watchers.get(key(entry.dir)) === entry) emit([...entry.tabIds], media)
}

function unwatchDir(k: string): void {
  const entry = watchers.get(k)
  if (!entry) return
  watchers.delete(k)
  for (const timer of entry.pending.values()) clearTimeout(timer)
  try {
    entry.watcher.close()
  } catch {
    // zaten kapalı
  }
}

/** Sekmenin izlediği klasörü bırakır; klasörü izleyen başka sekme yoksa kapatır. */
export function unwatchMediaTab(tabId: string): void {
  for (const [k, entry] of watchers) {
    if (!entry.tabIds.delete(tabId)) continue
    if (entry.tabIds.size === 0) unwatchDir(k)
  }
}

export function unwatchAllMedia(): void {
  for (const k of [...watchers.keys()]) unwatchDir(k)
}
