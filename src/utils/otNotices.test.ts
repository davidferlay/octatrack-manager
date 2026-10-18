import { describe, it, expect } from 'vitest'
import { otNotices, type OtCarry, type OtApplied } from './otNotices'

const carry = (over: Partial<OtCarry>): OtCarry => ({
  audio: 'loop.wav', ot: 'loop.ot', outcome: 'copied', from_rate: null, reason: null, replaced: false,
  ...over,
})
const applied = (over: Partial<OtApplied>): OtApplied => ({
  slot_index: 3, ot: 'loop.ot', slices: 8, error: null, ...over,
})

describe('otNotices', () => {
  it('says nothing when no .ot was involved', () => {
    expect(otNotices([], [], 'F')).toEqual({ lines: [], warning: false })
  })

  it('names a copied .ot and the slot that took its settings and slices', () => {
    expect(otNotices([carry({})], [applied({})], 'F')).toEqual({
      lines: ['loop.ot copied with loop.wav', 'F3 took its settings and 8 slices from loop.ot'],
      warning: false,
    })
  })

  it('says a .ot was rescaled from the source rate, and that an older one was backed up', () => {
    const { lines } = otNotices(
      [carry({ outcome: 'rescaled', from_rate: 48000, replaced: true })], [], 'F')
    expect(lines).toEqual(['loop.ot rescaled from 48 kHz and copied with loop.wav, older one moved to backups'])
  })

  it('leaves out the slice count for a .ot without slices', () => {
    expect(otNotices([], [applied({ slices: 0 })], 'S').lines)
      .toEqual(['S3 took its settings from loop.ot'])
  })

  it('reports a .ot left over from a replaced file', () => {
    expect(otNotices([carry({ outcome: 'removed' })], [], 'F').lines)
      .toEqual(['loop.wav replaced: its old loop.ot moved to backups'])
  })

  it('warns, with the reason, about a .ot that was not copied or not applied', () => {
    const reason = 'its trim end (90000) is past the end of the audio (1000 frames)'
    expect(otNotices([carry({ outcome: 'refused', reason })], [], 'F')).toEqual({
      lines: [`loop.ot not copied: ${reason}`], warning: true,
    })
    expect(otNotices([], [applied({ error: reason })], 'F')).toEqual({
      lines: [`loop.ot not applied to F3: ${reason}`], warning: true,
    })
  })

  it('counts instead of listing once a drop brings more than three lines', () => {
    const carries = [
      carry({ audio: 'a.wav', ot: 'a.ot' }),
      carry({ audio: 'b.wav', ot: 'b.ot', outcome: 'rescaled', from_rate: 48000 }),
      carry({ audio: 'c.wav', ot: 'c.ot', outcome: 'refused', reason: 'bad checksum' }),
    ]
    const slots = [applied({ slot_index: 1, ot: 'a.ot' }), applied({ slot_index: 2, ot: 'b.ot' })]
    expect(otNotices(carries, slots, 'F')).toEqual({
      lines: [
        '2 .ot files copied (1 rescaled to 44.1 kHz)',
        '2 slots took their settings from their .ot',
        '1 .ot not used (unreadable or made for other audio)',
      ],
      warning: true,
    })
  })
})
