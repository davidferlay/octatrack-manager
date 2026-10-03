import { describe, it, expect } from 'vitest'
import { fieldSpec, clampToSpec, formatSpecValue, parseSpecValue, isDeviceField } from './partFieldSpecs'

/**
 * The numbers asserted here are what the device itself wrote: each preset project was
 * made on the Octatrack with every field of Bank A / Part 1 / Track 4 driven to its
 * minimum, then to its maximum. They are the contract this module exists to hold.
 */
describe('ranges measured from the device', () => {
  it('stops PTCH 60 either side of centre, not at the byte edges', () => {
    const spec = fieldSpec('machine_params.ptch', 'Flex')!
    expect([spec.min, spec.max]).toEqual([4, 124])
    expect(spec.center).toBe(64)
  })

  it('gives Static and Flex the same SRC ranges', () => {
    for (const field of ['machine_params.strt', 'machine_params.rate', 'machine_setup.tstr']) {
      expect(fieldSpec(field, 'Static')).toEqual(fieldSpec(field, 'Flex'))
    }
  })

  it('holds the SRC SETUP ranges of a sample machine', () => {
    const range = (f: string) => {
      const s = fieldSpec(f, 'Static')!
      return [s.min, s.max]
    }
    expect(range('machine_setup.xloop')).toEqual([0, 3])
    expect(range('machine_setup.slic')).toEqual([0, 1])
    expect(range('machine_setup.len')).toEqual([0, 1])
    expect(range('machine_setup.rate')).toEqual([0, 1])
    expect(range('machine_setup.tstr')).toEqual([0, 3])
    expect(range('machine_setup.tsns')).toEqual([0, 127])
  })

  it('limits a Thru machine to its five inputs', () => {
    expect(fieldSpec('machine_params.in_ab', 'Thru')!.max).toBe(4)
    expect(fieldSpec('machine_params.in_cd', 'Thru')!.max).toBe(4)
    expect(fieldSpec('machine_params.vol_ab', 'Thru')!.max).toBe(127)
  })

  it('gives a Neighbor machine no SRC fields at all', () => {
    expect(fieldSpec('machine_params.ptch', 'Neighbor')).toBeNull()
    expect(fieldSpec('machine_params.vol_ab', 'Neighbor')).toBeNull()
  })

  it('will not let a Pickup machine turn timestretch off', () => {
    // The manual says timestretch cannot be disabled for a Pickup machine, the
    // device-made project stores a floor of 1, and the device offers no OFF here
    const pickup = fieldSpec('machine_setup.tstr', 'Pickup')!
    expect(pickup.min).toBe(1)
    expect(pickup.options?.map(o => o.label)).toEqual(['AUTO', 'NORM', 'BEAT'])
    expect(pickup.options?.map(o => o.value)).toEqual([1, 2, 3])
    const sampler = fieldSpec('machine_setup.tstr', 'Static')!
    expect(sampler.min).toBe(0)
    expect(sampler.options?.[0].label).toBe('OFF')
  })

  it('holds the Pickup ranges the device offers', () => {
    const range = (f: string) => {
      const s = fieldSpec(f, 'Pickup')!
      return [s.min, s.max]
    }
    expect(range('machine_params.dir')).toEqual([0, 2])   // REV PIPO FWD
    expect(range('machine_params.len')).toEqual([0, 4])   // OFF x1 x2 x4 x8
    expect(range('machine_params.op')).toEqual([0, 1])    // GAIN DUB
    expect(range('machine_params.gain')).toEqual([0, 127])
    // Nothing on a Pickup machine is left to a guessed ceiling any more
    for (const f of ['dir', 'len', 'op', 'gain', 'ptch']) {
      expect(fieldSpec(`machine_params.${f}`, 'Pickup')!.maxUnverified).toBeUndefined()
    }
  })

  it('keeps a field out of the pages a machine does not have it on', () => {
    expect(fieldSpec('machine_params.in_ab', 'Flex')).toBeNull()
    expect(fieldSpec('machine_params.strt', 'Thru')).toBeNull()
    expect(fieldSpec('machine_params.dir', 'Static')).toBeNull()
  })

  it('shares the AMP and LFO ranges across every machine', () => {
    expect(fieldSpec('atk')!.max).toBe(127)
    expect(fieldSpec('amp_setup_amp')!.max).toBe(3)
    expect(fieldSpec('amp_setup_sync')!.max).toBe(1)
    expect(fieldSpec('lfo1_pmtr')!.max).toBe(29)
    expect(fieldSpec('lfo1_wave')!.max).toBe(18)
    expect(fieldSpec('lfo1_mult')!.max).toBe(6)
    expect(fieldSpec('lfo1_trig')!.max).toBe(7)
  })

  it('treats the three LFOs identically', () => {
    for (const f of ['pmtr', 'wave', 'mult', 'trig']) {
      expect(fieldSpec(`lfo2_${f}`)).toEqual(fieldSpec(`lfo1_${f}`))
      expect(fieldSpec(`lfo3_${f}`)).toEqual(fieldSpec(`lfo1_${f}`))
    }
  })
})

