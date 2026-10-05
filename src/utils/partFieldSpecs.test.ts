import { describe, it, expect } from 'vitest'
import { machineTypesForTrack, MACHINE_TYPES, fieldSpec, clampToSpec, formatSpecValue, parseSpecValue, isDeviceField, noteName, machineParamLabels } from './partFieldSpecs'

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

describe('MIDI tracks', () => {
  it('keeps NOTE LEN and ARP LEN apart, since they are different parameters', () => {
    const note = fieldSpec('midi_notes.len')!
    const arp = fieldSpec('midi_arps.len')!
    expect(note.widget).toBe('unipolar')
    expect(arp.widget).toBe('selector')
    expect(arp.options).toHaveLength(16)
  })

  it('names the arpeggiator settings the device names', () => {
    expect(fieldSpec('midi_arps.mode')!.options?.map(o => o.label))
      .toEqual(['OFF', 'TRUE', 'UP', 'DOWN', 'CYCL', 'SHFL', 'RND'])
    expect(fieldSpec('midi_arps.rnge')!.options?.map(o => o.label))
      .toEqual(['1 OCT', '2 OCT', '3 OCT', '4 OCT', '5 OCT', '6 OCT', '7 OCT', '8 OCT'])
    const keys = fieldSpec('midi_arps.key')!
    expect(keys.options).toHaveLength(25)
    expect(keys.options![0].label).toBe('Off')
    expect(keys.options![1].label).toBe('C MAJ')
    expect(keys.options![24].label).toBe('B MIN')
  })

  it('shows the arp speed as the multiple it is, and reads one back', () => {
    const spd = fieldSpec('midi_arps.spd')!
    expect([spd.min, spd.max]).toEqual([0, 95])
    expect(formatSpecValue(0, spd)).toBe('x1')
    expect(formatSpecValue(95, spd)).toBe('x96')
    expect(parseSpecValue('x4', spd)).toBe(3)
  })

  it('offers the sixteen MIDI channels, counted from one', () => {
    const chan = fieldSpec('midi_notes.chan')!
    expect([chan.min, chan.max]).toEqual([0, 15])
    expect(chan.options![0].label).toBe('1')
    expect(chan.options![15].label).toBe('16')
  })

  it('lets Bank, Program and Sub Bank be switched off, one past the byte', () => {
    for (const f of ['bank', 'prog', 'sbnk']) {
      const spec = fieldSpec(`midi_notes.${f}`)!
      expect(spec.max, f).toBe(128)
      expect(spec.default, f).toBe(128)
      expect(formatSpecValue(128, spec)).toBe('Off')
      // Anything below it is the number itself
      expect(formatSpecValue(0, spec)).toBe('0')
    }
  })

  it('names a note the way a keyboard does', () => {
    expect(noteName(0)).toBe('C-1')
    expect(noteName(60)).toBe('C4')
    expect(noteName(69)).toBe('A4')
    expect(formatSpecValue(48, fieldSpec('midi_notes.note')!)).toBe('C3')
  })

  it('gives a MIDI track its own LFO targets, not the audio ones', () => {
    const midi = fieldSpec('midi_lfos.lfo1_pmtr')!
    const audio = fieldSpec('lfo1_pmtr')!
    expect(midi.options).toHaveLength(30)
    expect(midi.options![0].label).toBe('NOTE NOTE')
    expect(midi.options![6]).toEqual({ value: 12, label: 'ARP TRAN' })
    expect(audio.options![0].label).toBe('SRC P01')
    expect(midi.options).not.toEqual(audio.options)
    // Same reordering as the audio list: the second group stores above the third
    expect(midi.options![12]).toEqual({ value: 6, label: 'LFO1 SPD' })
  })

  /**
   * A target names the page it points at and the parameter on it, in the device's own
   * abbreviations - the same shape as the audio list, so neither reads as the odd one.
   * Each name has to match the label the MIDI pages actually draw, or the list points
   * at parameters by names that appear nowhere else in the editor.
   */
  it('names a MIDI LFO target the way the MIDI pages name that parameter', () => {
    const labels = fieldSpec('midi_lfos.lfo1_pmtr')!.options!.map(o => o.label)
    expect(labels.slice(0, 6)).toEqual([
      'NOTE NOTE', 'NOTE VEL', 'NOTE LEN', 'NOTE NOT2', 'NOTE NOT3', 'NOTE NOT4',
    ])
    expect(labels.slice(6, 12)).toEqual([
      'ARP TRAN', 'ARP LEG', 'ARP MODE', 'ARP SPD', 'ARP RNGE', 'ARP NLEN',
    ])
    expect(labels.slice(18, 24)).toEqual([
      'CTRL1 PB', 'CTRL1 AT', 'CTRL1 CC1', 'CTRL1 CC2', 'CTRL1 CC3', 'CTRL1 CC4',
    ])
    expect(labels.slice(24)).toEqual([
      'CTRL2 CC5', 'CTRL2 CC6', 'CTRL2 CC7', 'CTRL2 CC8', 'CTRL2 CC9', 'CTRL2 CC10',
    ])
    // Nothing is left in the long prose form the audio list never used
    expect(labels.some(l => /[a-z]/.test(l))).toBe(false)
  })

  it('keeps the MIDI targets on the values the device stores', () => {
    const byLabel = Object.fromEntries(
      fieldSpec('midi_lfos.lfo1_pmtr')!.options!.map(o => [o.label, o.value]),
    )
    // Renaming must not disturb the values: the ARP group is listed before the LFO
    // group but stored after it
    expect(byLabel['ARP TRAN']).toBe(12)
    expect(byLabel['LFO1 SPD']).toBe(6)
    expect(byLabel['CTRL1 PB']).toBe(18)
    expect(byLabel['CTRL2 CC10']).toBe(29)
  })

  it('names an LFO target after the machine the track actually runs', () => {
    // The device shows the parameter page and the parameter: SRC STRT on a Flex track
    const flex = fieldSpec('lfo1_pmtr', 'Flex')!
    expect(flex.options![1].label).toBe('SRC STRT')
    const thru = fieldSpec('lfo1_pmtr', 'Thru')!
    expect(thru.options![1].label).toBe('SRC VOL')
    expect(thru.options![0].label).toBe('SRC INAB')
    // Both still store the same value for that position
    expect(flex.options![1].value).toBe(thru.options![1].value)
  })

  it('names an effect target the way the device does, effect then parameter', () => {
    // 20 is the plate reverb, 8 the delay - both photographed on the hardware
    const spec = fieldSpec('lfo1_pmtr', 'Flex', { fx1Type: 20, fx2Type: 8 })!
    const byValue = (v: number) => spec.options!.find(o => o.value === v)!.label
    expect(byValue(18)).toBe('PLTE TIME')
    expect(byValue(20)).toBe('PLTE GATE')
    expect(byValue(24)).toBe('DEL TIME')
    expect(byValue(27)).toBe('DEL BASE')
  })

  it('marks a slot the effect does not use the way the device marks it', () => {
    // The DJ EQ leaves its second slot empty, and the device shows it as <B>
    const spec = fieldSpec('lfo1_pmtr', 'Flex', { fx1Type: 13 })!
    expect(spec.options!.find(o => o.value === 19)!.label).toBe('DJEQ <B>')
    // The spring reverb leaves its second and third empty
    const spring = fieldSpec('lfo1_pmtr', 'Flex', { fx1Type: 21 })!
    expect(spring.options!.find(o => o.value === 19)!.label).toBe('SPRG <B>')
  })

  it('falls back to the slot when the effect is not known', () => {
    const spec = fieldSpec('lfo1_pmtr', 'Flex')!
    expect(spec.options!.find(o => o.value === 18)!.label).toBe('FX1 <A>')
  })

  it('treats the extra notes and the transpose as offsets', () => {
    for (const f of ['midi_notes.not2', 'midi_notes.not3', 'midi_notes.not4', 'midi_arps.tran']) {
      const spec = fieldSpec(f)!
      expect(spec.widget, f).toBe('bipolar')
      expect(formatSpecValue(64, spec)).toBe('0')
      expect(formatSpecValue(70, spec)).toBe('6')
    }
  })
})

