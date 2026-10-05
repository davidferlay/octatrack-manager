import { describe, it, expect } from 'vitest'
import { fieldHelp, helpTitle } from './partFieldHelp'
import { fieldSpec } from './partFieldSpecs'
import { getFxMainLabels, getFxSetupLabels } from './fxLabels'

/** Every effect the device offers, by the value its slot stores. OFF has no page. */
const EFFECTS = [4, 5, 8, 12, 13, 16, 17, 18, 19, 20, 21, 22, 24, 28]

/**
 * What each page puts on screen, which is what has to have something to say on hover.
 * Written out rather than derived, so a field added to a page without a line of help
 * shows up here instead of silently hovering blank.
 */
const PAGES: Record<string, { machine?: string; fields: string[] }> = {
  'SRC, sample machine': {
    machine: 'Flex',
    fields: [
      'machine_params.ptch', 'machine_params.strt', 'machine_params.len',
      'machine_params.rate', 'machine_params.rtrg', 'machine_params.rtim',
      'machine_setup.xloop', 'machine_setup.slic', 'machine_setup.len',
      'machine_setup.rate', 'machine_setup.tstr', 'machine_setup.tsns',
    ],
  },
  'SRC, Thru': {
    machine: 'Thru',
    fields: [
      'machine_params.in_ab', 'machine_params.vol_ab',
      'machine_params.in_cd', 'machine_params.vol_cd',
    ],
  },
  'SRC, Pickup': {
    machine: 'Pickup',
    fields: [
      'machine_params.ptch', 'machine_params.dir', 'machine_params.len',
      'machine_params.gain', 'machine_params.op',
      'machine_setup.tstr', 'machine_setup.tsns',
    ],
  },
  AMP: {
    fields: [
      'atk', 'hold', 'rel', 'vol', 'bal',
      'amp_setup_amp', 'amp_setup_sync', 'amp_setup_atck',
      'amp_setup_fx1', 'amp_setup_fx2',
    ],
  },
  LFO: {
    fields: [1, 2, 3].flatMap(n => [
      `lfo${n}_pmtr`, `lfo${n}_wave`, `lfo${n}_mult`, `lfo${n}_trig`, `spd${n}`, `dep${n}`,
    ]),
  },
  'MIDI LFO': {
    // Looked up under their own section, so they need their own entries
    fields: [1, 2, 3].flatMap(n => [
      `midi_lfos.lfo${n}_pmtr`, `midi_lfos.lfo${n}_wave`, `midi_lfos.lfo${n}_mult`,
      `midi_lfos.lfo${n}_trig`, `midi_lfos.spd${n}`, `midi_lfos.dep${n}`,
    ]),
  },
  REC: {
    fields: [
      'recorders.in_ab', 'recorders.in_cd', 'recorders.rlen', 'recorders.trig',
      'recorders.src3', 'recorders.xloop', 'recorders.fin', 'recorders.fout',
      'recorders.ab', 'recorders.qrec', 'recorders.qpl', 'recorders.cd',
    ],
  },
  'MIDI NOTE': {
    fields: [
      'midi_notes.note', 'midi_notes.vel', 'midi_notes.len',
      'midi_notes.not2', 'midi_notes.not3', 'midi_notes.not4',
      'midi_notes.chan', 'midi_notes.bank', 'midi_notes.prog', 'midi_notes.sbnk',
    ],
  },
  'MIDI ARP': {
    fields: [
      'midi_arps.tran', 'midi_arps.leg', 'midi_arps.mode', 'midi_arps.spd',
      'midi_arps.rnge', 'midi_arps.nlen', 'midi_arps.len', 'midi_arps.key',
    ],
  },
  'MIDI CTRL': {
    fields: [
      'midi_ctrl1s.pb', 'midi_ctrl1s.at',
      ...[1, 2, 3, 4].flatMap(n => [`midi_ctrl1s.cc${n}`, `midi_ctrl1s.cc${n}_num`]),
      ...[5, 6, 7, 8, 9, 10].flatMap(n => [`midi_ctrl2s.cc${n}`, `midi_ctrl2s.cc${n}_num`]),
    ],
  },
}

