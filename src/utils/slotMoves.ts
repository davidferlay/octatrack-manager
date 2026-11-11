// Helpers for reorganising sample slots: when dragging is allowed, what a drag carries,
// and the notices shown after the backend reports what moved.

/** What the backend returns for a move or a sort (slot numbers are 1-based). */
export interface SlotMoveReport {
  moves: [number, number][]
  swapped: [number, number] | null
  pushed: [number, number][]
  files_written: string[]
}

type Prefix = 'F' | 'S'

/** Sort orders the backend parses; ids must match its parser. */
export const SORT_ORDERS: { id: string; label: string; hint: string; tip: string; icon: string }[] = [
  {
    id: 'name-asc', label: 'File name (A to Z)', hint: 'Alphabetical', icon: 'fa-arrow-down-a-z',
    tip: 'By sample file name, A first. Folders and letter case are ignored.',
  },
  {
    id: 'name-desc', label: 'File name (Z to A)', hint: 'Reverse alphabetical', icon: 'fa-arrow-down-z-a',
    tip: 'By sample file name, Z first. Folders and letter case are ignored.',
  },
  {
    id: 'duration-desc', label: 'Duration (longest first)', hint: 'Loops and long takes on top', icon: 'fa-arrow-down-wide-short',
    tip: 'Longest sample first. Files that are missing or cannot be read go last, by name.',
  },
  {
    id: 'duration-asc', label: 'Duration (shortest first)', hint: 'Hits and one-shots on top', icon: 'fa-arrow-down-short-wide',
    tip: 'Shortest sample first. Files that are missing or cannot be read go last, by name.',
  },
  {
    id: 'folder-name', label: 'Folder, then file name', hint: 'Grouped by folder', icon: 'fa-folder-tree',
    tip: 'Samples from the same folder side by side, folders A to Z, then file names A to Z inside each folder.',
  },
]

/**
 * Dragging only makes sense when the visible rows are the slots in their real order:
 * any other sort, search or column filter shows a subset or a reordering, so a drop
 * position would not map to a slot number. Hide empty is deliberately not an input.
 */
export function canDragSlots(view: {
  isEditMode: boolean
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  searchText: string
  filters: string[]
}): boolean {
  return view.isEditMode
    && view.sortColumn === 'slot'
    && view.sortDirection === 'asc'
    && view.searchText === ''
    && view.filters.every(f => f === 'all')
}

/** Dragging a selected row carries the whole selection (in slot order); otherwise just that row. */
export function sourcesForDrag(selected: Set<number>, dragged: number): number[] {
  return selected.has(dragged) ? [...selected].sort((a, b) => a - b) : [dragged]
}

/**
 * First and last slot of a selection of two or more side-by-side slots, else null. Tidy only
 * sorts such a run on its own: it sorts into its own slots, so nothing outside it moves.
 */
export function continuousRun(selected: Set<number>): [number, number] | null {
  if (selected.size < 2) return null
  const lo = Math.min(...selected), hi = Math.max(...selected)
  return hi - lo + 1 === selected.size ? [lo, hi] : null
}

/**
 * The move a slot-row drag asks for, or null for none. Let go on the row it was grabbed by,
 * it asks for nothing whatever it carries: that is a click that drifted past the drag
 * distance, not a request to pack the selection there.
 */
export function moveForDrop(
  drag: { slots: number[]; grabbed: number },
  target: number | null | undefined,
): { sources: number[]; target: number } | null {
  if (target == null || drag.slots.length === 0 || target === drag.grabbed) return null
  return { sources: drag.slots, target }
}

const label = (prefix: Prefix, n: number) => `${prefix}${String(n).padStart(3, '0')}`
const range = (prefix: Prefix, nums: number[]) => {
  const lo = Math.min(...nums), hi = Math.max(...nums)
  return lo === hi ? label(prefix, lo) : `${label(prefix, lo)}-${label(prefix, hi)}`
}
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
// ", 2 slots pushed down (F006-F007 now F008-F009)"
const pushedPart = (pushed: [number, number][], prefix: Prefix) =>
  `, ${plural(pushed.length, 'slot')} pushed down (${range(prefix, pushed.map(([o]) => o))} now ${range(prefix, pushed.map(([, n]) => n))})`

/**
 * Message for a drag-and-drop move; a push is a warning since slots beyond the drop
 * changed too. A swap is not: it is exactly what dropping on a taken slot asks for.
 */
export function moveNotice(report: SlotMoveReport, prefix: Prefix): { message: string; kind: 'info' | 'warning' } {
  if (report.moves.length === 0) return { message: 'Nothing to move', kind: 'info' }
  if (report.swapped) {
    const [a, b] = report.swapped
    return { message: `${label(prefix, a)} and ${label(prefix, b)} swapped`, kind: 'info' }
  }
  const pushedOld = new Set(report.pushed.map(([o]) => o))
  const dragged = report.moves.filter(([o]) => !pushedOld.has(o))
  const message = dragged.length === 1
    ? `${label(prefix, dragged[0][0])} moved to ${label(prefix, dragged[0][1])}`
    : `${dragged.length} slots moved to ${range(prefix, dragged.map(([, n]) => n))}`
  if (report.pushed.length === 0) return { message, kind: 'info' }
  return { message: message + pushedPart(report.pushed, prefix), kind: 'warning' }
}

/**
 * Message for a Tidy; `orderLabel` is the human label from SORT_ORDERS. A selection sort
 * that pushes slots outside the selection down is a warning, as for a move.
 */
export function sortNotice(report: SlotMoveReport, orderLabel: string, prefix: Prefix): { message: string; kind: 'info' | 'warning' } {
  if (report.moves.length === 0) return { message: 'Already in that order', kind: 'info' }
  const message = `${plural(report.moves.length, 'slot')} renumbered, sorted by ${orderLabel[0].toLowerCase()}${orderLabel.slice(1)}`
  if (report.pushed.length === 0) return { message, kind: 'info' }
  return { message: message + pushedPart(report.pushed, prefix), kind: 'warning' }
}
