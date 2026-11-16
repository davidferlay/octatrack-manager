import { describe, it, expect } from 'vitest'
import {
  invertShape, clearShape, setAllModes, randomShape, toSigned, toRaw,
  waveformPoints, pointToStep, toShareText, parseShareText, sameShape, shareFileName,
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
  ])('refuses %s', (_, text) => {
    expect(() => parseShareText(text)).toThrow('Not an LFO design')
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
