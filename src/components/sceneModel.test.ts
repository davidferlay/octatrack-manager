import { describe, it, expect } from 'vitest'
import {
  sceneAssignments, slotsForTrack, emptyTracks, countLocks,
  SceneTrackLocks, ScenesResponse,
} from './sceneModel'

/**
 * Reading a whole Part's scenes at once.
 *
 * The matrix and the comparison both ask the same question - which scenes reach for
 * which parameter, and what they hold there - so they share one answer. A row exists
 * because some scene reaches for it; the values follow per scene.
 */

const six = (): (number | null)[] => [null, null, null, null, null, null]

function track(id: number, held: Partial<SceneTrackLocks> = {}): SceneTrackLocks {
  return {
    track_id: id,
    machine: six(), lfo: six(), amp: six(), fx1: six(), fx2: six(), xlv: null,
    ...held,
  }
}

/** A Part whose scenes hold whatever each entry says, everything else untouched. */
function part(held: Record<number, Partial<SceneTrackLocks>[]> = {}): ScenesResponse {
  return {
    scenes: Array.from({ length: 16 }, (_, sceneId) => {
      const tracks = Array.from({ length: 8 }, (_, trackId) =>
        track(trackId, held[sceneId]?.[trackId] ?? {}))
      return { scene_id: sceneId, tracks, locked_count: countLocks(tracks) }
    }),
    scene_a: 0,
    scene_b: 8,
    machine_types: Array(8).fill('Flex'),
    fx1_types: Array(8).fill(4),
    fx2_types: Array(8).fill(8),
    parts_edited_bitmask: 0,
    parts_saved_state: [1, 0, 0, 0],
    scene_a_muted: false,
    scene_b_muted: false,
  }
}

describe('what a Part reaches for', () => {
  it('answers with nothing when no scene holds anything', () => {
    expect(sceneAssignments(part())).toEqual([])
  })

  it('gives a row to a parameter one scene holds', () => {
    const rows = sceneAssignments(part({ 0: [{ amp: [null, null, null, 100, null, null] }] }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ trackId: 0, pageName: 'AMP', label: 'VOL', index: 3 })
  })

  it('carries what each scene holds there, one per scene', () => {
    const rows = sceneAssignments(part({
      0: [{ amp: [null, null, null, 100, null, null] }],
      5: [{ amp: [null, null, null, 80, null, null] }],
    }))
    expect(rows[0].values).toHaveLength(16)
    expect(rows[0].values[0]).toBe(100)
    expect(rows[0].values[5]).toBe(80)
    expect(rows[0].values[1]).toBeNull()
  })

  it('leaves out a parameter no scene reaches for', () => {
    // The AMP page has six positions; only the one that is held becomes a row
    const rows = sceneAssignments(part({ 0: [{ amp: [null, null, null, 100, null, null] }] }))
    expect(rows.map(r => r.label)).toEqual(['VOL'])
  })

  it('offers every position a scene could reach for, on request', () => {
    const only = sceneAssignments(part({ 0: [{ amp: [null, null, null, 100, null, null] }] }))
    const all = sceneAssignments(part({ 0: [{ amp: [null, null, null, 100, null, null] }] }), true)
    expect(all.length).toBeGreaterThan(only.length)
    // Including the ones no scene holds, which is how one gets put into a scene
    expect(all.some(row => row.values.every(value => value === null))).toBe(true)
  })

  it('still answers for a Part holding nothing, when asked for everything', () => {
    const all = sceneAssignments(part(), true)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every(row => row.values.every(value => value === null))).toBe(true)
  })

  it('reads every track, in track order', () => {
    const rows = sceneAssignments(part({
      0: [
        { amp: [null, null, null, 100, null, null] },
        {},
        { lfo: [12, null, null, null, null, null] },
      ],
    }))
    expect(rows.map(r => r.trackId)).toEqual([0, 2])
  })

  it('keeps the page order the editor uses', () => {
    const rows = sceneAssignments(part({
      0: [{
        amp: [null, null, null, 100, null, null],
        machine: [70, null, null, null, null, null],
        lfo: [12, null, null, null, null, null],
      }],
    }))
    // SRC, then AMP, then LFO, as the scene list lays a track out
    expect(rows.map(r => r.pageName)).toEqual(['SRC', 'AMP', 'LFO'])
  })

  it('names a position after the machine the track runs', () => {
    // The second SRC position is STRT on a sample machine and DIR on a Pickup one
    const held = { 0: [{ machine: [null, 40, null, null, null, null] }] }
    const flex = sceneAssignments(part(held))
    const pickup = part(held)
    pickup.machine_types = Array(8).fill('Pickup')
    expect(flex[0].label).toBe('STRT')
    expect(sceneAssignments(pickup)[0].label).toBe('DIR')
  })

  it('names an effect position after the effect that block holds', () => {
    const filter = part({ 0: [{ fx1: [null, 30, null, null, null, null] }] })
    const delay = part({ 0: [{ fx1: [null, 30, null, null, null, null] }] })
    delay.fx1_types = Array(8).fill(8)
    // The filter's second knob is WDTH; the delay's is FB
    expect(sceneAssignments(filter)[0].label).toBe('WDTH')
    expect(sceneAssignments(delay)[0].label).toBe('FB')
  })

  it('carries the crossfader level, which only a scene can set', () => {
    const rows = sceneAssignments(part({ 0: [{ xlv: 127 }] }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'XLV', page: 'xlv' })
    expect(rows[0].values[0]).toBe(127)
  })

  it('gives each row what a view needs to write it back', () => {
    const rows = sceneAssignments(part({ 0: [{ lfo: [null, null, null, 12, null, null] }] }))
    expect(rows[0].page).toBe('lfo')
    expect(rows[0].index).toBe(3)
    expect(rows[0].field).toBeTruthy()
    expect(rows[0].spec).toBeTruthy()
  })

  it('keys each row to one position of one track', () => {
    const rows = sceneAssignments(part({
      0: [
        { amp: [null, null, null, 100, null, null] },
        { amp: [null, null, null, 100, null, null] },
      ],
    }))
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length)
  })

  it('survives a Part with no scenes at all', () => {
    const none = part()
    none.scenes = []
    expect(sceneAssignments(none)).toEqual([])
  })
})

