import { useState, useEffect, useRef, useLayoutEffect, useTransition, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  onContextMenu,
  rowRefs,
  children,
}: {
  file: AudioFile;
  originalIndex: number;
  selectedFiles: Set<string>;
  isCursor: boolean;
  onFileClick: (file: AudioFile, index: number, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, file: AudioFile | null) => void;
  rowRefs?: React.MutableRefObject<Map<number, HTMLTableRowElement>>;
  children: React.ReactNode;
}) {
  const dragFiles = selectedFiles.has(file.path) ? Array.from(selectedFiles) : [file.path];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `audio-file:${file.path}`,
    data: { source: 'audio-pool-sidebar', files: dragFiles },
    disabled: file.is_directory,
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
      onContextMenu={(e) => onContextMenu?.(e, file)}
      {...(file.is_directory ? {} : { ...attributes, ...listeners })}
    >
      {children}
    </tr>
  );
}

export interface AudioFileTableProps {
  files: AudioFile[];
  selectedFiles: Set<string>;
  onFileClick: (file: AudioFile, index: number, event: React.MouseEvent) => void;
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
  /** When true, rows use @dnd-kit pointer-based drag instead of HTML5 drag (fixes macOS WebKit) */
  dndMode?: boolean;
}

const DEFAULT_COLUMN_SIZES: Record<string, number> = {
  name: 200, format: 60, bitrate: 50, samplerate: 60, size: 80,
};
const MIN_COLUMN_SIZES: Record<string, number> = {
  name: 80, format: 40, bitrate: 35, samplerate: 40, size: 50,
};
const COLUMN_LABELS: Record<string, string> = {
  name: 'Name', format: 'Format', bitrate: 'Bit', samplerate: 'kHz', size: 'Size',
};

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
  dndMode = false,
}: AudioFileTableProps) {
  // Pre-filter state (applied before TanStack)
  const [searchText, setSearchText] = useState('');
  const [hideDirectories, setHideDirectories] = useState(false);
  const [hideDirectoriesVisual, setHideDirectoriesVisual] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [bitDepthFilter, setBitDepthFilter] = useState<string>('all');
  const [sampleRateFilter, setSampleRateFilter] = useState<string>('all');

  // Dropdown state — use portal + position to avoid clipping issues
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  // TanStack column state
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(['name', 'format', 'bitrate', 'samplerate', 'size']);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const columnMenuRef = useRef<HTMLDivElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const prevFilesRef = useRef<AudioFile[]>(files);

  // Save/restore scroll position across file list updates
  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    const handleScroll = () => { scrollPositionRef.current = wrapper.scrollTop; };
    wrapper.addEventListener('scroll', handleScroll);
    return () => wrapper.removeEventListener('scroll', handleScroll);
  }, []);
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
  const filteredData = useMemo(() => files.filter(file => {
    if (hideDirectories && file.is_directory) return false;
    if (searchText && !file.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (formatFilter !== 'all' && getFileFormat(file.name) !== formatFilter) return false;
    if (bitDepthFilter !== 'all' && file.bit_rate?.toString() !== bitDepthFilter) return false;
    if (sampleRateFilter !== 'all' && file.sample_rate?.toString() !== sampleRateFilter) return false;
    return true;
  }), [files, hideDirectories, searchText, formatFilter, bitDepthFilter, sampleRateFilter]);

  const columns = useMemo<ColumnDef<AudioFile>[]>(() => [
    { id: 'name', accessorKey: 'name', header: 'Name', size: DEFAULT_COLUMN_SIZES.name, minSize: MIN_COLUMN_SIZES.name, sortingFn: dirFirstSort },
    { id: 'format', accessorFn: (row) => (!row.is_directory ? getFileFormat(row.name) : ''), header: 'Format', size: DEFAULT_COLUMN_SIZES.format, minSize: MIN_COLUMN_SIZES.format, sortingFn: dirFirstSort },
    { id: 'bitrate', accessorKey: 'bit_rate', header: 'Bit', size: DEFAULT_COLUMN_SIZES.bitrate, minSize: MIN_COLUMN_SIZES.bitrate, sortingFn: dirFirstSort },
    { id: 'samplerate', accessorKey: 'sample_rate', header: 'kHz', size: DEFAULT_COLUMN_SIZES.samplerate, minSize: MIN_COLUMN_SIZES.samplerate, sortingFn: dirFirstSort },
    { id: 'size', accessorKey: 'size', header: 'Size', size: DEFAULT_COLUMN_SIZES.size, minSize: MIN_COLUMN_SIZES.size, sortingFn: dirFirstSort },
  ], []);

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
          <td key={colId} className="col-name" title={file.name}
            style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {file.is_directory ? <i className="fas fa-folder folder-icon"></i> : ''}
            <span className="file-name-text">{file.name}</span>
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
          <span>{table.getRowModel().rows.length}/{files.length} files</span>
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
            {searchText && (
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
          style={{ tableLayout: 'fixed', width: '100%', minWidth: table.getTotalSize() }}
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
                  onContextMenu={(e) => onContextMenu?.(e, file)}
                  draggable={draggable && !file.is_directory && selectedFiles.has(file.path)}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  style={{ cursor: file.is_directory ? 'pointer' : (draggable && selectedFiles.has(file.path) ? 'grab' : 'pointer') }}
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
