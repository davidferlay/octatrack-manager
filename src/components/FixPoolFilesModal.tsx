import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getFileFormat, formatFileSize, usageKey } from './AudioFileTable';
import type { PoolUsageEntry } from '../types/audioFile';

export interface IncompatibleFile {
  path: string;
  compatibility: string; // "wrong_rate" | "incompatible" | "unknown"
  source: 'pool' | 'project';
  /** Which slot(s) reference this file, e.g. ['F3', 'S12'] - project-scope scans only, undefined/empty for pool-scope rows and unreferenced files. */
  slots?: string[];
}

export interface PoolFixOutcome {
  old_path: string;
  new_path: string | null;
  error: string | null;
}

export interface PoolFixResult {
  outcomes: PoolFixOutcome[];
  projects_updated: string[];
  slots_updated: number;
}

export interface CopyProgressEvent {
  file_path: string;
  transfer_id: string;
  stage: string;
  progress: number;
}

/** File name without its directory part. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Directory of `path` relative to the SET (the pool's parent), shown as
 * AUDIO/... for a pool file or ProjectName/... for a project-local file -
 * same "top-level-folder/rest" shape either way, so a pool file's rendering
 * is unchanged from before this generalization.
 */
function poolLocation(path: string, poolPath: string): string {
  const setDir = poolPath.replace(/[/\\][^/\\]+[/\\]?$/, '');
  const rel = path.startsWith(setDir) ? path.slice(setDir.length).replace(/^[/\\]/, '') : path;
  const parts = rel.split(/[\\/]/).slice(0, -1); // drop the filename
  if (parts.length === 0) return '';
  const [top, ...rest] = parts;
  return rest.length ? `${top}/${rest.join('/')}` : `${top}/`;
}

/** What the fix will actually do to this file, from its metadata: the backend rewrites
    as WAV, resamples to 44.1 kHz and clamps the bit depth to 16..24 - only the steps
    this file needs are listed. */
function actionFor(name: string, bit: number | null, khz: number | null): { label: string; title: string } {
  const isWav = name.toLowerCase().endsWith('.wav');
  const ops: string[] = [];
  if (khz != null && khz !== 44100) ops.push('Resample to 44.1 kHz');
  if (bit != null && (bit < 16 || bit > 24)) ops.push(`Convert to ${bit < 16 ? 16 : 24}-bit`);
  if (!isWav) ops.push('Rewrite as WAV');
  const label = ops.length ? ops.join(', ') : 'Convert to 44.1 kHz WAV';
  const title = label + '; replace original file, update slot references';
  return { label, title };
}

/** Shared modal-header search box + copy-table button (fix-missing style). */
export function HeaderActions({ searchText, setSearchText, onCopy, copyFeedback, columnToggle }: {
  searchText: string;
  setSearchText: (v: string) => void;
  onCopy: () => void;
  copyFeedback: 'idle' | 'copied';
  columnToggle?: React.ReactNode;
}) {
  return (
    <div className="missing-samples-header-actions">
      <div className="header-search-container">
        <input
          type="text"
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="header-search-input"
        />
        {searchText && (
          <button className="header-search-clear" onClick={() => setSearchText('')} title="Clear search">×</button>
        )}
      </div>
      <button
        className={`copy-table-btn ${copyFeedback === 'copied' ? 'copied' : ''}`}
        onClick={onCopy}
        title="Copy table to clipboard (for Excel/Google Sheets)"
      >
        {copyFeedback === 'copied' ? '✓' : '⧉'}
      </button>
      {columnToggle}
    </div>
  );
}

export function useCopyFeedback(): ['idle' | 'copied', (text: string) => void] {
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');
  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopyFeedback('copied');
        setTimeout(() => setCopyFeedback('idle'), 2000);
      })
      .catch((err) => console.error('Failed to copy to clipboard:', err));
  };
  return [copyFeedback, copy];
}

