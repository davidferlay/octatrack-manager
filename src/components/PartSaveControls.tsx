import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { WriteStatus, writeStatus } from '../types/writeStatus';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { partChanges, actionName, trackRank, type PartCopies, type PartChange } from '../utils/partDiff';
import { ContextMenu, MenuItem } from './ContextMenu';
import { TrackBadge } from './TrackBadge';

/**
 * The device's own Reload / Save / Save All, and the state behind them.
 *
 * Every editor that writes a Part needs these, because the device keeps two copies of
 * each Part: `parts.unsaved`, which is what editing changes, and `parts.saved`, which
 * is what its Reload Part goes back to. Scenes live inside the Part, so the Scenes
 * editor needs exactly the same three buttons as the Parts editor - hence one
 * implementation here rather than one per panel.
 *
 * - Reload puts the saved copy back, discarding the edits. It needs a saved copy to
 *   exist, which is why a never-saved Part cannot be reloaded.
 * - Save copies the edited Part over the saved one.
 * - Save All does that for every Part holding edits.
 * - See diffs lists what differs between the two copies of a Part, which is exactly
 *   what its Save and Reload overwrite. A Part tab's right-click menu offers all three.
 */

/** Bank state the device keeps: which Parts hold edits, and which have a saved copy. */
export interface PartCommitState {
  modifiedPartIds: Set<number>;
  partsSavedState: number[];
  isCommitting: boolean;
  isReloading: boolean;
  commitPart: (partIndex: number) => Promise<void>;
  commitAllParts: () => Promise<void>;
  reloadPart: (partIndex: number) => Promise<void>;
  /** Called after an edit, so the buttons light up without re-reading the bank. */
  markModified: (partIndex: number) => void;
  /** Seeds the state from what the bank file already says, on load. */
  adoptBankState: (editedBitmask: number, savedState: number[]) => void;
  /** Writes the edits the editor still holds back, so the files are what is on screen. */
  flushEdits: () => Promise<void>;
  /** Both copies of a Part, as they are on disk. */
  readCopies: (partIndex: number) => Promise<PartCopies>;
  /** The Part whose diffs are open, if any. */
  diffsFor: number | null;
  showDiffs: (partIndex: number) => void;
  hideDiffs: () => void;
  /** The Part tab right-clicked, and where. */
  tabMenu: { partIndex: number; x: number; y: number } | null;
  openTabMenu: (e: ReactMouseEvent, partIndex: number) => void;
  closeTabMenu: () => void;
  /** The field or scene value right-clicked (Edit mode), as its value key, and where. */
  fieldMenu: { partIndex: number; path: string; x: number; y: number } | null;
  openFieldMenu: (e: ReactMouseEvent, partIndex: number) => void;
  closeFieldMenu: () => void;
  /**
   * The values locked in each of the bank's four Parts, as JSON pointers. A locked
   * value survives Reload: see the lock rules in the Part locks module.
   */
  locks: string[][];
  /** Reads the locks again after a write, but only when the bank holds one. */
  refreshLocks: () => void;
  /** Adds and removes locks in one Undo entry, and adopts what the backend now holds. */
  lockValues: (partIndex: number, add: string[], remove: string[]) => Promise<void>;
  /** Puts the saved value back for each path; the Part stays marked as edited. */
  revertValues: (partIndex: number, paths: string[], label: string) => Promise<void>;
  /** What Reload does to this Part, for its button and menu item. */
  reloadTitle: (partIndex: number) => string;
}

const NO_LOCKS: string[][] = [[], [], [], []];