describe('emptying a track set', () => {
  it('takes everything out and keeps the tracks', () => {
    const tracks = [track(0, { amp: [null, null, null, 100, null, null], xlv: 127 })]
    const empty = emptyTracks(tracks)
    expect(empty).toHaveLength(1)
    expect(empty[0].track_id).toBe(0)
    expect(countLocks(empty)).toBe(0)
  })

  it('leaves the ones it was given alone', () => {
    const tracks = [track(0, { amp: [null, null, null, 100, null, null] })]
    emptyTracks(tracks)
    expect(tracks[0].amp[3]).toBe(100)
  })
})

describe('counting what a scene holds', () => {
  it('counts every page and the crossfader level', () => {
    expect(countLocks([track(0, {
      amp: [null, null, null, 100, null, null],
      lfo: [12, null, null, null, null, null],
      xlv: 127,
    })])).toBe(3)
  })

  it('counts nothing for a scene that holds nothing', () => {
    expect(countLocks([track(0), track(1)])).toBe(0)
  })
})

describe('the positions a track offers', () => {
  it('leaves out what the machine does not have', () => {
    const neighbor = slotsForTrack(track(0), 'Neighbor', 4, 8)
    expect(neighbor.some(slot => slot.page === 'machine')).toBe(false)
    // It still has its AMP, LFO and effects
    expect(neighbor.some(slot => slot.page === 'amp')).toBe(true)
  })

  it('leaves out an effect knob the effect does not use', () => {
    // The spring reverb leaves its second and third positions blank
    const spring = slotsForTrack(track(0), 'Flex', 4, 21)
    const used = spring.filter(slot => slot.page === 'fx2').map(slot => slot.index)
    expect(used).not.toContain(1)
    expect(used).not.toContain(2)
  })

  it('always ends with the crossfader level', () => {
    const slots = slotsForTrack(track(0), 'Flex', 4, 8)
    expect(slots[slots.length - 1].page).toBe('xlv')
  })
})
