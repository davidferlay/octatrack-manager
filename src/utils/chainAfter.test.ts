import { describe, it, expect } from 'vitest'
import { formatChainAfter, chainAfterSteps } from './chainAfter'

describe('formatChainAfter', () => {
  it('names the setting that plays the pattern to its end', () => {
    expect(formatChainAfter(0)).toBe('PLEN')
  })

  it('counts in sixteenths, which is what the device shows', () => {
    expect(formatChainAfter(2)).toBe('2/16')
    expect(formatChainAfter(4)).toBe('4/16')
  })

  it('does not mistake the stored byte for the number of steps', () => {
    // The trap this module exists for: past the fourth setting the two diverge
    expect(formatChainAfter(5)).toBe('6/16')
    expect(formatChainAfter(8)).toBe('16/16')
    expect(formatChainAfter(16)).toBe('256/16')
  })

  it('offers sixteen settings in all', () => {
    const named = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    expect(named.every(v => formatChainAfter(v) !== String(v) || v === 0)).toBe(true)
    expect(named).toHaveLength(16)
  })

  it('falls back to the number for a value the device does not offer', () => {
    // There is no setting 1, and 255 is the "follow the project" marker
    expect(formatChainAfter(1)).toBe('1')
    expect(formatChainAfter(255)).toBe('255')
  })
})

describe('chainAfterSteps', () => {
  it('gives the step count behind the label', () => {
    expect(chainAfterSteps(2)).toBe(2)
    expect(chainAfterSteps(8)).toBe(16)
    expect(chainAfterSteps(16)).toBe(256)
  })

  it('has no step count for PLEN, which runs to the pattern end', () => {
    expect(chainAfterSteps(0)).toBeNull()
  })

  it('has none for a value the device does not offer', () => {
    expect(chainAfterSteps(1)).toBeNull()
  })
})
