import { describe, it, expect } from 'vitest'
import { formatTrackName, getTrackDisplayNumber } from './trackUtils'

describe('formatTrackName', () => {
  describe('audio tracks (0-7)', () => {
    it('formats track 0 as T1', () => {
      expect(formatTrackName(0)).toBe('T1')
    })

    it('formats track 7 as T8', () => {
      expect(formatTrackName(7)).toBe('T8')
    })

    it('formats all audio tracks correctly', () => {
      for (let i = 0; i <= 7; i++) {
        expect(formatTrackName(i)).toBe(`T${i + 1}`)
      }
    })
  })

  describe('MIDI tracks (8-15)', () => {
    it('formats track 8 as T1', () => {
      expect(formatTrackName(8)).toBe('T1')
    })

    it('formats track 15 as T8', () => {
      expect(formatTrackName(15)).toBe('T8')
    })

    it('formats all MIDI tracks correctly', () => {
      for (let i = 8; i <= 15; i++) {
        expect(formatTrackName(i)).toBe(`T${i - 7}`)
      }
    })
  })
})

describe('getTrackDisplayNumber', () => {
  describe('audio tracks (0-7)', () => {
    it('returns 1 for track 0', () => {
      expect(getTrackDisplayNumber(0)).toBe(1)
    })

    it('returns 8 for track 7', () => {
      expect(getTrackDisplayNumber(7)).toBe(8)
    })
  })

  describe('MIDI tracks (8-15)', () => {
    it('returns 1 for track 8', () => {
      expect(getTrackDisplayNumber(8)).toBe(1)
    })

    it('returns 8 for track 15', () => {
      expect(getTrackDisplayNumber(15)).toBe(8)
    })
  })
})
