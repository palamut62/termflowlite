// Arka planda ajan CLI guncelleyici: acilista ve her 24 saatte bir, npm ile global kurulu
// ajanlari `npm view` ile karsilastirir, eskiyse `npm install -g <pkg>@latest` calistirir.
// Sirayla ilerler (npm kilidi); hata uygulamayi etkilemez, sonuc Profiller ekranina yansir.

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { AGENT_NPM_PACKAGES, isNewerVersion, type AgentUpdateItem, type AgentUpdateSnapshot } from '../shared/agentUpdate'
import { executablePath } from './terminal/cli'

const exec = promisify(execFile)

export type NpmRunner = (args: string[], timeout: number) => Promise<string>

/** npm.cmd shell'den gecirilmez: node + npm-cli.js dogrudan calistirilir. */
export const runNpm: NpmRunner = async (args, timeout) => {
  const node = executablePath('node')
  const entry = [
    join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].find(existsSync)
  if (!entry) throw new Error('npm bulunamadi.')
  const { stdout } = await exec(node, [entry, ...args], { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  return stdout
}

export class AgentUpdater {
  private items = new Map<string, AgentUpdateItem>()
  private running = false
  private lastRunAt: number | undefined
  private lastError: string | undefined
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onChange: (snapshot: AgentUpdateSnapshot) => void,
    private readonly npm: NpmRunner = runNpm,
    private readonly now: () => number = Date.now
  ) {}

  snapshot(): AgentUpdateSnapshot {
    return { running: this.running, items: [...this.items.values()], lastRunAt: this.lastRunAt, lastError: this.lastError }
  }

  /** Acilistan kisa sure sonra bir kez, sonra gunde bir; `enabled` her turda okunur. */
  schedule(enabled: () => boolean, firstDelayMs = 20_000, intervalMs = 24 * 3600_000): void {
    const tick = (): void => { if (enabled()) void this.run() }
    setTimeout(tick, firstDelayMs).unref()
    this.timer = setInterval(tick, intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async run(): Promise<AgentUpdateSnapshot> {
    if (this.running) return this.snapshot()
    this.running = true
    this.lastError = undefined
    this.emit()
    try {
      const installed = await this.installedVersions()
      for (const [id, pkg] of Object.entries(AGENT_NPM_PACKAGES)) {
        const version = installed[pkg]
        if (!version) { this.items.delete(id); continue }
        await this.updateOne(id, pkg, version)
      }
    } catch (error) {
      this.lastError = ((error as Error).message.split('\n')[0] ?? '').slice(0, 200)
      console.warn('[agent-update] failed:', this.lastError)
    } finally {
      this.running = false
      this.lastRunAt = this.now()
      this.emit()
    }
    return this.snapshot()
  }

  private async installedVersions(): Promise<Record<string, string>> {
    // npm ls bagimlilik uyarisinda sifir olmayan kodla cikar ama stdout gecerlidir.
    const out = await this.npm(['ls', '-g', '--depth=0', '--json'], 30_000).catch((e: { stdout?: string }) => {
      if (e.stdout === undefined) throw e // npm hic calismadi (bulunamadi/zaman asimi): sessizce "guncel" sayma
      return e.stdout
    })
    const json = JSON.parse(out || '{}') as { dependencies?: Record<string, { version?: string }> }
    return Object.fromEntries(Object.entries(json.dependencies ?? {}).flatMap(([name, d]) => (d.version ? [[name, d.version]] : [])))
  }

  private async updateOne(id: string, pkg: string, version: string): Promise<void> {
    this.set({ id, pkg, state: 'checking', version })
    try {
      const latest = (await this.npm(['view', pkg, 'version'], 30_000)).trim()
      if (!isNewerVersion(version, latest)) {
        this.set({ id, pkg, state: 'current', version, latest, checkedAt: this.now() })
        return
      }
      this.set({ id, pkg, state: 'updating', version, latest })
      await this.npm(['install', '-g', `${pkg}@${latest}`], 5 * 60_000)
      this.set({ id, pkg, state: 'updated', version: latest, latest, checkedAt: this.now() })
    } catch (error) {
      // Calisan ajan dosyayi kilitleyebilir (EBUSY); bir sonraki turda yeniden denenir.
      this.set({ id, pkg, state: 'failed', version, checkedAt: this.now(), error: ((error as Error).message.split('\n')[0] ?? '').slice(0, 200) })
    }
  }

  private set(item: AgentUpdateItem): void {
    this.items.set(item.id, item)
    this.emit()
  }

  private emit(): void { this.onChange(this.snapshot()) }
}
