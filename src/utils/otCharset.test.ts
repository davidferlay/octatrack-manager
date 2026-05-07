import { describe, test, expect } from 'vitest'
import {
  OT_CHARSET,
  FS_FORBIDDEN,
  MAX_PROJECT_NAME_LEN,
  ALLOWED_CHARS,
  isCharAllowed,
  filterProjectName,
} from './otCharset'

describe('OT_CHARSET', () => {
  test('contains uppercase ASCII letters', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(OT_CHARSET).toContain(ch)
    }
  })

  test('contains lowercase ASCII letters', () => {
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      expect(OT_CHARSET).toContain(ch)
    }
  })

  test('contains digits', () => {
    for (const ch of '0123456789') {
      expect(OT_CHARSET).toContain(ch)
    }
  })

  test('contains Nordic characters', () => {
    for (const ch of 'ÅÄÖÜØøåäöü') {
      expect(OT_CHARSET).toContain(ch)
    }
  })

  test('contains space', () => {
    expect(OT_CHARSET).toContain(' ')
  })
})

describe('MAX_PROJECT_NAME_LEN', () => {
  test('is 32', () => {
    expect(MAX_PROJECT_NAME_LEN).toBe(32)
  })
})

describe('ALLOWED_CHARS', () => {
  test('excludes FS_FORBIDDEN characters', () => {
    for (const ch of FS_FORBIDDEN) {
      expect(ALLOWED_CHARS).not.toContain(ch)
    }
  })

  test('contains no duplicates', () => {
    expect(new Set(ALLOWED_CHARS).size).toBe(ALLOWED_CHARS.length)
  })
})

describe('isCharAllowed', () => {
  test('allows normal ASCII letters', () => {
    expect(isCharAllowed('A')).toBe(true)
    expect(isCharAllowed('z')).toBe(true)
  })

  test('allows digits', () => {
    expect(isCharAllowed('5')).toBe(true)
  })

  test('allows space', () => {
    expect(isCharAllowed(' ')).toBe(true)
  })

  test('allows accented characters', () => {
    expect(isCharAllowed('Å')).toBe(true)
    expect(isCharAllowed('ü')).toBe(true)
  })

  test('rejects emoji', () => {
    expect(isCharAllowed('🎵')).toBe(false)
  })

  test('rejects CJK characters', () => {
    expect(isCharAllowed('漢')).toBe(false)
  })

  test('rejects filesystem-forbidden characters', () => {
    expect(isCharAllowed('/')).toBe(false)
    expect(isCharAllowed('\\')).toBe(false)
    expect(isCharAllowed(':')).toBe(false)
    expect(isCharAllowed('*')).toBe(false)
    expect(isCharAllowed('?')).toBe(false)
    expect(isCharAllowed('"')).toBe(false)
  })
})

describe('filterProjectName', () => {
  test('passes valid name unchanged', () => {
    const [result, filtered] = filterProjectName('MYPROJECT')
    expect(result).toBe('MYPROJECT')
    expect(filtered).toBe(false)
  })

  test('removes invalid characters', () => {
    const [result, filtered] = filterProjectName('TEST€NAME')
    expect(result).toBe('TESTNAME')
    expect(filtered).toBe(true)
  })

  test('removes filesystem-forbidden characters', () => {
    const [result, filtered] = filterProjectName('A/B\\C')
    expect(result).toBe('ABC')
    expect(filtered).toBe(true)
  })

  test('caps at max length (default 32)', () => {
    const long = 'A'.repeat(40)
    const [result] = filterProjectName(long)
    expect(result.length).toBe(32)
  })

  test('caps at custom max length', () => {
    const [result] = filterProjectName('ABCDEFGHIJ', 5)
    expect(result).toBe('ABCDE')
  })

  test('handles empty string', () => {
    const [result, filtered] = filterProjectName('')
    expect(result).toBe('')
    expect(filtered).toBe(false)
  })

  test('handles string of all invalid characters', () => {
    const [result, filtered] = filterProjectName('€🎵漢')
    expect(result).toBe('')
    expect(filtered).toBe(true)
  })

  test('preserves accented characters', () => {
    const [result, filtered] = filterProjectName('ÅÄÖ_test')
    expect(result).toBe('ÅÄÖ_test')
    expect(filtered).toBe(false)
  })
})
