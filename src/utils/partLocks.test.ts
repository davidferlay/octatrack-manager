import { describe, it, expect } from 'vitest'
import { fieldPath, scenePath, valueAt, differs } from './partLocks'
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
