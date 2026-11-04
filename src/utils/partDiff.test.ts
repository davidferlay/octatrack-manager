import { describe, it, expect } from 'vitest'
import { partChanges } from './partDiff'
import { copy } from './partDiff.fixtures'

describe('partChanges', () => {
  it('lists nothing for two identical copies', () => {
    expect(partChanges(copy(), copy())).toEqual([])
  })

  it('names a parameter by track and page, and reads both values the way the editor does', () => {
    const saved = copy()
    const current = copy()
    saved.part.amps[0].vol = 100
    current.part.amps[0].vol = 108
    // VOL reads as its distance from 64, as on the device
    expect(partChanges(saved, current)).toMatchObject([
      { track: 'T1', page: 'AMP', param: 'VOL', saved: '36', current: '44' },
    ])
  })

  it('names an SRC position after the machine the track runs', () => {
    const saved = copy()
    const current = copy()
    current.part.machines[1].machine_params.strt = 10
    const [row] = partChanges(saved, current)
    expect(row).toMatchObject({ track: 'T2', page: 'SRC', param: 'STRT' })
  })

  it('names the saved value too, once an effect change makes a knob mean something else', () => {
    const saved = copy()
    const current = copy()
    current.part.fxs[0].fx1_type = 18 // FILTER to CHORUS
    current.part.fxs[0].fx1_param1 = 30
    expect(partChanges(saved, current)).toMatchObject([
      { track: 'T1', page: 'FX1', param: 'TYPE', saved: 'FILTER', current: 'CHORUS' },
      { track: 'T1', page: 'FX1', param: 'DEL', saved: 'BASE 64', current: '30' },
    ])
  })

  it('shows "-" on the side whose machine does not use a position', () => {
    const saved = copy()
    const current = copy()
    const thru = current.part.machines[0]
    thru.machine_type = 'Thru'
    thru.machine_params = { ...thru.machine_params, strt: null, in_ab: 0 }
    const rows = partChanges(saved, current)
    expect(rows[0]).toMatchObject({ track: 'T1', page: 'SRC', param: 'MACHINE', saved: 'Flex', current: 'Thru' })
    expect(rows).toContainEqual(expect.objectContaining({ param: 'STRT', current: '-' }))
    expect(rows).toContainEqual(expect.objectContaining({ param: 'INAB', saved: '-' }))
  })

  it('names MIDI tracks M1 to M8 and reads a note as a note', () => {
    const saved = copy()
    const current = copy()
    current.part.midi_notes[0].note = 60
    expect(partChanges(saved, current)).toMatchObject([
      { track: 'M1', page: 'NOTE', param: 'NOTE', saved: 'C3', current: 'C4' },
    ])
  })

  it('lists each changed step of a custom LFO design', () => {
    const saved = copy()
    const current = copy()
    current.part.lfos[0].custom_lfo_design[2] = 200
    expect(partChanges(saved, current)).toMatchObject([
      { track: 'T1', page: 'LFO DESIGN', param: 'STEP 3', saved: '0', current: '200' },
    ])
  })

  it('lists a scene lock, with "-" for a position the scene leaves alone', () => {
    const saved = copy()
    const current = copy()
    current.scenes.scenes[2].tracks[0].amp[3] = 80
    expect(partChanges(saved, current)).toMatchObject([
      { track: 'T1', page: 'Scene 3 AMP', param: 'VOL', saved: '-', current: '16' },
    ])
  })

  it('lists a crossfader end pointed at another scene', () => {
    const saved = copy()
    const current = copy()
    current.scenes.scene_a = 3
    expect(partChanges(saved, current)).toMatchObject([
      { track: '', page: 'CROSSFADER', param: 'A', saved: 'Scene 1', current: 'Scene 4' },
    ])
  })

  it('carries the help the editor gives a parameter', () => {
    const saved = copy()
    const current = copy()
    current.part.amps[0].vol = 70
    current.part.volumes[0].main = 100
    const [trk, vol] = partChanges(saved, current)
    expect(vol.help).toMatch(/^VOL - Track volume before the effects/)
    expect(trk.help).toMatch(/^TRK - this track's level in this Part/)
  })

  it('carries the help of a scene position too', () => {
    const saved = copy()
    const current = copy()
    current.scenes.scenes[2].tracks[0].amp[3] = 80
    expect(partChanges(saved, current)[0].help).toMatch(/^VOL - Track volume before the effects/)
  })

  it('keeps every row of a track together, its scene locks after its own values', () => {
    const saved = copy()
    const current = copy()
    current.part.amps[1].vol = 70
    current.scenes.scenes[2].tracks[0].amp[3] = 80
    current.scenes.scene_a = 3
    expect(partChanges(saved, current).map(r => `${r.track} ${r.page}`))
      .toEqual(['T1 Scene 3 AMP', 'T2 AMP', ' CROSSFADER'])
  })
})