describe('what a machine calls its six SRC parameters', () => {
  it('names a sample machine the way the SRC page does', () => {
    expect(machineParamLabels('Flex')).toEqual(machineParamLabels('Static'))
    expect(machineParamLabels('Flex')!.map(l => l?.split(' ')[0]))
      .toEqual(['PTCH', 'STRT', 'LEN', 'RATE', 'RTRG', 'RTIM'])
  })

  it('names a Thru machine its inputs, not a pitch', () => {
    const thru = machineParamLabels('Thru')
    expect(thru[0]).toMatch(/^INAB/)
    expect(thru[3]).toMatch(/^INCD/)
    // The two slots the device leaves empty stay empty
    expect(thru[2]).toBeNull()
    expect(thru[5]).toBeNull()
  })

  it('gives a Neighbor machine no parameters at all', () => {
    expect(machineParamLabels('Neighbor')).toEqual([null, null, null, null, null, null])
  })

  it('names a Pickup machine, skipping the slot it does not use', () => {
    const pickup = machineParamLabels('Pickup')
    expect(pickup.map(l => l?.split(' ')[0]))
      .toEqual(['PTCH', 'DIR', 'LEN', undefined, 'GAIN', 'OP'])
    expect(pickup[3]).toBeNull()
  })

  it('always answers with six positions, so a value cannot shift onto another name', () => {
    for (const m of ['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup', undefined, 'Nonsense']) {
      expect(machineParamLabels(m), String(m)).toHaveLength(6)
    }
  })

  it('still shows the locks of a machine it does not recognise', () => {
    expect(machineParamLabels(undefined).every(l => l !== null)).toBe(true)
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

describe('values the device does not show as plain numbers', () => {
  const flex = (f: string) => fieldSpec(`machine_params.${f}`, 'Flex')!

  it('counts LEN from one, as the device does', () => {
    expect(formatSpecValue(0, flex('len'))).toBe('1')
    expect(formatSpecValue(127, flex('len'))).toBe('128')
  })

  it('reads RATE either side of its centre, where it stops', () => {
    expect(formatSpecValue(0, flex('rate'))).toBe('-64')
    expect(formatSpecValue(64, flex('rate'))).toBe('0')
    expect(formatSpecValue(127, flex('rate'))).toBe('63')
  })

  it('counts retrigs and ends at INF', () => {
    expect(formatSpecValue(0, flex('rtrg'))).toBe('1')
    expect(formatSpecValue(126, flex('rtrg'))).toBe('127')
    expect(formatSpecValue(127, flex('rtrg'))).toBe('INF')
  })

  it('shows the retrig time as the device writes it, decimal or division', () => {
    expect(formatSpecValue(0, flex('rtim'))).toBe('0.005')
    expect(formatSpecValue(7, flex('rtim'))).toBe('1/128')
    expect(formatSpecValue(127, flex('rtim'))).toBe('8.000')
  })

  it('leaves a retrig time the device never produces as its number', () => {
    // The encoder steps over these nine values
    expect(formatSpecValue(1, flex('rtim'))).toBe('1')
  })

  it('shows the recorder fades as the step counts the device shows', () => {
    const fin = fieldSpec('recorders.fin')!
    expect(formatSpecValue(0, fin)).toBe('0')
    // A sixteenth of a step at the bottom, whole steps higher up
    expect(formatSpecValue(1, fin)).toBe('0.063')
    expect(formatSpecValue(32, fin)).toBe('2')
    expect(formatSpecValue(112, fin)).toBe('64')
  })

  it('reads a Thru machine input volume either side of its centre', () => {
    for (const f of ['vol_ab', 'vol_cd']) {
      const spec = fieldSpec(`machine_params.${f}`, 'Thru')!
      expect(formatSpecValue(0, spec), f).toBe('-64')
      expect(formatSpecValue(64, spec), f).toBe('0')
      expect(formatSpecValue(127, spec), f).toBe('63')
    }
  })

  it('shows a Pickup machine GAIN in dB, from silence upward', () => {
    const gain = fieldSpec('machine_params.gain', 'Pickup')!
    expect(formatSpecValue(0, gain)).toBe('-INF')
    expect(formatSpecValue(127, gain)).toBe('11.90')
  })

  it('shows AMP HOLD as a time, ending at INF', () => {
    const hold = fieldSpec('hold')!
    expect(formatSpecValue(0, hold)).toBe('0.007')
    expect(formatSpecValue(126, hold)).toBe('128.0')
    expect(formatSpecValue(127, hold)).toBe('INF')
  })

  it('reads AMP VOL either side of its centre', () => {
    const vol = fieldSpec('vol')!
    expect(formatSpecValue(0, vol)).toBe('-64')
    expect(formatSpecValue(64, vol)).toBe('0')
    expect(formatSpecValue(127, vol)).toBe('63')
  })

  it('still shows the parameters that really are plain numbers', () => {
    expect(formatSpecValue(127, fieldSpec('atk')!)).toBe('127')
    expect(formatSpecValue(126, fieldSpec('rel')!)).toBe('126')
    expect(formatSpecValue(127, flex('strt'))).toBe('127')
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
    expect(spec.options![6]).toEqual({ value: 12, label: 'AMP ATK' })
    expect(spec.options![12]).toEqual({ value: 6, label: 'LFO1 SPD' })
    expect(formatSpecValue(17, spec)).toBe('AMP XVOL')
    expect(formatSpecValue(9, spec)).toBe('LFO1 DEP')
    // Every raw value 0-29 is reachable exactly once
    expect([...new Set(spec.options!.map(o => o.value))].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 30 }, (_, i) => i))
  })
})

describe('which machines a track can run', () => {
  it('lists the five in the order the device lists them', () => {
    expect(MACHINE_TYPES).toEqual(['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup'])
  })

  /**
   * A Neighbor machine takes its audio from the track before it. T1 and T5 are the
   * first of their group and have none, so the device refuses it there (manual A.4).
   */
  it('withholds Neighbor from the tracks that have no neighbour', () => {
    for (const track of [0, 4]) {
      expect(machineTypesForTrack(track), `T${track + 1}`).not.toContain('Neighbor')
      expect(machineTypesForTrack(track)).toHaveLength(4)
    }
  })

  it('offers Neighbor on every other track', () => {
    for (const track of [1, 2, 3, 5, 6, 7]) {
      expect(machineTypesForTrack(track), `T${track + 1}`).toContain('Neighbor')
      expect(machineTypesForTrack(track)).toHaveLength(5)
    }
  })

  it('keeps the device order whichever track it is', () => {
    expect(machineTypesForTrack(0)).toEqual(['Static', 'Flex', 'Thru', 'Pickup'])
    expect(machineTypesForTrack(1)).toEqual(MACHINE_TYPES)
  })

  it('gives every machine it offers a set of SRC fields, or none on purpose', () => {
    // Neighbor is the one with none - it has no parameters of its own
    for (const machine of MACHINE_TYPES) {
      const ptch = fieldSpec('machine_params.ptch', machine)
      if (machine === 'Thru' || machine === 'Neighbor') expect(ptch, machine).toBeNull()
      else expect(ptch, machine).not.toBeNull()
    }
  })
})