export function usePartCommits<T>({
  projectPath, bankId, partNames, onWriteStatusChange, onReloaded, onError, reloadKey, flush,
}: {
  projectPath: string;
  bankId: string;
  partNames: string[];
  onWriteStatusChange?: (status: WriteStatus) => void;
  /** What the reloaded Part should replace. The shapes differ per editor. */
  onReloaded?: (partIndex: number, part: T) => void;
  onError?: (message: string) => void;
  /** Changes when an Undo or Redo rewrote the files, so the locks are read again. */
  reloadKey?: number;
  /**
   * Writes the edits the editor is still holding back behind its save delay, and
   * resolves once they are in the file. Every action here runs on the file, so one
   * that landed after it would overwrite the action: a Revert undone by the write
   * queued before it, a Reload followed by the old values coming back.
   */
  flush?: () => Promise<void>;
}): PartCommitState {
  // Through a ref, so the callbacks below do not change with the editor's own
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const flushEdits = useCallback(() => flushRef.current?.() ?? Promise.resolve(), []);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [modifiedPartIds, setModifiedPartIds] = useState<Set<number>>(new Set());
  const [partsSavedState, setPartsSavedState] = useState<number[]>([0, 0, 0, 0]);

  const [locks, setLocks] = useState<string[][]>(NO_LOCKS);
  // Read through a ref so refreshLocks stays stable: the editors call it from timers
  // and promise callbacks that must not be rebuilt every time a lock changes
  const locksRef = useRef<string[][]>(NO_LOCKS);
  const adoptLocks = useCallback((next: unknown) => {
    // Anything but four lists is not a locks answer, and would break every reader
    const lists = Array.isArray(next) && next.length === 4 && next.every(Array.isArray)
      ? (next as string[][]) : NO_LOCKS;
    locksRef.current = lists;
    setLocks(lists);
  }, []);
  // Replies are only adopted while they still belong to the bank on screen: a reply
  // for bank A landing after a switch to bank B must not show A's locks in B. The
  // counter also makes the latest read win when two overlap.
  const bankKey = `${projectPath}\0${bankId}`;
  const bankKeyRef = useRef(bankKey);
  bankKeyRef.current = bankKey;
  const readSeq = useRef(0);
  const readLocks = useCallback(async () => {
    const key = bankKey;
    const seq = ++readSeq.current;
    try {
      const next = await invoke<string[][]>('read_part_locks', { path: projectPath, bankId });
      if (key === bankKeyRef.current && seq === readSeq.current) adoptLocks(next);
    } catch (err) {
      console.error('Reading the part locks failed:', err);
    }
  }, [bankKey, projectPath, bankId, adoptLocks]);
  const refreshLocks = useCallback(() => {
    if (locksRef.current.some(l => l.length > 0)) void readLocks();
  }, [readLocks]);
  // On mount, on bank change, and after an Undo/Redo rewrote the files
  useEffect(() => {
    // Nothing of the previous bank's locks may be shown while this one is read
    readSeq.current++;
    adoptLocks(NO_LOCKS);
    void readLocks();
  }, [readLocks, reloadKey, adoptLocks]);

  const named = useCallback(
    (index: number) => partNames[index] || `Part ${index + 1}`,
    [partNames],
  );

  const adoptBankState = useCallback((editedBitmask: number, savedState: number[]) => {
    const edited = new Set<number>();
    for (let i = 0; i < 4; i++) {
      if ((editedBitmask & (1 << i)) !== 0) edited.add(i);
    }
    setModifiedPartIds(edited);
    setPartsSavedState(savedState);
  }, []);

  const markModified = useCallback((partIndex: number) => {
    setModifiedPartIds(prev => (prev.has(partIndex) ? prev : new Set(prev).add(partIndex)));
  }, []);

  /** The three share everything but their call and their wording. */
  const run = useCallback(async (
    busy: (on: boolean) => void,
    verb: string,
    done: string,
    action: () => Promise<void>,
  ) => {
    try {
      busy(true);
      onWriteStatusChange?.(writeStatus.writing(verb));
      await action();
      onWriteStatusChange?.(writeStatus.success(done));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);
    } catch (err) {
      console.error(`${verb} failed:`, err);
      onError?.(`${verb} failed: ${err}`);
      onWriteStatusChange?.(writeStatus.error(`${verb} failed`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    } finally {
      busy(false);
    }
  }, [onWriteStatusChange, onError]);

  const forget = (partIndex: number) => setModifiedPartIds(prev => {
    const next = new Set(prev);
    next.delete(partIndex);
    return next;
  });

  const commitPart = useCallback(async (partIndex: number) => {
    const name = named(partIndex);
    await run(setIsCommitting, `Saving part ${name}...`, `Part ${name} saved`, async () => {
      await flushEdits();
      await invoke('commit_part', { path: projectPath, bankId, partId: partIndex });
      forget(partIndex);
      // The Part now has a saved copy, so Reload becomes possible for it
      setPartsSavedState(prev => prev.map((v, i) => (i === partIndex ? 1 : v)));
      refreshLocks();
    });
  }, [projectPath, bankId, named, run, refreshLocks, flushEdits]);

  const commitAllParts = useCallback(async () => {
    if (modifiedPartIds.size === 0) return;
    await run(setIsCommitting, 'Saving all parts...', 'All parts saved', async () => {
      await flushEdits();
      await invoke('commit_all_parts', { path: projectPath, bankId });
      setModifiedPartIds(new Set());
      setPartsSavedState([1, 1, 1, 1]);
      refreshLocks();
    });
  }, [projectPath, bankId, modifiedPartIds.size, run, refreshLocks, flushEdits]);

  const reloadPart = useCallback(async (partIndex: number) => {
    const name = named(partIndex);
    await run(setIsReloading, `Reloading part ${name}...`, `Part ${name} reloaded`, async () => {
      await flushEdits();
      const part = await invoke<T>('reload_part', {
        path: projectPath, bankId, partId: partIndex,
      });
      onReloaded?.(partIndex, part);
      // Locked values were put back over the saved Part, so it still differs from
      // its saved copy and stays edited
      if (locksRef.current[partIndex]?.length > 0) markModified(partIndex);
      else forget(partIndex);
      refreshLocks();
    });
  }, [projectPath, bankId, named, run, onReloaded, markModified, refreshLocks, flushEdits]);

  // Pins and unpins the values Part reload leaves alone. Silent, outside `run`, and not
  // an Undo step: it marks values rather than writing the Part, so neither the header's
  // write buttons nor its status should react to it
  const lockValues = useCallback(async (
    partIndex: number, add: string[], remove: string[],
  ) => {
    try {
      await flushEdits();
      const key = bankKey;
      const next = await invoke<string[][]>('set_part_locks', {
        path: projectPath, bankId, partId: partIndex, add, remove,
      });
      if (key === bankKeyRef.current) {
        // Newer than any read still in flight
        readSeq.current++;
        adoptLocks(next);
      }
    } catch (err) {
      console.error('Pinning failed:', err);
      onError?.(`Pinning failed: ${err}`);
    }
  }, [bankKey, projectPath, bankId, adoptLocks, flushEdits, onError]);

  const revertValues = useCallback(async (
    partIndex: number, paths: string[], label: string,
  ) => {
    await run(setIsCommitting, `${label}...`, label, async () => {
      await flushEdits();
      const part = await invoke<T>('revert_part_values', {
        path: projectPath, bankId, partId: partIndex, paths, label,
      });
      onReloaded?.(partIndex, part);
      // The backend sets the edited bit; mirror it. Not refreshLocks: a revert can
      // prune a lock (R2), so the bank is read whether or not it held one before.
      markModified(partIndex);
      await readLocks();
    });
  }, [projectPath, bankId, run, onReloaded, markModified, readLocks, flushEdits]);

  const reloadTitle = useCallback((partIndex: number) => {
    const n = locks[partIndex]?.length ?? 0;
    if (n > 0) {
      return `Reload puts the Saved values back, except ${n} pinned ${n === 1 ? 'value' : 'values'}`;
    }
    if (partsSavedState[partIndex] !== 1) return 'No saved state yet: Save part first!';
    return modifiedPartIds.has(partIndex)
      ? `Reload part ${named(partIndex)} from saved state`
      : 'No changes to reload';
  }, [locks, partsSavedState, modifiedPartIds, named]);

  const readCopies = useCallback(
    (partIndex: number) => invoke<PartCopies>('read_part_copies', {
      path: projectPath, bankId, partId: partIndex,
    }),
    [projectPath, bankId],
  );

  // Shared here rather than kept by the buttons, so a Part tab's menu can open them too
  const [diffsFor, setDiffsFor] = useState<number | null>(null);
  const hideDiffs = useCallback(() => setDiffsFor(null), []);
  const [tabMenu, setTabMenu] = useState<PartCommitState['tabMenu']>(null);
  const openTabMenu = useCallback((e: ReactMouseEvent, partIndex: number) => {
    e.preventDefault();
    setTabMenu({ partIndex, x: e.clientX, y: e.clientY });
  }, []);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  const [fieldMenu, setFieldMenu] = useState<PartCommitState['fieldMenu']>(null);
  const openFieldMenu = useCallback((e: ReactMouseEvent, partIndex: number) => {
    const path = (e.target as Element).closest('[data-lock-path]')?.getAttribute('data-lock-path');
    // Anywhere else in the panel keeps the browser's own menu
    if (!path) return;
    e.preventDefault();
    setFieldMenu({ partIndex, path, x: e.clientX, y: e.clientY });
  }, []);
  const closeFieldMenu = useCallback(() => setFieldMenu(null), []);

  return {
    modifiedPartIds, partsSavedState, isCommitting, isReloading,
    commitPart, commitAllParts, reloadPart, markModified, adoptBankState, readCopies, flushEdits,
    diffsFor, showDiffs: setDiffsFor, hideDiffs, tabMenu, openTabMenu, closeTabMenu,
    fieldMenu, openFieldMenu, closeFieldMenu,
    locks, refreshLocks, lockValues, revertValues, reloadTitle,
  };
}

/** The device's three buttons in its own order, then See diffs. */
export function PartSaveControls({ state, activePartIndex, partNames, visible }: {
  state: PartCommitState;
  activePartIndex: number;
  partNames: string[];
  /** Hidden rather than unmounted, so the header does not resize on the way in. */
  visible: boolean;
}) {
  const {
    modifiedPartIds, partsSavedState, isCommitting, isReloading,
    commitPart, commitAllParts, reloadPart, diffsFor, showDiffs, hideDiffs, tabMenu,
  } = state;
  const busy = isCommitting || isReloading;
  const dirty = modifiedPartIds.has(activePartIndex);
  const name = partNames[activePartIndex] || `Part ${activePartIndex + 1}`;

  // D opens and closes the diffs of the Part on screen, in Edit mode
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'd' && e.key !== 'D') || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      // ponytail: with All Banks on screen every bank's controls listen and none can
      // claim the key, so it waits for a single bank. Route it through the selected
      // bank if All Banks needs it.
      if (document.querySelectorAll('.parts-edit-controls.visible').length !== 1) return;
      if (diffsFor !== null) {
        e.preventDefault();
        hideDiffs();
        return;
      }
      // Another window is open, and the key is not for the page behind it
      if (document.querySelector('.modal-overlay') || !dirty) return;
      e.preventDefault();
      showDiffs(activePartIndex);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, diffsFor, dirty, activePartIndex, showDiffs, hideDiffs]);

  return (
    <div className={`parts-edit-controls ${visible ? 'visible' : 'hidden'}`}>
      <button
        className="cancel-button"
        onClick={() => reloadPart(activePartIndex)}
        disabled={busy || !dirty || partsSavedState[activePartIndex] !== 1}
        title={state.reloadTitle(activePartIndex)}
      >
        Reload
      </button>
      <button
        className="save-button"
        onClick={() => commitPart(activePartIndex)}
        disabled={busy || !dirty}
        title={dirty ? `Save part ${name}` : 'No changes to save'}
      >
        Save
      </button>
      <button
        className="save-button"
        onClick={commitAllParts}
        disabled={busy || modifiedPartIds.size === 0}
        title={
          modifiedPartIds.size > 0
            ? `Save all ${modifiedPartIds.size} modified parts`
            : 'No changes to save'
        }
      >
        Save All
      </button>
      <button
        className="cancel-button parts-diffs-button"
        aria-label="See diffs"
        onClick={() => showDiffs(activePartIndex)}
        disabled={!dirty}
        title={dirty
          ? `See diffs (D): what part ${name} holds against its saved copy, which Save and Reload overwrite`
          : 'No diff to display'}
      >
        <i className="fas fa-not-equal" />
      </button>
      {diffsFor !== null && <PartDiffsModal state={state} partIndex={diffsFor} partNames={partNames} />}
      {tabMenu && <PartTabMenu state={state} />}
      {state.fieldMenu && <FieldMenu state={state} />}
    </div>
  );
}

