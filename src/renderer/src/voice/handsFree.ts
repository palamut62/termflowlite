// Hands-free dictation helpers (docs/voice-input.md).

/** RMS above this counts as speech; room noise with noise suppression stays well below. */
export const SPEECH_LEVEL = 0.015
/** Hands-free recording with no speech at all gives up after this long. */
export const NO_SPEECH_MS = 10_000

/**
 * Feed microphone levels; answers once when the recording should end:
 * 'stop' after speech and then `silenceMs` without it, 'nothing' when no speech came.
 */
export function silenceDetector(silenceMs: number, start: number): (level: number, now: number) => 'stop' | 'nothing' | null {
  let lastSpeech: number | null = null
  let done = false
  return (level, now) => {
    if (done) return null
    if (level >= SPEECH_LEVEL) lastSpeech = now
    const verdict = lastSpeech === null
      ? (now - start >= NO_SPEECH_MS ? 'nothing' : null)
      : (silenceMs > 0 && now - lastSpeech >= silenceMs ? 'stop' : null)
    done = verdict !== null
    return verdict
  }
}

// A whole word at the very end (\b is ASCII-only in JS, so the boundary is spelled out).
const SEND_WORD = /(^|[^\p{L}\p{N}])(gönder|gonder|send|enter)[\s.!]*$/iu

/** "fix the tests, gönder" -> text without the word and send = true. */
export function splitSendWord(text: string): { text: string; send: boolean } {
  const match = SEND_WORD.exec(text)
  if (!match) return { text, send: false }
  return { text: text.slice(0, match.index + match[1].length).replace(/[\s,.;:!?-]+$/u, ''), send: true }
}
