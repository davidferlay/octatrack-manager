/** File-explorer style selection for the Tools source panes, plus the
 * destination pairing rules that follow from a multi-item source selection. */

export interface SelectionState {
  /** Selected indices, always ascending. */
  selection: number[];
  /** Item a subsequent shift-click ranges from. Null when nothing is anchored. */
  anchor: number | null;
}

export interface ClickModifiers {
  shift: boolean;
  /** Ctrl on Linux/Windows, Cmd on macOS - both mean "toggle this one". */
  ctrl: boolean;
}

/**
 * Apply a click on item `idx`.
 *
 * - plain click: select only `idx`; clicking the sole selected item clears it
 *   (the pre-existing single-select behaviour of the Tools panes)
 * - shift-click: contiguous range from the anchor to `idx`
 * - ctrl-click: toggle `idx`, keeping the rest
 *
 * `isSelectable` filters items that cannot be picked (an unloaded bank, say);
 * it applies to ranges too, so a shift-click never drags in a dead item.
 */
export function applyItemClick(
  state: SelectionState,
  idx: number,
  mods: ClickModifiers,
  isSelectable: (i: number) => boolean = () => true
): SelectionState {
  if (!isSelectable(idx)) return state;

  if (mods.shift && state.anchor !== null) {
    const lo = Math.min(state.anchor, idx);
    const hi = Math.max(state.anchor, idx);
    const selection: number[] = [];
    for (let i = lo; i <= hi; i++) if (isSelectable(i)) selection.push(i);
    // Anchor stays put so successive shift-clicks re-range from the same origin.
    return { selection, anchor: state.anchor };
  }

  if (mods.ctrl) {
    const selection = state.selection.includes(idx)
      ? state.selection.filter((i) => i !== idx)
      : [...state.selection, idx].sort((a, b) => a - b);
    return { selection, anchor: idx };
  }

  if (state.selection.length === 1 && state.selection[0] === idx) {
    return { selection: [], anchor: null };
  }
  return { selection: [idx], anchor: idx };
}

/**
 * The destination run for a multi-item source selection: `count` consecutive
 * items starting at `start`, slid back so the run always fits inside `max`.
 * Returns [] when the run cannot fit at all.
 */
export function destRangeFrom(start: number, count: number, max: number): number[] {
  if (count <= 0 || count > max) return [];
  const first = Math.max(0, Math.min(start, max - count));
  return Array.from({ length: count }, (_, i) => first + i);
}

export interface CopyPair {
  src: number;
  dst: number;
}

/** Pair each source with the destination at the same position. */
export function pairSourcesWithDests(sources: number[], dests: number[]): CopyPair[] {
  return sources.map((src, i) => ({ src, dst: dests[i] })).filter((p) => p.dst !== undefined);
}

/**
 * Order pairs so no copy overwrites a bank/pattern another pair still has to
 * read. Only matters when source and destination are the same project: copying
 * A->B then B->C would otherwise propagate the new B instead of the original.
 *
 * Greedy: emit any pair whose destination is not a pending source. Both lists
 * arrive ascending, so the mapping is monotone and cannot cycle; if a caller
 * ever passes one that does, the remaining pairs are emitted in order rather
 * than looping forever.
 */
export function orderCopyPairs(pairs: CopyPair[]): CopyPair[] {
  const remaining = [...pairs];
  const ordered: CopyPair[] = [];
  while (remaining.length > 0) {
    const i = remaining.findIndex(
      (p) => !remaining.some((other) => other !== p && other.src === p.dst)
    );
    if (i === -1) {
      // ponytail: unreachable for monotone pairings; drain rather than hang.
      ordered.push(...remaining);
      break;
    }
    ordered.push(remaining.splice(i, 1)[0]);
  }
  return ordered;
}
