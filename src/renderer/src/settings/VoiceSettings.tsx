import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Mic, RefreshCw, Trash2, Volume2 } from 'lucide-react'
import type { SpeakModel, OpenRouterModel, OpenRouterModelList, VoiceLanguage, VoiceResult } from '../../../shared/types'
import { contextText, ModelPicker, usd } from './ModelPicker'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { speak } from '../voice/speak'
import { Field, NumberInput, Select, TextInput, Toggle } from './Settings'

/** Shared with Agent Memory: one OpenRouter key for the app. */
const SECRET_ID = 'termflow-memory'
/** Shown until the model list was fetched once. */
const FALLBACK: OpenRouterModel[] = ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash', 'mistralai/voxtral-small-24b-2507']
  .map((id) => ({ id, name: id, contextLength: 0, inputPrice: null, outputPrice: null, structured: false, audio: true }))
const LANGUAGES: { value: VoiceLanguage; label: string }[] = [
  { value: 'auto', label: 'Automatic (Turkish / English)' },
  { value: 'tr', label: 'Turkish' },
  { value: 'en', label: 'English' }
]

const SILENCE = [
  { value: '1000', label: 'After 1 s of silence' },
  { value: '1500', label: 'After 1.5 s of silence' },
  { value: '2500', label: 'After 2.5 s of silence' },
  { value: '4000', label: 'After 4 s of silence' },
  { value: '0', label: 'Only with Space' }
]

function testText(result: VoiceResult): string {
  if (!result.ok) return result.error ?? 'Test failed'
  return `Works · ${(result.latencyMs / 1000).toFixed(1)} s${result.cost !== undefined ? ` · ${usd(result.cost)}` : ''}`
}

