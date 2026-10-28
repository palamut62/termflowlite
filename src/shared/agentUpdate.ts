// Ajan CLI'larinin otomatik guncellenmesi: yalnizca npm ile global kurulanlar. Yerel kurulumlar
// (grok, droid, kimi...) kendi guncelleyicisine birakilir; tahminle komut calistirilmaz.

export const AGENT_NPM_PACKAGES: Readonly<Record<string, string>> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  gemini: '@google/gemini-cli',
  qwen: '@qwen-code/qwen-code',
  copilot: '@github/copilot',
  pi: '@mariozechner/pi-coding-agent',
  codebuff: 'codebuff'
}

export type AgentUpdateState = 'checking' | 'updating' | 'current' | 'updated' | 'failed'

export interface AgentUpdateItem {
  id: string
  pkg: string
  state: AgentUpdateState
  /** Kurulu surum (guncellemeden sonra yeni surum). */
  version?: string
  latest?: string
  checkedAt?: number
  error?: string
}

export interface AgentUpdateSnapshot {
  running: boolean
  items: AgentUpdateItem[]
  /** Son tur bittiginde (ms); hic calismadiysa yok. Tur basarisiz olduysa `lastError` dolu. */
  lastRunAt?: number
  lastError?: string
}

/** true: `latest`, `current`'tan yeni. Surum bicimi bozuksa (dist-tag, link) false: dokunulmaz. */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(current)
  const b = parse(latest)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i]
  // Ayni numara: onsurumdeyse (1.0.0-rc.1) kararli surume gec.
  return current.includes('-') && !latest.includes('-')
}