describe('factory defaults', () => {
  it('matches the values a blank Part is written with', () => {
    expect(fieldSpec('machine_params.rate', 'Flex')!.default).toBe(127)
    expect(fieldSpec('machine_params.rtim', 'Flex')!.default).toBe(79)
    expect(fieldSpec('machine_setup.xloop', 'Flex')!.default).toBe(1)
    expect(fieldSpec('hold')!.default).toBe(127)
    expect(fieldSpec('vol')!.default).toBe(64)
    expect(fieldSpec('spd1')!.default).toBe(32)
    expect(fieldSpec('amp_setup_amp')!.default).toBe(1)
  })

  it('never puts a default outside its own range', () => {
    const machines = ['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup']
    const fields = [
      'machine_params.ptch', 'machine_params.strt', 'machine_params.len', 'machine_params.rate',
      'machine_params.rtrg', 'machine_params.rtim', 'machine_params.in_ab', 'machine_params.vol_ab',
      'machine_params.in_cd', 'machine_params.vol_cd', 'machine_params.dir', 'machine_params.gain',
      'machine_params.op', 'machine_setup.xloop', 'machine_setup.slic', 'machine_setup.len',
      'machine_setup.rate', 'machine_setup.tstr', 'machine_setup.tsns',
      'atk', 'hold', 'rel', 'vol', 'bal', 'amp_setup_amp', 'amp_setup_sync', 'amp_setup_atck',
      'amp_setup_fx1', 'amp_setup_fx2', 'spd1', 'dep1', 'lfo1_pmtr', 'lfo1_wave', 'lfo1_mult',
      'lfo1_trig',
    ]
    for (const machine of machines) {
      for (const field of fields) {
        const spec = fieldSpec(field, machine)
        if (!spec) continue
        expect(spec.default, `${machine}.${field}`).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default, `${machine}.${field}`).toBeLessThanOrEqual(spec.max)
      }
    }
  })
})

describe('fields the AMP page does not carry', () => {
  it('keeps XVOL off the page, since the device only shows it under a SCENE key', () => {
    expect(isDeviceField('xvol')).toBe(false)
    expect(fieldSpec('xvol')).toBeNull()
  })

  it('still accepts the five AMP parameters that do exist', () => {
    for (const f of ['atk', 'hold', 'rel', 'vol', 'bal']) {
      expect(isDeviceField(f)).toBe(true)
      expect(fieldSpec(f)).not.toBeNull()
    }
  })
})

describe('fields nobody has measured yet', () => {
  it('leaves the effect and MIDI fields usable instead of hiding them', () => {
    for (const f of ['fx1_param1', 'fx2_setup3', 'note', 'vel']) {
      const spec = fieldSpec(f)!
      expect(spec).not.toBeNull()
      expect([spec.min, spec.max]).toEqual([0, 127])
      expect(spec.maxUnverified).toBe(true)
    }
  })

  it('still hides a machine field the machine does not have', () => {
    // Absent is not the same as unmeasured - SRC fields are enumerated per machine
    expect(fieldSpec('machine_params.gain', 'Flex')).toBeNull()
  })
})

describe('selectors only exist where the choices are known', () => {
  it('never builds a selector on a ceiling that was never measured', () => {
    // A selector lists every value between min and max, so an unverified ceiling
    // would offer 128 entries where the device has a handful
    const machines = ['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup']
    const fields = [
      'machine_params.ptch', 'machine_params.dir', 'machine_params.len', 'machine_params.gain',
      'machine_params.op', 'machine_params.in_ab', 'machine_params.in_cd', 'machine_setup.xloop',
      'machine_setup.slic', 'machine_setup.tstr', 'amp_setup_amp', 'lfo1_pmtr', 'lfo1_wave',
      'fx1_param1',
    ]
    for (const machine of machines) {
      for (const field of fields) {
        const spec = fieldSpec(field, machine)
        if (!spec) continue
        if (spec.widget === 'selector' || spec.widget === 'toggle') {
          expect(spec.maxUnverified, `${machine}.${field}`).toBeUndefined()
        }
      }
    }
  })

  it('keeps every selector short enough to be a list', () => {
    for (const field of ['machine_setup.xloop', 'machine_setup.tstr', 'amp_setup_amp',
      'lfo1_pmtr', 'lfo1_wave', 'lfo1_mult', 'lfo1_trig']) {
      const spec = fieldSpec(field, 'Flex')!
      expect(spec.max - spec.min + 1, field).toBeLessThanOrEqual(30)
    }
  })
})