export function VoiceSettings(): React.JSX.Element {
  const voice = useSettingsStore((s) => s.settings.voice)
  const update = useSettingsStore((s) => s.update)
  const toast = useToastStore((s) => s.show)
  const [consent, setConsent] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [catalog, setCatalog] = useState<OpenRouterModelList | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<VoiceResult | null>(null)
  const [speakTest, setSpeakTest] = useState('')
  // Edited as text and saved on blur, so a trailing comma survives typing.
  const [terms, setTerms] = useState(voice.terms.join(', '))

  const refreshKey = useCallback(async (): Promise<void> => {
    setHasKey(await window.termflow.providerSecrets.has(SECRET_ID))
  }, [])

  useEffect(() => {
    void refreshKey()
    // The list is shared with Memory and cached for a day.
    void window.termflow.memory.models().then(setCatalog)
  }, [refreshKey])

  const audioModels = useMemo(() => {
    const listed = (catalog?.models ?? []).filter((m) => m.audio)
    return listed.length ? listed : FALLBACK
  }, [catalog])
  const selected = audioModels.find((m) => m.id === voice.model)

  const patch = (next: Partial<typeof voice>): Promise<void> => update({ voice: { ...voice, ...next } })

  const setEnabled = async (enabled: boolean): Promise<void> => {
    setConsent(false)
    await patch({ enabled })
  }

  const saveKey = async (): Promise<void> => {
    const key = apiKey.trim().replace(/^["']|["']$/g, '')
    if (!key) return
    try {
      await window.termflow.providerSecrets.set(SECRET_ID, key)
      setApiKey('')
      toast('OpenRouter key stored securely', 'success')
      await refreshKey()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The key could not be stored', 'error')
    }
  }

  const removeKey = async (): Promise<void> => {
    await window.termflow.providerSecrets.delete(SECRET_ID)
    await refreshKey()
  }

  const refreshModels = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const next = await window.termflow.memory.models(true)
      setCatalog(next)
      if (next.error) toast(next.error, 'error')
      else toast(`${next.models.filter((m) => m.audio).length} models accept audio`, 'success')
    } finally {
      setRefreshing(false)
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      const result = await window.termflow.voice.test(voice.model)
      setTest(result)
      toast(`${voice.model}: ${testText(result)}`, result.ok ? 'success' : 'error')
    } finally {
      setTesting(false)
    }
  }

  const patchSpeak = (next: Partial<typeof voice.speak>): Promise<void> => patch({ speak: { ...voice.speak, ...next } })
  const runSpeakTest = async (): Promise<void> => {
    setSpeakTest('Testing...')
    const result = await speak('Merhaba, ben TermFlow. Sesli okuma çalışıyor.')
    setSpeakTest('firstSoundMs' in result ? `Works · first sound in ${(result.firstSoundMs / 1000).toFixed(1)} s` : result.error)
  }

  const audioPrice = selected?.audioPrice
  const modelHint = selected
    ? `${contextText(selected.contextLength)}${audioPrice != null ? ` · audio ${usd(audioPrice)} / 1M tokens (~${usd(audioPrice * 32 * 10 / 1_000_000)} per 10 s)` : ''}`
    : catalog ? 'This model does not take audio input in the OpenRouter list' : 'Loading the model list...'

  return (
    <section>
      <div className="settings-section-title"><Mic size={14} /> Voice Input</div>
      <p className="settings-note">
        Hold <strong>Space</strong> in a terminal and speak; release it and the text is typed where the cursor is, cleaned up and
        without pressing Enter. A short press still types a space. Works at shell prompts and in Claude Code, Codex and OpenCode.
        Esc while recording cancels. For longer requests press <strong>Ctrl+Shift+Space</strong> once and just talk: it stops by
        itself when you pause.
      </p>

      <Field label="Enable voice input" hint="Hold Space to dictate">
        <Toggle checked={voice.enabled} label="Enable voice input" onChange={(on) => (on ? setConsent(true) : void setEnabled(false))} />
      </Field>
      {consent && (
        <div className="memory-consent" role="alertdialog" aria-label="Enable voice input">
          <strong>What is sent to OpenRouter</strong>
          <span>
            Each recording (only while you hold Space or after Ctrl+Shift+Space) is sent to the chosen OpenRouter model to be turned into text, together
            with the kind of terminal you type into. Nothing is recorded otherwise, and recordings are not kept on this computer.
          </span>
          <div className="profile-form-actions">
            <button className="settings-btn settings-btn-primary" onClick={() => void setEnabled(true)}>Enable</button>
            <button className="settings-btn" onClick={() => setConsent(false)}>Cancel</button>
          </div>
        </div>
      )}

      <Field label="OpenRouter API key" hint={hasKey ? 'Stored securely, shared with Memory. Paste a new key to replace it.' : 'Encrypted by the operating system; shared with Memory'}>
        <span className="memory-inline">
          <TextInput className="settings-input-wide" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? 'Stored securely' : 'sk-or-...'} />
          <button className="settings-btn settings-btn-small" disabled={!apiKey.trim()} onClick={() => void saveKey()}>Save</button>
          {hasKey && <button className="settings-btn settings-btn-small settings-btn-danger" onClick={() => void removeKey()} aria-label="Remove OpenRouter key"><Trash2 size={12} /></button>}
        </span>
      </Field>

      <Field label="Model" hint={modelHint}>
        <span className="memory-inline">
          <ModelPicker models={audioModels} value={voice.model} onChange={(id) => { setTest(null); void patch({ model: id }) }} showStructured={false} />
          <button className="settings-btn settings-btn-small" disabled={refreshing} onClick={() => void refreshModels()} aria-label="Refresh model list" title="Fetch the model list from OpenRouter again">
            <RefreshCw size={12} className={refreshing ? 'memory-spin' : undefined} />
          </button>
          <button className="settings-btn settings-btn-small" disabled={testing || !hasKey} onClick={() => void runTest()} title={hasKey ? 'Send a short sound to check the key and the model' : 'Save an OpenRouter API key first'}>
            <FlaskConical size={12} className={testing ? 'memory-spin' : undefined} /> {testing ? 'Testing...' : 'Test'}
          </button>
        </span>
      </Field>
      {test && <p className="settings-note"><span className={test.ok ? 'memory-status' : 'memory-status memory-status-error'}>Test: {testText(test)}</span></p>}

      <Field label="Clean up text" hint="Punctuation, spelling, no filler words, commands and file names written correctly">
        <Toggle checked={voice.cleanup} label="Clean up text" onChange={(cleanup) => void patch({ cleanup })} />
      </Field>
      <Field label="Language" hint="What you usually speak">
        <Select value={voice.language} options={LANGUAGES} onChange={(language) => void patch({ language: language as VoiceLanguage })} />
      </Field>
      <Field label="Hold time" hint="How long Space is held before recording starts (ms)">
        <NumberInput value={voice.holdMs} min={250} max={1000} step={50} onChange={(holdMs) => void patch({ holdMs })} />
      </Field>
      <Field label="Hands-free stop" hint="Ctrl+Shift+Space records without holding a key; it ends after this much silence (or press Space)">
        <Select value={String(voice.silenceMs)} options={SILENCE} onChange={(value) => void patch({ silenceMs: Number(value) })} />
      </Field>
      <Field label="Say &quot;send&quot; to submit" hint="In Claude Code, Codex and OpenCode: end with &quot;gönder&quot;, &quot;send&quot; or &quot;enter&quot; and Enter is pressed. Never at a shell prompt">
        <Toggle checked={voice.sendWord} label="Say send to submit" onChange={(sendWord) => void patch({ sendWord })} />
      </Field>
      <Field label="Terms" hint="Names and words to spell exactly like this, separated by commas (e.g. TermFlow, Vercel, pnpm)">
        <TextInput
          className="settings-input-wide"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          onBlur={() => void patch({ terms: terms.split(',').map((t) => t.trim()).filter(Boolean) })}
          placeholder="TermFlow, Vercel, pnpm"
        />
      </Field>

      <div className="settings-section-title"><Volume2 size={14} /> Read Aloud</div>
      <p className="settings-note">
        Select text in a terminal, right-click and choose <strong>Read Aloud</strong>. The Turkish voice runs on this computer
        with the local models of tts-studyo (Antalia-2 Mini, EMA Lightning); nothing is sent online. The server is started when
        needed and closed with the app.
      </p>
      <Field label="Enable read aloud" hint="Adds Read Aloud to the terminal menu">
        <Toggle checked={voice.speak.enabled} label="Enable read aloud" onChange={(enabled) => void patchSpeak({ enabled })} />
      </Field>
      <Field label="Voice model" hint="Antalia is a little faster; try both">
        <Select value={voice.speak.model} options={[{ value: 'antalia', label: 'Antalia-2 Mini' }, { value: 'ema', label: 'EMA Lightning' }]} onChange={(model) => void patchSpeak({ model: model as SpeakModel })} />
      </Field>
      <Field label="Speed" hint="0.5 - 2.0">
        <NumberInput value={voice.speak.speed} min={0.5} max={2} step={0.1} onChange={(speed) => void patchSpeak({ speed })} />
      </Field>
      <Field label="tts-studyo folder" hint="Empty = Projects/tts-studyo in your home folder">
        <TextInput className="settings-input-wide" value={voice.speak.studioDir} onChange={(e) => void patchSpeak({ studioDir: e.target.value })} placeholder="C:\Users\you\Projects\tts-studyo" />
      </Field>
      <Field label="Test" hint={speakTest || 'Speaks one sentence'}>
        <button className="settings-btn settings-btn-small" disabled={!voice.speak.enabled} onClick={() => void runSpeakTest()}>
          <FlaskConical size={12} /> Test voice
        </button>
      </Field>
    </section>
  )
}
