import { useEffect, useMemo, useRef, useState } from 'react';
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
  pool, slots, currentSlotId, projectPath, trackLabel, partLabel, onPick, onClose,
}: Props) {
  const [searchText, setSearchText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sortColumn, setSortColumn] = useState<'slot' | 'sample'>('slot');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [playable, setPlayable] = useState(false);
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

  const resolve = (path: string | null) => {
    if (!path) return null;
    const isAbsolute = path.startsWith('/') || /^[A-Za-z]:/.test(path);
    return isAbsolute ? path : `${projectPath}/${path}`;
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
  useEffect(() => {
    const at = rows.findIndex(r => r.isAssigned);
    setCursor(at === -1 ? 0 : at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector('.slot-picker-row.cursor')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, visible.length]);

  const commit = (row: Row | undefined) => {
    if (!row) return;
    onPick(row.slotId - 1);
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