/** Modal resize: left/right handles adjust width symmetrically, bottom adjusts height. */
export function useModalResize() {
  const [modalWidth, setModalWidth] = useState<number | null>(null);
  const [modalHeight, setModalHeight] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'left' | 'right' | 'bottom' | null>(null);
  const dragStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const onResizeMouseDown = useCallback((side: 'left' | 'right' | 'bottom', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = side;
    const rect = modalRef.current?.getBoundingClientRect();
    dragStart.current = { x: e.clientX, y: e.clientY, w: rect?.width ?? 700, h: rect?.height ?? 500 };
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      if (dragging.current === 'bottom') {
        const h = Math.max(240, Math.min(window.innerHeight * 0.95, dragStart.current.h + (e.clientY - dragStart.current.y)));
        setModalHeight(h);
      } else {
        // Both edges expand symmetrically: multiply delta by 2
        const mult = dragging.current === 'right' ? 2 : -2;
        const w = Math.max(400, Math.min(window.innerWidth * 0.95, dragStart.current.w + (e.clientX - dragStart.current.x) * mult));
        setModalWidth(w);
      }
    }
    // A resize drag often ends with the pointer over the overlay, which would fire
    // its click-to-close: swallow the single click that follows a drag
    const swallowClick = (e: MouseEvent) => e.stopPropagation();
    function onUp() {
      if (dragging.current) {
        document.addEventListener('click', swallowClick, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallowClick, true), 0);
      }
      dragging.current = null;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const style: React.CSSProperties = {
    ...(modalWidth ? { width: modalWidth, maxWidth: '95vw' } : {}),
    ...(modalHeight ? { height: modalHeight, maxHeight: '95vh' } : {}),
  };
  const handles = (
    <>
      <div className="modal-resize-handle modal-resize-left" onMouseDown={(e) => onResizeMouseDown('left', e)} />
      <div className="modal-resize-handle modal-resize-right" onMouseDown={(e) => onResizeMouseDown('right', e)} />
      <div className="modal-resize-handle modal-resize-bottom" onMouseDown={(e) => onResizeMouseDown('bottom', e)} />
    </>
  );
  return { modalRef, style, handles };
}

interface FileMeta {
  path: string;
  size: number;
  bit_rate: number | null;
  sample_rate: number | null;
}

/** Bit/kHz/Size metadata per file, fetched once (files sit scattered across subfolders). */
function usePoolFileMeta(files: IncompatibleFile[]): Record<string, FileMeta> {
  const [meta, setMeta] = useState<Record<string, FileMeta>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(invoke<FileMeta[]>('get_audio_files_info', { paths: files.map(f => f.path) }))
      .then(infos => {
        if (cancelled || !Array.isArray(infos)) return;
        setMeta(Object.fromEntries(infos.map(i => [i.path, i])));
      })
      .catch(() => {}); // no Tauri (e2e without mock) → columns stay empty
    return () => { cancelled = true; };
  }, [files]);
  return meta;
}

interface PoolRow {
  path: string;
  name: string;
  format: string;
  bit: number | null;
  khz: number | null;
  size: number | null;
  location: string;
  action: string;
  actionTitle: string;
  usageEntries: PoolUsageEntry[];
  slots: string[];
}

export type PoolSortColumn = 'file' | 'format' | 'bit' | 'khz' | 'size' | 'location' | 'action' | 'usage' | 'slot';

const POOL_COLUMNS: { id: PoolSortColumn; label: string }[] = [
  { id: 'slot', label: 'Slot' },
  { id: 'file', label: 'File' },
  { id: 'format', label: 'Format' },
  { id: 'bit', label: 'Bit' },
  { id: 'khz', label: 'kHz' },
  { id: 'usage', label: 'Usage' },
  { id: 'size', label: 'Size' },
  { id: 'location', label: 'Location' },
  { id: 'action', label: 'Action' },
];

/**
 * Shared sortable/filterable/column-resizable table for the two pool modals.
 * Columns: File, Format, Bit, kHz, Size, Location (+ Action for the review modal).
 */
