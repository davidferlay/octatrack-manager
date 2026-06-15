import { useState, useEffect, useRef, useLayoutEffect, useTransition, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { AudioFile } from "../types/audioFile";

// Inner component used when dndMode is enabled — pointer-based drag, cross-platform (fixes macOS WebKit)
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

export type SortColumn = 'name' | 'size' | 'format' | 'bitrate' | 'samplerate';
export type SortDirection = 'asc' | 'desc';

// Extract file format from filename (only for audio files)
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
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchText, setSearchText] = useState('');
  const [hideDirectories, setHideDirectories] = useState(false);
  const [hideDirectoriesVisual, setHideDirectoriesVisual] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [bitDepthFilter, setBitDepthFilter] = useState<string>('all');
  const [sampleRateFilter, setSampleRateFilter] = useState<string>('all');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const prevFilesRef = useRef<AudioFile[]>(files);

  // Save scroll position on scroll events
  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;

    const handleScroll = () => {
      scrollPositionRef.current = wrapper.scrollTop;
    };

    wrapper.addEventListener('scroll', handleScroll);
    return () => wrapper.removeEventListener('scroll', handleScroll);
  }, []);

  // Restore scroll position after files update using useLayoutEffect
  // This runs synchronously before browser paint
  useLayoutEffect(() => {
    // Only restore if files actually changed (refresh happened)
    if (prevFilesRef.current !== files && tableWrapperRef.current && scrollPositionRef.current > 0) {
      tableWrapperRef.current.scrollTop = scrollPositionRef.current;
    }
    prevFilesRef.current = files;
  }, [files]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Get unique values for filters
  const getUniqueFormats = () => {
    const formats = new Set<string>();
    files.forEach(file => {
      if (!file.is_directory) {
        const format = getFileFormat(file.name);
        if (format) {
          formats.add(format);
        }
      }
    });
    return Array.from(formats).sort();
  };

  const getUniqueSampleRates = () => {
    const rates = new Set<number>();
    files.forEach(file => {
      if (file.sample_rate !== null) {
        rates.add(file.sample_rate);
      }
    });
    return Array.from(rates).sort((a, b) => a - b);
  };

  const getUniqueBitDepths = () => {
    const depths = new Set<number>();
    files.forEach(file => {
      if (file.bit_rate !== null) {
        depths.add(file.bit_rate);
      }
    });
    return Array.from(depths).sort((a, b) => a - b);
  };

  // Filter files
  const filteredFiles = files.filter(file => {
    if (hideDirectories && file.is_directory) return false;
    if (searchText && !file.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (formatFilter !== 'all' && getFileFormat(file.name) !== formatFilter) return false;
    if (bitDepthFilter !== 'all' && file.bit_rate?.toString() !== bitDepthFilter) return false;
    if (sampleRateFilter !== 'all' && file.sample_rate?.toString() !== sampleRateFilter) return false;
    return true;
  });

  // Sort files (directories first, then by column)
  const sortedFiles = [...filteredFiles].sort((a, b) => {
    // Directories always first
    if (a.is_directory && !b.is_directory) return -1;
    if (!a.is_directory && b.is_directory) return 1;

    let compareA: string | number;
    let compareB: string | number;

    switch (sortColumn) {
      case 'name':
        compareA = a.name.toLowerCase();
        compareB = b.name.toLowerCase();
        break;
      case 'size':
        compareA = a.size || 0;
        compareB = b.size || 0;
        break;
      case 'format':
        compareA = getFileFormat(a.name);
        compareB = getFileFormat(b.name);
        break;
      case 'bitrate':
        compareA = a.bit_rate ?? -1;
        compareB = b.bit_rate ?? -1;
        break;
      case 'samplerate':
        compareA = a.sample_rate ?? -1;
        compareB = b.sample_rate ?? -1;
        break;
      default:
        return 0;
    }

    if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
    if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Find the file at cursorIndex in the original files array
  const cursorFile = cursorIndex >= 0 && cursorIndex < files.length ? files[cursorIndex] : null;

  return (
    <div className="audio-file-table-container" ref={dropdownRef} onClick={onPanelClick} onContextMenu={(e) => {
      // Only trigger if clicking on empty space (not on a file row)
      if ((e.target as HTMLElement).closest('tr')) return;
      onContextMenu?.(e, null);
    }}>
      <div className="filter-results-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {headerPrefix}
          <span>{sortedFiles.length}/{files.length} files</span>
          {formatFilter !== 'all' && <span className="filter-badge">Format: {formatFilter}</span>}
          {bitDepthFilter !== 'all' && <span className="filter-badge">Bit: {bitDepthFilter}</span>}
          {sampleRateFilter !== 'all' && <span className="filter-badge">Rate: {(parseInt(sampleRateFilter) / 1000).toFixed(1)}kHz</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="header-search-container">
            <input
              type="text"
              placeholder="Search..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="header-search-input"
            />
            {searchText && (
              <button
                className="header-search-clear"
                onClick={() => setSearchText('')}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <label className={`toggle-switch ${isPending ? 'pending' : ''}`} title="Hide folders from the file list">
            <span className="toggle-label">Hide folders</span>
            <div className="toggle-slider-container">
              <input
                type="checkbox"
                checked={hideDirectoriesVisual}
                onChange={(e) => {
                  const newValue = e.target.checked;
                  setHideDirectoriesVisual(newValue);
                  startTransition(() => {
                    setHideDirectories(newValue);
                  });
                }}
              />
              <span className="toggle-slider"></span>
            </div>
          </label>
        </div>
      </div>
      <div className="table-wrapper" ref={tableWrapperRef}>
        <table className="audio-files-table">
          <thead>
            <tr>
              <th className="filterable-header col-name">
                <div className="header-content">
                  <span onClick={() => handleSort('name')} className="sortable-label">
                    Name
                  </span>
                  <span className="sort-indicator sort-indicator-right" onClick={() => handleSort('name')}>
                    {sortColumn === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                </div>
              </th>
              <th className="filterable-header col-format">
                <div className="header-content">
                  <span className="sort-indicator" onClick={() => handleSort('format')}>
                    {sortColumn === 'format' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                  <span onClick={() => handleSort('format')} className="sortable-label">
                    Format
                  </span>
                  <button
                    className={`filter-icon ${openDropdown === `${tableId}-format` || formatFilter !== 'all' ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === `${tableId}-format` ? null : `${tableId}-format`);
                    }}
                  >
                    ⋮
                  </button>
                </div>
                {openDropdown === `${tableId}-format` && (
                  <div className="filter-dropdown">
                    <div className="dropdown-options">
                      <label className="dropdown-option">
                        <input
                          type="radio"
                          name={`${tableId}-format`}
                          checked={formatFilter === 'all'}
                          onChange={() => setFormatFilter('all')}
                        />
                        <span>All</span>
                      </label>
                      {getUniqueFormats().map((fmt) => (
                        <label key={fmt} className="dropdown-option">
                          <input
                            type="radio"
                            name={`${tableId}-format`}
                            checked={formatFilter === fmt}
                            onChange={() => setFormatFilter(fmt)}
                          />
                          <span>{fmt}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </th>
              <th className="filterable-header col-bitrate">
                <div className="header-content">
                  <span className="sort-indicator" onClick={() => handleSort('bitrate')}>
                    {sortColumn === 'bitrate' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                  <span onClick={() => handleSort('bitrate')} className="sortable-label">
                    Bit
                  </span>
                  <button
                    className={`filter-icon ${openDropdown === `${tableId}-bitrate` || bitDepthFilter !== 'all' ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === `${tableId}-bitrate` ? null : `${tableId}-bitrate`);
                    }}
                  >
                    ⋮
                  </button>
                </div>
                {openDropdown === `${tableId}-bitrate` && (
                  <div className="filter-dropdown">
                    <div className="dropdown-options">
                      <label className="dropdown-option">
                        <input
                          type="radio"
                          name={`${tableId}-bitrate`}
                          checked={bitDepthFilter === 'all'}
                          onChange={() => setBitDepthFilter('all')}
                        />
                        <span>All</span>
                      </label>
                      {getUniqueBitDepths().map((depth) => (
                        <label key={depth} className="dropdown-option">
                          <input
                            type="radio"
                            name={`${tableId}-bitrate`}
                            checked={bitDepthFilter === depth.toString()}
                            onChange={() => setBitDepthFilter(depth.toString())}
                          />
                          <span>{depth}-bit</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </th>
              <th className="filterable-header col-samplerate">
                <div className="header-content">
                  <span className="sort-indicator" onClick={() => handleSort('samplerate')}>
                    {sortColumn === 'samplerate' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                  <span onClick={() => handleSort('samplerate')} className="sortable-label">
                    kHz
                  </span>
                  <button
                    className={`filter-icon ${openDropdown === `${tableId}-samplerate` || sampleRateFilter !== 'all' ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === `${tableId}-samplerate` ? null : `${tableId}-samplerate`);
                    }}
                  >
                    ⋮
                  </button>
                </div>
                {openDropdown === `${tableId}-samplerate` && (
                  <div className="filter-dropdown">
                    <div className="dropdown-options">
                      <label className="dropdown-option">
                        <input
                          type="radio"
                          name={`${tableId}-samplerate`}
                          checked={sampleRateFilter === 'all'}
                          onChange={() => setSampleRateFilter('all')}
                        />
                        <span>All</span>
                      </label>
                      {getUniqueSampleRates().map((rate) => (
                        <label key={rate} className="dropdown-option">
                          <input
                            type="radio"
                            name={`${tableId}-samplerate`}
                            checked={sampleRateFilter === rate.toString()}
                            onChange={() => setSampleRateFilter(rate.toString())}
                          />
                          <span>{(rate / 1000).toFixed(1)} kHz</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </th>
              <th className="filterable-header col-size">
                <div className="header-content">
                  <span className="sort-indicator" onClick={() => handleSort('size')}>
                    {sortColumn === 'size' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                  <span onClick={() => handleSort('size')} className="sortable-label">
                    Size
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', opacity: 0.5 }}>
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && sortedFiles.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ textAlign: 'center', opacity: 0.5, cursor: onEmptyClick ? 'pointer' : 'default' }}
                  onClick={onEmptyClick}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!isLoading && sortedFiles.map((file) => {
              const isCursor = isActive && cursorFile?.path === file.path;
              const originalIndex = files.findIndex(f => f.path === file.path);
              const cells = (
                <>
                  <td className="col-name" title={file.name}>
                    {file.is_directory ? <i className="fas fa-folder folder-icon"></i> : ''}
                    <span className="file-name-text">{file.name}</span>
                  </td>
                  <td className="col-format">{file.is_directory ? '' : getFileFormat(file.name)}</td>
                  <td className="col-bitrate">{file.bit_rate || ''}</td>
                  <td className="col-samplerate">{file.sample_rate ? `${(file.sample_rate / 1000).toFixed(1)}` : ''}</td>
                  <td className="col-size">{file.size ? formatFileSize(file.size) : ''}</td>
                </>
              );
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
                  ref={(el) => {
                    if (rowRefs && el) {
                      rowRefs.current.set(originalIndex, el);
                    }
                  }}
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
