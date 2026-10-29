import { describe, expect, it } from 'vitest'
import { HoldToTalk, type HoldKeyEvent } from './holdToTalk'

function setup(enabled = true) {
  const log: string[] = []
  let pending: (() => void) | null = null
  const hold = new HoldToTalk({
    holdMs: () => 400,
    enabled: () => enabled,
    onTap: () => log.push('tap'),
    onStart: (locked) => log.push(locked ? 'lock' : 'start'),
    onStop: () => log.push('stop'),
    onCancel: () => log.push('cancel'),
    setTimer: (cb) => { pending = cb; return 1 },
    clearTimer: () => { pending = null }
  })
  const ev = (type: string, key: string, extra: Partial<HoldKeyEvent> = {}): boolean =>
    hold.handle({ type, key, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra })
  const elapse = (): void => { const cb = pending; pending = null; cb?.() }
  return { hold, log, ev, elapse }
}

describe('HoldToTalk', () => {
  it('a short press types a space', () => {
    const { log, ev } = setup()
    expect(ev('keydown', ' ')).toBe(true)
    expect(ev('keyup', ' ')).toBe(true)
    expect(log).toEqual(['tap'])
  })

  it('holding records and releasing stops', () => {
    const { log, ev, elapse, hold } = setup()
    ev('keydown', ' ')
    ev('keydown', ' ', { repeat: true })
    elapse()
    expect(hold.recording).toBe(true)
    expect(ev('keydown', ' ', { repeat: true })).toBe(true)
    expect(ev('keyup', ' ')).toBe(true)
    expect(log).toEqual(['start', 'stop'])
  })

  it('fast typing types the space before the next key and never records', () => {
    const { log, ev, elapse } = setup()
    ev('keydown', ' ')
    expect(ev('keydown', 'a')).toBe(false)
    elapse()
    expect(ev('keyup', ' ')).toBe(false)
    expect(log).toEqual(['tap'])
  })

  it('Escape cancels and the release is swallowed', () => {
    const { log, ev, elapse } = setup()
    ev('keydown', ' ')
    elapse()
    expect(ev('keydown', 'Escape')).toBe(true)
    expect(ev('keyup', ' ')).toBe(true)
    expect(log).toEqual(['start', 'cancel'])
    expect(ev('keydown', ' ')).toBe(true) // ready again
  })

  it('keys pressed while recording do not reach the terminal', () => {
    const { ev, elapse } = setup()
    ev('keydown', ' ')
    elapse()
    expect(ev('keydown', 'x')).toBe(true)
  })

  it('leaves Space alone when off, with modifiers, or while composing', () => {
    expect(setup(false).ev('keydown', ' ')).toBe(false)
    expect(setup().ev('keydown', ' ', { ctrlKey: true })).toBe(false)
    expect(setup().ev('keydown', ' ', { shiftKey: true })).toBe(false)
    expect(setup().ev('keydown', ' ', { isComposing: true })).toBe(false)
  })

  it('Ctrl+Shift+Space records hands-free until Space', () => {
    const { log, ev, hold } = setup()
    const lock = { ctrlKey: true, shiftKey: true }
    expect(ev('keydown', ' ', lock)).toBe(true)
    expect(ev('keydown', ' ', { ...lock, repeat: true })).toBe(true)
    expect(ev('keyup', ' ', lock)).toBe(true)
    expect(hold.recording).toBe(true)
    expect(ev('keydown', 'x')).toBe(true)
    expect(ev('keydown', ' ')).toBe(true)
    expect(log).toEqual(['lock', 'stop'])
    expect(ev('keyup', ' ')).toBe(false) // idle again, nothing typed
    expect(hold.recording).toBe(false)
  })

  it('hands-free: Escape cancels, silence stops from outside', () => {
    const a = setup()
    a.ev('keydown', ' ', { ctrlKey: true, shiftKey: true })
    a.ev('keydown', 'Escape')
    expect(a.log).toEqual(['lock', 'cancel'])
    expect(a.ev('keydown', ' ')).toBe(true) // ready for hold-to-talk
    const b = setup()
    b.ev('keydown', ' ', { ctrlKey: true, shiftKey: true })
    b.hold.stopFromOutside()
    expect(b.hold.recording).toBe(false)
    expect(b.ev('keydown', ' ', { ctrlKey: true, shiftKey: true })).toBe(true)
    expect(b.log).toEqual(['lock', 'lock'])
  })

  it('losing focus cancels a recording', () => {
    const { log, ev, elapse, hold } = setup()
    ev('keydown', ' ')
    elapse()
    hold.blur()
    expect(log).toEqual(['start', 'cancel'])
    expect(hold.recording).toBe(false)
  })
})
