import { describe, it, expect } from 'vitest'
import { partChanges } from './partDiff'
import { machineHelp } from './partFieldHelp'
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

  /** The rows for one change made to the current copy only. */
  const changed = (edit: (current: ReturnType<typeof copy>) => void) => {
    const current = copy()
    edit(current)
    return partChanges(copy(), current)
  }

  it('names a SETUP page knob after the machine, under SRC SETUP', () => {
    expect(changed(c => { c.part.machines[0].machine_setup.tsns = 70 })).toMatchObject([
      { track: 'T1', page: 'SRC SETUP', param: 'TSNS' },
    ])
  })

  it('puts each page\'s setup fields on its SETUP page, named as the editor names them', () => {
    const cases: [(c: ReturnType<typeof copy>) => void, string, string, string][] = [
      [c => { c.part.amps[0].amp_setup_sync = 0 }, 'T1', 'AMP SETUP', 'SYNC'],
      [c => { c.part.lfos[0].lfo2_wave = 1 }, 'T1', 'LFO SETUP', 'LFO2 WAVE'],
      [c => { c.part.midi_notes[0].chan = 3 }, 'M1', 'NOTE SETUP', 'CHAN'],
      [c => { c.part.midi_arps[0].key = 2 }, 'M1', 'ARP SETUP', 'KEY'],
      [c => { c.part.midi_arps[0].spd = 6 }, 'M1', 'ARP', 'SPD'],
      [c => { c.part.midi_lfos[0].spd1 = 40 }, 'M1', 'LFO', 'SPD1'],
      [c => { c.part.midi_ctrl1s[0].cc2_num = 5 }, 'M1', 'CTRL1 SETUP', 'CC2#'],
      [c => { c.part.midi_ctrl2s[0].cc5 = 9 }, 'M1', 'CTRL2', 'CC5'],
    ]
    for (const [edit, track, page, param] of cases) {
      expect(changed(edit), `${page} ${param}`).toMatchObject([{ track, page, param }])
    }
  })

  it('names an effect SETUP knob after the effect loaded in that block', () => {
    // FX2 holds the delay, whose first setup knob is X
    expect(changed(c => { (c.part.fxs[0] as unknown as Record<string, number>).fx2_setup1 = 5 }))
      .toMatchObject([{ track: 'T1', page: 'FX2 SETUP', param: 'X' }])
  })

  it('names the recorder setup fields as the REC page does', () => {
    expect(changed(c => {
      c.part.recorders[0].rlen = 10
      c.part.recorders[0].xloop = 0
      c.part.recorders[0].in_ab = 2
    }).map(r => `${r.page} ${r.param}`)).toEqual(['REC INAB', 'REC RLEN', 'REC LOOP'])
  })

  it('names a Sample Slot by its pool, counting from 1 as the device does', () => {
    expect(changed(c => { c.part.machines[0].flex_slot_id = 4 })).toMatchObject([
      { track: 'T1', page: 'SRC', param: 'SLOT', saved: 'F001', current: 'F005' },
    ])
    expect(changed(c => { c.part.machines[1].static_slot_id = 9 })).toMatchObject([
      { track: 'T2', page: 'SRC', param: 'SLOT', saved: 'S002', current: 'S010' },
    ])
  })

  it('reads CUE as a level, like TRK', () => {
    expect(changed(c => { c.part.volumes[0].cue = 100 })).toMatchObject([
      { track: 'T1', page: 'LEVELS', param: 'CUE', saved: '108', current: '100' },
    ])
  })

  it('reads XVOL by its two settings', () => {
    expect(changed(c => { c.part.amps[0].xvol = 0 })).toMatchObject([
      { track: 'T1', page: 'AMP', param: 'XVOL', saved: 'MAX', current: 'MIN' },
    ])
  })

  it('lists the B end of the crossfader too', () => {
    expect(changed(c => { c.scenes.scene_b = 2 })).toMatchObject([
      { track: '', page: 'CROSSFADER', param: 'B', saved: 'Scene 9', current: 'Scene 3' },
    ])
  })

  it('lists a scene lock taken out, with "-" on the current side', () => {
    const saved = copy()
    saved.scenes.scenes[2].tracks[0].amp[3] = 80
    expect(partChanges(saved, copy())).toMatchObject([
      { track: 'T1', page: 'Scene 3 AMP', param: 'VOL', saved: '16', current: '-' },
    ])
  })

  it('names a scene\'s crossfader level XLV, by its two settings', () => {
    expect(changed(c => { c.scenes.scenes[0].tracks[1].xlv = 127 })).toMatchObject([
      { track: 'T2', page: 'Scene 1 XLV', param: 'XLV', saved: '-', current: 'MAX' },
    ])
  })

  it('names a scene\'s effect lock after the effect the track loads', () => {
    expect(changed(c => { c.scenes.scenes[0].tracks[0].fx1[0] = 40 })).toMatchObject([
      { track: 'T1', page: 'Scene 1 FLTR', param: 'BASE', saved: '-', current: '40' },
    ])
  })

  it('still lists a difference at a position neither copy uses, so none goes unseen', () => {
    // The DJ EQ leaves its second knob unused; a byte there that differs is still listed
    const saved = copy()
    const current = copy()
    saved.part.fxs[0].fx1_type = 13
    current.part.fxs[0].fx1_type = 13
    ;(current.part.fxs[0] as unknown as Record<string, number>).fx1_param2 = 30
    expect(partChanges(saved, current)).toMatchObject([
      { track: 'T1', saved: '64', current: '30' },
    ])
  })

  it('carries the machine\'s help on a machine change, and the effect\'s on an effect knob', () => {
    const [machine] = changed(c => { c.part.machines[0].machine_type = 'Thru' })
    expect(machine.help).toBe(machineHelp('Thru'))
    const [knob] = changed(c => { c.part.fxs[0].fx1_param1 = 30 })
    expect(knob.help).toMatch(/^BASE - /)
  })

  it('lists the audio tracks, then the MIDI tracks, then the crossfader', () => {
    expect(changed(c => {
      c.scenes.scene_a = 2
      c.part.midi_notes[0].note = 60
      c.part.amps[7].vol = 70
    }).map(r => r.track)).toEqual(['T8', 'M1', ''])
  })
})
