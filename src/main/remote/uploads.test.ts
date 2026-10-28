import { describe, expect, it } from 'vitest'
import { safeUploadName } from './uploads'

describe('safeUploadName', () => {
  it('keeps plain names and strips paths and control characters', () => {
    expect(safeUploadName('photo 1.jpg')).toBe('photo 1.jpg')
    expect(safeUploadName('..\\..\\Windows\\evil.exe')).toBe('evil.exe')
    expect(safeUploadName('../../etc/passwd')).toBe('passwd')
    expect(safeUploadName('a<b>:c.txt')).toBe('a_b__c.txt')
  })
  it('avoids empty and reserved Windows names', () => {
    expect(safeUploadName('')).toBe('upload')
    expect(safeUploadName('...')).toBe('upload')
    expect(safeUploadName('con.txt')).toBe('_con.txt')
  })
})
