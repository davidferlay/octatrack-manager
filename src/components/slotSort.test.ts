import { describe, it, expect } from 'vitest'
import { compareSlotLists } from './FixPoolFilesModal'

/** Sorts labels the way the Slot column does, ignoring the empty-last rule
 * (which the callers apply on top of this comparator). */
const sorted = (labels: string[]) => [...labels].sort((a, b) => compareSlotLists([a], [b]))

describe('compareSlotLists', () => {
  it('orders slot ids numerically, not as strings (the reported S99-above-S9 bug)', () => {
    expect(sorted(['S99', 'S9', 'S10', 'S1', 'S80', 'S2'])).toEqual(
      ['S1', 'S2', 'S9', 'S10', 'S80', 'S99'],
    )
  })

  it('groups the two pools by prefix, flex before static', () => {
    expect(sorted(['S1', 'F9', 'S2', 'F10'])).toEqual(['F9', 'F10', 'S1', 'S2'])
  })

  it('compares multi-slot rows element by element', () => {
    expect(compareSlotLists(['F2', 'S1'], ['F2', 'S9'])).toBeLessThan(0)
    expect(compareSlotLists(['F3'], ['F2', 'S1'])).toBeGreaterThan(0)
  })

  it('puts the shorter list first when one is a prefix of the other', () => {
    expect(compareSlotLists(['S1'], ['S1', 'F2'])).toBeLessThan(0)
  })

  it('treats identical lists as equal', () => {
    expect(compareSlotLists(['S1', 'F2'], ['S1', 'F2'])).toBe(0)
    expect(compareSlotLists([], [])).toBe(0)
  })

  it('does not choke on a malformed label', () => {
    expect(() => compareSlotLists(['?'], ['S1'])).not.toThrow()
  })
})
