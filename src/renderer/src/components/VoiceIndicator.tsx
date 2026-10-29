import { useEffect, useState } from 'react'
import { Loader2, Mic, Square, Volume2 } from 'lucide-react'
import { useVoiceStore } from '../store/voiceStore'
import { stopSpeaking } from '../voice/speak'

const BARS = 5

/** Dictation status above the status bar: listening (with a level meter) or transcribing. */
export function VoiceIndicator(): React.JSX.Element | null {
  const phase = useVoiceStore((s) => s.phase)
  const level = useVoiceStore((s) => s.level)
  const startedAt = useVoiceStore((s) => s.startedAt)
  const speaking = useVoiceStore((s) => s.speaking)
  const locked = useVoiceStore((s) => s.locked)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [phase])

  if (phase === 'idle' && speaking !== 'idle') {
    return (
      <div className="voice-indicator voice-speaking" role="status" aria-live="polite">
        {speaking === 'preparing' ? <Loader2 size={14} className="voice-spin" /> : <Volume2 size={14} />}
        <span>{speaking === 'preparing' ? 'Preparing voice...' : 'Reading aloud'}</span>
        <button className="voice-stop" onClick={stopSpeaking} aria-label="Stop reading"><Square size={10} /> Stop</button>
      </div>
    )
  }
  if (phase === 'idle') return null
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  // Speech sits around 0.02-0.2 RMS; spread that over the bars.
  const lit = Math.min(BARS, Math.round(Math.sqrt(level / 0.2) * BARS))

  return (
    <div className={`voice-indicator voice-${phase}`} role="status" aria-live="polite">
      {phase === 'transcribing'
        ? <><Loader2 size={14} className="voice-spin" /> Transcribing...</>
        : (
          <>
            <Mic size={14} className="voice-mic" />
            <span>{phase === 'starting' ? 'Opening microphone...' : `Listening ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>
            <span className="voice-meter" aria-hidden="true">
              {Array.from({ length: BARS }, (_, i) => <span key={i} className={i < lit ? 'on' : ''} style={{ height: `${6 + i * 3}px` }} />)}
            </span>
            <span className="voice-hint">{locked ? 'Hands-free · pause or Space to insert · Esc to cancel' : 'Release to insert · Esc to cancel'}</span>
          </>
        )}
    </div>
  )
}
