import { useState, useEffect, useRef, useLayoutEffect, useTransition, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type ColumnOrderState,
  type ColumnSizingState,
  type SortingFn,
} from "@tanstack/react-table";
import { useDraggable } from "@dnd-kit/core";
import type { AudioFile } from "../types/audioFile";

export type SortColumn = 'name' | 'size' | 'format' | 'bitrate' | 'samplerate';
export type SortDirection = 'asc' | 'desc';

export function getFileFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return '';
  switch (ext) {
    case 'wav': return 'WAV';
    case 'aif':
    case 'aiff': return 'AIF';
    case 'mp3': return 'MP3';
    case 'flac': return 'FLAC';
    case 'ogg': return 'OGG';
    case 'm4a': return 'M4A';
    default: return '';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Pointer-based drag row — fixes macOS WebKit HTML5 drag restriction
function DraggableFileRow({
  file,
  originalIndex,
  selectedFiles,
  isCursor,
  onFileClick,
  onFileDoubleClick,
  onContextMenu,
  rowRefs,
  children,
}: {
  file: AudioFile;
  originalIndex: number;
  selectedFiles: Set<string>;
  isCursor: boolean;
  onFileClick: (file: AudioFile, index: number, e: React.MouseEvent) => void;
  onFileDoubleClick?: (file: AudioFile, index: number, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, file: AudioFile | null) => void;
  rowRefs?: React.MutableRefObject<Map<number, HTMLTableRowElement>>;
  children: React.ReactNode;
}) {
  // Directories are draggable too (dropping one onto a slot assigns its audio files,
  // expanded recursively). Click still navigates — dnd-kit only starts a drag past 5px.
  const dragFiles = selectedFiles.has(file.path) ? Array.from(selectedFiles) : [file.path];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `audio-file:${file.path}`,
    data: { source: 'audio-pool-sidebar', files: dragFiles },
  });

  return (
    <tr
      ref={(el) => {
        setNodeRef(el);
        if (rowRefs && el) rowRefs.current.set(originalIndex, el);
      }}
      className={`${selectedFiles.has(file.path) ? 'selected' : ''} ${isCursor ? 'cursor' : ''}`}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: file.is_directory ? 'pointer' : 'grab' }}
      onClick={(e) => onFileClick(file, originalIndex, e)}
      onDoubleClick={(e) => onFileDoubleClick?.(file, originalIndex, e)}
      onContextMenu={(e) => onContextMenu?.(e, file)}
      {...attributes}
      {...listeners}
    >
      {children}
    </tr>
  );
}

export interface AudioFileTableProps {
  files: AudioFile[];
  selectedFiles: Set<string>;
  onFileClick: (file: AudioFile, index: number, event: React.MouseEvent) => void;
  /** Double-click a row (e.g. to enter a directory when single-click only selects). */
  onFileDoubleClick?: (file: AudioFile, index: number, event: React.MouseEvent) => void;
  isLoading: boolean;
  emptyMessage: string;
  onEmptyClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  tableId: string;
  cursorIndex?: number;
  isActive?: boolean;
  onPanelClick?: () => void;
  onContextMenu?: (e: React.MouseEvent, file: AudioFile | null) => void;
  rowRefs?: React.MutableRefObject<Map<number, HTMLTableRowElement>>;
  headerPrefix?: ReactNode;
  /** Extra controls rendered in the toolbar, just left of the Show/Hide Columns button */
  headerActions?: ReactNode;
  /** When true, rows use @dnd-kit pointer-based drag instead of HTML5 drag (fixes macOS WebKit) */
  dndMode?: boolean;
  /** Initial column visibility — columns not listed default to visible */
  initialColumnVisibility?: Record<string, boolean>;
  /** When set, the vertical scroll position is remembered in sessionStorage under this key */
  scrollStorageKey?: string;
  /**
   * Audio Pool root. When set, name cells show the path relative to this root on hover.
   * Omit for plain name-only hover titles (e.g. the Source pane).
   */
  poolRoot?: string;
  /**
   * Directory to search under. When set, the search box matches recursively across this
   * directory and all its subfolders. Omit for plain single-directory, name-only filtering.
   */
  searchRoot?: string;
  /** Reports the freshly inspected OT-compatibility map (path -> compatibility). */
  onCompatMap?: (map: Record<string, string>) => void;
}

