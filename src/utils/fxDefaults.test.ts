import { describe, it, expect } from 'vitest'
import { FX_DEFAULTS, fxDefaults } from './fxDefaults'
import { getFxMainLabels, getFxSetupLabels, FX_TYPES } from './fxLabels'

/** Every effect that has a page. OFF has none. */
const EFFECTS = FX_TYPES.map(fx => fx.value).filter(v => v !== 0)

describe('what the device writes when an effect is loaded', () => {
  it('has a set of values for every effect that has a page', () => {
    for (const fx of EFFECTS) {
      expect(fxDefaults(fx), String(fx)).toBeDefined()
    }
  })

  it('has none for a block set to OFF, which shows nothing to reset', () => {
    expect(fxDefaults(0)).toBeUndefined()
  })

  /**
   * The gaps matter as much as the values. A knob position the effect leaves blank is
   * one the device never writes, so writing a value there would put a byte somewhere
   * the hardware did not - and a position it does use needs a value, or the parameter
   * keeps whatever the previous effect left in it.
   */
  it('writes exactly the positions the effect uses, and no others', () => {
    const wrong: string[] = []
    for (const fx of EFFECTS) {
      const defaults = fxDefaults(fx)!
      const pages = [
        ['MAIN', getFxMainLabels(fx), defaults.main],
        ['SETUP', getFxSetupLabels(fx), defaults.setup],
      ] as const
      for (const [page, labels, values] of pages) {
        labels.forEach((label, i) => {
          const used = label !== ''
          const written = values[i] !== null
          if (used !== written) {
            wrong.push(`${fx} ${page} ${i + 1} (${label || 'blank'}): ${
              written ? 'writes a value into a blank position' : 'leaves a used position unset'
            }`)
          }
        })
      }
    }
    expect(wrong).toEqual([])
  })

  it('gives each page six positions', () => {
    for (const fx of EFFECTS) {
      expect(fxDefaults(fx)!.main, `main ${fx}`).toHaveLength(6)
      expect(fxDefaults(fx)!.setup, `setup ${fx}`).toHaveLength(6)
    }
  })

  it('stays inside a byte', () => {
    for (const { main, setup } of Object.values(FX_DEFAULTS)) {
      for (const value of [...main, ...setup]) {
        if (value === null) continue
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(127)
      }
    }
  })

  it('leaves the whole setup page alone for the effects that have none', () => {
    // DJ EQ, flanger and comb filter
    for (const fx of [13, 17, 19]) {
      expect(fxDefaults(fx)!.setup, String(fx)).toEqual([null, null, null, null, null, null])
    }
  })

  /**
   * Spot values read off the hardware. These are the ones where the stored byte is not
   * the number on screen, so they are the ones a careless re-reading would get wrong.
   */
  it('stores a centred parameter as its centre, not as zero', () => {
    // The filter's DPTH and the EQ's gains all read +0
    expect(fxDefaults(4)!.main[3]).toBe(64)
    expect(fxDefaults(12)!.main[1]).toBe(64)
    expect(fxDefaults(12)!.main[4]).toBe(64)
    // Every DJ EQ band reads +0 as well
    expect(fxDefaults(13)!.main.slice(3)).toEqual([64, 64, 64])
    // Both reverbs with a balance read +0
    expect(fxDefaults(20)!.setup[1]).toBe(64)
    expect(fxDefaults(22)!.setup[1]).toBe(64)
  })

  it('stores a negative reading below the centre', () => {
    // The flanger comes up with FB at -19
    expect(fxDefaults(17)!.main[3]).toBe(64 - 19)
    // The comb filter comes up with FB at +32
    expect(fxDefaults(19)!.main[3]).toBe(64 + 32)
  })

  it('stores a named setting by its own list, not by what it reads', () => {
    // The filter's Q reads BOTH, which is the fourth entry of its list
    expect(fxDefaults(4)!.setup[4]).toBe(3)
    // The phaser reads 6 stages and the chorus 3 taps, both counted from the first entry
    expect(fxDefaults(16)!.setup[1]).toBe(2)
    expect(fxDefaults(18)!.setup[0]).toBe(2)
    // The spring reverb reads type 2
    expect(fxDefaults(21)!.setup[0]).toBe(1)
    // The comb filter's pitch reads C 3
    expect(fxDefaults(19)!.main[0]).toBe(26)
    // Both reverbs come up with MIXF on MIX rather than SEND
    expect(fxDefaults(20)!.setup[5]).toBe(0)
    expect(fxDefaults(22)!.setup[5]).toBe(0)
  })
})

describe('the picker order', () => {
  /**
   * The device lists the effects in neither alphabetical nor stored-value order. This
   * is the order read off the hardware, and it matches the user guide's appendix.
   */
  it('follows the device, not the stored values', () => {
    expect(FX_TYPES.map(fx => fx.value)).toEqual([
      0, 4, 12, 13, 16, 17, 18, 5, 19, 24, 28, 8, 20, 21, 22,
    ])
  })

  it('puts the spatializer after the chorus, where the device puts it', () => {
    const order = FX_TYPES.map(fx => fx.label)
    expect(order.indexOf('SPATIALIZER')).toBe(order.indexOf('CHORUS') + 1)
    // ...which is not where its stored value would put it
    expect(FX_TYPES[1].value).toBe(4)
  })

  it('still offers every effect exactly once', () => {
    const values = FX_TYPES.map(fx => fx.value)
    expect(new Set(values).size).toBe(values.length)
    expect(values).toHaveLength(15)
  })
})
