/** An LFO design: 16 steps, raw bytes 0-255 and modes 0 (stepped) | 1 (smooth), as in PartTrackLfo. */
export interface LfoShape {
  values: number[]
  interpolation: number[]
}

const STEPS = 16
const SHARE_TYPE = 'octatrack-lfo-design'
const MAX_SHARE_LENGTH = 10000

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Raw byte 0-255 to signed -128..127. */
export const toSigned = (raw: number): number => (raw > 127 ? raw - 256 : raw)

/** Signed value to raw byte; rounds and clamps to -128..127. */
export const toRaw = (signed: number): number => clamp(Math.round(signed), -128, 127) & 0xff

/** Same values and modes, step by step: an edit that would write nothing new. */
export const sameShape = (a: LfoShape, b: LfoShape): boolean =>
  a.values.length === b.values.length &&
  a.interpolation.length === b.interpolation.length &&
  a.values.every((v, i) => v === b.values[i]) &&
  a.interpolation.every((m, i) => m === b.interpolation[i])

/** The device's Invert: raw ^ 0xFF on every value, modes kept. */
export const invertShape = (s: LfoShape): LfoShape => ({
  values: s.values.map(v => v ^ 0xff),
  interpolation: [...s.interpolation],
})

/** The device's Clear: all values 0, all steps stepped. */
export const clearShape = (): LfoShape => ({
  values: Array(STEPS).fill(0),
  interpolation: Array(STEPS).fill(0),
})

/** Same values, every step set to the given mode. */
export const setAllModes = (s: LfoShape, mode: 0 | 1): LfoShape => ({
  values: [...s.values],
  interpolation: Array(STEPS).fill(mode),
})

/** 16 random values over the whole byte range, then 16 random modes. */
export const randomShape = (rand: () => number = Math.random): LfoShape => {
  const values = Array.from({ length: STEPS }, () => Math.floor(rand() * 256))
  const interpolation = Array.from({ length: STEPS }, () => (rand() < 0.5 ? 1 : 0))
  return { values, interpolation }
}

/** Vertical position of a signed value: 127 at the top, -128 at the bottom. */
export const yOf = (signed: number, height: number): number => ((127 - signed) * height) / 255

const fmt = (n: number) => String(Math.round(n * 100) / 100)

/** SVG polyline `points` for the waveform; step 16 wraps into step 1. */
export const waveformPoints = (s: LfoShape, width: number, height: number): string => {
  const v = s.values.map(toSigned)
  const pts: [number, number][] = [[0, yOf(v[0], height)]]
  for (let i = 0; i < STEPS; i++) {
    const x1 = ((i + 1) * width) / STEPS
    const next = v[(i + 1) % STEPS]
    if (s.interpolation[i] !== 1) pts.push([x1, yOf(v[i], height)])
    pts.push([x1, yOf(next, height)])
  }
  return pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
}

/** Maps a pointer position to a step and signed value, clamped to the canvas. */
export const pointToStep = (
  x: number, y: number, width: number, height: number,
): { step: number; signed: number } => ({
  step: clamp(Math.floor(clamp(x, 0, width - 0.001) / (width / STEPS)), 0, STEPS - 1),
  signed: clamp(Math.round(127 - (clamp(y, 0, height) * 255) / height), -128, 127),
})

/** Share text (JSON) for Copy and Export. */
export const toShareText = (s: LfoShape): string =>
  JSON.stringify({
    type: SHARE_TYPE,
    version: 1,
    values: s.values.map(toSigned),
    interpolated: s.interpolation.map(m => m === 1),
  })

/** Parses share text; throws an Error with a user-facing message when it is not a valid design. */
export const parseShareText = (text: string): LfoShape => {
  const notDesign = () => new Error('Not an LFO design')
  if (text.length > MAX_SHARE_LENGTH) throw notDesign()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw notDesign()
  }
  if (typeof data !== 'object' || data === null) throw notDesign()
  const d = data as Record<string, unknown>
  if (d.type !== SHARE_TYPE) throw notDesign()
  if (typeof d.version === 'number' && d.version > 1) {
    throw new Error('Made by a newer version of Octatrack Manager')
  }
  if (d.version !== 1) throw notDesign()
  const { values, interpolated } = d
  if (
    !Array.isArray(values) || values.length !== STEPS ||
    !values.every(v => Number.isInteger(v) && v >= -128 && v <= 127)
  ) throw notDesign()
  if (
    !Array.isArray(interpolated) || interpolated.length !== STEPS ||
    !interpolated.every(m => typeof m === 'boolean')
  ) throw notDesign()
  return {
    values: (values as number[]).map(toRaw),
    interpolation: (interpolated as boolean[]).map(m => (m ? 1 : 0)),
  }
}

/** A safe file-name piece: letters, digits, _ and - stay, every other run becomes one -. */
const fileSafe = (text: string) => text.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');

/**
 * The export file name, without extension: `<Set>_<project>_lfo-design-part<n>-<track>`.
 * The Set and the project are the last two folders of the project's path; either is left
 * out when there is none.
 */
export function shareFileName(projectPath: string, part: number, track: string): string {
  const folders = projectPath.split(/[\\/]/).filter(Boolean).slice(-2).map(fileSafe).filter(Boolean);
  return [...folders, `lfo-design-part${part}-${track}`].join('_');
}