describe('clamping', () => {
  const ptch = fieldSpec('machine_params.ptch', 'Flex')!

  it('pulls a value above the range down to the ceiling', () => {
    expect(clampToSpec(999, ptch)).toBe(124)
  })

  it('pulls a value below the range up to the floor', () => {
    expect(clampToSpec(0, ptch)).toBe(4)
  })

  it('leaves a value inside the range alone', () => {
    expect(clampToSpec(64, ptch)).toBe(64)
  })

  it('rounds rather than truncating toward zero', () => {
    expect(clampToSpec(64.6, ptch)).toBe(65)
  })

  it('falls back to the default rather than writing a non-number', () => {
    expect(clampToSpec(NaN, ptch)).toBe(64)
    expect(clampToSpec(Infinity, ptch)).toBe(64)
  })

  it('clamps a Thru input to its five choices', () => {
    expect(clampToSpec(9, fieldSpec('machine_params.in_ab', 'Thru')!)).toBe(4)
  })
})

describe('how a value reads', () => {
  it('shows PTCH in semitones, five steps to the semitone', () => {
    const ptch = fieldSpec('machine_params.ptch', 'Flex')!
    expect(formatSpecValue(64, ptch)).toBe('0.0')
    expect(formatSpecValue(4, ptch)).toBe('-12.0')
    expect(formatSpecValue(124, ptch)).toBe('12.0')
    expect(formatSpecValue(5, ptch)).toBe('-11.8')
    expect(formatSpecValue(69, ptch)).toBe('1.0')
  })

  it('reads a typed semitone value back as the byte the device stores', () => {
    const ptch = fieldSpec('machine_params.ptch', 'Flex')!
    expect(parseSpecValue('-12', ptch)).toBe(4)
    expect(parseSpecValue('0', ptch)).toBe(64)
    expect(parseSpecValue('12.0', ptch)).toBe(124)
    expect(parseSpecValue('-11.8', ptch)).toBe(5)
    expect(parseSpecValue('nonsense', ptch)).toBeNull()
  })

  it('shows a centred level as its distance from centre', () => {
    const bal = fieldSpec('bal')!
    expect(formatSpecValue(64, bal)).toBe('0')
    expect(formatSpecValue(0, bal)).toBe('-64')
    expect(formatSpecValue(127, bal)).toBe('63')
    expect(parseSpecValue('-64', bal)).toBe(0)
  })

  it('shows a plain field as its number', () => {
    expect(formatSpecValue(100, fieldSpec('atk')!)).toBe('100')
  })

  it('names every value the device names', () => {
    const name = (field: string, v: number, machine = 'Flex') =>
      formatSpecValue(v, fieldSpec(field, machine)!)
    expect(name('machine_setup.slic', 1)).toBe('ON')
    expect(name('machine_setup.xloop', 3)).toBe('PIPO')
    expect(name('machine_setup.tstr', 2)).toBe('NORM')
    expect(name('machine_setup.rate', 1)).toBe('TSTR')
    expect(name('machine_params.in_ab', 4, 'Thru')).toBe('A+B')
    expect(name('machine_params.in_cd', 2, 'Thru')).toBe('C')
    expect(name('machine_params.dir', 0, 'Pickup')).toBe('REV')
    expect(name('machine_params.op', 1, 'Pickup')).toBe('DUB')
    expect(name('machine_params.len', 4, 'Pickup')).toBe('x8')
    expect(formatSpecValue(10, fieldSpec('lfo1_wave')!)).toBe('RND')
    expect(formatSpecValue(18, fieldSpec('lfo1_wave')!)).toBe('T8')
    expect(formatSpecValue(6, fieldSpec('lfo1_mult')!)).toBe('64X')
    expect(formatSpecValue(5, fieldSpec('lfo1_trig')!)).toBe('SYNC TRIG')
    expect(formatSpecValue(2, fieldSpec('amp_setup_amp')!)).toBe('R+T')
  })

  it('names SETUP LEN after whether slices are switched on', () => {
    const off = fieldSpec('machine_setup.len', 'Flex', { slic: 0 })!
    const on = fieldSpec('machine_setup.len', 'Flex', { slic: 1 })!
    expect(off.options?.map(o => o.label)).toEqual(['OFF', 'TIME'])
    expect(on.options?.map(o => o.label)).toEqual(['SLIC', 'TIME'])
  })

  it('lists the LFO targets in the device order while storing their own values', () => {
    const spec = fieldSpec('lfo1_pmtr')!
    expect(spec.options).toHaveLength(30)
    // The AMP targets come before the LFO ones in the list, but store higher values
    expect(spec.options![6]).toEqual({ value: 12, label: 'Amp Attack' })
    expect(spec.options![12]).toEqual({ value: 6, label: 'LFO 1 Speed' })
    expect(formatSpecValue(17, spec)).toBe('Amp XVol')
    expect(formatSpecValue(9, spec)).toBe('LFO 1 Depth')
    // Every raw value 0-29 is reachable exactly once
    expect([...new Set(spec.options!.map(o => o.value))].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 30 }, (_, i) => i))
  })
})
