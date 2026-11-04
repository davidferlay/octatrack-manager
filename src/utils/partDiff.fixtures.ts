/** A plain factory Part and its scenes, in the shapes read_part_copies returns. */
import type { PartData } from '../context/ProjectsContext'
import type { ScenesResponse } from '../components/sceneModel'
import type { PartCopy, PartCopies } from './partDiff'

const tracks = Array.from({ length: 8 }, (_, i) => i)
const lfo = (track_id: number) => ({
  track_id, spd1: 32, spd2: 32, spd3: 32, dep1: 0, dep2: 0, dep3: 0,
  lfo1_pmtr: 0, lfo2_pmtr: 0, lfo3_pmtr: 0, lfo1_wave: 0, lfo2_wave: 0, lfo3_wave: 0,
  lfo1_mult: 0, lfo2_mult: 0, lfo3_mult: 0, lfo1_trig: 0, lfo2_trig: 0, lfo3_trig: 0,
  custom_lfo_design: Array(16).fill(0),
})
const six = (prefix: string, value: number) =>
  Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`${prefix}${n}`, value]))

export function makePart(): PartData {
  return {
    part_id: 0,
    machines: tracks.map(track_id => ({
      track_id, machine_type: 'Flex',
      machine_params: {
        ptch: 64, strt: 0, len: 0, rate: 127, rtrg: 0, rtim: 79,
        in_ab: null, vol_ab: null, in_cd: null, vol_cd: null, dir: null, gain: null, op: null,
      },
      machine_setup: { xloop: 1, slic: 0, len: 0, rate: 0, tstr: 1, tsns: 64 },
      static_slot_id: track_id, flex_slot_id: track_id,
    })),
    volumes: tracks.map(track_id => ({ track_id, main: 108, cue: 108 })),
    amps: tracks.map(track_id => ({
      track_id, atk: 0, hold: 127, rel: 24, vol: 64, bal: 64, xvol: 127,
      amp_setup_amp: 1, amp_setup_sync: 1, amp_setup_atck: 0, amp_setup_fx1: 0, amp_setup_fx2: 0,
    })),
    lfos: tracks.map(lfo),
    fxs: tracks.map(track_id => ({
      track_id, fx1_type: 4, fx2_type: 8,
      ...six('fx1_param', 64), ...six('fx2_param', 64), ...six('fx1_setup', 0), ...six('fx2_setup', 0),
    })) as PartData['fxs'],
    recorders: tracks.map(track_id => ({
      track_id, in_ab: 1, in_cd: 0, rlen: 0, trig: 0, src3: 0, xloop: 1,
      fin: 0, fout: 0, ab: 64, qrec: 255, qpl: 255, cd: 64,
    })),
    midi_notes: tracks.map(track_id => ({
      track_id, note: 48, vel: 100, len: 6, not2: 64, not3: 64, not4: 64,
      chan: track_id, bank: 128, prog: 128, sbnk: 128,
    })),
    midi_arps: tracks.map(track_id => ({
      track_id, tran: 64, leg: 0, mode: 0, spd: 5, rnge: 0, nlen: 6, len: 7, key: 0,
    })),
    midi_lfos: tracks.map(lfo),
    midi_ctrl1s: tracks.map(track_id => ({
      track_id, pb: 64, at: 0, cc1: 127, cc2: 0, cc3: 0, cc4: 0,
      cc1_num: 7, cc2_num: 1, cc3_num: 2, cc4_num: 10,
    })),
    midi_ctrl2s: tracks.map(track_id => ({
      track_id, cc5: 0, cc6: 0, cc7: 0, cc8: 0, cc9: 0, cc10: 0,
      cc5_num: 71, cc6_num: 72, cc7_num: 73, cc8_num: 74, cc9_num: 75, cc10_num: 76,
    })),
  }
}

export function makeScenes(): ScenesResponse {
  const none = () => Array(6).fill(null)
  return {
    scenes: Array.from({ length: 16 }, (_, scene_id) => ({
      scene_id, locked_count: 0,
      tracks: tracks.map(track_id => ({
        track_id, machine: none(), lfo: none(), amp: none(), fx1: none(), fx2: none(), xlv: null,
      })),
    })),
    scene_a: 0, scene_b: 8,
    machine_types: tracks.map(() => 'Flex'), fx1_types: tracks.map(() => 4), fx2_types: tracks.map(() => 8),
    parts_edited_bitmask: 1, parts_saved_state: [1, 0, 0, 0],
    scene_a_muted: false, scene_b_muted: false,
  }
}

export const copy = (): PartCopy => ({ part: makePart(), scenes: makeScenes() })

/** Both copies of a Part, the current one changed by `edit` and the saved one factory. */
export const copiesWith = (edit: (current: PartCopy) => void): PartCopies => {
  const edited = copy()
  edit(edited)
  return { saved: copy(), edited, identical: false }
}
