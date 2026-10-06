import { describe, it, expect } from 'vitest'
import { AMP_HOLD, RETRIG_COUNT, RETRIG_TIME, PICKUP_GAIN, RECORD_FADE } from './otValueTables'

/**
 * These tables are generated from the device's own value list, so the tests here
 * guard the shape rather than restate every entry: a regeneration that truncated a
 * table, shifted it, or lost its end markers would show up as one of these failing.
 *
 * The spot values are ones read off photographs of the hardware.
 */
describe('AMP_HOLD', () => {
  it('covers every value the byte can hold', () => {
    expect(AMP_HOLD).toHaveLength(128)
    expect(AMP_HOLD.every(v => typeof v === 'string' && v.length > 0)).toBe(true)
  })

  it('runs from the shortest hold to an infinite one', () => {
    expect(AMP_HOLD[0]).toBe('0.007')
    expect(AMP_HOLD[126]).toBe('128.0')
    expect(AMP_HOLD[127]).toBe('INF')
  })

  it('never goes backwards before its infinite end', () => {
    const numbers = AMP_HOLD.slice(0, 127).map(Number)
    expect(numbers.every(n => Number.isFinite(n))).toBe(true)
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i], `step ${i}`).toBeGreaterThanOrEqual(numbers[i - 1])
    }
  })
})

describe('RETRIG_COUNT', () => {
  it('covers every value the byte can hold', () => {
    expect(RETRIG_COUNT).toHaveLength(128)
  })

  it('counts from one, a step ahead of the stored value, and ends at INF', () => {
    expect(RETRIG_COUNT[0]).toBe('1')
    expect(RETRIG_COUNT[1]).toBe('2')
    expect(RETRIG_COUNT[126]).toBe('127')
    expect(RETRIG_COUNT[127]).toBe('INF')
  })
})

describe('RETRIG_TIME', () => {
  it('is sparse, because the device steps over some values', () => {
    const present = Object.keys(RETRIG_TIME).map(Number)
    // 120 settings over the byte's 128 values
    expect(present).toHaveLength(120)
    // The eight the encoder skips
    for (const skipped of [1, 2, 4, 5, 8, 11, 14, 16]) {
      expect(RETRIG_TIME[skipped], `raw ${skipped}`).toBeUndefined()
    }
  })

  /**
   * The settings are a geometric series - each about 1.059 times the one before - so
   * they have to climb with the raw value throughout. This is what catches a mistyped
   * entry: the source table gave raw 93 twice and nothing for 95, which showed up here
   * as 1.259 sitting before 1.189.
   */
  it('climbs all the way up, with no value out of order', () => {
    const asNumber = (label: string) => {
      const [top, bottom] = label.split('/')
      return bottom ? Number(top) / Number(bottom) : Number(top)
    }
    const raws = Object.keys(RETRIG_TIME).map(Number).sort((a, b) => a - b)
    for (let i = 1; i < raws.length; i++) {
      const [before, after] = [RETRIG_TIME[raws[i - 1]], RETRIG_TIME[raws[i]]]
      expect(asNumber(after), `raw ${raws[i]} (${after}) after ${before}`)
        .toBeGreaterThan(asNumber(before))
    }
  })

  it('keeps the two entries the source table got wrong', () => {
    expect(RETRIG_TIME[93]).toBe('1.122')
    expect(RETRIG_TIME[95]).toBe('1.259')
  })

  it('mixes decimals with note divisions, as the device does', () => {
    expect(RETRIG_TIME[0]).toBe('0.005')
    expect(RETRIG_TIME[7]).toBe('1/128')
    expect(RETRIG_TIME[127]).toBe('8.000')
    const labels = Object.values(RETRIG_TIME)
    expect(labels.some(l => l.includes('/'))).toBe(true)
    expect(labels.some(l => /^\d+\.\d+$/.test(l))).toBe(true)
  })

  it('stays inside the byte', () => {
    for (const raw of Object.keys(RETRIG_TIME).map(Number)) {
      expect(raw).toBeGreaterThanOrEqual(0)
      expect(raw).toBeLessThanOrEqual(127)
    }
  })
})

describe('PICKUP_GAIN', () => {
  it('covers every value the byte can hold', () => {
    expect(PICKUP_GAIN).toHaveLength(128)
  })

  it('runs from silence up to about twelve decibels', () => {
    expect(PICKUP_GAIN[0]).toBe('-INF')
    expect(PICKUP_GAIN[127]).toBe('11.90')
  })

  it('rises once past silence', () => {
    const numbers = PICKUP_GAIN.slice(1).map(Number)
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i], `step ${i}`).toBeGreaterThan(numbers[i - 1])
    }
  })
})

describe('RECORD_FADE', () => {
  it('covers the recorder fade range', () => {
    expect(RECORD_FADE).toHaveLength(113)
  })

  it('counts sequencer steps, in sixteenths below the first whole one', () => {
    expect(RECORD_FADE[0]).toBe('0')
    expect(RECORD_FADE[1]).toBe('0.063')
    expect(RECORD_FADE[32]).toBe('2')
    expect(RECORD_FADE[112]).toBe('64')
  })

  it('never goes backwards', () => {
    const numbers = RECORD_FADE.map(Number)
    expect(numbers.every(n => Number.isFinite(n))).toBe(true)
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i], `step ${i}`).toBeGreaterThanOrEqual(numbers[i - 1])
    }
  })
})
