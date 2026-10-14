/**
 * Giving a scene's values new ones at random, within bounds the user sets.
 *
 * Kept apart from the panel because the interesting part is arithmetic: which numbers
 * are reachable, and what happens at the edges of a parameter's own range. The random
 * source is an argument so a test can hand it a known sequence.
 */

import { clampToSpec, type FieldSpec } from '../utils/partFieldSpecs';
import type { AssignmentRow, SceneData, SceneTrackLocks } from './sceneModel';

/**
 * Window rerolls a value anywhere in a slice of its range, ignoring what it holds now.
 * Drift moves it away from where it already sits, by no more than so much.
 */
export type RandomizeMode = 'window' | 'drift';

export interface RandomizeBounds {
  mode: RandomizeMode;
  /** Window: the slice of each parameter's own range, as percentages of it. */
  low: number;
  high: number;
  /** Drift: how far a value may move, as a percentage of its range. */
  drift: number;
}

/** The whole range, which is what Randomize did before there were bounds at all. */
export const DEFAULT_BOUNDS: RandomizeBounds = {
  mode: 'window',
  low: 0,
  high: 100,
  drift: 15,
};

/** An integer in [lo, hi], both ends included. */
function between(lo: number, hi: number, random: () => number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

/**
 * One new value for one parameter.
 *
 * Percentages rather than numbers because the parameters have nothing in common: VOL
 * runs 0-127 and an LFO speed runs -64-63, so "the top quarter" is the only thing that
 * means the same for both.
 *
 * `clampToSpec` has the last word, so a value that lands in a gap the device does not
 * use moves to the nearest one it does - even where that is outside the bounds asked
 * for. A sparse parameter whose whole window is a gap has to answer something, and the
 * nearest legal value is a better answer than refusing to move.
 */
export function rollValue(
  spec: FieldSpec,
  bounds: RandomizeBounds,
  current: number,
  random: () => number = Math.random,
): number {
  const span = spec.max - spec.min;

  if (bounds.mode === 'drift') {
    const reach = Math.round((Math.max(0, bounds.drift) / 100) * span);
    const lo = Math.max(spec.min, current - reach);
    const hi = Math.min(spec.max, current + reach);
    return clampToSpec(between(lo, hi, random), spec);
  }

  // Dragged past each other, the handles still describe a window
  const lowest = Math.min(bounds.low, bounds.high);
  const highest = Math.max(bounds.low, bounds.high);
  const lo = spec.min + Math.round((lowest / 100) * span);
  const hi = spec.min + Math.round((highest / 100) * span);
  return clampToSpec(between(lo, hi, random), spec);
}

/**
 * The scene's tracks with every parameter in `rows` rerolled.
 *
 * A row the scene does not hold is left alone: which parameters a scene reaches for is
 * the musical decision, and only the values are being shuffled. Pass rows the scene
 * does hold and they all change; pass the whole Part's rows and each scene takes the
 * ones that are its own.
 */
export function randomizedTracks(
  scene: SceneData,
  rows: AssignmentRow[],
  bounds: RandomizeBounds,
  random: () => number = Math.random,
): { tracks: SceneTrackLocks[]; changed: number } {
  const tracks = scene.tracks.map(t => ({
    ...t,
    machine: [...t.machine], lfo: [...t.lfo], amp: [...t.amp],
    fx1: [...t.fx1], fx2: [...t.fx2],
  }));

  let changed = 0;
  for (const row of rows) {
    const held = row.values[scene.scene_id];
    if (held === null || held === undefined) continue;
    const track = tracks[row.trackId];
    if (!track) continue;
    const rolled = rollValue(row.spec, bounds, held, random);
    if (row.page === 'xlv') track.xlv = rolled;
    else track[row.page][row.index] = rolled;
    changed++;
  }
  return { tracks, changed };
}

/** The rows at least one of these scenes holds - what there is to reroll. */
export function rowsHeldBy(rows: AssignmentRow[], scenes: number[]): AssignmentRow[] {
  return rows.filter(row => scenes.some(id => row.values[id] !== null));
}
