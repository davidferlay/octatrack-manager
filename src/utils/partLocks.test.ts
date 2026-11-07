import { describe, it, expect } from 'vitest'
import { fieldPath, scenePath, valueAt, differs, paramLocation } from './partLocks'
import { copy } from './partDiff.fixtures'

describe('value keys', () => {
  it('writes a Part value as a JSON pointer, dots as slashes', () => {
    expect(fieldPath('machines', 2, 'machine_params.ptch')).toBe('/part/machines/2/machine_params/ptch')
    expect(fieldPath('fxs', 0, 'fx1_param3')).toBe('/part/fxs/0/fx1_param3')
  })

  it('writes a scene value as a JSON pointer', () => {
    expect(scenePath(3, 1, 'xlv', 0)).toBe('/scenes/scenes/3/tracks/1/xlv')
    expect(scenePath(3, 1, 'fx1', 2)).toBe('/scenes/scenes/3/tracks/1/fx1/2')
  })
})

describe('valueAt', () => {
  it('reads numbers, strings and null', () => {
    const c = copy()
    expect(valueAt(c, '/part/amps/0/atk')).toBe(0)
    expect(valueAt(c, '/part/machines/0/machine_type')).toBe('Flex')
    expect(valueAt(c, '/part/machines/0/machine_params/in_ab')).toBeNull()
    expect(valueAt(c, '/scenes/scene_b')).toBe(8)
    expect(valueAt(c, '/scenes/scenes/0/tracks/0/xlv')).toBeNull()
  })

  it('reads a path that leads nowhere as null', () => {
    expect(valueAt(copy(), '/part/nope/0/x')).toBeNull()
  })
})

describe('differs', () => {
  it('is false without a saved copy', () => {
    expect(differs({ saved: null, edited: copy(), identical: false }, '/part/amps/0/atk')).toBe(false)
  })

  it('compares the two copies at the path', () => {
    const edited = copy()
    edited.part.amps[0].atk = 5
    const copies = { saved: copy(), edited, identical: false }
    expect(differs(copies, '/part/amps/0/atk')).toBe(true)
    expect(differs(copies, '/part/amps/0/rel')).toBe(false)
  })
})

describe('where a value is edited', () => {
  it('a Part value names its track, page and LFO sub-tab', () => {
    expect(paramLocation('/part/amps/2/atk')).toEqual({ tab: 'parts', track: 2, page: 1 })
    expect(paramLocation('/part/machines/0/machine_params/ptch')).toEqual({ tab: 'parts', track: 0, page: 0 })
    expect(paramLocation('/part/machines/0/machine_setup/xloop')).toEqual({ tab: 'parts', track: 0, page: 0 })
    expect(paramLocation('/part/fxs/1/fx1_param3')).toEqual({ tab: 'parts', track: 1, page: 3 })
    expect(paramLocation('/part/fxs/1/fx2_type')).toEqual({ tab: 'parts', track: 1, page: 4 })
    expect(paramLocation('/part/recorders/3/rlen')).toEqual({ tab: 'parts', track: 3, page: 5 })
    expect(paramLocation('/part/lfos/0/lfo2_wave')).toEqual({ tab: 'parts', track: 0, page: 2, lfoTab: 'LFO2' })
    expect(paramLocation('/part/lfos/0/dep3')).toEqual({ tab: 'parts', track: 0, page: 2, lfoTab: 'LFO3' })
    expect(paramLocation('/part/lfos/0/custom_lfo_design/4')).toEqual({ tab: 'parts', track: 0, page: 2, lfoTab: 'DESIGN' })
  })

  it('a MIDI track counts from 8', () => {
    expect(paramLocation('/part/midi_arps/0/len')).toEqual({ tab: 'parts', track: 8, page: 1 })
    expect(paramLocation('/part/midi_lfos/7/spd1')).toEqual({ tab: 'parts', track: 15, page: 2, lfoTab: 'LFO1' })
  })

  it('a field of the track header is on every page', () => {
    expect(paramLocation('/part/machines/4/machine_type')).toEqual({ tab: 'parts', track: 4, page: undefined })
    expect(paramLocation('/part/machines/4/flex_slot_id')).toEqual({ tab: 'parts', track: 4, page: undefined })
    expect(paramLocation('/part/volumes/4/main')).toEqual({ tab: 'parts', track: 4, page: undefined })
  })

  it('a scene lock names its scene and track; a crossfader end only the tab', () => {
    expect(paramLocation('/scenes/scenes/12/tracks/3/fx1/2')).toEqual({ tab: 'scenes', sceneId: 12, track: 3 })
    expect(paramLocation('/scenes/scenes/0/tracks/7/xlv')).toEqual({ tab: 'scenes', sceneId: 0, track: 7 })
    expect(paramLocation('/scenes/scene_b')).toEqual({ tab: 'scenes' })
    expect(paramLocation('/part/nope')).toBeNull()
  })
})
