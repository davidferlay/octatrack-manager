import { describe, it, expect } from 'vitest'
import {
  rollValue, randomizedTracks, rowsHeldBy, DEFAULT_BOUNDS,
  type RandomizeBounds,
} from './sceneRandomize'
import type { AssignmentRow, SceneData, SceneTrackLocks } from './sceneModel'
import type { FieldSpec } from '../utils/partFieldSpecs'

/**
 * Rerolling a scene's values.
 *
 * The random source is handed in everywhere, so these say what is reachable rather
 * than what came out once.
 */

/** A source that walks the given points of [0, 1), then repeats the last one. */
function rolls(...points: number[]): () => number {
  let at = 0
  return () => points[Math.min(at++, points.length - 1)]
}

/** Every value a roll can produce, found by sweeping the random source. */
function reachable(spec: FieldSpec, bounds: RandomizeBounds, current: number): number[] {
  const seen = new Set<number>()
  for (let i = 0; i < 1000; i++) seen.add(rollValue(spec, bounds, current, () => i / 1000))
  return [...seen].sort((a, b) => a - b)
}

const plain = (min: number, max: number): FieldSpec => ({
  min, max, default: min, widget: 'unipolar',
})

const window = (low: number, high: number): RandomizeBounds =>
  ({ mode: 'window', low, high, drift: 0 })
const drift = (by: number): RandomizeBounds =>
  ({ mode: 'drift', low: 0, high: 100, drift: by })

describe('rolling one value', () => {
  it('reaches both ends of the range and nothing outside it', () => {
    const reach = reachable(plain(0, 127), DEFAULT_BOUNDS, 64)
    expect(reach[0]).toBe(0)
    expect(reach[reach.length - 1]).toBe(127)
    expect(reach).toHaveLength(128)
  })

  it('a window keeps to its slice of the range', () => {
    // A quarter of 0-127 either side of the middle
    expect(reachable(plain(0, 127), window(25, 75), 0)).toEqual(
      Array.from({ length: 64 }, (_, i) => 32 + i),
    )
  })

  it('the window is a share of each range, not a number', () => {
    // The same 25-75 over a bipolar range lands where that range's middle is
    const reach = reachable(plain(-64, 63), window(25, 75), 0)
    expect(reach[0]).toBe(-32)
    expect(reach[reach.length - 1]).toBe(31)
  })

  it('a window of one point always gives that point', () => {
    expect(reachable(plain(0, 127), window(50, 50), 3)).toEqual([64])
  })

  it('handles dragged past each other still describe a window', () => {
    expect(reachable(plain(0, 127), window(75, 25), 0))
      .toEqual(reachable(plain(0, 127), window(25, 75), 0))
  })

  it('drift stays within reach of the value held', () => {
    // 10% of 0-127 is 13 either way
    expect(reachable(plain(0, 127), drift(10), 100)).toEqual(
      Array.from({ length: 27 }, (_, i) => 87 + i),
    )
  })

  it('drift is measured from the value, so it moves with it', () => {
    expect(reachable(plain(0, 127), drift(10), 20)[0]).toBe(7)
    expect(reachable(plain(0, 127), drift(10), 60)[0]).toBe(47)
  })

  it('drift does not push a value past either end of its range', () => {
    expect(reachable(plain(0, 127), drift(50), 10)[0]).toBe(0)
    const high = reachable(plain(0, 127), drift(50), 120)
    expect(high[high.length - 1]).toBe(127)
  })

  it('no drift leaves the value where it is', () => {
    expect(reachable(plain(0, 127), drift(0), 42)).toEqual([42])
  })

  it('lands only on values the device uses', () => {
    // XLV is one of two settings, never anything between
    const sparse: FieldSpec = {
      min: 0, max: 127, default: 0, widget: 'unipolar',
      table: { 0: 'MIN', 127: 'MAX' },
    } as unknown as FieldSpec
    expect(reachable(sparse, DEFAULT_BOUNDS, 0)).toEqual([0, 127])
  })

  it('a window that is all gap still answers, with the nearest value that is not', () => {
    const sparse: FieldSpec = {
      min: 0, max: 127, default: 0, widget: 'unipolar',
      table: { 0: 'MIN', 127: 'MAX' },
    } as unknown as FieldSpec
    // Nothing legal between 40% and 60%, so it takes whichever end is closer
    expect(reachable(sparse, window(40, 60), 0).every(v => v === 0 || v === 127)).toBe(true)
  })
})

const six = (): (number | null)[] => [null, null, null, null, null, null]

function track(id: number, held: Partial<SceneTrackLocks> = {}): SceneTrackLocks {
  return {
    track_id: id,
    machine: six(), lfo: six(), amp: six(), fx1: six(), fx2: six(), xlv: null,
    ...held,
  }
}

