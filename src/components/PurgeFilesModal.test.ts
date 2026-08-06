import { describe, it, expect } from 'vitest'
import { purgeAudioFileCount, type PurgeUnit } from './PurgeFilesModal'

describe('purgeAudioFileCount', () => {
  it('is 0 for an empty plan', () => {
    expect(purgeAudioFileCount([])).toBe(0)
  })

  it('counts each lone File unit as 1', () => {
    const units: PurgeUnit[] = [
      { kind: 'File', path: '/a.wav', origin: 'PROJ', size: 1, slots: [] },
      { kind: 'File', path: '/b.wav', origin: 'PROJ', size: 1, slots: [] },
    ]
    expect(purgeAudioFileCount(units)).toBe(2)
  })

  it('counts a collapsed Directory unit by its file_count, not as a single item', () => {
    const units: PurgeUnit[] = [
      {
        kind: 'Directory',
        path: '/kit',
        origin: 'PROJ',
        file_count: 6,
        size: 100,
        files: [],
      },
    ]
    expect(purgeAudioFileCount(units)).toBe(6)
  })

  it('sums lone files and collapsed directories together (the reported 15+6=21 case)', () => {
    const units: PurgeUnit[] = [
      ...Array.from({ length: 15 }, (_, i) => ({
        kind: 'File' as const,
        path: `/root${i}.wav`,
        origin: 'PROJ',
        size: 1,
        slots: [],
      })),
      {
        kind: 'Directory',
        path: '/kit',
        origin: 'PROJ',
        file_count: 6,
        size: 100,
        files: [],
      },
    ]
    // Plain units.length would read 16 (15 files + 1 directory row) - the
    // actual audio file count is 21.
    expect(units.length).toBe(16)
    expect(purgeAudioFileCount(units)).toBe(21)
  })
})
