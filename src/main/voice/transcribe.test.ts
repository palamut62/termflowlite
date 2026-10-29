import { describe, expect, it } from 'vitest'
import { toneWav } from '../../shared/wav'
import { cleanReply, systemPrompt, testVoiceModel, transcribe } from './transcribe'

const shell = { kind: 'shell' as const, name: 'PowerShell' }

function fakeFetch(content: string, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(status === 200
      ? { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 8, cost: 0.00004 } }
      : { error: { message: 'bad' } }), { status })
  }
  return { impl, calls }
}

let clock = 0
const now = (): number => (clock += 250)

describe('transcribe', () => {
  it('sends the recording as base64 wav input_audio with the cleanup prompt', async () => {
    const { impl, calls } = fakeFetch('git status')
    const result = await transcribe({ apiKey: 'k', model: 'google/gemini-2.5-flash-lite', wav: toneWav(0.2), cleanup: true, language: 'auto', context: shell }, impl, now)
    expect(result).toMatchObject({ ok: true, text: 'git status', cost: 0.00004 })
    const body = calls[0].body as { model: string; temperature: number; messages: { role: string; content: unknown }[] }
    expect(body.model).toBe('google/gemini-2.5-flash-lite')
    expect(body.temperature).toBe(0)
    expect(body.messages[0].content).toContain('remove filler words')
    const parts = body.messages[1].content as { type: string; input_audio?: { data: string; format: string } }[]
    const audio = parts.find((p) => p.type === 'input_audio')!
    expect(audio.input_audio!.format).toBe('wav')
    expect(Buffer.from(audio.input_audio!.data, 'base64').subarray(0, 4).toString()).toBe('RIFF')
  })

  it('rejects data that is not wav without calling the API', async () => {
    const { impl, calls } = fakeFetch('x')
    const result = await transcribe({ apiKey: 'k', model: 'm', wav: new Uint8Array(100), cleanup: true, language: 'auto', context: shell }, impl, now)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('reports API errors in plain words', async () => {
    const { impl } = fakeFetch('', 401)
    const result = await transcribe({ apiKey: 'k', model: 'm', wav: toneWav(0.1), cleanup: true, language: 'auto', context: shell }, impl, now)
    expect(result).toMatchObject({ ok: false, error: 'OpenRouter rejected the API key.' })
  })

  it('tests a model with a short tone', async () => {
    const { impl, calls } = fakeFetch('')
    const result = await testVoiceModel('k', 'm', 'http://127.0.0.1:1/x', impl, now)
    expect(result.ok).toBe(true)
    expect(calls[0].url).toBe('http://127.0.0.1:1/x')
  })
})

describe('prompt and reply', () => {
  it('tells the model where the text goes', () => {
    expect(systemPrompt(true, 'tr', { kind: 'agent', name: 'Claude Code' })).toContain('coding agent Claude Code')
    expect(systemPrompt(false, 'en', shell)).toContain('exactly as spoken')
    expect(systemPrompt(true, 'tr', shell)).toContain('Turkish characters')
    expect(systemPrompt(true, 'tr', shell, ['TermFlow', 'pnpm'])).toContain('exactly like this: TermFlow, pnpm.')
    expect(systemPrompt(true, 'tr', shell)).not.toContain('exactly like this')
    expect(systemPrompt(true, 'tr', shell, [], true)).toContain('"gönder"')
  })

  it('strips quotes, fences, labels and silence notes', () => {
    expect(cleanReply('"git status"')).toBe('git status')
    expect(cleanReply('```\nnpm test\n```')).toBe('npm test')
    expect(cleanReply('Transcript: merhaba dünya')).toBe('merhaba dünya')
    expect(cleanReply('[no speech detected]')).toBe('')
    expect(cleanReply('(silence)')).toBe('')
    expect(cleanReply('Bu dosyayı "README.md" olarak kaydet')).toBe('Bu dosyayı "README.md" olarak kaydet')
  })
})
