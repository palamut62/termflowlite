import type { Terminal } from '@xterm/xterm'
import { agentForProfile, mergeProfiles } from '../../../shared/profiles'
import { useSettingsStore } from '../store/settingsStore'
import { useTerminalStore } from '../store/terminalStore'
import { useToastStore } from '../store/toastStore'
import { useVoiceStore } from '../store/voiceStore'
import { silenceDetector, splitSendWord } from './handsFree'
import { HoldToTalk } from './holdToTalk'
import { MAX_RECORDING_MS, microphoneError, startRecording, type Recording } from './recorder'

const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' } as const
/** Shorter or quieter recordings are treated as "nothing said" and never uploaded. */
const MIN_SECONDS = 0.35
const MIN_PEAK = 0.008

/** Where the text goes, so the model writes a command or a prompt. */
function contextFor(tabId: string): { kind: 'agent' | 'shell'; name: string } {
  const settings = useSettingsStore.getState().settings
  const tab = useTerminalStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return { kind: 'shell', name: 'terminal' }
  const agent = agentForProfile(settings, tab.profileId)
  if (agent) return { kind: 'agent', name: AGENT_NAMES[agent] }
  const profile = mergeProfiles(settings.profiles).find((p) => p.id === tab.profileId)
  const shell = useSettingsStore.getState().shells.find((s) => s.id === tab.profileId)
  return { kind: 'shell', name: profile?.name ?? shell?.name ?? tab.title }
}

const toast = (text: string, tone: 'info' | 'error' = 'info'): void => useToastStore.getState().show(text, tone)

/** One dictation at a time, across all terminals. */
let session: { tabId: string; hold: HoldToTalk; recording: Recording | null; stopRequested: boolean; cancelled: boolean; limit: ReturnType<typeof setTimeout> | null } | null = null

function finishSession(): void {
  if (session?.limit) clearTimeout(session.limit)
  session = null
}

async function begin(tabId: string, hold: HoldToTalk, term: Terminal, locked: boolean): Promise<void> {
  if (session) cancel()
  const current = { tabId, hold, recording: null as Recording | null, stopRequested: false, cancelled: false, limit: null as ReturnType<typeof setTimeout> | null }
  session = current
  useVoiceStore.getState().set({ phase: 'starting', tabId, startedAt: Date.now(), level: 0, locked })
  // Hands-free: nobody releases a key, so silence ends the recording.
  const silent = locked ? silenceDetector(useSettingsStore.getState().settings.voice.silenceMs, Date.now()) : null
  const onLevel = (level: number): void => {
    useVoiceStore.getState().set({ level })
    const verdict = silent?.(level, Date.now())
    if (!verdict || session !== current) return
    hold.stopFromOutside()
    if (verdict === 'stop') void stop(term)
    else {
      cancel()
      toast('Nothing was heard.')
    }
  }
  try {
    current.recording = await startRecording(onLevel)
  } catch (error) {
    finishSession()
    hold.stopFromOutside()
    useVoiceStore.getState().set({ phase: 'idle', level: 0 })
    toast(microphoneError(error), 'error')
    return
  }
  if (current.cancelled) {
    current.recording.cancel()
    return
  }
  useVoiceStore.getState().set({ phase: 'recording', startedAt: Date.now() })
  current.limit = setTimeout(() => {
    hold.stopFromOutside()
    void stop(term)
    toast('Recording stopped after 60 seconds.')
  }, MAX_RECORDING_MS)
  if (current.stopRequested) void stop(term)
}

async function stop(term: Terminal): Promise<void> {
  const current = session
  if (!current) return
  if (!current.recording) {
    current.stopRequested = true // the microphone is still opening
    return
  }
  finishSession()
  const result = await current.recording.stop()
  if (!result || result.seconds < MIN_SECONDS || result.peak < MIN_PEAK) {
    useVoiceStore.getState().set({ phase: 'idle', level: 0 })
    toast('Nothing was heard. Hold Space while you speak.')
    return
  }
  useVoiceStore.getState().set({ phase: 'transcribing', level: 0 })
  try {
    const context = contextFor(current.tabId)
    const answer = await window.termflow.voice.transcribe(result.wav, context)
    if (!answer.ok) toast(answer.error ?? 'The recording could not be transcribed.', 'error')
    else if (!answer.text) toast('No speech was recognized.')
    else {
      // Spoken "send" presses Enter, only in agent tabs: at a shell it would run a command unseen.
      const { text, send } = context.kind === 'agent' && useSettingsStore.getState().settings.voice.sendWord
        ? splitSendWord(answer.text)
        : { text: answer.text, send: false }
      // paste() follows bracketed paste, so a multi-line prompt stays one block; Enter is left to the user.
      if (text) term.paste(text)
      // A short gap so the agent has taken the paste before Enter arrives.
      if (send) setTimeout(() => term.input('\r', true), 80)
    }
  } catch {
    toast('The recording could not be transcribed.', 'error')
  } finally {
    useVoiceStore.getState().set({ phase: 'idle', level: 0 })
  }
}

function cancel(): void {
  const current = session
  if (!current) return
  current.cancelled = true
  current.recording?.cancel()
  finishSession()
  useVoiceStore.getState().set({ phase: 'idle', level: 0 })
}

/** Hold-to-talk for one terminal; feed it key events from xterm's key handler. */
export function createVoiceInput(tabId: string, term: Terminal): HoldToTalk {
  const hold: HoldToTalk = new HoldToTalk({
    holdMs: () => useSettingsStore.getState().settings.voice.holdMs,
    enabled: () => useSettingsStore.getState().settings.voice.enabled && useVoiceStore.getState().phase !== 'transcribing',
    onTap: () => term.input(' ', true),
    onStart: (locked) => void begin(tabId, hold, term, locked),
    onStop: () => void stop(term),
    onCancel: () => {
      cancel()
      toast('Dictation cancelled.')
    },
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  })
  return hold
}
