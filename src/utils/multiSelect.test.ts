import { describe, it, expect } from 'vitest'
import {
  applyItemClick,
  destRangeFrom,
  pairSourcesWithDests,
  orderCopyPairs,
  type SelectionState,
} from './multiSelect'

const plain = { shift: false, ctrl: false }
const shift = { shift: true, ctrl: false }
const ctrl = { shift: false, ctrl: true }
const empty: SelectionState = { selection: [], anchor: null }

describe('applyItemClick - plain click', () => {
  it('selects a single item and anchors it', () => {
    expect(applyItemClick(empty, 3, plain)).toEqual({ selection: [3], anchor: 3 })
  })

  it('replaces an existing selection', () => {
    const state = { selection: [1, 2, 3], anchor: 1 }
    expect(applyItemClick(state, 7, plain)).toEqual({ selection: [7], anchor: 7 })
  })

  it('clears when clicking the sole selected item', () => {
    expect(applyItemClick({ selection: [4], anchor: 4 }, 4, plain)).toEqual({ selection: [], anchor: null })
  })

  it('does not clear when the clicked item is one of several', () => {
    const state = { selection: [2, 4], anchor: 2 }
    expect(applyItemClick(state, 4, plain)).toEqual({ selection: [4], anchor: 4 })
  })
})

describe('applyItemClick - shift click', () => {
  it('ranges forward from the anchor', () => {
    const state = applyItemClick(empty, 2, plain)
    expect(applyItemClick(state, 5, shift).selection).toEqual([2, 3, 4, 5])
  })

  it('ranges backward from the anchor', () => {
    const state = applyItemClick(empty, 5, plain)
    expect(applyItemClick(state, 2, shift).selection).toEqual([2, 3, 4, 5])
  })

  it('keeps the anchor so a second shift-click re-ranges from the origin', () => {
    let state = applyItemClick(empty, 4, plain)
    state = applyItemClick(state, 8, shift)
    expect(state.anchor).toBe(4)
    expect(applyItemClick(state, 6, shift).selection).toEqual([4, 5, 6])
  })

  it('ranges onto a single item when anchor equals the click', () => {
    const state = applyItemClick(empty, 3, plain)
    expect(applyItemClick(state, 3, shift).selection).toEqual([3])
  })

  it('falls back to a plain click when nothing is anchored', () => {
    expect(applyItemClick(empty, 6, shift)).toEqual({ selection: [6], anchor: 6 })
  })

  it('skips unselectable items inside the range', () => {
    const state = applyItemClick(empty, 0, plain, (i) => i !== 2)
    expect(applyItemClick(state, 4, shift, (i) => i !== 2).selection).toEqual([0, 1, 3, 4])
  })
})

describe('applyItemClick - ctrl click', () => {
  it('adds without dropping the rest, keeping order ascending', () => {
    let state = applyItemClick(empty, 5, plain)
    state = applyItemClick(state, 1, ctrl)
    expect(state.selection).toEqual([1, 5])
  })

  it('toggles an already selected item off', () => {
    const state = { selection: [1, 5, 9], anchor: 9 }
    expect(applyItemClick(state, 5, ctrl).selection).toEqual([1, 9])
  })

  it('can empty the selection', () => {
    expect(applyItemClick({ selection: [3], anchor: 3 }, 3, ctrl).selection).toEqual([])
  })

  it('re-anchors so a following shift-click ranges from the ctrl-clicked item', () => {
    let state = applyItemClick(empty, 0, plain)
    state = applyItemClick(state, 5, ctrl)
    expect(applyItemClick(state, 7, shift).selection).toEqual([5, 6, 7])
  })
})

describe('applyItemClick - unselectable items', () => {
  it('ignores a click on an unselectable item', () => {
    const state = { selection: [1], anchor: 1 }
    expect(applyItemClick(state, 9, plain, (i) => i !== 9)).toBe(state)
  })
})

describe('destRangeFrom', () => {
  it('returns a run of the requested length', () => {
    expect(destRangeFrom(2, 3, 16)).toEqual([2, 3, 4])
  })

  it('slides the run back so it fits', () => {
    expect(destRangeFrom(15, 4, 16)).toEqual([12, 13, 14, 15])
  })

  it('clamps a negative start', () => {
    expect(destRangeFrom(-3, 2, 16)).toEqual([0, 1])
  })

  it('returns the whole span when the count fills it', () => {
    expect(destRangeFrom(5, 16, 16)).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })

  it('returns nothing when the run cannot fit', () => {
    expect(destRangeFrom(0, 17, 16)).toEqual([])
    expect(destRangeFrom(0, 0, 16)).toEqual([])
  })
})

describe('pairSourcesWithDests', () => {
  it('pairs position by position', () => {
    expect(pairSourcesWithDests([1, 5, 9], [3, 4, 5])).toEqual([
      { src: 1, dst: 3 },
      { src: 5, dst: 4 },
      { src: 9, dst: 5 },
    ])
  })

  it('drops sources with no destination', () => {
    expect(pairSourcesWithDests([1, 2, 3], [7])).toEqual([{ src: 1, dst: 7 }])
  })
})

/** Every source must still hold its original content when its pair runs. */
function replay(pairs: { src: number; dst: number }[]): Map<number, number> {
  const content = new Map<number, number>()
  const read = (i: number) => content.get(i) ?? i
  for (const { src, dst } of orderCopyPairs(pairs)) content.set(dst, read(src))
  return content
}

describe('orderCopyPairs', () => {
  it('shifts a range up without propagating overwritten items', () => {
    const pairs = [
      { src: 4, dst: 5 },
      { src: 5, dst: 6 },
    ]
    const after = replay(pairs)
    expect(after.get(5)).toBe(4)
    expect(after.get(6)).toBe(5)
  })

  it('shifts a range down without propagating overwritten items', () => {
    const pairs = [
      { src: 4, dst: 3 },
      { src: 5, dst: 4 },
    ]
    const after = replay(pairs)
    expect(after.get(3)).toBe(4)
    expect(after.get(4)).toBe(5)
  })

  it('handles a fully overlapping four-item shift', () => {
    const pairs = [0, 1, 2, 3].map((i) => ({ src: i, dst: i + 1 }))
    const after = replay(pairs)
    expect([1, 2, 3, 4].map((i) => after.get(i))).toEqual([0, 1, 2, 3])
  })

  it('handles discrete sources landing on a contiguous run', () => {
    const pairs = [
      { src: 1, dst: 4 },
      { src: 5, dst: 5 },
      { src: 9, dst: 6 },
    ]
    const after = replay(pairs)
    expect(after.get(4)).toBe(1)
    expect(after.get(5)).toBe(5)
    expect(after.get(6)).toBe(9)
  })

  it('keeps every pair exactly once', () => {
    const pairs = [0, 1, 2, 3].map((i) => ({ src: i, dst: i + 2 }))
    expect(orderCopyPairs(pairs)).toHaveLength(4)
    expect([...orderCopyPairs(pairs)].sort((a, b) => a.src - b.src)).toEqual(pairs)
  })

  it('leaves disjoint pairs alone', () => {
    const pairs = [
      { src: 0, dst: 8 },
      { src: 1, dst: 9 },
    ]
    expect(orderCopyPairs(pairs)).toEqual(pairs)
  })

  it('drains rather than hanging on a cycle', () => {
    const pairs = [
      { src: 0, dst: 1 },
      { src: 1, dst: 0 },
    ]
    expect(orderCopyPairs(pairs)).toHaveLength(2)
  })
})
