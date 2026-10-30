import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { normalizeAsciiBackgrounds } from '../../shared/asciiBackground'
import { DEFAULT_SETTINGS, MEMORY_INTERVAL_MS, ORCHESTRATION_TARGET_ID, type AppSettings, type WorktreeMeta } from '../../shared/types'
import { normalizeSetupSteps } from '../../shared/worktreeSetup'
import { EDITION } from '../../shared/edition'
import { PUSH_TOPIC, newPushTopic, normalizePushServer } from '../remote/phonePush'

const WRITE_DEBOUNCE_MS = 300

function normalizeMemorySettings(value: unknown): AppSettings['memory'] {
  const input = value && typeof value === 'object' ? value as Partial<AppSettings['memory']> : {}
  const defaults = DEFAULT_SETTINGS.memory
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim().slice(0, 200) : defaults.model
  const excluded = Array.isArray(input.excludedProjects)
    ? [...new Set(input.excludedProjects.filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length < 1024))]
    : []
  const updateEvery = input.updateEvery && input.updateEvery in MEMORY_INTERVAL_MS ? input.updateEvery : defaults.updateEvery
  return { enabled: input.enabled === true, updateEvery, model, excludedProjects: excluded }
}
const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const TARGET_ID = ORCHESTRATION_TARGET_ID

export function normalizeOrchestrationSettings(value: unknown): AppSettings['orchestration'] {
  const input = value && typeof value === 'object' ? value as Partial<AppSettings['orchestration']> : {}
  const defaults = DEFAULT_SETTINGS.orchestration
  const raw = input.targets && typeof input.targets === 'object' ? input.targets : defaults.targets
  const targets = Object.fromEntries(Object.entries(raw).slice(0, 50).flatMap(([id, target]) => {
    if (!TARGET_ID.test(id) || !target || typeof target !== 'object') return []
    const model = typeof target.model === 'string' ? target.model.trim().slice(0, 200) : ''
    return [[id, { enabled: target.enabled !== false, model }]]
  }))
  return {
    enabled: input.enabled === true,
    maxConcurrent: clampInt(input.maxConcurrent, 1, 4, defaults.maxConcurrent),
    timeoutMinutes: clampInt(input.timeoutMinutes, 1, 60, defaults.timeoutMinutes),
    claudeThreshold: clampInt(input.claudeThreshold, 0, 100, defaults.claudeThreshold),
    targets
  }
}
function normalizeRemoteSettings(value: unknown): AppSettings['remote'] {
  const input = value && typeof value === 'object' ? value as Partial<AppSettings['remote']> : {}
  const port = typeof input.port === 'number' && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535
    ? input.port
    : DEFAULT_SETTINGS.remote.port
  const screenInput = input.screen && typeof input.screen === 'object' ? input.screen as Partial<AppSettings['remote']['screen']> : {}
  const screenPort = typeof screenInput.port === 'number' && Number.isInteger(screenInput.port) && screenInput.port >= 1 && screenInput.port <= 65535
    ? screenInput.port
    : DEFAULT_SETTINGS.remote.screen.port
  return {
    enabled: input.enabled === true,
    port,
    push: normalizePhonePush(input.push),
    screen: { enabled: screenInput.enabled === true, port: screenPort }
  }
}
function normalizePhonePush(value: unknown): AppSettings['remote']['push'] {
  const input = value && typeof value === 'object' ? value as Partial<AppSettings['remote']['push']> : {}
  const enabled = input.enabled === true
  const server = normalizePushServer(input.server) ?? DEFAULT_SETTINGS.remote.push.server
  const valid = typeof input.topic === 'string' && PUSH_TOPIC.test(input.topic)
  // Topic is made when push is turned on (or cleared for a new one) and then kept, so the phone stays subscribed.
  const topic = valid ? input.topic as string : enabled ? newPushTopic() : ''
  return { enabled, server, topic }
}
function normalizeVoiceSettings(value: unknown): AppSettings['voice'] {
  const input = value && typeof value === 'object' ? value as Partial<AppSettings['voice']> : {}
  const defaults = DEFAULT_SETTINGS.voice
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim().slice(0, 200) : defaults.model
  const holdMs = typeof input.holdMs === 'number' && Number.isFinite(input.holdMs) ? Math.min(1000, Math.max(250, Math.round(input.holdMs))) : defaults.holdMs
  const language = input.language === 'tr' || input.language === 'en' ? input.language : 'auto'
  const silenceMs = typeof input.silenceMs === 'number' && Number.isFinite(input.silenceMs)
    ? (input.silenceMs <= 0 ? 0 : Math.min(5000, Math.max(800, Math.round(input.silenceMs)))) : defaults.silenceMs
  const terms = Array.isArray(input.terms)
    ? [...new Set(input.terms.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 60)).filter(Boolean))].slice(0, 50)
    : []
  const speak: Partial<AppSettings['voice']['speak']> = input.speak && typeof input.speak === 'object' ? input.speak : {}
  const speed = typeof speak.speed === 'number' && Number.isFinite(speak.speed) ? Math.min(2, Math.max(0.5, speak.speed)) : 1
  const studioDir = typeof speak.studioDir === 'string' ? speak.studioDir.trim().slice(0, 500) : ''
  return {
    enabled: input.enabled === true, model, holdMs, cleanup: input.cleanup !== false, language,
    silenceMs, sendWord: input.sendWord === true, terms,
    speak: { enabled: speak.enabled === true, model: speak.model === 'ema' ? 'ema' : 'antalia', speed, studioDir }
  }
}
function normalizeIde(value: unknown): AppSettings['ide'] {
  const input: Partial<AppSettings['ide']> = value && typeof value === 'object' ? value : {}
  const width = (raw: unknown, fallback: number, min: number, max: number): number =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.round(Math.min(max, Math.max(min, raw))) : fallback
  const projects = Array.isArray(input.projects)
    ? [...new Set(input.projects.filter((p): p is string => typeof p === 'string' && p.trim().length > 0 && p.length <= 1024))].slice(0, 100)
    : []
  return {
    projects,
    sidebarWidth: width(input.sidebarWidth, 260, 200, 400),
    rightWidth: width(input.rightWidth, 300, 220, 560),
    rightOpen: input.rightOpen !== false,
    rightTab: (['agents', 'delegated', 'scm', 'checks'] as const).find((t) => t === input.rightTab) ?? 'explorer',
    sidebarOpen: input.sidebarOpen !== false,
    showClaudeWorktrees: input.showClaudeWorktrees === true,
    showOtherWorktrees: input.showOtherWorktrees === true,
    shownWorktrees: Array.isArray(input.shownWorktrees) ? input.shownWorktrees.filter((p): p is string => typeof p === 'string' && p.length <= 1024).slice(0, 500) : [],
    hideDefaultBranch: input.hideDefaultBranch === true,
    hideDetached: input.hideDetached === true,
    sort: input.sort === 'name' || input.sort === 'recent' ? input.sort : 'activity',
    cardLayout: input.cardLayout === 'compact' ? 'compact' : 'detailed',
    groupBy: input.groupBy === 'status' || input.groupBy === 'pr' || input.groupBy === 'none' ? input.groupBy : 'project',
    hideSleeping: input.hideSleeping === true,
    hiddenProps: Array.isArray(input.hiddenProps) ? (['note', 'link', 'sessions'] as const).filter((p) => input.hiddenProps?.includes(p)) : [],
    worktreeMeta: normalizeWorktreeMeta(input.worktreeMeta),
    keepAwake: input.keepAwake === 'on' || input.keepAwake === 'agent' ? input.keepAwake : 'off'
  }
}