/** Right-click on a Part tab: the same three actions, for that Part. */
function PartTabMenu({ state }: { state: PartCommitState }) {
  const { tabMenu, modifiedPartIds, partsSavedState, isCommitting, isReloading, closeTabMenu } = state;
  if (!tabMenu) return null;

  const index = tabMenu.partIndex;
  const busy = isCommitting || isReloading;
  const dirty = modifiedPartIds.has(index);

  return (
    <ContextMenu x={tabMenu.x} y={tabMenu.y} onClose={closeTabMenu}>
      <MenuItem label="Reload" icon="fa-rotate-left" enabled={!busy && dirty && partsSavedState[index] === 1}
        title={state.locks[index]?.length > 0 ? state.reloadTitle(index) : undefined}
        onSelect={() => state.reloadPart(index)} />
      <MenuItem label="Save" icon="fa-floppy-disk" enabled={!busy && dirty}
        onSelect={() => state.commitPart(index)} />
      <div className="context-menu-separator" />
      <MenuItem label="See diffs" icon="fa-not-equal" enabled={dirty}
        onSelect={() => state.showDiffs(index)} />
    </ContextMenu>
  );
}

/**
 * Whether a row's value is pinned, so Part reload leaves it alone. A row of a group
 * answers for the whole group: a member whose own value is not held still has its group
 * pinned, and offers Unpin.
 */
