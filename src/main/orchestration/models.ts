// Devir hedeflerinin model listesi: ajan CLI'inin kendi komutundan (OpenCode `models --verbose`, Grok `models`),
// memory'deki ModelCatalog ile 24 saat diske cache'lenir; hata olursa eski liste + uyari doner.

import { join } from 'path'
import type { DelegateAgentKind, OpenRouterModel } from '../../shared/types'
import { ModelCatalog } from '../memory/models'

const model = (id: string, extra: Partial<OpenRouterModel> = {}): OpenRouterModel => ({
  id, name: id, contextLength: 0, inputPrice: null, outputPrice: null, structured: true, audio: false, ...extra
})

/**
 * `opencode models --verbose`: her model icin `saglayici/model` satiri ve ardindan girintili JSON.
 * Fiyat 1M token basina USD (0 = ucretsiz). `structured` alani burada arac cagirma yetenegidir:
 * araci olmayan model dosya yazamaz.
 */
export function parseOpencodeModels(stdout: string): OpenRouterModel[] {
  const models: OpenRouterModel[] = []
  let id = ''
  let block: string[] = []
  const flush = (): void => {
    if (!id) return
    let info: { name?: string; cost?: { input?: number; output?: number }; limit?: { context?: number }; capabilities?: { toolcall?: boolean } } = {}
    try { info = JSON.parse(block.join('\n')) } catch { /* yalniz id satiri */ }
    models.push(model(id, {
      name: info.name || id,
      contextLength: info.limit?.context ?? 0,
      inputPrice: typeof info.cost?.input === 'number' ? info.cost.input : null,
      outputPrice: typeof info.cost?.output === 'number' ? info.cost.output : null,
      structured: info.capabilities?.toolcall !== false
    }))
    id = ''
    block = []
  }
  for (const line of stdout.split(/\r?\n/)) {
    if (/^[^\s{}"]+\/\S+$/.test(line)) {
      flush()
      id = line.trim()
    } else if (id) block.push(line)
  }
  flush()
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

/** `grok models`: "Available models:" altindaki `* grok-4.7 (default)` satirlari. */
export function parseGrokModels(stdout: string): OpenRouterModel[] {
  const start = stdout.indexOf('Available models:')
  if (start < 0) return []
  return stdout.slice(start).split(/\r?\n/).slice(1).flatMap((line) => {
    const match = /^\s+\*?\s*([\w.:/-]+)/.exec(line)
    return match ? [model(match[1], { name: /\(default\)/.test(line) ? `${match[1]} (default)` : match[1] })] : []
  })
}

/** CLI'in listeleme komutu olmayan ajanlar icin cevrimdisi yedek (elle yazilmis; yalniz oneri). */
export const FALLBACK_MODELS: Record<DelegateAgentKind, OpenRouterModel[]> = {
  opencode: [],
  grok: [],
  codex: [],
  agy: [],
  gemini: [],
  qwen: [],
  copilot: [],
  kimi: [],
  droid: [],
  claude: ['haiku', 'sonnet', 'opus'].map((id) => model(id))
}

export type RunCli = (command: string, args: string[]) => Promise<string>

/** Hedef basina katalog; listeleme komutu olmayan ajanda null (arayuz serbest metin + yedek gosterir). */
export function agentModelCatalog(dir: string, agent: DelegateAgentKind, run: RunCli): ModelCatalog | null {
  const load = agent === 'opencode'
    ? async () => parseOpencodeModels(await run('opencode', ['models', '--verbose']))
    : agent === 'grok'
      ? async () => parseGrokModels(await run('grok', ['models']))
      : null
  return load ? new ModelCatalog(join(dir, `models-${agent}.json`), fetch, Date.now, load) : null
}
