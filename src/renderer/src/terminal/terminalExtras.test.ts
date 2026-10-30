import { describe, expect, it } from 'vitest'
import { parseOsc52, shiftEnterSequence, urlAt } from './terminalExtras'

describe('parseOsc52', () => {
  it('decodes a clipboard write, including UTF-8', () => {
    expect(parseOsc52(`c;${btoa('hello')}`)).toBe('hello')
    expect(parseOsc52(`;${Buffer.from('şğü').toString('base64')}`)).toBe('şğü')
  })

  it('refuses reads, bad selectors, bad base64 and huge payloads', () => {
    expect(parseOsc52('c;?')).toBeNull()
    expect(parseOsc52('x;aGk=')).toBeNull()
    expect(parseOsc52('c;not base64!')).toBeNull()
    expect(parseOsc52(`c;${'A'.repeat(2_000_000)}`)).toBeNull()
    expect(parseOsc52('nosemicolon')).toBeNull()
  })
})

describe('urlAt', () => {
  const line = 'see https://example.com/a?b=1, then (http://x.io).'
  it('finds the URL under the column and trims trailing punctuation', () => {
    expect(urlAt(line, 6)).toBe('https://example.com/a?b=1')
    expect(urlAt(line, 38)).toBe('http://x.io')
    expect(urlAt(line, 1)).toBeNull()
  })
})

it('maps Shift+Enter per agent and leaves shells alone', () => {
  expect(shiftEnterSequence('claude')).toBe('\x1b\r')
  expect(shiftEnterSequence('codex')).toBe('\n')
  expect(shiftEnterSequence('gemini')).toBe('\n')
  expect(shiftEnterSequence(null)).toBeNull()
})