const isHeld = (r: PartChange, held: string[]) =>
  r.paths.some(p => held.includes(p)) || r.lock.some(p => held.includes(p));

/** Unpin takes out whichever of the row's values are pinned, however they were. */
const unlockPathsOf = (r: PartChange, held: string[]) =>
  [...new Set([...r.revert, ...r.lock, ...r.paths])].filter(p => held.includes(p));

/**
 * Right-click on a field or scene value: reload its saved value, or pin it so Part
 * reload leaves it alone. Acts on the row of the diffs window that holds the value, so a changed
 * machine or effect type is reset or locked as the group it is.
 */
export function FieldMenu({ state }: { state: PartCommitState }) {
  const { fieldMenu, closeFieldMenu, readCopies, flushEdits, locks, isCommitting, isReloading } = state;
  const [copies, setCopies] = useState<PartCopies>();
  const partIndex = fieldMenu?.partIndex;
  useEffect(() => {
    if (partIndex === undefined) return;
    let live = true;
    setCopies(undefined);
    // An edit made a moment ago is still waiting out the editor's save delay
    flushEdits().then(() => readCopies(partIndex)).then(
      c => { if (live) setCopies(c); },
      err => { console.error('Reading the part copies failed:', err); if (live) closeFieldMenu(); },
    );
    return () => { live = false; };
  }, [partIndex, fieldMenu?.path, readCopies, flushEdits, closeFieldMenu]);
  // Opened once both copies are in, as the diffs window is
  if (!fieldMenu || !copies) return null;

  const busy = isCommitting || isReloading;
  const rows = copies.saved ? partChanges(copies.saved, copies.edited) : [];
  const row = rows.find(r => r.paths.includes(fieldMenu.path));
  const held = locks[fieldMenu.partIndex] ?? [];
  const none = copies.saved ? 'Matches the saved copy' : 'No saved copy yet';
  const action = row ? actionName(row) : '';
  const head = row?.group ? rows.find(r => r.group?.head && r.group.name === row.group?.name && r.track === row.track) : row;
  const locked = !!row && isHeld(row, held);

  return (
    <ContextMenu x={fieldMenu.x} y={fieldMenu.y} onClose={closeFieldMenu}>
      <MenuItem
        icon="fa-rotate-left"
        label={row && head
          ? (row.group ? `Reload saved ${head.page} (${head.saved})` : `Reload saved value (${row.saved})`)
          : 'Reload saved value'}
        enabled={!busy && !!row && !locked}
        title={locked ? 'Pinned: unpin it to reload the saved value' : row ? undefined : none}
        onSelect={() => row && state.revertValues(fieldMenu.partIndex, row.revert, `Reload saved ${action}`)}
      />
      {locked && row ? (
        <MenuItem icon="fa-thumbtack-slash" label="Unpin value - include in Part reload" enabled={!busy}
          onSelect={() => state.lockValues(fieldMenu.partIndex, [], unlockPathsOf(row, held))} />
      ) : (
        <MenuItem icon="fa-thumbtack" label="Pin value - exclude from Part reload" enabled={!busy && !!row && row.lock.length > 0}
          title={row ? undefined : none}
          onSelect={() => row && state.lockValues(fieldMenu.partIndex, row.lock, [])} />
      )}
    </ContextMenu>
  );
}

