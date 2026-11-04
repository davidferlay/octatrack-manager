import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  useAudioPreview, isAudioFile, scrubTarget, volumeStep, shouldAutoPreview,
} from '../hooks/useAudioPreview';
import { SamplePlayerBar } from './SamplePlayerBar';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useModalResize } from './FixPoolFilesModal';
import { useSearchShortcut } from '../hooks/useSearchShortcut';
import type { SlotChoice } from './PartsPanel';

interface Props {
  /** "Static" or "Flex" - decides the slot prefix and which pool is listed. */
  pool: 'Static' | 'Flex';
  slots: SlotChoice[];
  /** Currently assigned slot, 0-based as the machine stores it. */
  currentSlotId: number;
  /**
   * Empty the slot the track is on, for when the pool has no free slot to move it to.
   * The track keeps pointing at the slot, which now holds nothing - the state the
   * device itself leaves behind.
   */
  onClearCurrentSlot: () => void;
  /** Absolute project directory, used to resolve a slot's relative path for playback. */
  projectPath: string;
  trackLabel: string;
  partLabel: string;
  onPick: (slotIdZeroBased: number) => void;
  onClose: () => void;
}

/** Slot list row, flattened once so search, keyboard and preview share the same data. */
interface Row {
  slotId: number;      // 1-based, as the device numbers it
  label: string;       // e.g. "F002"
  filename: string;
  path: string | null;
  isAssigned: boolean;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Picks the Sample Slot a track plays in a Part.
 *
 * Deliberately the Sample Slots pages' shape - same slot numbering, same search
 * shortcut, same transport bar and the same player keys - rather than a dropdown:
 * picking a sample you cannot hear is guesswork, and 128 entries in a native select
 * is unusable. Resizable like the Tools modals, since slot lists get long.
 */
export function SlotPickerModal({
  pool, slots, currentSlotId, projectPath, trackLabel, partLabel, onPick, onClearCurrentSlot,
  onClose,
}: Props) {
  const [searchText, setSearchText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sortColumn, setSortColumn] = useState<'slot' | 'sample'>('slot');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [playable, setPlayable] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; row: Row } | null>(null);
  const player = useAudioPreview();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { modalRef, style, handles } = useModalResize();
  useEscapeClose(onClose);
  // The slot list is long; reaching its end must not start scrolling the page behind
  useBodyScrollLock();
  // Ctrl/Cmd+F focuses the search box, Escape clears it - as on the Sample Slots pages
  useSearchShortcut(searchRef, () => setSearchText(''));

  const prefix = pool === 'Static' ? 'S' : 'F';

  const rows = useMemo<Row[]>(() => {
    const loaded = slots
      .filter(s => s.path)
      .map<Row>(s => ({
        slotId: s.slot_id,
        label: `${prefix}${String(s.slot_id).padStart(3, '0')}`,
        filename: basename(s.path as string),
        path: s.path,
        isAssigned: s.slot_id === currentSlotId + 1,
      }));
    // The assigned slot is always offered, even when its sample was cleared - the
    // picker has to be able to show what the track actually points at.
    if (!loaded.some(r => r.isAssigned)) {
      loaded.unshift({
        slotId: currentSlotId + 1,
        label: `${prefix}${String(currentSlotId + 1).padStart(3, '0')}`,
        filename: '(empty)',
        path: null,
        isAssigned: true,
      });
    }
    return loaded;
  }, [slots, prefix, currentSlotId]);

