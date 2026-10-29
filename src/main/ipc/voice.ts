import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AppSettings, SpeakResult, VoiceResult } from '../../shared/types'
import { synthesize } from '../voice/speak'
import { MAX_VOICE_BYTES, testVoiceModel, transcribe, type VoiceContext } from '../voice/transcribe'

export interface VoiceIpcDeps {
  getSettings(): AppSettings
  /** The OpenRouter key shared with Agent Memory; never sent to the renderer. */
  getApiKey(): string | undefined
  /** E2E only: a local stand-in for OpenRouter. */
  url?: string
}

const NO_KEY = 'Add an OpenRouter API key in Settings > Voice first.'

function validContext(value: unknown): VoiceContext {
  const input = value && typeof value === 'object' ? value as Partial<VoiceContext> : {}
  return {
    kind: input.kind === 'agent' ? 'agent' : 'shell',
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 60) : 'terminal'
  }
}

export function registerVoiceIpc(deps: VoiceIpcDeps): void {
  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_event, wav: unknown, context: unknown): Promise<VoiceResult> => {
    const voice = deps.getSettings().voice
    const model = voice.model
    if (!voice.enabled) return { ok: false, text: '', model, latencyMs: 0, error: 'Voice input is turned off.' }
    if (!(wav instanceof Uint8Array) || wav.length > MAX_VOICE_BYTES) return { ok: false, text: '', model, latencyMs: 0, error: 'The recording could not be used.' }
    const apiKey = deps.getApiKey()
    if (!apiKey) return { ok: false, text: '', model, latencyMs: 0, error: NO_KEY }
    const where = validContext(context)
    return transcribe({
      apiKey, model, wav, cleanup: voice.cleanup, language: voice.language, context: where,
      terms: voice.terms, sendWord: voice.sendWord && where.kind === 'agent', url: deps.url
    })
  })

  ipcMain.handle(IPC.VOICE_SYNTH, async (_event, text: unknown): Promise<SpeakResult> => {
    const speak = deps.getSettings().voice.speak
    if (!speak.enabled) return { ok: false, error: 'Read aloud is turned off.' }
    if (typeof text !== 'string') return { ok: false, error: 'There is no text to read.' }
    return synthesize(text, speak)
  })

  ipcMain.handle(IPC.VOICE_TEST, async (_event, model: unknown): Promise<VoiceResult> => {
    const id = typeof model === 'string' && /^[a-zA-Z0-9_./:@+-]{1,200}$/.test(model) ? model : deps.getSettings().voice.model
    const apiKey = deps.getApiKey()
    if (!apiKey) return { ok: false, text: '', model: id, latencyMs: 0, error: NO_KEY }
    return testVoiceModel(apiKey, id, deps.url)
  })
}
