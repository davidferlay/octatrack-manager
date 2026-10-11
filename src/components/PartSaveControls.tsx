import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { WriteStatus, writeStatus } from '../types/writeStatus';

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

  return {
    modifiedPartIds, partsSavedState, isCommitting, isReloading,
    commitPart, commitAllParts, reloadPart, markModified, adoptBankState,
  };
}

/** The three buttons, in the device's own order. */
export function PartSaveControls({ state, activePartIndex, partNames, visible }: {
  state: PartCommitState;
  activePartIndex: number;
  partNames: string[];
  /** Hidden rather than unmounted, so the header does not resize on the way in. */
  visible: boolean;
}) {
  const {
    modifiedPartIds, partsSavedState, isCommitting, isReloading,
    commitPart, commitAllParts, reloadPart,
  } = state;
  const busy = isCommitting || isReloading;
  const dirty = modifiedPartIds.has(activePartIndex);
  const name = partNames[activePartIndex] || `Part ${activePartIndex + 1}`;

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
    </div>
  );
}