export function normalizeWorktreeMeta(value: unknown): Record<string, WorktreeMeta> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const text = (raw: unknown, max: number): string | undefined => (typeof raw === 'string' && raw.trim() ? raw.slice(0, max) : undefined)
  const out: Record<string, WorktreeMeta> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 1000)) {
    if (!raw || typeof raw !== 'object' || key.length > 1024) continue
    const m = raw as Record<string, unknown>
    const meta: WorktreeMeta = {
      name: text(m.name, 120),
      link: text(m.link, 2000),
      note: text(m.note, 20000),
      status: (['todo', 'in-progress', 'in-review', 'done'] as const).find((s) => s === m.status),
      pinned: m.pinned === true || undefined,
      sleeping: m.sleeping === true || undefined,
      parent: text(m.parent, 1024)
    }
    // Bos kayit tutulmaz.
    const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as WorktreeMeta
    if (Object.keys(clean).length) out[key] = clean
  }
  return out
}

function normalizeAgentAlerts(value: unknown): AppSettings['agentAlerts'] {
  const fallback = DEFAULT_SETTINGS.agentAlerts
  const input: Partial<AppSettings['agentAlerts']> = value && typeof value === 'object' ? value : {}
  const channel = (raw: unknown, base: AppSettings['agentAlerts']['done']): AppSettings['agentAlerts']['done'] => {
    const c: Partial<AppSettings['agentAlerts']['done']> = raw && typeof raw === 'object' ? raw : {}
    return { system: typeof c.system === 'boolean' ? c.system : base.system, sound: typeof c.sound === 'boolean' ? c.sound : base.sound }
  }
  const volume = typeof input.volume === 'number' && Number.isFinite(input.volume) ? Math.round(Math.min(100, Math.max(0, input.volume))) : fallback.volume
  // Yalniz userData/sounds altindaki bir dosya adi; yol ya da baska klasor kabul edilmez.
  const soundFile = typeof input.soundFile === 'string' && /^alert\.(?:mp3|wav|ogg|m4a|aac|flac)$/.test(input.soundFile) ? input.soundFile : ''
  return { needsInput: channel(input.needsInput, fallback.needsInput), done: channel(input.done, fallback.done), error: channel(input.error, fallback.error), volume, soundFile }
}
const BACKDROPS: AppSettings['backdrop'][] = ['none', 'mica', 'acrylic', 'tabbed']

