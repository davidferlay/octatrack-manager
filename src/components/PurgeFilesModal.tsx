import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ColumnToggle, HeaderActions, useCopyFeedback, useModalResize } from './FixPoolFilesModal';

/** Matches the Rust `PurgeFileEntry` struct exactly. */
export interface PurgeFileEntry {
  path: string;
  size: number;
  /** Slot label(s) ("S1", "F2", ...) currently loading this file - only
   * ever non-empty when it became unused via a simulated "Clear unused
   * sample slot assignments" run. */
  slots: string[];
}

/** Matches the Rust `PurgeUnit` enum's `#[serde(tag = "kind")]` shape exactly. */
export type PurgeUnit =
  | { kind: 'File'; path: string; origin: string; size: number; slots: string[] }
  | { kind: 'Directory'; path: string; origin: string; file_count: number; size: number; files: PurgeFileEntry[] };

function baseName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** The containing directory of `path` - the "Location" column/field below,
 * so two same-named files in different folders are distinguishable on the
 * one screen whose entire purpose is confirming exactly what's about to be
 * removed. */
function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : '';
}

/** `filePath` relative to `dirPath` (its containing `PurgeUnit::Directory`),
 * for the tree-style child list below a directory row - "808/kick.wav"
 * reads better there than the full absolute path. */
function relativeToDir(filePath: string, dirPath: string): string {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedDir = dirPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedFile.startsWith(`${normalizedDir}/`)
    ? normalizedFile.slice(normalizedDir.length + 1)
    : baseName(filePath);
}

/** Total unused audio files a purge plan represents - a `PurgeUnit::File`
 * counts as 1, a collapsed `PurgeUnit::Directory` counts as its own
 * `file_count` (every audio file it absorbed), not as a single item. Plain
 * `units.length` undercounts whenever any directory collapsed (e.g. 15 root
 * files + 1 directory absorbing 6 more reads as 16 items, not the 21 audio
 * files actually found). */
