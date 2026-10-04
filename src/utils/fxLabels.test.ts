import { describe, it, expect } from 'vitest'
import { formatFxType, getFxMainLabels, getFxSetupLabels, fxShortName } from './fxLabels'

/** Every effect the device offers, by the value its slot stores. */
const EFFECTS = [0, 4, 5, 8, 12, 13, 16, 17, 18, 19, 20, 21, 22, 24, 28]

/**
 * These arrays are read positionally: the label at index n names parameter n+1, and
 * an empty entry is a knob position the device leaves blank. Compacting one silently
 * points every later knob at the wrong parameter, which is the bug these guard.
 *
 * Each layout is the one the manual's Appendix B screenshots show, and the gaps were
 * confirmed a second time on the hardware - an LFO pointed at an unused slot names it
 * by its letter, such as "DJEQ <B>".
 */
describe('effect parameter layouts', () => {
  it('gives every effect exactly six main and six setup positions', () => {
    for (const fx of EFFECTS) {
      expect(getFxMainLabels(fx), `main ${fx}`).toHaveLength(6)
      expect(getFxSetupLabels(fx), `setup ${fx}`).toHaveLength(6)
    }
  })

  it('leaves the main-page gap where the device leaves it', () => {
    // DJ EQ: LS F and HS F sit in the first and third columns, not the first and second
    expect(getFxMainLabels(13)).toEqual(['LS F', '', 'HS F', 'LOWG', 'MIDG', 'HI G'])
    // Comb filter: a gap before MIX, which is therefore the sixth parameter
    expect(getFxMainLabels(19)).toEqual(['PTCH', 'TUNE', 'LP', 'FB', '', 'MIX'])
    // Spring reverb: TIME alone on the first row
    expect(getFxMainLabels(21)).toEqual(['TIME', '', '', 'HP', 'LP', 'MIX'])
    // Lo-fi: DIST and AMF in the first and third columns
    expect(getFxMainLabels(28)).toEqual(['DIST', '', 'AMF', 'SRR', 'BRR', 'AMD'])
  })

  it('leaves the setup-page gap where the device leaves it', () => {
    // Both reverbs put MIXF last, not fourth
    expect(getFxSetupLabels(20)).toEqual(['GVOL', 'BAL', 'MONO', '', '', 'MIXF'])
    expect(getFxSetupLabels(22)).toEqual(['PRE', 'BAL', 'MONO', '', '', 'MIXF'])
    // The chorus and the EQ put their second setting on the second row
    expect(getFxSetupLabels(18)).toEqual(['TAPS', '', '', 'FBLP', '', ''])
    expect(getFxSetupLabels(12)).toEqual(['TYP1', '', '', 'TYP2', '', ''])
    // The phaser's and the lo-fi's single setting is not in the first position
    expect(getFxSetupLabels(16)).toEqual(['', 'NUM', '', '', '', ''])
    expect(getFxSetupLabels(28)).toEqual(['', '', 'AMPH', '', '', ''])
    // The spatializer's phase sits above its mid gain, in the second column
    expect(getFxSetupLabels(5)).toEqual(['', 'PHSE', '', 'M/S', 'MG', 'SG'])
  })

  it('fills every position for the effects whose pages have no gap', () => {
    for (const fx of [4, 5, 8, 12, 16, 17, 18, 20, 22, 24]) {
      expect(getFxMainLabels(fx).every(l => l !== ''), `main ${fx}`).toBe(true)
    }
    for (const fx of [4, 8]) {
      expect(getFxSetupLabels(fx).every(l => l !== ''), `setup ${fx}`).toBe(true)
    }
  })

  it('gives the effects with no page at all nothing to draw', () => {
    expect(getFxMainLabels(0).every(l => l === '')).toBe(true)
    // DJ EQ, flanger and comb filter have no setup parameters
    for (const fx of [0, 13, 17, 19]) {
      expect(getFxSetupLabels(fx).every(l => l === ''), `setup ${fx}`).toBe(true)
    }
  })

  it('keeps the device wording rather than a tidied version', () => {
    // The filter page reads WDTH and DPTH, not WIDTH and DEPTH
    expect(getFxMainLabels(4)).toContain('WDTH')
    expect(getFxMainLabels(4)).toContain('DPTH')
  })

  it('falls back to numbered parameters for an effect it does not know', () => {
    expect(getFxMainLabels(99)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'])
    expect(getFxSetupLabels(99)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
  })
})

describe('effect names', () => {
  it('names every effect the device offers', () => {
    for (const fx of EFFECTS) {
      expect(formatFxType(fx), String(fx)).not.toMatch(/^FX /)
    }
    expect(formatFxType(0)).toBe('OFF')
    expect(formatFxType(20)).toBe('PLATE REVERB')
  })

  it('says so plainly for a value it does not recognise', () => {
    expect(formatFxType(99)).toBe('FX 99')
  })
})

describe('effect abbreviations', () => {
  it('uses the short names the device shows on the LFO page', () => {
    // Read off the hardware - they do not follow from the full names
    expect(fxShortName(20, 'FX1')).toBe('PLTE')
    expect(fxShortName(8, 'FX1')).toBe('DEL')
    expect(fxShortName(13, 'FX1')).toBe('DJEQ')
    expect(fxShortName(28, 'FX1')).toBe('LOFI')
    expect(fxShortName(5, 'FX1')).toBe('SPAT')
  })

  it('has a short name for every effect', () => {
    for (const fx of EFFECTS) {
      expect(fxShortName(fx, 'FX1'), String(fx)).not.toBe('FX1')
    }
  })

  it('keeps the abbreviations short enough for the widget', () => {
    for (const fx of EFFECTS) {
      expect(fxShortName(fx, 'FX1').length, String(fx)).toBeLessThanOrEqual(4)
    }
  })

  it('falls back to the slot when no effect is loaded or it is unknown', () => {
    expect(fxShortName(undefined, 'FX2')).toBe('FX2')
    expect(fxShortName(99, 'FX2')).toBe('FX2')
  })
})
