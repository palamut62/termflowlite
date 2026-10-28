import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { extname, isAbsolute, join, normalize } from 'path'
import type { ResolvedPath } from '../shared/ipc'

const MAX_LENGTH = 8192
const URL_PROTOCOL = /:\/\//
const PROTOCOL_LIKE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
const NETWORK_PATH = /^[\\/]{2}/
const EXECUTABLE_EXTENSIONS = new Set([
  '.appref-ms', '.bat', '.cmd', '.com', '.cpl', '.exe', '.hta', '.jar', '.js', '.jse',
  '.lnk', '.msc', '.msi', '.msp', '.ps1', '.psm1', '.reg', '.scr', '.url', '.vbe', '.vbs',
  '.wsf', '.wsh'
])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ide', 'out', 'build', '.next', 'target', '.venv', '__pycache__'])

/** Yalniz dosya adi ("ProjectTree.tsx") cwd'de yoksa projede arar: siglik/sure butcesi sinirli, en sig eslesme kazanir. */
function findByName(root: string, name: string): string | null {
  const wanted = name.toLowerCase()
  const deadline = Date.now() + 60
  let budget = 4000
  let level = [root]
  for (let depth = 0; depth < 6 && level.length > 0; depth += 1) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (entry.name.toLowerCase() === wanted) return join(dir, entry.name)
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) next.push(join(dir, entry.name))
        if (--budget <= 0 || Date.now() > deadline) return null
      }
    }
    level = next
  }
  return null
}

export function isSafePathToOpen(path: string, isDirectory: boolean): boolean {
  return isDirectory || !EXECUTABLE_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Terminal çıktısından gelen bir yol adayını tab'ın cwd'sine göre çözümler ve
 * diskinizde gerçekten var olduğunu doğrular. Var olmayan, URL veya protokol
 * benzeri değerler null döner — tıklanabilir link yalnızca gerçek yollar olur.
 *
 * Sandbox'lı renderer'da fs yok; bu çözümleme main process'te tek yerde
 * (IPC.SYSTEM_RESOLVE_PATH) yapılır.
 */
export function resolvePathCandidate(candidate: string, cwd: string): ResolvedPath | null {
  if (typeof candidate !== 'string' || typeof cwd !== 'string') return null
  const value = candidate.trim()
  if (!value || value.length > MAX_LENGTH) return null
  // Hover ile tetiklenen senkron fs kontrolü ağ yolunda ana process'i saniyelerce
  // kilitleyebilir. Tıklanabilir yollar yerel disklerle sınırlıdır.
  if (NETWORK_PATH.test(value)) return null
  // URL'ler WebLinksAddon'ın işi; '://' içeren adayları asla yol gibi açma.
  if (URL_PROTOCOL.test(value)) return null
  // 'http:', 'mailto:' vb. protokol benzeri değerler yol değildir; ancak
  // Windows sürücü yolları ('C:\...' / 'C:/...') bu teste takılmamalı.
  if (PROTOCOL_LIKE.test(value) && !WINDOWS_DRIVE.test(value)) return null

  // '~' (home) genişletmesi — Git Bash/Unix alışkanlığı.
  let target: string
  if (value === '~') target = homedir()
  else if (value.startsWith('~/') || value.startsWith('~\\')) target = join(homedir(), value.slice(2))
  else target = value
  // Git Bash / MSYS yolu ("/c/Users/x"): Claude Code gibi araçlar bu biçimi yazdırır.
  const msys = process.platform === 'win32' ? /^\/([a-zA-Z])\/(.*)$/.exec(target) : null
  if (msys) target = `${msys[1].toUpperCase()}:\\${msys[2].replace(/\//g, '\\')}`

  try {
    const full = normalize(isAbsolute(target) ? target : join(cwd, target))
    let found = full
    if (!existsSync(full)) {
      const bare = !/[\\/]/.test(target) && !isAbsolute(target) && /\.[A-Za-z0-9]{1,10}$/.test(target)
      const hit = bare ? findByName(cwd, target) : null
      if (!hit) return null
      found = hit
    }
    const st = statSync(found)
    // Dönen yol, kök sürücü ('C:\') dışında sondaki ayraçsız olur ki menüde
    // kopyalanan/karşılaştırılan yol temiz görünsün.
    const cleaned = found.length > 3 && /[\\/]$/.test(found) ? found.slice(0, -1) : found
    const isDirectory = st.isDirectory()
    return { path: cleaned, isDirectory, canOpen: isSafePathToOpen(cleaned, isDirectory) }
  } catch {
    return null
  }
}
