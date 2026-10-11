import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { WriteStatus, writeStatus } from '../types/writeStatus';

/**
 * Taking back what the app wrote to the project.
 *
 * Every editor writes straight to the card a moment after each change, so there is no
 * dialog to cancel out of. The device's own Reload Part is the only way back and it
 * needs the Part to have been saved there first, which it usually has not.
 *
 * This belongs to the project rather than to any one editor: a Part edit, a scene
 * edit and a sample slot assignment all go on one list, in the order they happened,
 * and the buttons sit in the project header beside the Edit toggle rather than in
 * whichever panel happens to be open.
 */

/** What the backend says the two buttons can do, for this project. */
export interface HistoryState {
  can_undo: boolean;
  can_redo: boolean;
  undo_label: string | null;
  redo_label: string | null;
}

const NOTHING: HistoryState = {
  can_undo: false, can_redo: false, undo_label: null, redo_label: null,
};

export interface WriteHistory {
  state: HistoryState;
  busy: boolean;
  /** Re-reads what the backend has, which the page does after any write. */
  refresh: () => void;
  undo: () => void;
  redo: () => void;
}

export function useWriteHistory({ projectPath, onWriteStatusChange, onRestored }: {
  projectPath: string | null;
  onWriteStatusChange?: (status: WriteStatus) => void;
  /**
   * The files changed underneath the editors and everything has to be read again.
   *
   * Undo rewrites whole files, so there is nothing useful to patch in place: which
   * Parts hold edits, what every scene holds and which samples are assigned can all
   * differ afterwards.
   */
  onRestored?: () => void;
}): WriteHistory {
  const [state, setState] = useState<HistoryState>(NOTHING);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!projectPath) {
      setState(NOTHING);
      return;
    }
    invoke<HistoryState | null>('write_history_state', { path: projectPath })
      // A backend that does not answer is one with nothing to offer, not a crash
      .then(answer => setState(answer ?? NOTHING))
      .catch(() => setState(NOTHING));
  }, [projectPath]);

  // The history belongs to the project, so opening another one starts again
  useEffect(() => { refresh(); }, [refresh]);

  const step = useCallback(async (back: boolean) => {
    if (!projectPath || busy) return;
    const verb = back ? 'Undoing' : 'Redoing';
    try {
      setBusy(true);
      onWriteStatusChange?.(writeStatus.writing(`${verb} the last change...`));
      const what = await invoke<string | null>(
        back ? 'undo_write' : 'redo_write', { path: projectPath },
      );
      if (what === null) {
        onWriteStatusChange?.(writeStatus.idle());
        return;
      }
      onRestored?.();
      onWriteStatusChange?.(writeStatus.success(back ? `Undone: ${what}` : `Redone: ${what}`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);
    } catch (error) {
      console.error(`${verb} failed:`, error);
      onWriteStatusChange?.(writeStatus.error(`${verb} failed`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    } finally {
      setBusy(false);
      refresh();
    }
  }, [projectPath, busy, onWriteStatusChange, onRestored, refresh]);

  const undo = useCallback(() => { void step(true); }, [step]);
  const redo = useCallback(() => { void step(false); }, [step]);

  return { state, busy, refresh, undo, redo };
}

/** The pair of buttons, for the project header beside the Edit toggle. */
export function WriteHistoryControls({ history, visible }: {
  history: WriteHistory;
  /** Only in Edit mode: there is nothing to take back while only reading. */
  visible: boolean;
}) {
  const { state, busy, undo, redo } = history;
  if (!visible) return null;

  return (
    <div className="write-history-controls">
      <button
        className="history-button"
        onClick={undo}
        disabled={busy || !state.can_undo}
        title={state.can_undo
          ? `Undo: ${state.undo_label}`
          : 'Nothing to undo in this project'}
        aria-label="Undo"
      >
        <i className="fas fa-rotate-left" />
      </button>
      <button
        className="history-button"
        onClick={redo}
        disabled={busy || !state.can_redo}
        title={state.can_redo
          ? `Redo: ${state.redo_label}`
          : 'Nothing to redo in this project'}
        aria-label="Redo"
      >
        <i className="fas fa-rotate-right" />
      </button>
    </div>
  );
}