function row(
  key: string, trackId: number, page: AssignmentRow['page'], index: number,
  values: (number | null)[],
): AssignmentRow {
  return {
    key, trackId, page, index,
    pageName: 'AMP', label: 'VOL', field: 'amp_volume',
    spec: plain(0, 127),
    values,
  }
}

/** Sixteen scenes' worth of values, with the named ones filled in. */
const per = (filled: Record<number, number>): (number | null)[] =>
  Array.from({ length: 16 }, (_, i) => (i in filled ? filled[i] : null))

function scene(id: number, tracks: SceneTrackLocks[]): SceneData {
  return { scene_id: id, tracks, locked_count: 0 }
}

describe('rerolling a scene', () => {
  it('changes the parameters it was handed', () => {
    const amp = [null, null, null, 100, null, null]
    const subject = scene(0, [track(0, { amp })])
    const { tracks, changed } = randomizedTracks(
      subject,
      [row('0-amp-3', 0, 'amp', 3, per({ 0: 100 }))],
      window(0, 0),
      rolls(0),
    )
    expect(changed).toBe(1)
    expect(tracks[0].amp[3]).toBe(0)
  })

  it('leaves the scene it was given alone', () => {
    const amp = [null, null, null, 100, null, null]
    const subject = scene(0, [track(0, { amp })])
    randomizedTracks(subject, [row('0-amp-3', 0, 'amp', 3, per({ 0: 100 }))], window(0, 0), rolls(0))
    expect(subject.tracks[0].amp[3]).toBe(100)
  })

  it('does not reach for a parameter the scene does not hold', () => {
    const subject = scene(0, [track(0)])
    const { tracks, changed } = randomizedTracks(
      subject,
      // Scene 1 holds it, scene 0 does not
      [row('0-amp-3', 0, 'amp', 3, per({ 1: 100 }))],
      DEFAULT_BOUNDS,
      rolls(0.9),
    )
    expect(changed).toBe(0)
    expect(tracks[0].amp[3]).toBeNull()
  })

  it('leaves the parameters it was not handed as they were', () => {
    const amp = [null, null, null, 100, 20, null]
    const subject = scene(0, [track(0, { amp })])
    const { tracks } = randomizedTracks(
      subject,
      [row('0-amp-3', 0, 'amp', 3, per({ 0: 100 }))],
      window(0, 0),
      rolls(0),
    )
    expect(tracks[0].amp[4]).toBe(20)
  })

  it('reaches the crossfader level, which is stored apart from the pages', () => {
    const subject = scene(0, [track(0, { xlv: 0 })])
    const { tracks, changed } = randomizedTracks(
      subject,
      [row('0-xlv-0', 0, 'xlv', 0, per({ 0: 0 }))],
      window(100, 100),
      rolls(0),
    )
    expect(changed).toBe(1)
    expect(tracks[0].xlv).toBe(127)
  })

  it('reaches every track it was given rows for', () => {
    const subject = scene(0, [
      track(0, { amp: [null, null, null, 10, null, null] }),
      track(1, { amp: [null, null, null, 20, null, null] }),
    ])
    const { tracks, changed } = randomizedTracks(
      subject,
      [
        row('0-amp-3', 0, 'amp', 3, per({ 0: 10 })),
        row('1-amp-3', 1, 'amp', 3, per({ 0: 20 })),
      ],
      window(100, 100),
      rolls(0),
    )
    expect(changed).toBe(2)
    expect([tracks[0].amp[3], tracks[1].amp[3]]).toEqual([127, 127])
  })

  it('ignores a row for a track that is not there', () => {
    const subject = scene(0, [track(0)])
    const { changed } = randomizedTracks(
      subject,
      [row('9-amp-3', 9, 'amp', 3, per({ 0: 10 }))],
      DEFAULT_BOUNDS,
      rolls(0.5),
    )
    expect(changed).toBe(0)
  })
})

describe('what there is to reroll', () => {
  it('keeps the rows the chosen scenes hold', () => {
    const held = row('0-amp-3', 0, 'amp', 3, per({ 2: 10 }))
    const other = row('0-amp-4', 0, 'amp', 4, per({ 5: 10 }))
    expect(rowsHeldBy([held, other], [2])).toEqual([held])
  })

  it('a row any one of them holds is in', () => {
    const held = row('0-amp-3', 0, 'amp', 3, per({ 5: 10 }))
    expect(rowsHeldBy([held], [2, 5])).toEqual([held])
  })

  it('nothing held, nothing to reroll', () => {
    const empty = row('0-amp-3', 0, 'amp', 3, per({}))
    expect(rowsHeldBy([empty], [0, 1, 2])).toEqual([])
  })
})