describe('every parameter has something to say', () => {
  for (const [page, { machine, fields }] of Object.entries(PAGES)) {
    it(`covers the ${page} page`, () => {
      const missing = fields.filter(f => !fieldHelp(f, machine)?.text)
      expect(missing).toEqual([])
    })
  }

  it('covers every knob of every effect page', () => {
    const missing: string[] = []
    for (const fx of EFFECTS) {
      const slots = [
        ...getFxMainLabels(fx).map((label, i) => [`fx1_param${i + 1}`, label, 'MAIN'] as const),
        ...getFxSetupLabels(fx).map((label, i) => [`fx1_setup${i + 1}`, label, 'SETUP'] as const),
      ]
      for (const [field, label, page] of slots) {
        // An empty label is a knob position the device leaves blank
        if (!label) continue
        if (!fieldHelp(field, undefined, { label, fxType: fx })) {
          missing.push(`${fx} ${page} ${label}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('says nothing for a Neighbor machine, which has no parameters of its own', () => {
    expect(fieldHelp('machine_params.ptch', 'Neighbor')).toBeUndefined()
  })
})

describe('what it says about each setting', () => {
  /**
   * A named setting is explained by the name the editor shows for it. If the two ever
   * part company - a list reworded, a help entry left behind - the explanation stops
   * reaching the screen without anything failing, which is what this catches.
   */
  it('names settings the field actually offers', () => {
    const wrong: string[] = []
    const check = (field: string, machine?: string, ctx?: { slic?: number }) => {
      const help = fieldHelp(field, machine)
      const spec = fieldSpec(field, machine, ctx)
      if (!help?.values || !spec?.options) return
      const offered = new Set(spec.options.map(o => o.label))
      for (const name of Object.keys(help.values)) {
        if (!offered.has(name)) wrong.push(`${machine ?? ''} ${field}: ${name}`)
      }
    }
    for (const field of [
      'machine_params.in_ab', 'machine_params.in_cd', 'machine_setup.xloop',
      'machine_setup.slic', 'machine_setup.rate', 'machine_setup.tstr',
    ]) check(field, 'Flex')
    check('machine_params.op', 'Pickup')
    check('machine_setup.tstr', 'Pickup')
    for (const field of [
      'amp_setup_amp', 'amp_setup_atck', 'amp_setup_fx1', 'amp_setup_fx2',
      'lfo1_trig', 'lfo2_trig', 'lfo3_trig',
      'recorders.in_ab', 'recorders.in_cd', 'recorders.trig', 'recorders.src3',
      'recorders.qrec', 'recorders.qpl', 'midi_arps.leg', 'midi_arps.mode',
    ]) check(field)
    expect(wrong).toEqual([])
  })

  it('explains SETUP LEN under both of its lists, because SLIC changes them', () => {
    // OFF and TIME when SLIC is off, SLIC and TIME when it is on
    const named = Object.keys(fieldHelp('machine_setup.len', 'Flex')!.values!)
    const off = fieldSpec('machine_setup.len', 'Flex', { slic: 0 })!.options!.map(o => o.label)
    const on = fieldSpec('machine_setup.len', 'Flex', { slic: 1 })!.options!.map(o => o.label)
    expect(new Set([...off, ...on])).toEqual(new Set(named))
  })
})

describe('an effect knob is explained by the effect that is loaded', () => {
  it('reads the same slot differently for different effects', () => {
    const plate = fieldHelp('fx1_param1', undefined, { label: 'TIME', fxType: 20 })
    const spring = fieldHelp('fx1_param1', undefined, { label: 'TIME', fxType: 21 })
    expect(plate!.text).toContain('reverb')
    expect(spring!.text).toContain('springs')
    expect(plate!.text).not.toBe(spring!.text)
  })

  it('says nothing when the slot holds no effect', () => {
    expect(fieldHelp('fx1_param1', undefined, { label: 'TIME', fxType: 0 })).toBeUndefined()
    expect(fieldHelp('fx1_param1', undefined, { label: 'TIME' })).toBeUndefined()
  })
})

describe('the tooltip text', () => {
  it('leads with the parameter name, then what it does', () => {
    const title = helpTitle('ATK', fieldHelp('atk'))!
    expect(title.split('\n')[0]).toMatch(/^ATK - /)
  })

  it('lists every named setting under the description', () => {
    const title = helpTitle('LOOP', fieldHelp('machine_setup.xloop', 'Flex'))!
    const lines = title.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines.slice(1).map(l => l.split(':')[0])).toEqual(['OFF', 'AUTO', 'ON', 'PIPO'])
  })

  it('keeps the raw value note when there is one', () => {
    expect(helpTitle('VOL', fieldHelp('vol'), 'Stored as 64')).toContain('Stored as 64')
  })

  it('falls back to the raw value note alone when nothing was written', () => {
    expect(helpTitle('NOPE', undefined, 'Stored as 64')).toBe('Stored as 64')
    expect(helpTitle('NOPE', undefined)).toBeUndefined()
  })
})
