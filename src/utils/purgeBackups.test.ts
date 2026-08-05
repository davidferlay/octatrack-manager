import { describe, it, expect } from 'vitest'
import { isUnderBackupsDir } from './purgeBackups'

describe('isUnderBackupsDir', () => {
  it('is true for a file directly inside a project\'s backups/ directory', () => {
    expect(isUnderBackupsDir('/sets/Set1/PROJ1/backups/old.wav', ['/sets/Set1/PROJ1'])).toBe(true)
  })

  it('is true for a file nested deeper inside backups/', () => {
    expect(isUnderBackupsDir('/sets/Set1/PROJ1/backups/2026-01-01_copy_bank/bank01.work', ['/sets/Set1/PROJ1'])).toBe(true)
  })

  it('is true for the backups/ directory itself (a collapsed PurgeUnit::Directory)', () => {
    expect(isUnderBackupsDir('/sets/Set1/PROJ1/backups', ['/sets/Set1/PROJ1'])).toBe(true)
  })

  it('is false for a file outside backups/', () => {
    expect(isUnderBackupsDir('/sets/Set1/PROJ1/AUDIO/kick.wav', ['/sets/Set1/PROJ1'])).toBe(false)
  })

  it('is false for a sibling directory that merely starts with "backups"', () => {
    expect(isUnderBackupsDir('/sets/Set1/PROJ1/backups-old/kick.wav', ['/sets/Set1/PROJ1'])).toBe(false)
  })

  it('checks against every project root, not just the first', () => {
    const roots = ['/sets/Set1/PROJ1', '/sets/Set1/PROJ2']
    expect(isUnderBackupsDir('/sets/Set1/PROJ2/backups/old.wav', roots)).toBe(true)
  })

  it('is false when no project root matches (e.g. an Audio Pool file)', () => {
    expect(isUnderBackupsDir('/sets/Set1/AUDIO/kick.wav', ['/sets/Set1/PROJ1'])).toBe(false)
  })

  it('normalizes backslash path separators', () => {
    expect(isUnderBackupsDir('C:\\Sets\\Set1\\PROJ1\\backups\\old.wav', ['C:\\Sets\\Set1\\PROJ1'])).toBe(true)
  })
})
