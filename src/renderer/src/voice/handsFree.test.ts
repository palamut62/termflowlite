import { describe, expect, it } from 'vitest'
import { NO_SPEECH_MS, nothingHeardMessage, silenceDetector, splitSendWord } from './handsFree'

describe('silenceDetector', () => {
  it('stops once after speech and then silence', () => {
    const feed = silenceDetector(1500, 0)
    expect(feed(0.1, 100)).toBeNull()
    expect(feed(0.001, 1000)).toBeNull()
    expect(feed(0.001, 1600)).toBe('stop')
    expect(feed(0.001, 3000)).toBeNull()
  })

  it('speech keeps it going', () => {
    const feed = silenceDetector(1000, 0)
    feed(0.1, 0)
    expect(feed(0.05, 900)).toBeNull()
    expect(feed(0.001, 1800)).toBeNull()
    expect(feed(0.001, 1900)).toBe('stop')
  })

  it('gives up when nothing is said', () => {
    const feed = silenceDetector(1500, 0)
    expect(feed(0.005, NO_SPEECH_MS - 1)).toBeNull()
    expect(feed(0.005, NO_SPEECH_MS)).toBe('nothing')
  })

  it('0 never stops on silence', () => {
    const feed = silenceDetector(0, 0)
    feed(0.1, 0)
    expect(feed(0.001, 60_000)).toBeNull()
  })
})

describe('nothingHeardMessage', () => {
  it('tells a muted microphone apart from not speaking', () => {
    // -97 dB: what a muted Realtek microphone delivered.
    expect(nothingHeardMessage(1.4e-5, false)).toContain('microphone gives no sound')
    expect(nothingHeardMessage(1.4e-5, true)).toContain('Sound > Input')
    expect(nothingHeardMessage(0.003, false)).toBe('Nothing was heard. Hold Space while you speak.')
    expect(nothingHeardMessage(0.003, true)).toBe('Nothing was heard.')
  })
})

describe('splitSendWord', () => {
  it('strips a closing send word', () => {
    expect(splitSendWord('Testleri düzelt, gönder.')).toEqual({ text: 'Testleri düzelt', send: true })
    expect(splitSendWord('Fix the tests. Send!')).toEqual({ text: 'Fix the tests', send: true })
    expect(splitSendWord('run the build enter')).toEqual({ text: 'run the build', send: true })
    expect(splitSendWord('GÖNDER')).toEqual({ text: '', send: true })
  })

  it('leaves other text alone', () => {
    expect(splitSendWord('Bunu gönder ve bekle')).toEqual({ text: 'Bunu gönder ve bekle', send: false })
    expect(splitSendWord('resend')).toEqual({ text: 'resend', send: false })
    expect(splitSendWord('isimgönder')).toEqual({ text: 'isimgönder', send: false })
  })
})