/**
 * Each value that differs between one Part's saved and edited copies, which is what
 * its Save and Reload overwrite.
 */
function PartDiffsModal({ state, partIndex, partNames }: {
  state: PartCommitState;
  partIndex: number;
  partNames: string[];
}) {
  const { partsSavedState, isCommitting, isReloading, readCopies, flushEdits, hideDiffs } = state;
  useEscapeClose(hideDiffs);
  useBodyScrollLock();
  const busy = isCommitting || isReloading;
  const name = partNames[partIndex] || `Part ${partIndex + 1}`;
  const [read, setRead] = useState<PartCopies | string>();
  // Every row listed since the window opened. A row put back as saved stays, both sides
  // reading the saved value, so the list does not shift under the pointer: it goes when
  // the window closes.
  const [seen, setSeen] = useState<Map<string, PartChange>>(new Map());
  // Bumped after every row action, so both copies are read again and the rows follow
  const [refresh, setRefresh] = useState(0);
  // From the start of an action until the re-read lands: the rows on screen are stale
  // in between, so acting on them would send the old reload and pin lists
  const [refreshing, setRefreshing] = useState(false);
  const held = state.locks[partIndex] ?? [];
  const frozen = busy || refreshing;

  // Reads the files, so what the editors still hold back behind their save delay is
  // written first
  useEffect(() => {
    let live = true;
    flushEdits().then(() => readCopies(partIndex)).then(
      copies => {
        if (!live) return;
        setRead(copies);
        setSeen(prev => {
          const next = new Map(prev);
          for (const r of liveRows(copies)) next.set(rowKey(r), r);
          return next;
        });
        setRefreshing(false);
      },
      err => { if (live) { setRead(String(err)); setRefreshing(false); } },
    );
    return () => { live = false; };
  }, [partIndex, readCopies, flushEdits, refresh]);

  const live = new Map((read && typeof read !== 'string' ? liveRows(read) : []).map(r => [rowKey(r), r]));
  // Stable, so each track keeps the order its rows were first listed in
  const rows: Shown[] = [...seen.entries()]
    .map(([key, r]) => live.get(key) ?? { ...r, current: r.saved, settled: true })
    .sort((x, y) => trackRank(x.track) - trackRank(y.track));

  const act = async (run: () => Promise<void>) => {
    setRefreshing(true);
    try {
      await run();
    } finally {
      setRefresh(n => n + 1);
    }
  };

  const body = () => {
    if (read === undefined) return null;
    if (typeof read === 'string') return <p className="part-changes-note">Could not read the Part: {read}</p>;
    if (!read.saved) {
      return <p className="part-changes-note">No saved copy yet: Save makes the Part as it is now the one Reload goes back to.</p>;
    }
    if (rows.length === 0) {
      return read.identical
        ? <p className="part-changes-note">Nothing differs from the saved copy: the edits were turned back by hand.</p>
        : <p className="part-changes-note">The two copies differ only in data not shown by the editor.</p>;
    }
    return (
      <table className="samples-table part-changes-table">
        <thead>
          <tr>
            <th>Track</th><th>Page</th><th>Param</th>
            <th className="part-changes-saved">Saved</th>
            <th className="part-changes-current">Current</th>
            <th className="part-changes-actions" aria-label="Actions">
              {/* Above the pins it clears */}
              {held.length > 0 && (
                <button
                  className="part-changes-action part-changes-unpin-all"
                  aria-label={`Unpin all values of ${name}`}
                  title="Unpin all: Part reload puts every saved value back"
                  disabled={frozen}
                  onClick={() => act(() => state.lockValues(partIndex, [], held))}
                >
                  <i className="fas fa-xmark" aria-hidden="true" />
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // The rows come a track at a time, so each track is named once, in one cell
            // spanning all of its rows
            const first = i === 0 || rows[i - 1].track !== r.track;
            let span = 1;
            while (first && rows[i + span]?.track === r.track) span++;
            const pinned = !r.settled && isHeld(r, held);
            const action = actionName(r);
            const acts = !r.settled && (!r.group || r.group.head);
            const cls = [
              first && i > 0 ? 'part-changes-group' : '',
              r.group ? (r.group.head ? 'part-changes-head' : 'part-changes-member') : '',
              r.settled ? 'part-changes-settled' : '',
            ].filter(Boolean).join(' ') || undefined;
            return (
            <tr key={rowKey(r)} className={cls}>
              {first && (
                <td rowSpan={span} className="part-changes-track">
                  {r.track && <TrackBadge trackId={trackIdOf(r.track)} />}
                </td>
              )}
              <td>{r.page}</td>
              <td title={r.help}>{r.param}</td>
              <td className="part-changes-saved">{r.saved}</td>
              <td className="part-changes-current">{r.current}</td>
              <td className="part-changes-actions">
                {acts && (
                  <>
                    <button
                      className="part-changes-action"
                      aria-label={`Reload saved ${action}`}
                      title={pinned ? 'Pinned: unpin it to reload the saved value' : 'Reload the saved value'}
                      disabled={frozen || pinned}
                      onClick={() => act(() => state.revertValues(partIndex, r.revert, `Reload saved ${action}`))}
                    >
                      <i className="fas fa-rotate-left" aria-hidden="true" />
                    </button>
                    <button
                      className={`part-changes-action${pinned ? ' pinned' : ''}`}
                      aria-pressed={pinned}
                      aria-label={pinned ? `Unpin ${action}` : `Pin ${action}`}
                      title={pinned
                        ? 'Pinned, excluded from Part reload: click to include it again'
                        : 'Pin value - exclude from Part reload'}
                      disabled={frozen || (!pinned && r.lock.length === 0)}
                      onClick={() => act(() => (pinned
                        ? state.lockValues(partIndex, [], unlockPathsOf(r, held))
                        : state.lockValues(partIndex, r.lock, [])))}
                    >
                      <i className="fas fa-thumbtack" aria-hidden="true" />
                    </button>
                  </>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  // Opened once both copies are in, at its full size, rather than as a placeholder
  // that jumps when the list arrives - the read takes a few milliseconds
  if (read === undefined) return null;

  // Portalled: the controls slide in with a transform, which would otherwise pin a
  // fixed overlay to them instead of to the window
  return createPortal(
    <div className="modal-overlay" onClick={hideDiffs}>
      <div
        className="modal-content part-changes-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edited params against saved"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Edited params against saved</h3>
          <h4 className="part-changes-heading">
            Part {partIndex + 1}: {name}
            {live.size > 0 && (
              <span className="part-changes-count"> - {live.size} {live.size === 1 ? 'diff' : 'diffs'}</span>
            )}
          </h4>
        </div>
        <div className="modal-body">
          {body()}
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button
              className="modal-button"
              aria-label={`Reload ${name}`}
              title={held.length > 0 ? state.reloadTitle(partIndex) : 'Reload puts the Saved values back'}
              disabled={busy || partsSavedState[partIndex] !== 1}
              onClick={async () => {
                // With pins, Reload leaves those values as they are: the window stays and
                // reads again, so what was put back shows as settled and the pins remain
                if (held.length > 0) {
                  await act(() => state.reloadPart(partIndex));
                } else {
                  await state.reloadPart(partIndex);
                  hideDiffs();
                }
              }}
            >
              Reload
            </button>
            <button
              className="modal-button"
              aria-label={`Save ${name}`}
              title="Save makes the Current values the saved ones"
              disabled={busy}
              onClick={async () => { await state.commitPart(partIndex); hideDiffs(); }}
            >
              Save
            </button>
            <button className="modal-button" onClick={hideDiffs}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A row of the diffs window, or one it keeps listing after it was put back as saved. */
type Shown = PartChange & { settled?: boolean };

/** What differs between the two copies, or nothing when there is no saved copy. */
const liveRows = (copies: PartCopies): PartChange[] =>
  (copies.saved && !copies.identical ? partChanges(copies.saved, copies.edited) : []);

/** A row's values name it: no two rows show the same ones. */
const rowKey = (r: PartChange) => r.paths.join(' ');

/** T1-T8 are the audio tracks 0-7, M1-M8 the MIDI tracks 8-15, as TrackBadge counts them. */
function trackIdOf(track: string): number {
  return (track[0] === 'M' ? 8 : 0) + Number(track.slice(1)) - 1;
}