/** Path relative to the Audio Pool root, prefixed "AUDIO/" — used for hover titles. */
function relativeToPool(filePath: string, poolRoot: string): string {
  if (!filePath.startsWith(poolRoot)) return filePath;
  const rel = filePath.slice(poolRoot.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
  return rel ? `AUDIO/${rel}` : 'AUDIO/';
}

const DEFAULT_COLUMN_SIZES: Record<string, number> = {
  name: 200, compat: 60, format: 90, bitrate: 70, samplerate: 75, size: 80,
};
const MIN_COLUMN_SIZES: Record<string, number> = {
  name: 80, compat: 45, format: 60, bitrate: 50, samplerate: 55, size: 55,
};
const COLUMN_LABELS: Record<string, string> = {
  name: 'Name', compat: 'Compat', format: 'Format', bitrate: 'Bit', samplerate: 'kHz', size: 'Size',
};

// Same OT-style compatibility badge as the Sample Slots table
export function CompatBadge({ compatibility }: { compatibility: string | undefined }) {
  switch (compatibility) {
    case 'compatible':
      return <span className="compat-badge compat-compatible" title="Compatible (WAV/AIFF, 16/24-bit, 44.1kHz)">:)</span>;
    case 'wrong_rate':
      return <span className="compat-badge compat-wrong-rate" title="Wrong sample rate (plays at wrong speed)">:|</span>;
    case 'incompatible':
      return <span className="compat-badge compat-incompatible" title="Incompatible bit depth">:(</span>;
    case 'unsupported_format':
      return <span className="compat-badge compat-unknown" title="Audio format the Octatrack cannot play (convert to WAV)">??</span>;
    case 'unknown':
      return <span className="compat-badge compat-unknown" title="Unrecognized format (not WAV or AIFF)">??</span>;
    default:
      return null;
  }
}

/**
 * Classify a file by extension for OT-compatibility purposes:
 * 'native' (WAV/AIFF — needs header inspection for rate/depth),
 * 'other-audio' (audio the OT cannot play — mp3, flac, ...), or null (not audio).
 */
export function audioKind(name: string): 'native' | 'other-audio' | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (['wav', 'aif', 'aiff'].includes(ext)) return 'native';
  if (['mp3', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return 'other-audio';
  return null;
}

// Directories always first, then sort within each group
const dirFirstSort: SortingFn<AudioFile> = (rowA, rowB, columnId) => {
  const aDir = rowA.original.is_directory;
  const bDir = rowB.original.is_directory;
  if (aDir && !bDir) return -1;
  if (!aDir && bDir) return 1;
  const a = rowA.getValue<string | number>(columnId) ?? '';
  const b = rowB.getValue<string | number>(columnId) ?? '';
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
};

export function AudioFileTable({
  files,
  selectedFiles,
  onFileClick,
  onFileDoubleClick,
  isLoading,
  emptyMessage,
  onEmptyClick,
  draggable = false,
  onDragStart,
  onDragEnd,
  tableId,
  cursorIndex = -1,
  isActive = false,
  onPanelClick,
  onContextMenu,
  rowRefs,
  headerPrefix,
  headerActions,
  dndMode = false,
  initialColumnVisibility,
  scrollStorageKey,
  poolRoot,
  searchRoot,
  onCompatMap,
}: AudioFileTableProps) {
  // Pre-filter state (applied before TanStack)
  const [searchText, setSearchText] = useState('');
  const [hideDirectories, setHideDirectories] = useState(false);
  const [hideDirectoriesVisual, setHideDirectoriesVisual] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [bitDepthFilter, setBitDepthFilter] = useState<string>('all');
  const [sampleRateFilter, setSampleRateFilter] = useState<string>('all');

  // Recursive search: when a searchRoot is set and the user is searching, match across that
  // directory and all its subfolders instead of just the current level. Fetched once when
  // search turns on (and when the directory changes), then filtered client-side as you type.
  const searchActive = searchText.trim().length > 0;
  const [recursiveFiles, setRecursiveFiles] = useState<AudioFile[] | null>(null);
  const [recursiveLoading, setRecursiveLoading] = useState(false);
  useEffect(() => {
    if (!searchRoot || !searchActive) {
      setRecursiveFiles(null);
      setRecursiveLoading(false);
      return;
    }
    let cancelled = false;
    setRecursiveLoading(true);
    invoke<AudioFile[]>("list_audio_directory_recursive", { path: searchRoot })
      .then(r => { if (!cancelled) setRecursiveFiles(r); })
      .catch(() => { if (!cancelled) setRecursiveFiles(null); }) // no Tauri (e2e) → plain search
      .finally(() => { if (!cancelled) setRecursiveLoading(false); });
    return () => { cancelled = true; };
  }, [searchRoot, searchActive]);

  // While a recursive search is resolved, browse that flattened list; otherwise the current dir.
  const baseFiles = searchRoot && searchActive && recursiveFiles ? recursiveFiles : files;

  // OT compatibility per file path. Only WAV/AIFF need header inspection (rate/depth);
  // other audio formats are unplayable by definition and non-audio files get no badge.
  // Recomputed from scratch on every files change so in-place conversions refresh.
  // Pool views only (poolRoot set): the plain file browser pane doesn't need it.
  const [compatMap, setCompatMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!poolRoot) return;
    const audioFiles = baseFiles.filter(f => !f.is_directory);
    const base: Record<string, string> = {};
    for (const f of audioFiles) {
      if (audioKind(f.name) === 'other-audio') base[f.path] = 'unsupported_format';
    }
    const nativePaths = audioFiles.filter(f => audioKind(f.name) === 'native').map(f => f.path);
    if (nativePaths.length === 0) {
      setCompatMap(base);
      onCompatMap?.(base);
      return;
    }
    let cancelled = false;
    Promise.resolve(invoke<{ path: string; compatibility: string }[]>('inspect_audio_files', { paths: nativePaths }))
      .then(results => {
        if (cancelled || !Array.isArray(results)) return;
        const next = { ...base };
        for (const r of results) next[r.path] = r.compatibility;
        setCompatMap(next);
        onCompatMap?.(next);
      })
      .catch(() => {}); // no Tauri (e2e without mock) → column stays empty
    return () => { cancelled = true; };
  }, [baseFiles, poolRoot]);

  // Dropdown state — use portal + position to avoid clipping issues
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  // TanStack column state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialColumnVisibility ?? {});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(['name', 'compat', 'format', 'bitrate', 'samplerate', 'size']);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const columnMenuRef = useRef<HTMLDivElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(
    scrollStorageKey ? Number(sessionStorage.getItem(scrollStorageKey)) || 0 : 0
  );
  const prevFilesRef = useRef<AudioFile[]>(files);

  // Save/restore scroll position across file list updates (and across navigation when keyed)
  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    const handleScroll = () => {
      scrollPositionRef.current = wrapper.scrollTop;
      if (scrollStorageKey) sessionStorage.setItem(scrollStorageKey, String(wrapper.scrollTop));
    };
    wrapper.addEventListener('scroll', handleScroll);
    return () => wrapper.removeEventListener('scroll', handleScroll);
  }, [scrollStorageKey]);
  useLayoutEffect(() => {
    if (prevFilesRef.current !== files && tableWrapperRef.current && scrollPositionRef.current > 0) {
      tableWrapperRef.current.scrollTop = scrollPositionRef.current;
    }
    prevFilesRef.current = files;
  }, [files]);

  // Close filter dropdown when clicking outside (portal-aware)
  useEffect(() => {
    if (!openDropdown) return;
    const timeoutId = setTimeout(() => {
      function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.filter-dropdown') && !target.closest('.filter-icon')) {
          setOpenDropdown(null);
          setDropdownPosition(null);
        }
      }
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [openDropdown]);

  // Close column visibility menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Open filter dropdown — calculate position from the button's bounding rect
  function handleFilterButtonClick(e: React.MouseEvent, dropdownKey: string) {
    e.stopPropagation();
    if (openDropdown === dropdownKey) {
      setOpenDropdown(null);
      setDropdownPosition(null);
      return;
    }
    const button = e.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    setDropdownPosition({ top: rect.bottom + 4, left: rect.right - 120 });
    setOpenDropdown(dropdownKey);
  }

  // Unique values for filter options (derived from full file list, not filtered)
  const uniqueFormats = useMemo(() => {
    const s = new Set<string>();
    files.forEach(f => { if (!f.is_directory) { const fmt = getFileFormat(f.name); if (fmt) s.add(fmt); } });
    return Array.from(s).sort();
  }, [files]);
  const uniqueSampleRates = useMemo(() => {
    const s = new Set<number>();
    files.forEach(f => { if (f.sample_rate != null) s.add(f.sample_rate); });
    return Array.from(s).sort((a, b) => a - b);
  }, [files]);
  const uniqueBitDepths = useMemo(() => {
    const s = new Set<number>();
    files.forEach(f => { if (f.bit_rate != null) s.add(f.bit_rate); });
    return Array.from(s).sort((a, b) => a - b);
  }, [files]);

  // Pre-filter before passing to TanStack
  const filteredData = useMemo(() => baseFiles.filter(file => {
    if (hideDirectories && file.is_directory) return false;
    if (searchText && !file.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (formatFilter !== 'all' && getFileFormat(file.name) !== formatFilter) return false;
    if (bitDepthFilter !== 'all' && file.bit_rate?.toString() !== bitDepthFilter) return false;
    if (sampleRateFilter !== 'all' && file.sample_rate?.toString() !== sampleRateFilter) return false;
    return true;
  }), [baseFiles, hideDirectories, searchText, formatFilter, bitDepthFilter, sampleRateFilter]);

  const columns = useMemo<ColumnDef<AudioFile>[]>(() => [
    { id: 'name', accessorKey: 'name', header: 'Name', size: DEFAULT_COLUMN_SIZES.name, minSize: MIN_COLUMN_SIZES.name, sortingFn: dirFirstSort },
    // Compat column only in pool views — the plain file browser pane skips inspection
    ...(poolRoot ? [{ id: 'compat', accessorFn: (row: AudioFile) => (!row.is_directory ? (compatMap[row.path] ?? '') : ''), header: 'Compat', size: DEFAULT_COLUMN_SIZES.compat, minSize: MIN_COLUMN_SIZES.compat, sortingFn: dirFirstSort } as ColumnDef<AudioFile>] : []),
    { id: 'format', accessorFn: (row) => (!row.is_directory ? getFileFormat(row.name) : ''), header: 'Format', size: DEFAULT_COLUMN_SIZES.format, minSize: MIN_COLUMN_SIZES.format, sortingFn: dirFirstSort },
    { id: 'bitrate', accessorKey: 'bit_rate', header: 'Bit', size: DEFAULT_COLUMN_SIZES.bitrate, minSize: MIN_COLUMN_SIZES.bitrate, sortingFn: dirFirstSort },
    { id: 'samplerate', accessorKey: 'sample_rate', header: 'kHz', size: DEFAULT_COLUMN_SIZES.samplerate, minSize: MIN_COLUMN_SIZES.samplerate, sortingFn: dirFirstSort },
    { id: 'size', accessorKey: 'size', header: 'Size', size: DEFAULT_COLUMN_SIZES.size, minSize: MIN_COLUMN_SIZES.size, sortingFn: dirFirstSort },
  ], [compatMap, poolRoot]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, columnVisibility, columnOrder, columnSizing },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    sortingFns: { dirFirst: dirFirstSort },
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const cursorFile = cursorIndex >= 0 && cursorIndex < files.length ? files[cursorIndex] : null;

  // Cell content per column
  function renderCell(colId: string, file: AudioFile) {
    const w = table.getColumn(colId)?.getSize();
    switch (colId) {
      case 'name':
        return (
          <td key={colId} className="col-name" title={poolRoot ? relativeToPool(file.path, poolRoot) : file.name}
            style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {file.is_directory ? <i className="fas fa-folder folder-icon"></i> : ''}
            <span className="file-name-text">{file.name}</span>
          </td>
        );
      case 'compat':
        return (
          <td key={colId} className="col-compat" style={{ width: w }}>
            {!file.is_directory && <CompatBadge compatibility={compatMap[file.path]} />}
          </td>
        );
      case 'format':
        return <td key={colId} className="col-format" style={{ width: w }}>{file.is_directory ? '' : getFileFormat(file.name)}</td>;
      case 'bitrate':
        return <td key={colId} className="col-bitrate" style={{ width: w }}>{file.bit_rate || ''}</td>;
      case 'samplerate':
        return <td key={colId} className="col-samplerate" style={{ width: w }}>{file.sample_rate ? `${(file.sample_rate / 1000).toFixed(1)}` : ''}</td>;
      case 'size':
        return <td key={colId} className="col-size" style={{ width: w }}>{file.size ? formatFileSize(file.size) : ''}</td>;
      default:
        return null;
    }
  }

  // Column header drag-to-reorder (HTML5, avoids dnd-kit context conflicts)
  function handleColDragStart(e: React.DragEvent, colId: string) {
    e.dataTransfer.setData('text/plain', colId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleColDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColId(colId);
  }
  function handleColDrop(e: React.DragEvent, targetColId: string) {
    e.preventDefault();
    setDragOverColId(null);
    const sourceColId = e.dataTransfer.getData('text/plain');
    if (!sourceColId || sourceColId === targetColId) return;
    const order = table.getAllLeafColumns().map(c => c.id);
    const from = order.indexOf(sourceColId);
    const to = order.indexOf(targetColId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, sourceColId);
    table.setColumnOrder(next);
  }
  function handleColDragLeave() { setDragOverColId(null); }

  // Portal-rendered filter dropdown content
  function renderFilterDropdown(dropdownKey: string, colId: string) {
    if (openDropdown !== dropdownKey || !dropdownPosition) return null;
    return createPortal(
      <div className="filter-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
        <div className="dropdown-options">
          {colId === 'format' && (
            <>
              <label className="dropdown-option"><input type="radio" name={dropdownKey} checked={formatFilter === 'all'} onChange={() => setFormatFilter('all')} /><span>All</span></label>
              {uniqueFormats.map(fmt => (
                <label key={fmt} className="dropdown-option"><input type="radio" name={dropdownKey} checked={formatFilter === fmt} onChange={() => setFormatFilter(fmt)} /><span>{fmt}</span></label>
              ))}
            </>
          )}
          {colId === 'bitrate' && (
            <>
              <label className="dropdown-option"><input type="radio" name={dropdownKey} checked={bitDepthFilter === 'all'} onChange={() => setBitDepthFilter('all')} /><span>All</span></label>
              {uniqueBitDepths.map(d => (
                <label key={d} className="dropdown-option"><input type="radio" name={dropdownKey} checked={bitDepthFilter === d.toString()} onChange={() => setBitDepthFilter(d.toString())} /><span>{d}-bit</span></label>
              ))}
            </>
          )}
          {colId === 'samplerate' && (
            <>
              <label className="dropdown-option"><input type="radio" name={dropdownKey} checked={sampleRateFilter === 'all'} onChange={() => setSampleRateFilter('all')} /><span>All</span></label>
              {uniqueSampleRates.map(r => (
                <label key={r} className="dropdown-option"><input type="radio" name={dropdownKey} checked={sampleRateFilter === r.toString()} onChange={() => setSampleRateFilter(r.toString())} /><span>{(r / 1000).toFixed(1)} kHz</span></label>
              ))}
            </>
          )}
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div
      className="audio-file-table-container"
      onClick={onPanelClick}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('tr')) return;
        onContextMenu?.(e, null);
      }}
    >
      {/* Toolbar row */}
      <div className="filter-results-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {headerPrefix}
          <span>{table.getRowModel().rows.length}/{baseFiles.length} files</span>
          {formatFilter !== 'all' && <span className="filter-badge">Format: {formatFilter}</span>}
          {bitDepthFilter !== 'all' && <span className="filter-badge">Bit: {bitDepthFilter}</span>}
          {sampleRateFilter !== 'all' && <span className="filter-badge">Rate: {(parseInt(sampleRateFilter) / 1000).toFixed(1)}kHz</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="header-search-container">
            <input
              type="text"
              placeholder="Search..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="header-search-input"
            />
            {recursiveLoading
              ? <span className="header-search-spinner" title="Searching subfolders…" />
              : searchText && (
                  <button className="header-search-clear" onClick={() => setSearchText('')} title="Clear search">×</button>
                )}
          </div>
          <label className={`toggle-switch ${isPending ? 'pending' : ''}`} title="Hide folders from the file list">
            <span className="toggle-label">Hide folders</span>
            <div className="toggle-slider-container">
              <input
                type="checkbox"
                checked={hideDirectoriesVisual}
                onChange={(e) => {
                  const v = e.target.checked;
                  setHideDirectoriesVisual(v);
                  startTransition(() => setHideDirectories(v));
                }}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>
          {headerActions}
          {/* Column visibility toggle — positioned to the right of the Hide folders field */}
          <div className="column-menu-wrapper" ref={columnMenuRef}>
            <button
              className={`column-visibility-btn ${showColumnMenu ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowColumnMenu(v => !v); }}
              title="Show/Hide Columns"
            >
              ☰
            </button>
            {showColumnMenu && (
              <div className="column-visibility-dropdown">
                <div className="column-visibility-header">Show/Hide Columns</div>
                <div className="dropdown-options">
                  {table.getAllLeafColumns().map(col => (
                    <label key={col.id} className="dropdown-option">
                      <input type="checkbox" checked={col.getIsVisible()} onChange={col.getToggleVisibilityHandler()} />
                      <span>{COLUMN_LABELS[col.id] ?? col.id}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper" ref={tableWrapperRef}>
        <table
          className="audio-files-table"
          style={{ width: '100%' }}
        >
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => {
                  const colId = header.id;
                  const sortState = header.column.getIsSorted();
                  const isFilterable = ['format', 'bitrate', 'samplerate'].includes(colId);
                  const hasActiveFilter =
                    (colId === 'format' && formatFilter !== 'all') ||
                    (colId === 'bitrate' && bitDepthFilter !== 'all') ||
                    (colId === 'samplerate' && sampleRateFilter !== 'all');
                  const dropdownKey = `${tableId}-${colId}`;
                  return (
                    <th
                      key={header.id}
                      className={`filterable-header col-${colId}${dragOverColId === colId ? ' col-drag-over' : ''}`}
                      style={{ ...(colId !== 'name' ? { width: header.getSize() } : {}), position: 'relative', userSelect: 'none' }}
                      onDragOver={(e) => handleColDragOver(e, colId)}
                      onDrop={(e) => handleColDrop(e, colId)}
                      onDragLeave={handleColDragLeave}
                    >
                      <div className="header-content" onClick={() => header.column.toggleSorting()}
                        draggable
                        onDragStart={(e) => handleColDragStart(e, colId)}
                        style={{ cursor: 'grab' }}
                      >
                        <span className="sortable-label">
                          {typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : colId}
                        </span>
                        {sortState && <span className="sort-indicator">{sortState === 'asc' ? '▲' : '▼'}</span>}
                        {isFilterable && (
                          <button
                            className={`filter-icon ${openDropdown === dropdownKey || hasActiveFilter ? 'active' : ''}`}
                            onClick={(e) => handleFilterButtonClick(e, dropdownKey)}
                          >
                            ⋮
                          </button>
                        )}
                      </div>
                      {isFilterable && renderFilterDropdown(dropdownKey, colId)}
                      {/* Column resize handle */}
                      <div
                        className={`col-resize-handle${header.column.getIsResizing() ? ' isResizing' : ''}`}
                        onMouseDown={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                        onTouchStart={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={visibleColumns.length} style={{ textAlign: 'center', opacity: 0.5 }}>Loading...</td></tr>
            )}
            {!isLoading && table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length}
                  style={{ textAlign: 'center', opacity: 0.5, cursor: onEmptyClick ? 'pointer' : 'default' }}
                  onClick={onEmptyClick}>
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!isLoading && table.getRowModel().rows.map((row) => {
              const file = row.original;
              const isCursor = isActive && cursorFile?.path === file.path;
              // ponytail: index into the parent's current-dir list; -1 for subfolder hits shown
              // during a recursive search (plain click still selects by path; shift-range and
              // arrow-key nav stay scoped to the current directory until you navigate into it).
              const originalIndex = files.findIndex(f => f.path === file.path);
              const cells = <>{visibleColumns.map(col => renderCell(col.id, file))}</>;

              if (dndMode && draggable) {
                return (
                  <DraggableFileRow
                    key={file.path}
                    file={file}
                    originalIndex={originalIndex}
                    selectedFiles={selectedFiles}
                    isCursor={isCursor}
                    onFileClick={onFileClick}
                    onFileDoubleClick={onFileDoubleClick}
                    onContextMenu={onContextMenu}
                    rowRefs={rowRefs}
                  >
                    {cells}
                  </DraggableFileRow>
                );
              }
              return (
                <tr
                  key={file.path}
                  ref={(el) => { if (rowRefs && el) rowRefs.current.set(originalIndex, el); }}
                  className={`${selectedFiles.has(file.path) ? 'selected' : ''} ${isCursor ? 'cursor' : ''}`}
                  onClick={(e) => onFileClick(file, originalIndex, e)}
                  onDoubleClick={(e) => onFileDoubleClick?.(file, originalIndex, e)}
                  onContextMenu={(e) => onContextMenu?.(e, file)}
                  draggable={draggable && selectedFiles.has(file.path)}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  style={{ cursor: draggable && selectedFiles.has(file.path) ? 'grab' : 'pointer' }}
                >
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