/**
 * JSON-backed settings persistence (userData/settings.json). Reads are
 * immutable copies; writes are debounced 300ms and atomic (temp + rename).
 */
export class SettingsStore {
  private settings: AppSettings
  private writeTimer: NodeJS.Timeout | null = null

  constructor(private readonly filePath: string) {
    this.settings = this.normalize(this.load())
  }

  private load(): AppSettings {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as AppSettings
    } catch (err) {
      // Missing file (first run) or corrupt JSON: fall back to defaults.
      console.warn(`[settings] could not read ${this.filePath}:`, err)
      return { ...DEFAULT_SETTINGS }
    }
  }

  /** Schema evolution: fill missing/stale fields from DEFAULT_SETTINGS. */
  normalize(settings: AppSettings): AppSettings {
    const merged: AppSettings = { ...DEFAULT_SETTINGS, ...settings }
    // shortcuts is a nested object -> deep merge; profiles is replaced whole.
    merged.shortcuts = { ...DEFAULT_SETTINGS.shortcuts, ...(settings.shortcuts ?? {}) }
    merged.profiles = Array.isArray(settings.profiles) ? settings.profiles : []
    merged.providerProfiles = Array.isArray(settings.providerProfiles)
      ? settings.providerProfiles
      : structuredClone(DEFAULT_SETTINGS.providerProfiles)
    merged.sshConnections = Array.isArray(settings.sshConnections) ? settings.sshConnections : []
    // Eski "Blur" anahtarı: açıksa acrylic backdrop olarak devam eder.
    if ((settings as Partial<AppSettings>).backdrop === undefined && settings.blur) merged.backdrop = 'acrylic'
    if (!BACKDROPS.includes(merged.backdrop)) merged.backdrop = 'none'
    merged.asciiBackgrounds = normalizeAsciiBackgrounds(settings.asciiBackgrounds)
    merged.memory = normalizeMemorySettings(settings.memory)
    merged.remote = normalizeRemoteSettings(settings.remote)
    merged.voice = normalizeVoiceSettings(settings.voice)
    merged.orchestration = normalizeOrchestrationSettings(settings.orchestration)
    merged.agentAlerts = normalizeAgentAlerts(settings.agentAlerts)
    merged.ide = normalizeIde(settings.ide)
    // Agent IDE yalniz IDE surumunde; Lite her zaman terminal yerlesimi.
    if (EDITION !== 'ide' || merged.uiMode !== 'ide') merged.uiMode = 'terminal'
    if (!Array.isArray(settings.installedAgents)) delete merged.installedAgents
    else merged.installedAgents = settings.installedAgents.filter((id): id is string => typeof id === 'string').slice(0, 100)
    const setups = settings.worktreeSetup && typeof settings.worktreeSetup === 'object' ? Object.entries(settings.worktreeSetup) : []
    merged.worktreeSetup = Object.fromEntries(setups.slice(0, 100).flatMap(([key, value]) => {
      const steps = normalizeSetupSteps(value)
      return steps ? [[key, steps]] : []
    }))
    // 1.24.0 ilk surumunde Claude limitleri kapali ve % kullanilan geliyordu; mevcut kurulumlar bir kez yeni varsayilana gecer.
    if (!settings.limitDefaultsApplied) {
      merged.claudeUsage = true
      merged.usageDisplay = 'remaining'
    }
    merged.limitDefaultsApplied = true
    // 1.25.0: limitler Claude Code'un kendi satiri gibi % kullanilan; mevcut kurulumlar bir kez gecer, 'off' korunur.
    if (!settings.limitClaudeStyleApplied && merged.usageDisplay !== 'off') merged.usageDisplay = 'used'
    merged.limitClaudeStyleApplied = true
    const contrast = Number(merged.minimumContrastRatio)
    merged.minimumContrastRatio = Number.isFinite(contrast) ? Math.min(21, Math.max(1, contrast)) : 1
    return merged
  }

  /** Immutable snapshot — callers must never mutate the returned object. */
  get(): AppSettings {
    return structuredClone(this.settings)
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.settings = this.normalize({ ...this.settings, ...patch })
    this.scheduleWrite()
    return this.get()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), WRITE_DEBOUNCE_MS)
  }

  /** Synchronous write — call from before-quit so nothing is lost. */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.warn('[settings] failed to persist settings:', err)
    }
  }
}