  const visible = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    const matched = needle
      ? rows.filter(r => `${r.label} ${r.filename}`.toLowerCase().includes(needle))
      : rows;
    const key = (r: Row) => (sortColumn === 'slot' ? r.slotId : r.filename.toLowerCase());
    return [...matched].sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [rows, searchText, sortColumn, sortDirection]);

  const sortBy = (column: 'slot' | 'sample') => {
    if (sortColumn === column) setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortColumn(column); setSortDirection('asc'); }
  };
  const sortIndicator = (column: 'slot' | 'sample') =>
    sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

  useEffect(() => {
    if (!rowMenu) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.context-menu')) return;
      setRowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRowMenu(null); };
    document.addEventListener('click', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [rowMenu]);

  /**
   * Lowest-numbered empty slot in this pool, or null when every slot is taken.
   *
   * There is no "no sample" value for a machine's slot byte - the device assigns by
   * picking a slot and pressing YES (manual 11.3), and the byte always names one. So
   * un-assigning means pointing the track at an empty slot, which is exactly where a
   * fresh project leaves every machine.
   */
  const firstEmptySlot = useMemo(() => slots.find(s => !s.path)?.slot_id ?? null, [slots]);

  /**
   * What Un-assign will do, which depends on whether the pool has room.
   *
   * With an empty slot to point at, the track moves there and the pool is untouched.
   * With every slot holding a sample there is nowhere to move to, so the only way to
   * leave the track playing nothing is to empty the slot it is on - which is what the
   * device does, and it costs any other track on that slot its sample too.
   */
  const unassign = firstEmptySlot !== null
    ? {
      title: `Points the track at ${prefix}${String(firstEmptySlot).padStart(3, '0')}, an empty slot`,
      run: () => onPick(firstEmptySlot - 1),
    }
    : {
      title: `Every slot in this pool holds a sample, so this empties ${prefix}`
        + `${String(currentSlotId + 1).padStart(3, '0')} instead. Any other track playing`
        + ' that slot loses its sample too.',
      run: onClearCurrentSlot,
    };

  const resolve = (path: string | null) => {
    if (!path) return null;
    const isAbsolute = path.startsWith('/') || /^[A-Za-z]:/.test(path);
    return isAbsolute ? path : `${projectPath}/${path}`;
  };

  /** Explicit play, as from the context menu: sounds regardless of Auto-preview. */
  const playRow = (row: Row) => {
    const resolved = resolve(row.path);
    if (!resolved || !isAudioFile(resolved)) return;
    setPlayable(true);
    player.play(resolved, row.filename);
  };

  // Moving the selection loads that sample, and plays it when Auto-preview is on -
  // the same behaviour selecting a slot has on the Sample Slots pages.
  useEffect(() => {
    const row = visible[cursor];
    if (!row) { setPlayable(false); player.reset(); return; }
    const resolved = resolve(row.path);
    if (!resolved || !isAudioFile(resolved)) { setPlayable(false); player.reset(); return; }
    setPlayable(true);
    if (shouldAutoPreview(player.autoPreview, 1, true)) player.play(resolved, row.filename);
    else player.load(resolved, row.filename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, visible]);

  // Open on the assigned slot, so the list starts where the track already points.
  // The search box is deliberately not focused: the keys below belong to the list.
  //
  // Found in the displayed order, not in the unsorted one: the two differ whenever the
  // assigned slot holds nothing, because that row is pushed to the front of the list
  // before being sorted back into its numbered place.
  useEffect(() => {
    const at = visible.findIndex(r => r.isAssigned);
    setCursor(at === -1 ? 0 : at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Keeps the cursor row on screen.
   *
   * The row the list opens on is centred, the rest scroll the least they can. Opening a
   * long list with `nearest` leaves the assigned sample pinned to the bottom edge with
   * nothing under it, which does not read as having been scrolled to; centring on the
   * way in does. Doing the same on every arrow press would make the list jump under the
   * cursor instead of following it.
   */
  const centredOnOpen = useRef(false);
  useEffect(() => {
    const row = listRef.current?.querySelector('.slot-picker-row.cursor');
    if (!row) return;
    const centre = !centredOnOpen.current && row.classList.contains('assigned');
    row.scrollIntoView({ block: centre ? 'center' : 'nearest' });
    if (centre) centredOnOpen.current = true;
  }, [cursor, visible.length]);

  const commit = (row: Row | undefined) => {
    if (!row) return;
    // Picking the slot the track already plays is not a change, so it does not mark
    // the Part modified or write anything - the picker just closes
    if (row.slotId - 1 !== currentSlotId) onPick(row.slotId - 1);
    onClose();
  };

  // Same key model as the Sample Slots pages: arrows move the selection, Space plays,
  // Ctrl+arrows scrub and set volume, Shift+Enter/Shift+L toggle Auto-preview and Loop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = !!t && (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable);

      if (e.key === ' ' && !typing) {
        if (tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'A') { e.preventDefault(); player.togglePlay(); }
        return;
      }
      if (e.key === 'Enter' && e.shiftKey && !typing) { e.preventDefault(); player.setAutoPreview(!player.autoPreview); return; }
      if ((e.key === 'L' || e.key === 'l') && e.shiftKey && !typing) { e.preventDefault(); player.setLoop(!player.loop); return; }
      if ((e.ctrlKey || e.metaKey) && !typing) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(scrubTarget(player.currentTime, player.duration, -1)); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(scrubTarget(player.currentTime, player.duration, 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); player.setVolume(volumeStep(player.volume, 1)); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); player.setVolume(volumeStep(player.volume, -1)); return; }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Arrows walk the list even from the search box, so filtering and choosing
      // are one motion; Enter assigns from either place.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor(c => Math.max(0, Math.min(visible.length - 1, e.key === 'ArrowDown' ? c + 1 : c - 1)));
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); commit(visible[cursor]); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cursor, player]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-content missing-samples-list-modal slot-picker-modal"
        onClick={e => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className="modal-header missing-samples-header slot-picker-header">
          <h3><i className="fas fa-list"></i> {pool} Sample Slot</h3>
          <div className="missing-samples-header-info">
            <span className="missing-samples-header-count">
              {trackLabel} - {partLabel} - showing {visible.length} of {rows.length} slots
            </span>
          </div>
          <div className="missing-samples-header-actions">
            <div className="header-search-container">
              <input
                ref={searchRef}
                type="text"
                className="header-search-input"
                placeholder="Search..."
                value={searchText}
                onChange={e => { setSearchText(e.target.value); setCursor(0); }}
              />
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="table-wrapper slot-picker-list" ref={listRef}>
            <table className="samples-table">
              <thead>
                <tr>
                  <th className="col-slot sortable" onClick={() => sortBy('slot')}>
                    Slot{sortIndicator('slot')}
                  </th>
                  <th className="col-sample sortable" onClick={() => sortBy('sample')}>
                    Sample{sortIndicator('sample')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => (
                  <tr
                    key={row.slotId}
                    className={`slot-picker-row${i === cursor ? ' cursor' : ''}${row.isAssigned ? ' assigned' : ''}`}
                    onClick={() => setCursor(i)}
                    onDoubleClick={() => commit(row)}
                    onContextMenu={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Right-clicking also selects, so the menu always acts on the
                      // row under the pointer rather than on an older selection
                      setCursor(i);
                      setRowMenu({ x: e.clientX, y: e.clientY, row });
                    }}
                  >
                    <td className="col-slot">{row.label}</td>
                    <td className="col-sample" title={row.path ?? ''}>
                      <div className="slot-picker-sample-cell">
                        <span className="slot-picker-filename">{row.filename}</span>
                        {row.isAssigned && <span className="slot-picker-assigned-tag">Assigned</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={2} className="slot-picker-empty">No slot matches that search</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {rowMenu && (() => {
            const resolved = resolve(rowMenu.row.path);
            const playableRow = !!resolved && isAudioFile(resolved);
            return (
              <div
                className="context-menu"
                style={{ position: 'fixed', top: rowMenu.y, left: rowMenu.x }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  className="context-menu-item"
                  disabled={!playableRow}
                  title={playableRow ? undefined : 'This slot holds no playable file'}
                  onClick={() => { playRow(rowMenu.row); setRowMenu(null); }}
                >
                  <i className="fas fa-play"></i> Play
                </button>
                {rowMenu.row.isAssigned && rowMenu.row.path && (
                  <>
                    <div className="context-menu-separator" />
                    <button
                      className="context-menu-item"
                      title={unassign.title}
                      onClick={() => {
                        setRowMenu(null);
                        unassign.run();
                        onClose();
                      }}
                    >
                      <i className="fas fa-ban"></i> Un-assign
                    </button>
                    <div className="context-menu-separator" />
                  </>
                )}
                <button
                  className="context-menu-item"
                  disabled={!resolved}
                  onClick={() => { if (resolved) invoke('reveal_in_file_manager', { path: resolved }); setRowMenu(null); }}
                >
                  <i className="fas fa-folder-open"></i> Open in file explorer
                </button>
                <button
                  className="context-menu-item"
                  disabled={!resolved}
                  onClick={() => { if (resolved) navigator.clipboard.writeText(resolved); setRowMenu(null); }}
                >
                  <i className="fas fa-copy"></i> Copy path to clipboard
                </button>
              </div>
            );
          })()}

          <SamplePlayerBar player={player} playable={playable} />

          <div className="fix-confirm-actions slot-picker-actions">
            <button className="fix-cancel-btn" onClick={onClose}>Cancel</button>
            <div style={{ flex: 1 }} />
            <button
              className="tools-execute-btn"
              disabled={!visible[cursor]}
              onClick={() => commit(visible[cursor])}
            >
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