export function usePoolTable(
  files: IncompatibleFile[],
  poolPath: string,
  withAction: boolean,
  defaultHidden: PoolSortColumn[] = [],
  usageMap?: Record<string, PoolUsageEntry[]>,
  usageLoading?: boolean,
  withSlot?: boolean,
) {
  const meta = usePoolFileMeta(files);
  const [searchText, setSearchText] = useState('');
  const [sortColumn, setSortColumn] = useState<PoolSortColumn>('file');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [formatFilter, setFormatFilter] = useState('all');
  const [bitFilter, setBitFilter] = useState('all');
  const [khzFilter, setKhzFilter] = useState('all');
  const [usageFilter, setUsageFilter] = useState('all');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const [usagePopover, setUsagePopover] = useState<{ x: number; y: number; path: string; scope: 'audible' | 'referenced' } | null>(null);
  useEffect(() => {
    if (!usagePopover) return;
    const close = () => setUsagePopover(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUsagePopover(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [usagePopover]);

  // Column visibility ("toggle columns" menu in the header)
  const allColumns = POOL_COLUMNS.filter(c =>
    (withAction || c.id !== 'action') &&
    (usageMap || c.id !== 'usage') &&
    (withSlot || c.id !== 'slot')
  );
  const [hiddenCols, setHiddenCols] = useState<Set<PoolSortColumn>>(new Set(defaultHidden));
  const visibleColumns = allColumns.filter(c => !hiddenCols.has(c.id));
  const toggleCol = (id: PoolSortColumn) => setHiddenCols(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Column resize (fix-missing style: widths captured from the DOM, dragged in pairs)
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

  // Close dropdown when clicking outside
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

  const allRows: PoolRow[] = files.map(f => {
    const name = baseName(f.path);
    const bit = meta[f.path]?.bit_rate ?? null;
    const khz = meta[f.path]?.sample_rate ?? null;
    const { label, title } = actionFor(name, bit, khz);
    return {
      path: f.path,
      name,
      format: getFileFormat(f.path),
      bit,
      khz,
      size: meta[f.path]?.size ?? null,
      location: poolLocation(f.path, poolPath),
      action: label,
      actionTitle: title,
      usageEntries: usageMap?.[usageKey(f.path)] ?? [],
      slots: f.slots ?? [],
    };
  });

  const rows = allRows
    .filter(r => {
      if (searchText && !r.name.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (formatFilter !== 'all' && r.format !== formatFilter) return false;
      if (bitFilter !== 'all' && String(r.bit ?? '') !== bitFilter) return false;
      if (khzFilter !== 'all' && String(r.khz ?? '') !== khzFilter) return false;
      if (usageFilter !== 'all') {
        const audibleCount = r.usageEntries.filter(e => e.audible).length;
        if (usageFilter === 'used' && audibleCount === 0) return false;
        if (usageFilter === 'referenced' && audibleCount === r.usageEntries.length) return false;
        if (usageFilter === 'unused' && r.usageEntries.length > 0) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const numeric = sortColumn === 'bit' || sortColumn === 'khz' || sortColumn === 'size' || sortColumn === 'usage';
      const key = (r: PoolRow): string | number => {
        switch (sortColumn) {
          case 'file': return r.name.toLowerCase();
          case 'format': return r.format;
          case 'bit': return r.bit ?? -1;
          case 'khz': return r.khz ?? -1;
          case 'size': return r.size ?? -1;
          case 'location': return r.location.toLowerCase();
          case 'action': return r.action;
          case 'usage': return r.usageEntries.filter(e => e.audible).length * 1000 + r.usageEntries.length;
          case 'slot': return r.slots.join(', ').toLowerCase();
        }
      };
      const ka = key(a);
      const kb = key(b);
      const cmp = numeric ? (ka as number) - (kb as number) : ka < kb ? -1 : ka > kb ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });

  const handleSort = (column: PoolSortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (column: PoolSortColumn) =>
    sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

  const unique = (get: (r: PoolRow) => string) =>
    Array.from(new Set(allRows.map(get).filter(v => v !== ''))).sort();

  const hasActiveFilters = formatFilter !== 'all' || bitFilter !== 'all' || khzFilter !== 'all' || usageFilter !== 'all';
  const resetFilters = () => {
    setFormatFilter('all');
    setBitFilter('all');
    setKhzFilter('all');
    setUsageFilter('all');
  };

  /** Sortable header with a ⋮ filter dropdown, same markup as the fix-missing review table. */
  const renderFilterableHeader = (
    column: PoolSortColumn,
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
                <input type="radio" name={`${column}-pool-filter`} checked={currentValue === opt.value} onChange={() => { onChange(opt.value); closeDropdown(); }} />
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

  const renderSortableHeader = (column: PoolSortColumn, label: string, resizeIndex?: number) => (
    <th key={column} className="sortable" onClick={() => handleSort(column)} style={{ position: 'relative' }}>
      {label}{sortIndicator(column)}
      {resizeIndex !== undefined && (
        <span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); handleColResizeMouseDown(resizeIndex, e); }} />
      )}
    </th>
  );

  return {
    rows, allRows, searchText, setSearchText,
    formatFilter, setFormatFilter, bitFilter, setBitFilter, khzFilter, setKhzFilter,
    usageFilter, setUsageFilter, usageLoading,
    usagePopover, setUsagePopover,
    hasActiveFilters, resetFilters, unique,
    renderFilterableHeader, renderSortableHeader,
    colWidths, tableRef,
    allColumns, visibleColumns, hiddenCols, toggleCol,
  };
}

/** "Toggle columns" menu (same look as the file tables' column visibility button).
    Shared by the pool and missing-samples modals. */
export function ColumnToggle({ columns, hiddenCols, onToggle }: {
  columns: { id: string; label: string }[];
  hiddenCols: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div className="column-menu-wrapper" ref={ref}>
      <button
        className={`column-visibility-btn ${open ? 'active' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        title="Show/Hide Columns"
      >
        ☰
      </button>
      {open && (
        <div className="column-visibility-dropdown">
          <div className="column-visibility-header">Show/Hide Columns</div>
          <div className="dropdown-options">
            {columns.map(c => (
              <label key={c.id} className="dropdown-option">
                <input type="checkbox" checked={!hiddenCols.has(c.id)} onChange={() => onToggle(c.id)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Default column widths (px) before the user resizes anything.
    List modal: File takes the rest; review modal: Action takes the rest. */
const POOL_COL_DEFAULTS: Record<string, number | undefined> = {
  slot: 70, file: undefined, format: 95, bit: 72, khz: 78, usage: 90, size: 89, location: 185, action: 190,
};
const REVIEW_COL_DEFAULTS: Record<string, number | undefined> = {
  slot: 70, file: 260, format: 93, bit: 80, khz: 78, usage: 90, size: 90, location: 185, action: undefined,
};

const BANK_LETTERS = 'ABCDEFGHIJKLMNOP';

export function PoolFilesTable({ table }: { table: ReturnType<typeof usePoolTable> }) {
  const {
    rows, visibleColumns, formatFilter, setFormatFilter, bitFilter, setBitFilter, khzFilter, setKhzFilter,
    usageFilter, setUsageFilter, usageLoading, usagePopover, setUsagePopover,
    unique, renderFilterableHeader, renderSortableHeader, colWidths, tableRef,
  } = table;

  const filterOptions = (values: string[], fmt: (v: string) => string = v => v) =>
    [{ value: 'all', label: 'All' }, ...values.map(v => ({ value: v, label: fmt(v) }))];

  const usageFilterOptions = [
    { value: 'all', label: 'All' },
    { value: 'used', label: 'Used (plays)' },
    { value: 'referenced', label: 'Referenced, not triggered' },
    { value: 'unused', label: 'Unused' },
  ];

  const renderHeader = (id: PoolSortColumn, label: string, i: number) => {
    // The last visible column has no resize handle (it absorbs the leftovers)
    const resizeIndex = i < visibleColumns.length - 1 ? i : undefined;
    switch (id) {
      case 'format':
        return renderFilterableHeader('format', label, formatFilter !== 'all',
          filterOptions(unique(r => r.format)), formatFilter, setFormatFilter, resizeIndex);
      case 'bit':
        return renderFilterableHeader('bit', label, bitFilter !== 'all',
          filterOptions(unique(r => String(r.bit ?? ''))), bitFilter, setBitFilter, resizeIndex);
      case 'khz':
        return renderFilterableHeader('khz', label, khzFilter !== 'all',
          filterOptions(unique(r => String(r.khz ?? '')), v => `${(Number(v) / 1000).toFixed(1)}`), khzFilter, setKhzFilter, resizeIndex);
      case 'usage':
        return renderFilterableHeader('usage', label, usageFilter !== 'all',
          usageFilterOptions, usageFilter, setUsageFilter, resizeIndex);
      case 'action':
        return <th key="action">Action</th>;
      default:
        return renderSortableHeader(id, label, resizeIndex);
    }
  };

  const renderCell = (id: PoolSortColumn, r: PoolRow) => {
    switch (id) {
      case 'file': return <td key={id} className="col-sample" title={r.path}>{r.name}</td>;
      case 'format': return <td key={id}>{r.format}</td>;
      case 'bit': return <td key={id}>{r.bit ?? ''}</td>;
      case 'khz': return <td key={id}>{r.khz != null ? (r.khz / 1000).toFixed(1) : ''}</td>;
      case 'size': return <td key={id}>{r.size != null ? formatFileSize(r.size) : ''}</td>;
      case 'location': return <td key={id} className="fix-location-cell" title={r.location}>{r.location}</td>;
      case 'action': return <td key={id} title={r.actionTitle}>{r.action}</td>;
      case 'slot': return <td key={id} className="col-slot">{r.slots.length > 0 ? r.slots.join(', ') : <span className="usage-none">—</span>}</td>;
      case 'usage': {
        const audibleCount = r.usageEntries.filter(e => e.audible).length;
        const referencedCount = r.usageEntries.length - audibleCount;
        const openPopover = (scope: 'audible' | 'referenced') => (e: React.MouseEvent) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setUsagePopover({ x: rect.left, y: rect.bottom + 4, path: r.path, scope });
        };
        return (
          <td key={id} className="col-usage">
            {audibleCount > 0 && (
              <button className="usage-badge" title={`Played in ${audibleCount} place${audibleCount > 1 ? 's' : ''} - click for details`} onClick={openPopover('audible')}>
                ✓ {audibleCount}
              </button>
            )}
            {referencedCount > 0 && (
              <button className="usage-badge referenced" title={`Referenced in ${referencedCount} place${referencedCount > 1 ? 's' : ''} but not triggered - click for details`} onClick={openPopover('referenced')}>
                ○ {referencedCount}
              </button>
            )}
            {r.usageEntries.length === 0 && (usageLoading
              ? <span className="usage-none" title="Computing usage…">…</span>
              : <span className="usage-none" title="Not referenced anywhere">—</span>)}
          </td>
        );
      }
    }
  };

  const defaults = table.allColumns.some(c => c.id === 'action') ? REVIEW_COL_DEFAULTS : POOL_COL_DEFAULTS;

  return (
    <>
      <table className="samples-table pool-files-table" ref={tableRef}>
        <colgroup>
          {visibleColumns.map((c, i) => (
            <col key={c.id} style={{ width: colWidths.length > 0 ? colWidths[i] : defaults[c.id] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((c, i) => renderHeader(c.id, c.label, i))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.path}>
              {visibleColumns.map(c => renderCell(c.id, r))}
            </tr>
          ))}
        </tbody>
      </table>
      {usagePopover && createPortal(
        <div className="usage-popover" style={{ position: 'fixed', top: usagePopover.y, left: usagePopover.x }} onClick={(e) => e.stopPropagation()}>
          {(() => {
            const row = rows.find(r => r.path === usagePopover.path) ?? table.allRows.find((r: PoolRow) => r.path === usagePopover.path);
            const scoped = (row?.usageEntries ?? []).filter((e: PoolUsageEntry) => e.audible === (usagePopover.scope === 'audible'));
            return (
              <>
                <div className="usage-popover-header">
                  {usagePopover.scope === 'audible'
                    ? `Played in ${scoped.length} place${scoped.length > 1 ? 's' : ''}`
                    : `Referenced in ${scoped.length} place${scoped.length > 1 ? 's' : ''} but not triggered`}
                </div>
                <div className="usage-popover-list">
                  {scoped.map((entry, idx) => (
                    <div key={idx} className="usage-popover-entry">
                      {entry.kind === 'machine'
                        ? `${entry.project} · Bank ${BANK_LETTERS[entry.bank] ?? '?'} · Part ${(entry.part ?? 0) + 1} · T${entry.track + 1} · Machine`
                        : `${entry.project} · Bank ${BANK_LETTERS[entry.bank] ?? '?'} · Pattern ${(entry.pattern ?? 0) + 1} · T${entry.track + 1} · Step ${(entry.step ?? 0) + 1} · Lock`}
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>,
        document.body
      )}
    </>
  );
}

export function poolTableTsv(table: ReturnType<typeof usePoolTable>): string {
  const { rows, visibleColumns } = table;
  const value = (id: PoolSortColumn, r: PoolRow): string | number => {
    switch (id) {
      case 'file': return r.name;
      case 'format': return r.format;
      case 'bit': return r.bit ?? '';
      case 'khz': return r.khz != null ? (r.khz / 1000).toFixed(1) : '';
      case 'size': return r.size != null ? formatFileSize(r.size) : '';
      case 'location': return r.location;
      case 'action': return r.action;
      case 'slot': return r.slots.join(', ');
      case 'usage': {
        const audibleCount = r.usageEntries.filter(e => e.audible).length;
        const referencedCount = r.usageEntries.length - audibleCount;
        return `${audibleCount} played, ${referencedCount} referenced`;
      }
    }
  };
  return [
    visibleColumns.map(c => c.label).join('\t'),
    ...rows.map(r => visibleColumns.map(c => value(c.id, r)).join('\t')),
  ].join('\n');
}

/** Filter badges + reset button shown in the modal header when filters are active. */
export function FilterBadges({ table }: { table: ReturnType<typeof usePoolTable> }) {
  const { formatFilter, bitFilter, khzFilter, usageFilter, hasActiveFilters, resetFilters } = table;
  if (!hasActiveFilters) return null;
  return (
    <>
      {formatFilter !== 'all' && <span className="filter-badge">Format: {formatFilter}</span>}
      {bitFilter !== 'all' && <span className="filter-badge">Bit: {bitFilter}</span>}
      {khzFilter !== 'all' && <span className="filter-badge">kHz: {(Number(khzFilter) / 1000).toFixed(1)}</span>}
      {usageFilter !== 'all' && <span className="filter-badge">Usage: {usageFilter === 'used' ? 'Used' : usageFilter === 'referenced' ? 'Referenced' : 'Unused'}</span>}
      <button className="reset-filters-btn" onClick={resetFilters} title="Reset all filters">✕ Reset</button>
    </>
  );
}

/**
 * Read-only list of the incompatible pool files found by the Tools tab scan —
 * same look as the project's Missing Samples list modal.
 */
export function PoolIncompatibleListModal({ poolPath, files, onClose }: {
  poolPath: string;
  files: IncompatibleFile[];
  onClose: () => void;
}) {
  const table = usePoolTable(files, poolPath, false);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-content missing-samples-list-modal pool-list-modal"
        onClick={(e) => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className="modal-header missing-samples-header">
          <h3><i className="fas fa-list"></i> Incompatible Audio Pool Samples</h3>
          <div className="missing-samples-header-info">
            <span className="missing-samples-header-count">Showing {table.rows.length} of {files.length} files</span>
            <FilterBadges table={table} />
          </div>
          <HeaderActions
            searchText={table.searchText}
            setSearchText={table.setSearchText}
            onCopy={() => copy(poolTableTsv(table))}
            copyFeedback={copyFeedback}
            columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={(id) => table.toggleCol(id as PoolSortColumn)} />}
          />
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {/* Plain wrapper — the page-level .samples-tab class pins itself to viewport
              height, which would leave a tall empty body inside a modal */}
          <div className="table-wrapper">
            <PoolFilesTable table={table} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  /** Absolute path of the Set's AUDIO directory. */
  poolPath: string;
  /** Incompatible files to convert. */
  files: IncompatibleFile[];
  /** Skip the review screen and start converting immediately. */
  skipReview?: boolean;
  onClose: () => void;
  /** Called once a fix run finished so callers can refresh their listings. */
  onFixed?: (result: PoolFixResult) => void;
}

type Phase = 'review' | 'converting' | 'done' | 'error';

/**
 * Fix Audio Pool Samples: converts pool files the Octatrack cannot play to
 * 44.1 kHz 16/24-bit WAV in place (originals replaced), then repoints sample-slot
 * references across every project of the Set (each project file is backed up first).
 * Mirrors the Fix Missing Samples review/apply flow.
 */
export function FixPoolFilesModal({ poolPath, files, skipReview = false, onClose, onFixed }: Props) {
  const [phase, setPhase] = useState<Phase>(skipReview ? 'converting' : 'review');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [currentFile, setCurrentFile] = useState<string>('');
  const [fileProgress, setFileProgress] = useState<number>(0);
  const [result, setResult] = useState<PoolFixResult | null>(null);
  const transferIdRef = useRef<string>(`fix-pool-${Date.now()}`);
  const startedRef = useRef(false);

  // Location is hidden by default here - the Action column matters most for review
  const table = usePoolTable(files, poolPath, true, ['location']);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();

  const relName = (path: string) =>
    path.startsWith(poolPath) ? path.slice(poolPath.length).replace(/^[/\\]/, '') : path;

  // Per-file conversion progress
  useEffect(() => {
    if (phase !== 'converting') return;
    let unlisten: (() => void) | undefined;
    listen<CopyProgressEvent>('copy-progress', (event) => {
      if (event.payload.transfer_id !== transferIdRef.current) return;
      setCurrentFile(event.payload.file_path);
      setFileProgress(event.payload.progress);
    }).then(fn => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [phase]);

  // Run the fix whenever the converting phase is entered (Apply Changes, or
  // immediately on mount when the review step is skipped)
  useEffect(() => {
    if (phase !== 'converting' || startedRef.current) return;
    startedRef.current = true;
    setCurrentFile(files[0]?.path ?? '');
    setFileProgress(0);
    invoke<PoolFixResult>('fix_pool_files', {
      poolPath,
      filePaths: files.map(f => f.path),
      transferId: transferIdRef.current,
    })
      .then(res => {
        setResult(res);
        setPhase('done');
        onFixed?.(res);
      })
      .catch(e => {
        setErrorMsg(String(e));
        setPhase('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleCancelConvert() {
    invoke('cancel_audio_transfer', { transferId: transferIdRef.current }).catch(() => {});
  }

  const converting = phase === 'converting';
  const convertingIndex = converting
    ? Math.max(0, files.findIndex(f => f.path === currentFile))
    : 0;
  const failed = result?.outcomes.filter(o => o.error) ?? [];
  const converted = result?.outcomes.filter(o => !o.error) ?? [];

  return (
    <div className="modal-overlay" onClick={phase !== 'converting' ? onClose : undefined}>
      <div
        ref={modalRef}
        className="modal-content fix-missing-modal fix-pool-modal"
        onClick={(e) => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className={`modal-header${phase === 'review' ? ' missing-samples-header' : ''}`}>
          <h3>
            {phase === 'review' && <><i className="fas fa-clipboard-check"></i> Review planned changes - {files.length} incompatible audio file{files.length === 1 ? '' : 's'}</>}
            {phase === 'converting' && <><i className="fas fa-wrench" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Fixing Audio Pool Samples...</>}
            {phase === 'done' && <><i className="fas fa-wrench" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Fix Audio Pool Samples</>}
            {phase === 'error' && 'Error'}
          </h3>
          {phase === 'review' && (
            <>
              <div className="missing-samples-header-info">
                <span className="missing-samples-header-count">Showing {table.rows.length} of {files.length} files</span>
                <FilterBadges table={table} />
              </div>
              <HeaderActions
                searchText={table.searchText}
                setSearchText={table.setSearchText}
                onCopy={() => copy(poolTableTsv(table))}
                copyFeedback={copyFeedback}
                columnToggle={<ColumnToggle columns={table.allColumns} hiddenCols={table.hiddenCols} onToggle={(id) => table.toggleCol(id as PoolSortColumn)} />}
              />
            </>
          )}
          {!converting && <button className="modal-close" onClick={onClose}>×</button>}
        </div>
        <div className={`modal-body${phase === 'review' ? ' fix-confirm-body' : ''}`}>
          {phase === 'review' && (
            <div className="fix-confirmation">
              <div className="fix-confirm-table-wrapper">
                <PoolFilesTable table={table} />
              </div>
              {/* Same bottom as the fix-missing search modal */}
              <div className="fix-progress-section">
                <div className="fix-done-actions">
                  <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button className="tools-execute-btn" onClick={() => setPhase('converting')}>
                    Apply Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {converting && (
            <div className="fix-pool-progress">
              <p>
                Converting {convertingIndex + 1} / {files.length}:{' '}
                <span className="fix-pool-current-file" title={currentFile}>{relName(currentFile)}</span>
              </p>
              <div className="copy-progress-bar">
                <div className="copy-progress-bar-fill" style={{ width: `${Math.round(fileProgress * 100)}%` }}></div>
              </div>
              <div className="fix-done-actions">
                <button className="fix-cancel-btn" onClick={handleCancelConvert}>Cancel</button>
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="fix-pool-summary">
              <p>
                <i className="fas fa-check" style={{ color: '#2ecc71', marginRight: '0.5rem' }}></i>
                {converted.length} file{converted.length === 1 ? '' : 's'} converted.
                {result.slots_updated > 0 && (
                  <> {result.slots_updated} sample slot{result.slots_updated === 1 ? '' : 's'} updated
                    {' '}across {result.projects_updated.length} project{result.projects_updated.length === 1 ? '' : 's'} (backed up first).</>
                )}
              </p>
              {failed.length > 0 && (
                <div className="fix-done-error">
                  <p>{failed.length} file{failed.length === 1 ? '' : 's'} could not be converted:</p>
                  <ul>
                    {failed.map(f => (
                      <li key={f.old_path} title={f.old_path}>{relName(f.old_path)} - {f.error}</li>
                    ))}
                  </ul>
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
