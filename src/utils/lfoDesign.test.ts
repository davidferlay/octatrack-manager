import { describe, it, expect } from 'vitest'
import {
  invertShape, clearShape, setAllModes, randomShape, toSigned, toRaw,
  waveformPoints, pointToStep, toShareText, parseShareText, sameShape, shareFileName, yOf,
} from './lfoDesign'

const T1 = [127, 0, 127, 0, 127, 0, 127, 0, 128, 0, 128, 0, 128, 0, 128, 0]
const T1_INVERTED_ON_DEVICE = [128, 255, 128, 255, 128, 255, 128, 255, 127, 255, 127, 255, 127, 255, 127, 255]
const shape = (values: number[], interpolation = Array(16).fill(0)) => ({ values, interpolation })

describe('lfoDesign', () => {
  it('inverts like the device and keeps the modes', () => {
    const modes = [1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1]
    expect(invertShape(shape(T1, modes))).toEqual(shape(T1_INVERTED_ON_DEVICE, modes))
    expect(invertShape(invertShape(shape(T1, modes)))).toEqual(shape(T1, modes))
  })
  it('clears like the device', () => {
    expect(clearShape()).toEqual(shape(Array(16).fill(0)))
  })
  it('sets every mode', () => {
    expect(setAllModes(shape(T1), 1).interpolation).toEqual(Array(16).fill(1))
    expect(setAllModes(shape(T1, Array(16).fill(1)), 0).interpolation).toEqual(Array(16).fill(0))
  })
  it('draws random values over the whole range and random modes', () => {
    expect(randomShape(() => 0)).toEqual(shape(Array(16).fill(0), Array(16).fill(1)))
    expect(randomShape(() => 0.999)).toEqual(shape(Array(16).fill(255), Array(16).fill(0)))
    for (let i = 0; i < 50; i++) {
      const s = randomShape()
      expect(s.values.every(v => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true)
      expect(s.interpolation.every(m => m === 0 || m === 1)).toBe(true)
    }
  })
  it('converts between raw and signed', () => {
    expect([0, 127, 128, 255].map(toSigned)).toEqual([0, 127, -128, -1])
    expect([0, 127, -128, -1, 200, -300].map(toRaw)).toEqual([0, 127, 128, 255, 127, 128])
  })
  it('draws stepped steps flat and smooth ones as slopes, step 16 into step 1', () => {
    const v = [127, ...Array(15).fill(0)]
    const stepped = waveformPoints(shape(v), 160, 255).split(' ')
    expect(stepped.slice(0, 3)).toEqual(['0,0', '10,0', '10,127'])
    expect(stepped.slice(-2)).toEqual(['160,127', '160,0'])
    const smooth = waveformPoints(shape(v, Array(16).fill(1)), 160, 255).split(' ')
    expect(smooth.slice(0, 2)).toEqual(['0,0', '10,127'])
    expect(smooth.slice(-2)).toEqual(['150,127', '160,0'])
  })
  it('clamps a point past the canvas to its edge', () => {
    expect(pointToStep(-50, -10, 160, 255)).toEqual({ step: 0, signed: 127 })
    expect(pointToStep(500, 999, 160, 255)).toEqual({ step: 15, signed: -128 })
    expect(pointToStep(85, 127, 160, 255)).toEqual({ step: 8, signed: 0 })
  })
  it('round-trips the share text', () => {
    const s = shape(T1, [1, ...Array(15).fill(0)])
    expect(parseShareText(toShareText(s))).toEqual(s)
    expect(JSON.parse(toShareText(s))).toEqual({
      type: 'octatrack-lfo-design', version: 1,
      values: [127, 0, 127, 0, 127, 0, 127, 0, -128, 0, -128, 0, -128, 0, -128, 0],
      interpolated: [true, ...Array(15).fill(false)],
    })
  })
  it.each([
    ['not JSON', 'hello'],
    ['wrong type', '{"type":"x","version":1,"values":[],"interpolated":[]}'],
    ['15 values', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: Array(15).fill(0), interpolated: Array(16).fill(false) })],
    ['value out of range', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: [128, ...Array(15).fill(0)], interpolated: Array(16).fill(false) })],
    ['fractional value', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: [1.5, ...Array(15).fill(0)], interpolated: Array(16).fill(false) })],
    ['1 for a mode', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: Array(16).fill(0), interpolated: [1, ...Array(15).fill(false)] })],
    ['missing modes', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: Array(16).fill(0) })],
    ['oversized', 'x'.repeat(10001)],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON number', '42'],
    ['a JSON string', '"octatrack-lfo-design"'],
    ['"true" for a mode', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: Array(16).fill(0), interpolated: ['true', ...Array(15).fill(false)] })],
    ['0 for a mode', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: Array(16).fill(0), interpolated: [0, ...Array(15).fill(false)] })],
    ['17 modes', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: Array(16).fill(0), interpolated: Array(17).fill(false) })],
    ['a value as text', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: ['5', ...Array(15).fill(0)], interpolated: Array(16).fill(false) })],
    ['a value below -128', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: [-129, ...Array(15).fill(0)], interpolated: Array(16).fill(false) })],
    ['values not a list', JSON.stringify({ type: 'octatrack-lfo-design', version: 1, values: 'x', interpolated: Array(16).fill(false) })],
    ['no version', JSON.stringify({ type: 'octatrack-lfo-design', values: Array(16).fill(0), interpolated: Array(16).fill(false) })],
    ['version 0', JSON.stringify({ type: 'octatrack-lfo-design', version: 0, values: Array(16).fill(0), interpolated: Array(16).fill(false) })],
    ['an empty text', ''],
  ])('refuses %s', (_, text) => {
    expect(() => parseShareText(text)).toThrow('Not an LFO design')
  })
  it('reads a text of exactly 10000 characters, spaces around the JSON included', () => {
    const s = shape(T1, [1, ...Array(15).fill(0)])
    const text = ` ${toShareText(s)}`.padEnd(10000, ' ')
    expect(text).toHaveLength(10000)
    expect(parseShareText(text)).toEqual(s)
  })
  it('reads the range ends and every mode', () => {
    const values = [-128, 127, ...Array(14).fill(0)]
    const parsed = parseShareText(JSON.stringify({
      type: 'octatrack-lfo-design', version: 1, values, interpolated: [true, false, ...Array(14).fill(true)],
    }))
    expect(parsed.values.slice(0, 2)).toEqual([128, 127])
    expect(parsed.interpolation).toEqual([1, 0, ...Array(14).fill(1)])
  })
  it('ignores keys it does not know', () => {
    const s = shape(T1)
    const text = JSON.stringify({ ...JSON.parse(toShareText(s)), name: 'my shape', author: 'x' })
    expect(parseShareText(text)).toEqual(s)
  })
  it('refuses a newer version', () => {
    expect(() => parseShareText(JSON.stringify({ type: 'octatrack-lfo-design', version: 2, values: Array(16).fill(0), interpolated: Array(16).fill(false) })))
      .toThrow('Made by a newer version of Octatrack Manager')
  })
  it('compares two shapes step by step, values and modes', () => {
    const modes = [1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1]
    expect(sameShape(shape(T1, modes), shape([...T1], [...modes]))).toBe(true)
    const value = [...T1]
    value[15] = 1
    expect(sameShape(shape(T1, modes), shape(value, modes))).toBe(false)
    const mode = [...modes]
    mode[0] = 0
    expect(sameShape(shape(T1, modes), shape(T1, mode))).toBe(false)
    expect(sameShape(shape(T1, modes), shape(T1.slice(0, 15), modes))).toBe(false)
  })
})

