import { describe, expect, it } from 'vitest'
import { createTranslate } from './messages'
import { formatSpanDurationLabel } from './formatSpanDuration'

const tJa = createTranslate('ja')
const tEn = createTranslate('en')

describe('formatSpanDurationLabel', () => {
  it('shows sub-second spans in milliseconds, not 0:00', () => {
    // 1000 frames @ 44100 Hz ≈ 22.7 ms
    const label = formatSpanDurationLabel(1000n, 44100, tJa)
    expect(label).toMatch(/22\.7 ms/)
    expect(label).not.toMatch(/0:00/)
    expect(label).not.toMatch(/0 秒/)
  })

  it('shows under 1 ms for a single frame at 48 kHz', () => {
    expect(formatSpanDurationLabel(1n, 48000, tEn)).toBe('Under 1 ms')
  })

  it('shows whole seconds for long spans', () => {
    expect(formatSpanDurationLabel(48000n, 48000, tJa)).toBe('1 秒')
  })

  it('shows clock format for spans over one minute', () => {
    expect(formatSpanDurationLabel(130n * 44100n, 44100, tEn)).toBe('2:10')
  })

  it('returns unknown when sample rate is invalid', () => {
    expect(formatSpanDurationLabel(1000n, 0, tJa)).toBe('不明')
    expect(formatSpanDurationLabel(1000n, Number.NaN, tEn)).toBe('Unknown')
  })
})
