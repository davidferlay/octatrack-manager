import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { WriteStatus, writeStatus } from '../types/writeStatus';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { partChanges, type PartCopies } from '../utils/partDiff';
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
}

export function usePartCommits<T>({
  projectPath, bankId, partNames, onWriteStatusChange, onReloaded, onError,
}: {
  projectPath: string;
  bankId: string;
  partNames: string[];
  onWriteStatusChange?: (status: WriteStatus) => void;
  /** What the reloaded Part should replace. The shapes differ per editor. */
  onReloaded?: (partIndex: number, part: T) => void;
  onError?: (message: string) => void;
}): PartCommitState {
  const [isCommitting, setIsCommitting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [modifiedPartIds, setModifiedPartIds] = useState<Set<number>>(new Set());
  const [partsSavedState, setPartsSavedState] = useState<number[]>([0, 0, 0, 0]);

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
      await invoke('commit_part', { path: projectPath, bankId, partId: partIndex });
      forget(partIndex);
      // The Part now has a saved copy, so Reload becomes possible for it
      setPartsSavedState(prev => prev.map((v, i) => (i === partIndex ? 1 : v)));
    });
  }, [projectPath, bankId, named, run]);

  const commitAllParts = useCallback(async () => {
    if (modifiedPartIds.size === 0) return;
    await run(setIsCommitting, 'Saving all parts...', 'All parts saved', async () => {
      await invoke('commit_all_parts', { path: projectPath, bankId });
      setModifiedPartIds(new Set());
      setPartsSavedState([1, 1, 1, 1]);
    });
  }, [projectPath, bankId, modifiedPartIds.size, run]);

  const reloadPart = useCallback(async (partIndex: number) => {
    const name = named(partIndex);
    await run(setIsReloading, `Reloading part ${name}...`, `Part ${name} reloaded`, async () => {
      const part = await invoke<T>('reload_part', {
        path: projectPath, bankId, partId: partIndex,
      });
      onReloaded?.(partIndex, part);
      forget(partIndex);
    });
  }, [projectPath, bankId, named, run, onReloaded]);

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

  return {
    modifiedPartIds, partsSavedState, isCommitting, isReloading,
    commitPart, commitAllParts, reloadPart, markModified, adoptBankState, readCopies,
    diffsFor, showDiffs: setDiffsFor, hideDiffs, tabMenu, openTabMenu, closeTabMenu,
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
        title={
          partsSavedState[activePartIndex] !== 1
            ? 'No saved state yet: Save part first!'
            : dirty
              ? `Reload part ${name} from saved state`
              : 'No changes to reload'
        }
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
    </div>
  );
}

/** Right-click on a Part tab: the same three actions, for that Part. */
function PartTabMenu({ state }: { state: PartCommitState }) {
  const { tabMenu, modifiedPartIds, partsSavedState, isCommitting, isReloading, closeTabMenu } = state;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeTabMenu();
    };
    // Escape is handled here rather than through useEscapeClose, which stands aside
    // while any context menu is open - this one included - and would let the key
    // through to the project page, whose Escape leaves the project. Taken in the
    // capture phase and stopped, so nothing further down sees it.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeTabMenu();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [closeTabMenu]);
  if (!tabMenu) return null;

  const index = tabMenu.partIndex;
  const busy = isCommitting || isReloading;
  const dirty = modifiedPartIds.has(index);
  const item = (label: string, icon: string, enabled: boolean, act: () => void) => (
    <button
      role="menuitem"
      className="context-menu-item"
      disabled={!enabled}
      onClick={() => { closeTabMenu(); act(); }}
    >
      <i className={`fas ${icon}`} /> {label}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="context-menu"
      style={{ position: 'fixed', left: tabMenu.x, top: tabMenu.y }}
    >
      {item('Reload', 'fa-rotate-left', !busy && dirty && partsSavedState[index] === 1,
        () => state.reloadPart(index))}
      {item('Save', 'fa-floppy-disk', !busy && dirty, () => state.commitPart(index))}
      <div className="context-menu-separator" />
      {item('See diffs', 'fa-not-equal', dirty, () => state.showDiffs(index))}
    </div>,
    document.body,
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
  const { partsSavedState, isCommitting, isReloading, readCopies, hideDiffs } = state;
  useEscapeClose(hideDiffs);
  useBodyScrollLock();
  const busy = isCommitting || isReloading;
  const name = partNames[partIndex] || `Part ${partIndex + 1}`;
  const [read, setRead] = useState<PartCopies | string>();

  // ponytail: reads the files, so an edit still inside the editors' 500 ms save
  // debounce is missed - Save has the same window. Flush pending saves first if it bites.
  useEffect(() => {
    let live = true;
    readCopies(partIndex).then(
      copies => live && setRead(copies),
      err => live && setRead(String(err)),
    );
    return () => { live = false; };
  }, [partIndex, readCopies]);

  const rows = read && typeof read !== 'string' && read.saved && !read.identical
    ? partChanges(read.saved, read.edited)
    : null;

  const body = () => {
    if (read === undefined) return null;
    if (typeof read === 'string') return <p className="part-changes-note">Could not read the Part: {read}</p>;
    if (!read.saved) {
      return <p className="part-changes-note">No saved copy yet: Save makes the Part as it is now the one Reload goes back to.</p>;
    }
    if (read.identical) {
      return <p className="part-changes-note">Nothing differs from the saved copy: the edits were turned back by hand.</p>;
    }
    if (!rows || rows.length === 0) {
      return <p className="part-changes-note">The two copies differ only in data not shown by the editor.</p>;
    }
    return (
      <table className="samples-table part-changes-table">
        <thead>
          <tr>
            <th>Track</th><th>Page</th><th>Param</th>
            <th className="part-changes-saved">Saved</th>
            <th className="part-changes-current">Current</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // The rows come a track at a time, so each track is named once, in one cell
            // spanning all of its rows
            const first = i === 0 || rows[i - 1].track !== r.track;
            let span = 1;
            while (first && rows[i + span]?.track === r.track) span++;
            return (
            <tr key={i} className={first && i > 0 ? 'part-changes-group' : undefined}>
              {first && (
                <td rowSpan={span} className="part-changes-track">
                  {r.track && <TrackBadge trackId={trackIdOf(r.track)} />}
                </td>
              )}
              <td>{r.page}</td>
              <td title={r.help}>{r.param}</td>
              <td className="part-changes-saved">{r.saved}</td>
              <td className="part-changes-current">{r.current}</td>
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
            {rows && rows.length > 0 && (
              <span className="part-changes-count"> - {rows.length} {rows.length === 1 ? 'diff' : 'diffs'}</span>
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
              title="Reload puts the Saved values back"
              disabled={busy || partsSavedState[partIndex] !== 1}
              onClick={async () => { await state.reloadPart(partIndex); hideDiffs(); }}
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

/** T1-T8 are the audio tracks 0-7, M1-M8 the MIDI tracks 8-15, as TrackBadge counts them. */
function trackIdOf(track: string): number {
  return (track[0] === 'M' ? 8 : 0) + Number(track.slice(1)) - 1;
}