export function purgeAudioFileCount(units: PurgeUnit[]): number {
  return units.reduce((sum, u) => sum + (u.kind === 'Directory' ? u.file_count : 1), 0);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type PurgeSortColumn = 'slot' | 'name' | 'location' | 'origin' | 'size';

const PURGE_COLUMNS: { id: PurgeSortColumn; label: string }[] = [
  { id: 'slot', label: 'Slot' },
  { id: 'name', label: 'Name' },
  { id: 'location', label: 'Location' },
  { id: 'origin', label: 'Origin' },
  { id: 'size', label: 'Size' },
];

interface PurgeRow {
  unit: PurgeUnit;
  name: string;
  location: string;
  origin: string;
  size: number;
  slots: string[];
}

/** Default column widths (px) before the user resizes anything - Name fills the rest. */
const PURGE_COL_DEFAULTS: Record<PurgeSortColumn, number | undefined> = {
  slot: 60, name: undefined, location: 185, origin: 140, size: 90,
};

/**
 * Sortable/filterable/resizable table for purge rows - deliberately a
 * separate hook from `usePoolTable` (FixPoolFilesModal.tsx), which is built
 * around per-file Format/Bit/kHz inspection and single-file convert
 * actions, neither of which apply to already-known-unused files or to
 * whole-directory rows. Reuses the exact same UI patterns (sortable/
 * filterable header rendering, column-resize drag math, filter dropdown)
 * so the two tables look and behave identically to the user.
 */
export function usePurgeTable(units: PurgeUnit[]) {
  const [searchText, setSearchText] = useState('');
  const [sortColumn, setSortColumn] = useState<PurgeSortColumn>('origin');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [originFilter, setOriginFilter] = useState('all');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  // Directory rows expanded by default (matches the previous always-shown
  // tree-child behavior) - collapsed via the caret next to the folder icon.
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const toggleDirCollapsed = (path: string) => setCollapsedDirs(s => {
    const next = new Set(s);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const allColumns = PURGE_COLUMNS;
  const visibleColumns = allColumns.filter(c => !hiddenCols.has(c.id));
  const toggleCol = (id: string) => setHiddenCols(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Column resize (same drag math as usePoolTable - widths captured from the DOM, dragged in pairs)
  const [colWidths, setColWidths] = useState<number[]>([]);
  const colDragIndex = useRef<number | null>(null);
  const colDragStartX = useRef(0);
  const colDragStartWidths = useRef<number[]>([]);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (colDragIndex.current === null) return;
      const delta = e.clientX - colDragStartX.current;
      const idx = colDragIndex.current;
      const prev = colDragStartWidths.current;
      const minW = 40;
      const newLeft = Math.max(minW, prev[idx] + delta);
      const newRight = Math.max(minW, prev[idx + 1] - delta);
      setColWidths((w) => {
        const copy = [...w];
        copy[idx] = newLeft;
        copy[idx + 1] = newRight;
        return copy;
      });
    }
    function onUp() { colDragIndex.current = null; }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Dragged widths were measured against the previous column set - remeasure after a toggle
  useEffect(() => { setColWidths([]); }, [hiddenCols]);

  const handleColResizeMouseDown = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    colDragIndex.current = colIndex;
    colDragStartX.current = e.clientX;
    if (tableRef.current) {
      const ths = tableRef.current.querySelectorAll('thead th');
      const widths = Array.from(ths).map((th) => (th as HTMLElement).offsetWidth);
      colDragStartWidths.current = widths;
      setColWidths(widths);
    }
  }, []);

  const closeDropdown = () => {
    setOpenDropdown(null);
    setDropdownPosition(null);
  };

  useEffect(() => {
    if (!openDropdown) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.filter-dropdown') && !target.closest('.filter-icon')) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openDropdown]);

  const origins = useMemo(() => Array.from(new Set(units.map(u => u.origin))).sort(), [units]);

  const rows = useMemo<PurgeRow[]>(() => {
    let filtered = units.map(unit => ({
      unit,
      name: baseName(unit.path),
      location: dirName(unit.path),
      origin: unit.origin,
      size: unit.size,
      slots: unit.kind === 'File' ? unit.slots : [],
    }));

    if (originFilter !== 'all') filtered = filtered.filter(r => r.origin === originFilter);
    if (searchText.trim()) {
      const needle = searchText.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(needle) || r.unit.path.toLowerCase().includes(needle));
    }

    filtered.sort((a, b) => {
      // Directories always group before lone files, regardless of the
      // active sort column - only within each group does that column apply.
      const kindCmp = (a.unit.kind === 'Directory' ? 0 : 1) - (b.unit.kind === 'Directory' ? 0 : 1);
      if (kindCmp !== 0) return kindCmp;
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (sortColumn === 'size') return (a.size - b.size) * dir;
      if (sortColumn === 'slot') return a.slots.join(', ').localeCompare(b.slots.join(', ')) * dir;
      return a[sortColumn].localeCompare(b[sortColumn]) * dir;
    });

    return filtered;
  }, [units, searchText, originFilter, sortColumn, sortDirection]);

  const handleSort = (column: PurgeSortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  const sortIndicator = (column: PurgeSortColumn) =>
    sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

  const hasActiveFilters = originFilter !== 'all';
  const resetFilters = () => setOriginFilter('all');

  const renderSortableHeader = (column: PurgeSortColumn, label: string, resizeIndex?: number) => (
    <th key={column} className="sortable" onClick={() => handleSort(column)} style={{ position: 'relative' }}>
      {label}{sortIndicator(column)}
      {resizeIndex !== undefined && (
        <span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); handleColResizeMouseDown(resizeIndex, e); }} />
      )}
    </th>
  );

  const renderFilterableHeader = (
    column: PurgeSortColumn,
    label: string,
    isActive: boolean,
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void,
    resizeIndex?: number,
  ) => (
    <th key={column} className="filterable-header" style={{ position: 'relative' }}>
      <div className="header-content">
        <span onClick={() => handleSort(column)} className="sortable-label">
          {label}{sortIndicator(column)}
        </span>
        <button
          className={`filter-icon ${openDropdown === column || isActive ? 'active' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (openDropdown === column) {
              closeDropdown();
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setDropdownPosition({ top: rect.bottom + 4, left: rect.right - 120 });
              setOpenDropdown(column);
            }
          }}
        >
          ⋮
        </button>
      </div>
      {openDropdown === column && dropdownPosition && (
        <div className="filter-dropdown" style={{ position: 'fixed', top: dropdownPosition.top, left: dropdownPosition.left, width: 'auto', minWidth: 'auto' }}>
          <div className="dropdown-options" style={{ width: 'max-content' }}>
            {options.map((opt) => (
              <label key={opt.value} className="dropdown-option">
                <input type="radio" name={`${column}-purge-filter`} checked={currentValue === opt.value} onChange={() => { onChange(opt.value); closeDropdown(); }} />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {resizeIndex !== undefined && (
        <span className="col-resize-handle" onMouseDown={(e) => handleColResizeMouseDown(resizeIndex, e)} />
      )}
    </th>
  );

  const totalSize = useMemo(() => units.reduce((sum, u) => sum + u.size, 0), [units]);
  const totalDirs = useMemo(() => units.filter(u => u.kind === 'Directory').length, [units]);

  return {
    rows, allColumns, visibleColumns, hiddenCols, toggleCol,
    searchText, setSearchText,
    sortColumn, sortDirection,
    originFilter, setOriginFilter, origins,
    hasActiveFilters, resetFilters,
    collapsedDirs, toggleDirCollapsed,
    renderSortableHeader, renderFilterableHeader,
    colWidths, tableRef,
    totalSize, totalDirs,
  };
}

export function purgeTableTsv(table: ReturnType<typeof usePurgeTable>): string {
  const header = ['Slot', 'Name', 'Location', 'Origin', 'Size'].join('\t');
  const lines = table.rows.map(r => [r.slots.join(', '), r.name, r.location, r.origin, formatSize(r.size)].join('\t'));
  return [header, ...lines].join('\n');
}

/** "Origin: X ✕ Reset" badge, same look/placement as FixPoolFilesModal's FilterBadges. */
export function PurgeFilterBadges({ table }: { table: ReturnType<typeof usePurgeTable> }) {
  const { originFilter, hasActiveFilters, resetFilters } = table;
  if (!hasActiveFilters) return null;
  return (
    <>
      <span className="filter-badge">Origin: {originFilter}</span>
      <button className="reset-filters-btn" onClick={resetFilters} title="Reset all filters">✕ Reset</button>
    </>
  );
}

/** "Open in file explorer" + "Copy file path" - same actions/wording as
 * FixPoolFilesModal's row context menu, generalized to a bare path since a
 * purge row's menu also has to work for a tree-child row (a plain absorbed
 * file path, not a full PurgeUnit). */
function PurgeRowContextMenu({ menu, onClose }: { menu: { x: number; y: number; path: string }; onClose: () => void }) {
  return (
    <div className="context-menu" style={{ position: 'fixed', top: menu.y, left: menu.x }} onClick={(e) => e.stopPropagation()}>
      <button className="context-menu-item" onClick={() => { invoke('reveal_in_file_manager', { path: menu.path }); onClose(); }}>
        <i className="fas fa-folder-open"></i> Open in file explorer
      </button>
      <button className="context-menu-item" onClick={() => { navigator.clipboard.writeText(menu.path); onClose(); }}>
        <i className="fas fa-copy"></i> Copy file path
      </button>
    </div>
  );
}

export function PurgeUnitsTable({ table }: { table: ReturnType<typeof usePurgeTable> }) {
  const {
    rows, visibleColumns, originFilter, setOriginFilter, origins, renderSortableHeader, renderFilterableHeader,
    colWidths, tableRef, collapsedDirs, toggleDirCollapsed,
  } = table;

  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRowMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [rowMenu]);
  const openRowMenu = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ x: e.clientX, y: e.clientY, path });
  };

  const originOptions = [{ value: 'all', label: 'All' }, ...origins.map(o => ({ value: o, label: o }))];

  const renderHeader = (id: PurgeSortColumn, label: string, i: number) => {
    const resizeIndex = i < visibleColumns.length - 1 ? i : undefined;
    if (id === 'origin') {
      return renderFilterableHeader('origin', label, originFilter !== 'all', originOptions, originFilter, setOriginFilter, resizeIndex);
    }
    return renderSortableHeader(id, label, resizeIndex);
  };

  return (
    <>
      <table className="samples-table pool-files-table purge-units-table" ref={tableRef}>
        <colgroup>
          {visibleColumns.map((c, i) => (
            <col key={c.id} style={{ width: colWidths.length > 0 ? colWidths[i] : PURGE_COL_DEFAULTS[c.id] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((c, i) => renderHeader(c.id, c.label, i))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isDir = r.unit.kind === 'Directory';
            const collapsed = isDir && collapsedDirs.has(r.unit.path);
            return (
              <Fragment key={r.unit.path}>
                <tr onContextMenu={openRowMenu(r.unit.path)}>
                  {visibleColumns.map(c => {
                    switch (c.id) {
                      case 'slot':
                        return (
                          <td key="slot" className="col-slot">
                            {r.slots.length > 0 ? r.slots.join(', ') : <span className="usage-none">—</span>}
                          </td>
                        );
                      case 'name':
                        return (
                          <td key="name" className="col-sample" title={r.unit.path}>
                            {r.unit.kind === 'Directory' && (
                              <button
                                className="purge-dir-collapse-btn"
                                onClick={(e) => { e.stopPropagation(); toggleDirCollapsed(r.unit.path); }}
                                title={collapsed ? 'Expand' : 'Collapse'}
                              >
                                <i className={`fas fa-caret-${collapsed ? 'right' : 'down'}`}></i>
                              </button>
                            )}
                            {isDir && <i className="fas fa-folder"></i>}
                            {' '}
                            {r.name}
                            {r.unit.kind === 'Directory' && <span className="pool-dir-file-count"> ({r.unit.file_count} files)</span>}
                          </td>
                        );
                      case 'location':
                        return <td key="location" className="fix-location-cell" title={r.location}>{r.location}</td>;
                      case 'origin':
                        return <td key="origin">{r.origin}</td>;
                      case 'size':
                        return <td key="size">{formatSize(r.size)}</td>;
                    }
                  })}
                </tr>
                {r.unit.kind === 'Directory' && !collapsed && r.unit.files.map(file => (
                  <tr key={file.path} className="purge-tree-child-row" onContextMenu={openRowMenu(file.path)}>
                    {visibleColumns.map(c => {
                      switch (c.id) {
                        case 'slot':
                          return (
                            <td key="slot">
                              {file.slots.length > 0 ? file.slots.join(', ') : ''}
                            </td>
                          );
                        case 'name':
                          return (
                            <td key="name" className="purge-tree-child-name" title={file.path}>
                              <i className="fas fa-file-audio"></i> {relativeToDir(file.path, r.unit.kind === 'Directory' ? r.unit.path : '')}
                            </td>
                          );
                        case 'size':
                          return <td key="size">{formatSize(file.size)}</td>;
                        default:
                          return <td key={c.id}></td>;
                      }
                    })}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rowMenu && <PurgeRowContextMenu menu={rowMenu} onClose={() => setRowMenu(null)} />}
    </>
  );
}

/** Read-only preview modal, opened from the status button. */
export function PurgeUnusedListModal({ units, scope, onClose }: {
  units: PurgeUnit[];
  scope: 'project' | 'pool';
  onClose: () => void;
}) {
  const table = usePurgeTable(units);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();
  const title = scope === 'project' ? 'Unused Project Samples' : 'Unused Audio Pool Samples';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={modalRef} className="modal-content missing-samples-list-modal pool-list-modal purge-list-modal" onClick={(e) => e.stopPropagation()} style={style}>
        {handles}
        <div className="modal-header missing-samples-header">
          <h3><i className="fas fa-list"></i> {title}</h3>
          <div className="missing-samples-header-info">
            <span className="missing-samples-header-count">Showing {table.rows.length} of {units.length} items</span>
            <PurgeFilterBadges table={table} />
          </div>
          <HeaderActions
            searchText={table.searchText}
            setSearchText={table.setSearchText}
            onCopy={() => copy(purgeTableTsv(table))}
            copyFeedback={copyFeedback}
            columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={table.toggleCol} />}
          />
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="table-wrapper">
            <PurgeUnitsTable table={table} />
          </div>
        </div>
      </div>
    </div>
  );
}

export interface PurgeResult {
  files_removed: string[];
  dirs_removed: string[];
  bytes_reclaimed: number;
  slots_cleared: number;
  projects_updated: string[];
  errors: string[];
}

type Phase = 'review' | 'removing' | 'done' | 'error';

export interface PurgeFilesModalProps {
  /** "project" or "pool" - only affects labels/titles. */
  scope: 'project' | 'pool';
  /** Absolute path of the project or Audio Pool directory being purged. */
  scopePath: string;
  /** The reviewed plan. */
  units: PurgeUnit[];
  /** 'delete' sends to the OS Trash; a destination path moves files there instead. */
  mode: 'delete' | { destinationDir: string };
  /** Skip the review screen and start immediately - only ever true for Move mode (Delete mode always forces review, enforced by the caller). */
  skipReview?: boolean;
  /**
   * Count of loaded-but-untriggered sample slots that will also be cleared
   * this run (from `count_unused_slot_assignments`/`count_slots_eligible_for_clearing`),
   * shown in the review summary alongside the file/directory counts so this
   * second destructive effect of the "Clear unused sample slot assignments"
   * option is visible before Apply Changes, not just on the done screen.
   * `undefined`/`null` when that option is off - no extra line is shown.
   */
  slotsToClear?: number | null;
  onClose: () => void;
  onPurged?: (result: PurgeResult) => void;
  /** The actual purge call - the only backend-command-shaped detail that differs between project and pool scope. */
  runPurge: (plan: PurgeUnit[], destinationDir: string | null) => Promise<PurgeResult>;
}

/**
 * Shared review/apply flow behind both "Purge Project Samples" and "Purge
 * Audio Pool Samples" - same review -> removing -> done/error phase shape
 * as FixSamplesModal (FixPoolFilesModal.tsx), without its per-file
 * progress/cancellation machinery: deleting/moving is fast local filesystem
 * work, not audio conversion, so a brief spinner is enough - no event
 * listening, no transfer_id/cancellation plumbing needed.
 *
 * `scopePath` is accepted (not read here) purely to keep this component's
 * prop shape consistent with `PurgeUnusedListModal` above and with the
 * Fix*Modal family - callers pass it through uniformly even though the
 * review table already shows full origin/size per row without it.
 */
export function PurgeFilesModal({ scope, units, mode, skipReview = false, slotsToClear, onClose, onPurged, runPurge }: PurgeFilesModalProps) {
  const [phase, setPhase] = useState<Phase>(skipReview ? 'removing' : 'review');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<PurgeResult | null>(null);
  const table = usePurgeTable(units);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();
  const startedRef = useRef(false);

  const isDelete = mode === 'delete';
  const doneLabel = scope === 'project' ? 'Purge Project Samples' : 'Purge Audio Pool Samples';
  const progressingLabel = isDelete ? 'Sending to Trash...' : 'Moving...';

  const start = () => {
    setPhase('removing');
    const destinationDir = isDelete ? null : mode.destinationDir;
    runPurge(units, destinationDir)
      .then((r) => {
        setResult(r);
        setPhase('done');
        onPurged?.(r);
      })
      .catch((e) => {
        setErrorMsg(String(e));
        setPhase('error');
      });
  };

  // Kick off immediately when review is skipped (Move mode with the review
  // checkbox off). startedRef (same guard pattern FixSamplesModal uses)
  // ensures this fires exactly once even if the component re-renders while
  // 'removing'.
  useEffect(() => {
    if (skipReview && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay" onClick={phase !== 'removing' ? onClose : undefined}>
      <div
        ref={modalRef}
        className={`modal-content missing-samples-list-modal pool-list-modal purge-list-modal${phase === 'review' ? '' : ' fix-pool-modal-narrow'}`}
        onClick={(e) => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className={`modal-header${phase === 'review' ? ' missing-samples-header' : ''}`}>
          <h3>
            {phase === 'review' && <><i className="fas fa-trash"></i> Review planned changes - {units.length} item{units.length !== 1 ? 's' : ''}</>}
            {phase === 'removing' && <><i className="fas fa-trash" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>{progressingLabel}</>}
            {phase === 'done' && <><i className="fas fa-trash" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>{doneLabel}</>}
            {phase === 'error' && 'Error'}
          </h3>
          {phase === 'review' && (
            <>
              <div className="missing-samples-header-info">
                <span className="missing-samples-header-count">Showing {table.rows.length} of {units.length} items</span>
                <PurgeFilterBadges table={table} />
              </div>
              <HeaderActions
                searchText={table.searchText}
                setSearchText={table.setSearchText}
                onCopy={() => copy(purgeTableTsv(table))}
                copyFeedback={copyFeedback}
                columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={table.toggleCol} />}
              />
            </>
          )}
          {phase !== 'removing' && <button className="modal-close" onClick={onClose}>&times;</button>}
        </div>

        <div className={`modal-body${phase === 'review' ? ' fix-confirm-body' : ''}`}>
          {phase === 'review' && (
            <div className="fix-confirmation">
              <div className="fix-confirm-table-wrapper">
                <PurgeUnitsTable table={table} />
              </div>
              <div className="fix-progress-section">
                <p className="fix-confirm-status" style={isDelete ? { color: '#dc3545' } : undefined}>
                  {units.length} item{units.length !== 1 ? 's' : ''}, {table.totalDirs} director{table.totalDirs !== 1 ? 'ies' : 'y'}, ~{formatSize(table.totalSize)}
                  {isDelete ? ' will be moved to the Trash.' : ` will be moved to ${mode.destinationDir}.`}
                </p>
                {typeof slotsToClear === 'number' && (
                  <p className="fix-confirm-status">
                    {slotsToClear} unused sample slot assignment{slotsToClear !== 1 ? 's' : ''} will also be cleared.
                  </p>
                )}
                <div className="fix-done-actions">
                  <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button
                    className={`tools-execute-btn${isDelete ? ' tools-execute-btn-danger' : ''}`}
                    onClick={start}
                  >
                    Apply Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === 'removing' && (
            <div className="fix-pool-progress">
              <div className="fix-search-step running">
                <span className="fix-step-icon"><span className="loading-spinner-small"></span></span>
                <span className="fix-step-label">{progressingLabel}</span>
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="fix-pool-summary">
              <p>
                <i className="fas fa-check" style={{ color: '#2ecc71', marginRight: '0.5rem' }}></i>
                {result.files_removed.length} file{result.files_removed.length !== 1 ? 's' : ''} and {result.dirs_removed.length} director{result.dirs_removed.length !== 1 ? 'ies' : 'y'} removed ({formatSize(result.bytes_reclaimed)} reclaimed).
                {result.slots_cleared > 0 && (
                  <><br />{result.slots_cleared} unused sample slot assignment{result.slots_cleared !== 1 ? 's' : ''} cleared.</>
                )}
              </p>
              {result.errors.length > 0 && (
                <div className="fix-done-failures">
                  <div className="fix-done-failures-label">{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</div>
                  <div className="fix-done-failures-table-wrapper">
                    <table className="fix-done-failures-table">
                      <tbody>
                        {result.errors.map((e, i) => <tr key={i}><td>{e}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="fix-done-actions">
                <button className="tools-execute-btn" onClick={onClose}>Close</button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <>
              <div className="fix-done-error"><p>{errorMsg}</p></div>
              <div className="fix-done-actions">
                <button className="fix-cancel-btn" onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
