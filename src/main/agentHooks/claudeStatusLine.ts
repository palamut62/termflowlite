import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Claude'un o klasorde gercekten kullanacagi status line komutu (yerel > proje > kullanici).
 * usage-meter bu komutu sarmalar: JSON TermFlow'a da gider, kullanicinin gorunumu degismez.
 */
export function effectiveClaudeStatusLine(cwd: string | undefined, home = homedir(), configDir?: string): string | null {
  const files = cwd ? [join(cwd, '.claude', 'settings.local.json'), join(cwd, '.claude', 'settings.json')] : []
  // Profil kendi hesabini kullaniyorsa (CLAUDE_CONFIG_DIR) kullanici ayari oradadir.
  files.push(join(configDir?.trim() || process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), 'settings.json'))
  for (const file of files) {
    try {
      const statusLine = (JSON.parse(readFileSync(file, 'utf8')) as { statusLine?: { type?: unknown; command?: unknown } }).statusLine
      if (statusLine && statusLine.type === 'command' && typeof statusLine.command === 'string' && statusLine.command.trim()) return statusLine.command.trim()
    } catch {
      // dosya yok ya da bozuk: bir sonraki seviyeye bak
    }
  }
  return null
}