describe('shareFileName', () => {
  it('names the file after the Set, the project, the Part and the track', () => {
    expect(shareFileName('/home/me/Sets/LIVE SET/P-260702', 1, 'T3')).toBe('LIVE-SET_P-260702_lfo-design-part1-T3')
    expect(shareFileName('C:\\OT\\Set é\\proj (2)\\', 4, 'M1')).toBe('Set-é_proj-2_lfo-design-part4-M1')
  })
  it('drops what is unsafe in a file name and keeps going without a Set', () => {
    expect(shareFileName('/a:b*c?/x<y>|z', 2, 'T1')).toBe('a-b-c_x-y-z_lfo-design-part2-T1')
    expect(shareFileName('/proj', 1, 'T1')).toBe('proj_lfo-design-part1-T1')
    expect(shareFileName('', 1, 'T1')).toBe('lfo-design-part1-T1')
  })
})

describe('lfoDesign helpers', () => {
  it('never changes the shape it is given', () => {
    const values = [...T1]
    const interpolation = [1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1]
    const s = { values: [...values], interpolation: [...interpolation] }
    invertShape(s)
    setAllModes(s, 1)
    setAllModes(s, 0)
    toShareText(s)
    waveformPoints(s, 160, 255)
    expect(s).toEqual({ values, interpolation })
  })
  it('rounds a value to the nearest step before clamping it', () => {
    expect([1.4, 1.5, -1.5, 126.6, -127.6, 127.4].map(toRaw)).toEqual([1, 2, 255, 127, 128, 127])
  })
  it('puts 127 at the top, -128 at the bottom and 0 just below the middle', () => {
    expect(yOf(127, 255)).toBe(0)
    expect(yOf(-128, 255)).toBe(255)
    expect(yOf(0, 255)).toBe(127)
    expect(yOf(127, 100)).toBe(0)
    expect(yOf(-128, 100)).toBe(100)
  })
  it('draws one point per smooth step and two per stepped step, after the start', () => {
    const v = Array(16).fill(0)
    expect(waveformPoints(shape(v, Array(16).fill(1)), 160, 255).split(' ')).toHaveLength(1 + 16)
    expect(waveformPoints(shape(v, Array(16).fill(0)), 160, 255).split(' ')).toHaveLength(1 + 32)
    const mixed = Array(16).fill(0).map((_, i) => i % 2)
    expect(waveformPoints(shape(v, mixed), 160, 255).split(' ')).toHaveLength(1 + 8 + 16)
  })
  it('maps every column to its step and the full height to the full range', () => {
    for (let step = 0; step < 16; step++) {
      expect(pointToStep(step * 10 + 5, 0, 160, 255).step).toBe(step)
    }
    // The last pixel of the last column is still step 16, and its right edge too
    expect(pointToStep(159.9, 0, 160, 255).step).toBe(15)
    expect(pointToStep(160, 0, 160, 255).step).toBe(15)
    expect(pointToStep(0, 255, 160, 255).signed).toBe(-128)
    expect(pointToStep(0, 0, 160, 255).signed).toBe(127)
  })
  it('makes share text that holds signed values and true/false modes', () => {
    const s = shape([0, 255, 128, 127, ...Array(12).fill(1)], [1, 0, ...Array(14).fill(0)])
    const json = JSON.parse(toShareText(s))
    expect(json.values.slice(0, 4)).toEqual([0, -1, -128, 127])
    expect(json.interpolated.slice(0, 2)).toEqual([true, false])
    expect(Object.keys(json)).toEqual(['type', 'version', 'values', 'interpolated'])
  })
})
