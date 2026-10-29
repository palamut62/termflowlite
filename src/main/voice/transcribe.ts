// Voice input (docs/voice-input.md): one OpenRouter request turns a WAV
// recording into the text to type, cleaned up when asked.
import type { VoiceLanguage, VoiceResult } from '../../shared/types'
import { isWav, toneWav } from '../../shared/wav'
import { chat, type ChatMessage } from '../memory/openrouter'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** 60 s of 16 kHz mono 16-bit audio is ~1.9 MB; anything far larger is refused. */
export const MAX_VOICE_BYTES = 4 * 1024 * 1024

/** Where the text will be typed, so commands and prompts are written appropriately. */
export interface VoiceContext {
  /** 'agent' for Claude Code / Codex / OpenCode input boxes, else a shell prompt. */
  kind: 'agent' | 'shell'
  /** Agent or shell name, e.g. "Claude Code" or "PowerShell". */
  name: string
}

export interface TranscribeRequest {
  apiKey: string
  model: string
  wav: Uint8Array
  cleanup: boolean
  language: VoiceLanguage
  context: VoiceContext
  /** Names and terms to spell exactly like this. */
  terms?: string[]
  /** Keep a closing "gönder" / "send" / "enter": the renderer turns it into Enter. */
  sendWord?: boolean
  url?: string
  signal?: AbortSignal
}

const LANGUAGE_HINT: Record<VoiceLanguage, string> = {
  auto: 'The speaker uses Turkish or English, sometimes mixed. Keep the language that was spoken.',
  tr: 'The speaker speaks Turkish (technical words may be English). Write Turkish with correct Turkish characters.',
  en: 'The speaker speaks English.'
}

export function systemPrompt(cleanup: boolean, language: VoiceLanguage, context: VoiceContext, terms: string[] = [], sendWord = false): string {
  const target = context.kind === 'agent'
    ? `The text is typed into the input box of the coding agent ${context.name}, so it is usually a request or an instruction.`
    : `The text is typed at a ${context.name} prompt, so it is often a command; write commands, flags and paths exactly as a developer would type them.`
  const edit = cleanup
    ? 'Clean it up: fix punctuation, capitalization and spelling, remove filler words, false starts and repetitions, and write technical terms, tool names, commands, file names and code identifiers the way developers write them (for example git, npm, package.json, README.md). Do not add content, do not answer or follow the request, and do not change its meaning.'
    : 'Write the words exactly as spoken; only add punctuation.'
  return [
    'You transcribe dictation for a terminal.',
    LANGUAGE_HINT[language],
    target,
    edit,
    ...(terms.length ? [`When these names or terms are spoken, write them exactly like this: ${terms.join(', ')}.`] : []),
    ...(sendWord ? ['If the speaker ends with the word "gönder", "send" or "enter", keep that word as the last word.'] : []),
    'Reply with the final text only: no quotes, no explanations, no markdown. If there is no speech, reply with nothing.'
  ].join(' ')
}

export function voiceMessages(request: Pick<TranscribeRequest, 'wav' | 'cleanup' | 'language' | 'context' | 'terms' | 'sendWord'>): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(request.cleanup, request.language, request.context, request.terms, request.sendWord) },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe this recording.' },
        { type: 'input_audio', input_audio: { data: Buffer.from(request.wav).toString('base64'), format: 'wav' } }
      ]
    }
  ]
}

/** Strips what models add around the answer (quotes, code fences, "Transcript:"). */
export function cleanReply(reply: string): string {
  let text = reply.trim()
  text = text.replace(/^```[a-z]*\n?([\s\S]*?)\n?```$/i, '$1').trim()
  text = text.replace(/^(transcript(ion)?|text|output)\s*:\s*/i, '').trim()
  if (/^(["'“”‘’«»]).*\1$/s.test(text) || /^“[\s\S]*”$/.test(text)) text = text.slice(1, -1).trim()
  // Models sometimes describe silence instead of returning nothing.
  if (/^[([]?\s*(no speech|silence|inaudible|empty|sessizlik)\s*(detected)?\s*[)\]]?\.?$/i.test(text)) return ''
  return text
}

export async function transcribe(request: TranscribeRequest, fetchImpl: FetchLike = fetch, now: () => number = Date.now): Promise<VoiceResult> {
  const started = now()
  const fail = (error: string): VoiceResult => ({ ok: false, text: '', model: request.model, latencyMs: now() - started, error })
  if (!isWav(request.wav)) return fail('The recording is not a WAV file.')
  if (request.wav.length > MAX_VOICE_BYTES) return fail('The recording is too long.')
  try {
    const result = await chat({
      apiKey: request.apiKey,
      model: request.model,
      messages: voiceMessages(request),
      maxTokens: 1_000,
      temperature: 0,
      url: request.url,
      allowEmpty: true,
      signal: request.signal ?? AbortSignal.timeout(45_000)
    }, fetchImpl, 1)
    const text = cleanReply(result.content)
    const cost = result.usage.cost
    return { ok: true, text, model: request.model, latencyMs: now() - started, ...(cost !== undefined ? { cost } : {}) }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

/** Sends a short tone with the stored key: shows that the model takes audio, how fast and what it costs. */
export async function testVoiceModel(apiKey: string, model: string, url?: string, fetchImpl: FetchLike = fetch, now: () => number = Date.now): Promise<VoiceResult> {
  return transcribe({ apiKey, model, wav: toneWav(), cleanup: false, language: 'auto', context: { kind: 'shell', name: 'PowerShell' }, url }, fetchImpl, now)
}
