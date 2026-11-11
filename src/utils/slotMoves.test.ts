import { describe, it, expect } from 'vitest'
import {
  canDragSlots, sourcesForDrag, moveForDrop, moveNotice, sortNotice, continuousRun, SORT_ORDERS, type SlotMoveReport,
} from './slotMoves'

const report = (over: Partial<SlotMoveReport>): SlotMoveReport => ({
  moves: [], swapped: null, pushed: [], files_written: [], ...over,
})
const view = (over: Partial<Parameters<typeof canDragSlots>[0]> = {}) => ({
  isEditMode: true, sortColumn: 'slot', sortDirection: 'asc' as const, searchText: '',
  filters: ['all', 'all'], ...over,
})

describe('canDragSlots', () => {
  it('allows dragging in Edit mode, slot ascending, no search, no filters', () => {
    expect(canDragSlots(view())).toBe(true)
  })
  it('blocks in View mode', () => expect(canDragSlots(view({ isEditMode: false }))).toBe(false))
  it('blocks when sorted by another column', () => expect(canDragSlots(view({ sortColumn: 'name' }))).toBe(false))
  it('blocks when slot order is descending', () => expect(canDragSlots(view({ sortDirection: 'desc' }))).toBe(false))
  it('blocks with search text', () => expect(canDragSlots(view({ searchText: 'kick' }))).toBe(false))
  it('blocks with any filter set', () => expect(canDragSlots(view({ filters: ['all', 'wav'] }))).toBe(false))
})

describe('sourcesForDrag', () => {
  it('carries the sorted selection when the dragged slot is in it', () => {
    expect(sourcesForDrag(new Set([9, 2, 5]), 5)).toEqual([2, 5, 9])
  })
  it('carries only the dragged slot when it is not selected', () => {
    expect(sourcesForDrag(new Set([2, 5]), 7)).toEqual([7])
  })
})

describe('moveForDrop', () => {
  it('moves the carried slots to the row let go on', () => {
    expect(moveForDrop({ slots: [1, 2, 3], grabbed: 2 }, 10)).toEqual({ sources: [1, 2, 3], target: 10 })
  })
  it('moves nothing when let go on the grabbed row, whatever it carries', () => {
    expect(moveForDrop({ slots: [5], grabbed: 5 }, 5)).toBeNull()
    expect(moveForDrop({ slots: [1, 2, 3], grabbed: 2 }, 2)).toBeNull()
  })
  it('still moves when let go on another selected row', () => {
    expect(moveForDrop({ slots: [1, 2, 3], grabbed: 2 }, 3)).toEqual({ sources: [1, 2, 3], target: 3 })
  })
  it('moves nothing without a target or without slots', () => {
    expect(moveForDrop({ slots: [1], grabbed: 1 }, undefined)).toBeNull()
    expect(moveForDrop({ slots: [], grabbed: 1 }, 4)).toBeNull()
  })
})

describe('moveNotice', () => {
  it('names a single move', () => {
    expect(moveNotice(report({ moves: [[3, 10]] }), 'F')).toEqual({ message: 'F003 moved to F010', kind: 'info' })
  })
  it('summarises several moved slots', () => {
    expect(moveNotice(report({ moves: [[3, 10], [4, 11]] }), 'F').message).toBe('2 slots moved to F010-F011')
  })
  it('warns on a swap', () => {
    expect(moveNotice(report({ moves: [[3, 10], [10, 3]], swapped: [3, 10] }), 'F'))
      .toEqual({ message: 'F003 and F010 swapped', kind: 'info' })
  })
  it('warns on a push and gives the pushed range', () => {
    const pushed: [number, number][] = [[10, 11], [11, 12], [12, 13], [13, 14]]
    expect(moveNotice(report({ moves: [[3, 10], ...pushed], pushed }), 'F')).toEqual({
      message: 'F003 moved to F010, 4 slots pushed down (F010-F013 now F011-F014)', kind: 'warning',
    })
  })
  it('keeps the multi-slot form when several dragged slots push others', () => {
    const pushed: [number, number][] = [[10, 12]]
    expect(moveNotice(report({ moves: [[3, 10], [4, 11], ...pushed], pushed }), 'S').message)
      .toBe('2 slots moved to S010-S011, 1 slot pushed down (S010 now S012)')
  })
  it('says so when nothing moves', () => {
    expect(moveNotice(report({}), 'F')).toEqual({ message: 'Nothing to move', kind: 'info' })
  })
})

describe('sortNotice', () => {
  it('counts renumbered slots and names the order', () => {
    expect(sortNotice(report({ moves: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 1]] }), 'File name (A to Z)', 'F'))
      .toEqual({ message: '5 slots renumbered, sorted by file name (A to Z)', kind: 'info' })
  })
  it('says when already in order', () => {
    expect(sortNotice(report({}), 'File name (A to Z)', 'F').message).toBe('Already in that order')
  })
  it('warns and names the push when a selection sort pushes other slots down', () => {
    // F5, F9 and F12 sorted Z to A from F5: F6 and F7 are in the way and go to F8-F9
    const pushed: [number, number][] = [[6, 8], [7, 9]]
    expect(sortNotice(report({ moves: [[12, 5], [9, 6], [5, 7], ...pushed], pushed }), 'File name (Z to A)', 'F')).toEqual({
      message: '5 slots renumbered, sorted by file name (Z to A), 2 slots pushed down (F006-F007 now F008-F009)', kind: 'warning',
    })
  })
  it('counts one renumbered slot in the singular', () => {
    expect(sortNotice(report({ moves: [[2, 1]] }), 'Duration (longest first)', 'S').message).toBe('1 slot renumbered, sorted by duration (longest first)')
  })
})

describe('SORT_ORDERS', () => {
  it('matches the ids the backend parses', () => {
    expect(SORT_ORDERS.map(o => o.id)).toEqual(['name-asc', 'name-desc', 'duration-desc', 'duration-asc', 'folder-name'])
  })
})

describe('continuousRun', () => {
  it('gives the first and last slot of a selection with no gap', () => {
    expect(continuousRun(new Set([3, 4, 5]))).toEqual([3, 5])
    expect(continuousRun(new Set([5, 3, 4]))).toEqual([3, 5])
  })

  it('is null for picks that are not side by side', () => {
    expect(continuousRun(new Set([1, 3]))).toBeNull()
    expect(continuousRun(new Set([1, 2, 4]))).toBeNull()
  })

  it('is null for one slot or none: there is nothing to sort among', () => {
    expect(continuousRun(new Set([7]))).toBeNull()
    expect(continuousRun(new Set())).toBeNull()
  })
})
