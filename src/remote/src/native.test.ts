import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('iPhone app bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('window', {})
  })

  it('is inert in a plain browser', async () => {
    const native = await import('./native')
    expect(native.hasNative()).toBe(false)
    expect(() => native.postNative({ type: 'paste' })).not.toThrow()
  })

  it('posts to the app and queues text that arrives before the terminal listens', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('window', { webkit: { messageHandlers: { termflow: { postMessage: (m: unknown) => posted.push(m) } } } })
    const native = await import('./native')
    native.installNativeReceiver(() => 'key')
    expect(window.termflowNative?.token()).toBe('key')

    window.termflowNative!.receive({ type: 'text', text: 'run tests', enter: true })
    window.termflowNative!.receive({ type: 'info', info: { biometry: 'Face ID', lockEnabled: true, signatureExpires: null } })
    const seen: unknown[] = []
    const off = native.onNative((event) => seen.push(event))
    expect(seen).toEqual([{ type: 'text', text: 'run tests', enter: true }])

    window.termflowNative!.receive({ type: 'notice', text: 'hello' })
    expect(seen).toHaveLength(2)
    off()

    expect(native.hasNative()).toBe(true)
    await native.copyText('abc')
    expect(posted).toEqual([{ type: 'copy', text: 'abc' }])
  })

  it('taps only when a tab that worked a while stops, not on prompt flicker', async () => {
    const { finishedHaptic } = await import('./native')
    let state = finishedHaptic(new Map(), [{ id: 'a', activity: 'running' }, { id: 'b', activity: 'running' }], 0)
    expect(state.kind).toBeNull()
    // b flickers to a prompt after 1 s: silent.
    state = finishedHaptic(state.seen, [{ id: 'a', activity: 'running' }, { id: 'b', activity: 'waiting' }], 1_000)
    expect(state.kind).toBeNull()
    // a finishes after 6 s of work: success.
    state = finishedHaptic(state.seen, [{ id: 'a', activity: 'completed' }, { id: 'b', activity: 'waiting' }], 6_000)
    expect(state.kind).toBe('success')
    state = finishedHaptic(state.seen, [{ id: 'a', activity: 'running' }, { id: 'b', activity: 'running' }], 7_000)
    // Both stop together: needing input wins over done.
    state = finishedHaptic(state.seen, [{ id: 'a', activity: 'completed' }, { id: 'b', activity: 'waiting' }], 13_000)
    expect(state.kind).toBe('warning')
    // Unchanged state keeps its start time; a closed tab is forgotten.
    expect(finishedHaptic(state.seen, [{ id: 'a', activity: 'completed' }], 20_000).seen).toEqual(new Map([['a', { activity: 'completed', since: 13_000 }]]))
  })
})
