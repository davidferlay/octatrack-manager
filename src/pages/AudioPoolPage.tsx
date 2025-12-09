import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Version } from "../components/Version";
import "./AudioPoolPage.css";

interface CopyProgressEvent {
  file_path: string;
  transfer_id: string;
  stage: string;  // "converting", "resampling", "writing", "copying", "complete", "cancelled"
  progress: number;  // 0.0 to 1.0
}

interface AudioFile {
  name: string;
  size: number;
  channels: number | null;
  bit_rate: number | null;
  sample_rate: number | null;
  is_directory: boolean;
  path: string;
}

interface TransferItem {
  id: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  status: "pending" | "copying" | "completed" | "failed" | "cancelled";
  error?: string;
  startTime: number;
  speed?: number;
  timeLeft?: number;
  sourcePath?: string;
  stage?: string;  // "converting", "resampling", "writing", "copying", "complete"
  progress?: number;  // 0.0 to 1.0
}

interface OverwriteModalProps {
  isOpen: boolean;
  fileName: string;
  remainingFiles: string[];
  onOverwrite: () => void;
  onOverwriteAll: () => void;
  onSkip: () => void;
  onSkipAll: () => void;
  onCancel: () => void;
}

function OverwriteModal({ isOpen, fileName, remainingFiles, onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel }: OverwriteModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const hasMultipleRemaining = remainingFiles.length > 1;

  // Reset selection when modal opens/closes or when switching between single/multiple mode
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen, hasMultipleRemaining]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (hasMultipleRemaining) {
        // 5 buttons in grid: [Overwrite, Overwrite All], [Skip, Skip All], [Cancel]
        // Indices: 0=Overwrite, 1=Overwrite All, 2=Skip, 3=Skip All, 4=Cancel
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            if (selectedIndex === 4) setSelectedIndex(2);
            else if (selectedIndex === 2 || selectedIndex === 3) setSelectedIndex(selectedIndex - 2);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (selectedIndex === 0 || selectedIndex === 1) setSelectedIndex(selectedIndex + 2);
            else if (selectedIndex === 2 || selectedIndex === 3) setSelectedIndex(4);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (selectedIndex === 1) setSelectedIndex(0);
            else if (selectedIndex === 3) setSelectedIndex(2);
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (selectedIndex === 0) setSelectedIndex(1);
            else if (selectedIndex === 2) setSelectedIndex(3);
            break;
          case 'Enter':
            e.preventDefault();
            [onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel][selectedIndex]();
            break;
          case 'Escape':
            e.preventDefault();
            onCancel();
            break;
        }
      } else {
        // 3 buttons: [Overwrite, Skip], [Cancel]
        // Indices: 0=Overwrite, 1=Skip, 2=Cancel
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            if (selectedIndex === 2) setSelectedIndex(0);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (selectedIndex === 0 || selectedIndex === 1) setSelectedIndex(2);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (selectedIndex === 1) setSelectedIndex(0);
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (selectedIndex === 0) setSelectedIndex(1);
            break;
          case 'Enter':
            e.preventDefault();
            [onOverwrite, onSkip, onCancel][selectedIndex]();
            break;
          case 'Escape':
            e.preventDefault();
            onCancel();
            break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, hasMultipleRemaining, onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3><i className="fas fa-exclamation-triangle" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>File{hasMultipleRemaining ? 's' : ''} Already Exist{hasMultipleRemaining ? '' : 's'}</h3>
        </div>
        <div className="modal-body">
          {hasMultipleRemaining ? (
            <>
              <p>The following <strong>{remainingFiles.length} files</strong> already exist in the destination folder:</p>
              <ul style={{ maxHeight: '150px', overflowY: 'auto', margin: '0.5rem 0', paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--elektron-text-secondary)' }}>
                {remainingFiles.slice(0, 15).map((path, idx) => {
                  const name = path.split('/').pop() || path.split('\\').pop() || path;
                  return <li key={idx}>{name}</li>;
                })}
                {remainingFiles.length > 15 && <li style={{ fontStyle: 'italic' }}>...and {remainingFiles.length - 15} more</li>}
              </ul>
            </>
          ) : (
            <p>The file <strong>"{fileName}"</strong> already exists in the destination folder.</p>
          )}
          <p>What would you like to do?</p>
        </div>
        <div className="modal-footer">
          {hasMultipleRemaining ? (
            <>
              <div className="modal-buttons-row">
                <button className={`modal-button primary ${selectedIndex === 0 ? 'focused' : ''}`} onClick={onOverwrite}>
                  Overwrite
                </button>
                <button className={`modal-button ${selectedIndex === 1 ? 'focused' : ''}`} onClick={onOverwriteAll}>
                  Overwrite All ({remainingFiles.length})
                </button>
              </div>
              <div className="modal-buttons-row">
                <button className={`modal-button ${selectedIndex === 2 ? 'focused' : ''}`} onClick={onSkip}>
                  Skip
                </button>
                <button className={`modal-button ${selectedIndex === 3 ? 'focused' : ''}`} onClick={onSkipAll}>
                  Skip All ({remainingFiles.length})
                </button>
              </div>
              <div className="modal-buttons-row">
                <button className={`modal-button danger ${selectedIndex === 4 ? 'focused' : ''}`} onClick={onCancel}>
                  Cancel Import
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-buttons-row">
                <button className={`modal-button primary ${selectedIndex === 0 ? 'focused' : ''}`} onClick={onOverwrite}>
                  Overwrite
                </button>
                <button className={`modal-button ${selectedIndex === 1 ? 'focused' : ''}`} onClick={onSkip}>
                  Skip
                </button>
              </div>
              <div className="modal-buttons-row">
                <button className={`modal-button danger ${selectedIndex === 2 ? 'focused' : ''}`} onClick={onCancel}>
                  Cancel Import
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type SortColumn = 'name' | 'size' | 'format' | 'bitrate' | 'samplerate';

// Extract file format from filename (only for audio files)
function getFileFormat(filename: string): string {
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
type SortDirection = 'asc' | 'desc';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Reusable AudioFileTable component
interface AudioFileTableProps {
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
}

function AudioFileTable({
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
}: AudioFileTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchText, setSearchText] = useState('');
  const [hideDirectories, setHideDirectories] = useState(false);
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

    let compareA: any;
    let compareB: any;

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

  const hasActiveFilters = searchText || hideDirectories || formatFilter !== 'all' || bitDepthFilter !== 'all' || sampleRateFilter !== 'all';

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
          <span>Showing {sortedFiles.length} of {files.length} files</span>
          {hideDirectories && <span className="filter-badge">Folders Hidden</span>}
          {searchText && <span className="filter-badge">Search: {searchText}</span>}
          {formatFilter !== 'all' && <span className="filter-badge">Format: {formatFilter}</span>}
          {bitDepthFilter !== 'all' && <span className="filter-badge">Bit: {bitDepthFilter}</span>}
          {sampleRateFilter !== 'all' && <span className="filter-badge">Rate: {(parseInt(sampleRateFilter) / 1000).toFixed(1)}kHz</span>}
        </div>
        {hasActiveFilters && (
          <button
            className="clear-all-filters-btn"
            onClick={() => {
              setSearchText('');
              setHideDirectories(false);
              setFormatFilter('all');
              setBitDepthFilter('all');
              setSampleRateFilter('all');
            }}
          >
            Clear All
          </button>
        )}
      </div>
      <div className="table-wrapper" ref={tableWrapperRef}>
        <table className="audio-files-table">
          <thead>
            <tr>
              <th className="filterable-header col-name">
                <div className="header-content">
                  <span className="sort-indicator" onClick={() => handleSort('name')}>
                    {sortColumn === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                  <span onClick={() => handleSort('name')} className="sortable-label">
                    Name
                  </span>
                  <button
                    className={`filter-icon ${openDropdown === `${tableId}-name` || searchText || hideDirectories ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === `${tableId}-name` ? null : `${tableId}-name`);
                    }}
                  >
                    ⋮
                  </button>
                </div>
                {openDropdown === `${tableId}-name` && (
                  <div className="filter-dropdown">
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      className="dropdown-search"
                    />
                    <label className="dropdown-checkbox">
                      <input
                        type="checkbox"
                        checked={hideDirectories}
                        onChange={(e) => setHideDirectories(e.target.checked)}
                      />
                      <span>Hide Folders</span>
                    </label>
                    {(searchText || hideDirectories) && (
                      <button
                        className="clear-filter-btn"
                        onClick={() => {
                          setSearchText('');
                          setHideDirectories(false);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </th>
              <th onClick={() => handleSort('size')} className="sortable col-size">
                Size {sortColumn === 'size' && (sortDirection === 'asc' ? '▲' : '▼')}
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
                <td className="col-name" title={file.name}>
                  {file.is_directory ? <i className="fas fa-folder folder-icon"></i> : ''}
                  <span className="file-name-text">{file.name}</span>
                </td>
                <td className="col-size">{file.size ? formatFileSize(file.size) : ''}</td>
                <td className="col-format">{file.is_directory ? '' : getFileFormat(file.name)}</td>
                <td className="col-bitrate">{file.bit_rate || ''}</td>
                <td className="col-samplerate">{file.sample_rate ? `${(file.sample_rate / 1000).toFixed(1)}` : ''}</td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Import dropdown component
interface ImportDropdownProps {
  onImportFiles: () => void;
  onImportFolder: () => void;
}

function ImportDropdown({ onImportFiles, onImportFolder }: ImportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="import-dropdown-container" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`toolbar-button ${isOpen ? 'active' : ''}`}
        title="Import files or folder to Audio Pool"
      >
        <i className="fas fa-file-import"></i> Import <i className="fas fa-caret-down" style={{ marginLeft: '0.25rem', fontSize: '0.7rem' }}></i>
      </button>
      {isOpen && (
        <div className="import-dropdown-menu">
          <button
            className="import-dropdown-item"
            onClick={() => {
              onImportFiles();
              setIsOpen(false);
            }}
          >
            <i className="fas fa-file-audio"></i> Files...
          </button>
          <button
            className="import-dropdown-item"
            onClick={() => {
              onImportFolder();
              setIsOpen(false);
            }}
          >
            <i className="fas fa-folder"></i> Folder...
          </button>
        </div>
      )}
    </div>
  );
}

export function AudioPoolPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const audioPoolPath = searchParams.get("path") || "";
  const setName = searchParams.get("name") || "Audio Pool";

  const [sourcePath, setSourcePath] = useState("");
  const [destinationPath, setDestinationPath] = useState(audioPoolPath);
  const [sourceFiles, setSourceFiles] = useState<AudioFile[]>([]);
  const [destinationFiles, setDestinationFiles] = useState<AudioFile[]>([]);
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<Set<string>>(new Set());
  const [selectedDestFiles, setSelectedDestFiles] = useState<Set<string>>(new Set());
  const [lastClickedSourceIndex, setLastClickedSourceIndex] = useState<number>(-1);
  const [lastClickedDestIndex, setLastClickedDestIndex] = useState<number>(-1);
  const [activePanel, setActivePanel] = useState<'source' | 'dest'>('dest');
  const [cursorIndexSource, setCursorIndexSource] = useState<number>(0);
  const [cursorIndexDest, setCursorIndexDest] = useState<number>(0);
  const sourceRowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const destRowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingDest, setIsLoadingDest] = useState(false);
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(true);
  const [isTransferQueueOpen, setIsTransferQueueOpen] = useState(false);
  const [isOverDropZone, setIsOverDropZone] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [transferSortColumn, setTransferSortColumn] = useState<'num' | 'progress' | 'file' | 'size' | 'status'>('num');
  const [transferSortDirection, setTransferSortDirection] = useState<'asc' | 'desc'>('asc');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    file: AudioFile | null;
    panel: 'source' | 'dest';
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    file: null,
    panel: 'dest',
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Rename modal state
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    file: AudioFile | null;
    panel: 'source' | 'dest';
    newName: string;
  }>({
    isOpen: false,
    file: null,
    panel: 'dest',
    newName: '',
  });

  // Create folder modal state
  const [createFolderModal, setCreateFolderModal] = useState<{
    isOpen: boolean;
    panel: 'source' | 'dest';
    folderName: string;
  }>({
    isOpen: false,
    panel: 'dest',
    folderName: '',
  });

  // Delete confirmation modal state (supports multiple files)
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    files: AudioFile[];
    panel: 'source' | 'dest';
    selectedButton: number;
  }>({
    isOpen: false,
    files: [],
    panel: 'dest',
    selectedButton: 0,
  });

  // Overwrite modal state
  const [overwriteModal, setOverwriteModal] = useState<{
    isOpen: boolean;
    fileName: string;
    sourcePath: string;
    transferId: string;
    pendingFiles: string[];
    currentIndex: number;
    fileSizes?: Map<string, number>;
    transferIds?: string[];
  }>({
    isOpen: false,
    fileName: '',
    sourcePath: '',
    transferId: '',
    pendingFiles: [],
    currentIndex: 0,
  });
  const [overwriteAllMode, setOverwriteAllMode] = useState<'none' | 'overwrite' | 'skip'>('none');

  // Transfer pane resize state
  const [transferPaneHeight, setTransferPaneHeight] = useState(200);
  const [isResizingTransfer, setIsResizingTransfer] = useState(false);
  const transferResizeStartY = useRef(0);
  const transferResizeStartHeight = useRef(0);

  // Handle transfer pane resize
  useEffect(() => {
    if (!isResizingTransfer) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = transferResizeStartY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(500, transferResizeStartHeight.current + deltaY));
      setTransferPaneHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingTransfer(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingTransfer]);

  const handleTransferResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    transferResizeStartY.current = e.clientY;
    transferResizeStartHeight.current = transferPaneHeight;
    setIsResizingTransfer(true);
  };

  // Panel divider resize state
  const [sourcePanelWidth, setSourcePanelWidth] = useState(50); // percentage
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const transferListRef = useRef<HTMLDivElement>(null);

  // Handle panel divider resize
  useEffect(() => {
    if (!isResizingPanels) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelContainerRef.current) return;
      const containerRect = panelContainerRef.current.getBoundingClientRect();
      const newWidthPercent = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      setSourcePanelWidth(Math.max(20, Math.min(80, newWidthPercent)));
    };

    const handleMouseUp = () => {
      setIsResizingPanels(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingPanels]);

  const handlePanelResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPanels(true);
  };

  // Initialize source path to home directory on mount
  useEffect(() => {
    async function initHomeDirectory() {
      try {
        const homePath = await invoke<string>("get_home_directory");
        setSourcePath(homePath);
      } catch (error) {
        console.error("Error getting home directory:", error);
      }
    }
    initHomeDirectory();
  }, []);

  // Load destination files on mount
  useEffect(() => {
    if (destinationPath) {
      loadDestinationFiles(destinationPath);
    }
  }, [destinationPath]);

  // Load source files when path changes
  useEffect(() => {
    if (sourcePath) {
      loadSourceFiles(sourcePath);
    }
  }, [sourcePath]);

  // Reference for handling external drops
  const destinationPathRef = useRef(destinationPath);
  useEffect(() => {
    destinationPathRef.current = destinationPath;
  }, [destinationPath]);

  // Listen for external file drops from system (Tauri drag-drop)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setupDragDropListener() {
      const window = getCurrentWindow();
      unlisten = await window.onDragDropEvent(async (event) => {
        if (event.payload.type === 'over') {
          setIsOverDropZone(true);
        } else if (event.payload.type === 'leave') {
          setIsOverDropZone(false);
        } else if (event.payload.type === 'drop') {
          setIsOverDropZone(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0 && destinationPathRef.current) {
            // Use copyFilesToPool which handles parallel processing
            await copyFilesToPool(paths);
          }
        }
      });
    }

    setupDragDropListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Count active transfers
  const activeTransfersCount = transfers.filter(t => t.status === "copying" || t.status === "pending").length;
  const hasTransfers = transfers.length > 0;
  const allTransfersSucceeded = hasTransfers && activeTransfersCount === 0 && transfers.every(t => t.status === "completed");
  const hasFailedTransfers = transfers.some(t => t.status === "failed");

  // Auto-close transfers pane when all transfers complete successfully
  useEffect(() => {
    if (transfers.length > 0 && activeTransfersCount === 0) {
      // All transfers finished - check if all succeeded
      const allSucceeded = transfers.every(t => t.status === "completed");
      if (allSucceeded) {
        // Close the pane after a brief delay to show completion
        const timer = setTimeout(() => {
          setIsTransferQueueOpen(false);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [transfers, activeTransfersCount]);

  // Listen for copy progress events from Rust backend
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<CopyProgressEvent>("copy-progress", (event) => {
        const { file_path, transfer_id, stage, progress } = event.payload;

        setTransfers(prev => prev.map(t => {
          // Match by transfer_id if available, otherwise fall back to sourcePath
          // Only update if still in copying status (not cancelled)
          const matches = transfer_id ? t.id === transfer_id : t.sourcePath === file_path;
          if (matches && t.status === "copying") {
            return {
              ...t,
              stage,
              progress,
              bytesTransferred: progress * (t.fileSize || 1),
            };
          }
          return t;
        }));
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Auto-scroll transfer list to show the latest item
  useEffect(() => {
    if (transferListRef.current && transfers.length > 0) {
      // Scroll to bottom to show the most recent transfer
      transferListRef.current.scrollTop = transferListRef.current.scrollHeight;
    }
  }, [transfers.length]);

  // Keyboard handler for delete modal
  useEffect(() => {
    if (!deleteModal.isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          setDeleteModal(prev => ({ ...prev, selectedButton: prev.selectedButton === 0 ? 1 : 0 }));
          break;
        case 'Enter':
          e.preventDefault();
          if (deleteModal.selectedButton === 0) {
            setDeleteModal({ isOpen: false, files: [], panel: 'dest', selectedButton: 0 });
          } else {
            handleDeleteConfirm();
          }
          break;
        case 'Escape':
          e.preventDefault();
          setDeleteModal({ isOpen: false, files: [], panel: 'dest', selectedButton: 0 });
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteModal.isOpen, deleteModal.selectedButton]);

  async function loadSourceFiles(path: string) {
    if (!path) return;

    setIsLoadingSource(true);
    try {
      const files = await invoke<AudioFile[]>("list_audio_directory", { path });
      setSourceFiles(files);
    } catch (error) {
      console.error("Error loading source files:", error);
      setSourceFiles([]);
    } finally {
      setIsLoadingSource(false);
    }
  }

  async function loadDestinationFiles(path: string) {
    if (!path) return;

    setIsLoadingDest(true);
    try {
      const files = await invoke<AudioFile[]>("list_audio_directory", { path });
      setDestinationFiles(files);
    } catch (error) {
      console.error("Error loading destination files:", error);
      setDestinationFiles([]);
    } finally {
      setIsLoadingDest(false);
    }
  }

  async function browseSourceDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Source Directory"
      });

      if (selected) {
        setSourcePath(selected);
        setIsSourcePanelOpen(true);
      }
    } catch (error) {
      console.error("Error opening directory dialog:", error);
    }
  }

  // Direct import files - opens file dialog
  async function directImportFiles() {
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: "Select Audio Files to Import",
        filters: [{
          name: "Audio Files",
          extensions: ["wav", "aif", "aiff"]
        }]
      });

      if (selected) {
        const filePaths = Array.isArray(selected) ? selected : [selected];
        if (filePaths.length > 0) {
          await copyFilesToPool(filePaths);
        }
      }
    } catch (error) {
      console.error("Error importing files:", error);
    }
  }

  // Direct import folder - opens directory dialog
  async function directImportFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Folder to Import",
      });

      if (selected) {
        await copyFilesToPool([selected]);
      }
    } catch (error) {
      console.error("Error importing folder:", error);
    }
  }

  // Shared function to copy files to pool with parallel processing
  async function copyFilesToPool(sourcePaths: string[], fileSizes?: Map<string, number>) {
    setIsTransferQueueOpen(true);
    setOverwriteAllMode('none'); // Reset overwrite mode for new batch

    // First, add all files to the transfer queue with "pending" status
    const baseTimestamp = Date.now();
    const transferIds: string[] = [];
    const newTransfers: TransferItem[] = sourcePaths.map((sourcePath, index) => {
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      const transferId = `${baseTimestamp}-${index}-${fileName}`;
      transferIds.push(transferId);
      return {
        id: transferId,
        fileName: fileName,
        fileSize: fileSizes?.get(sourcePath) || 0,
        bytesTransferred: 0,
        status: "pending" as const,
        startTime: baseTimestamp,
        sourcePath: sourcePath,
      };
    });

    setTransfers(prev => [...prev, ...newTransfers]);

    // Get system resources for dynamic concurrency
    let concurrency = 2; // Default fallback
    try {
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      concurrency = resources.recommended_concurrency;
      console.log(`Parallel processing with concurrency: ${concurrency} (${resources.cpu_cores} cores, ${resources.available_memory_mb}MB available)`);
    } catch (e) {
      console.warn('Could not get system resources, using default concurrency:', e);
    }

    // Check for existing files BEFORE starting - this allows us to ask user once and then process all in parallel
    let existingFiles: string[] = [];
    try {
      const destFiles = await invoke<AudioFile[]>("list_audio_directory", { path: destinationPath });
      const destFileNames = new Set(destFiles.map(f => f.name.toLowerCase()));

      for (const sourcePath of sourcePaths) {
        const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
        // Get destination filename (will be .wav after conversion)
        const destFileName = fileName.replace(/\.(aif|aiff|mp3|flac|ogg|m4a)$/i, '.wav');
        if (destFileNames.has(destFileName.toLowerCase())) {
          existingFiles.push(sourcePath);
        }
      }
    } catch {
      // Ignore errors - continue without pre-check
    }

    if (existingFiles.length > 0) {
      console.log(`[Parallel] Found ${existingFiles.length} existing files, showing modal for batch decision`);
      // Show modal for batch overwrite decision
      setOverwriteModal({
        isOpen: true,
        fileName: existingFiles[0].split('/').pop() || existingFiles[0].split('\\').pop() || existingFiles[0],
        sourcePath: existingFiles[0],
        transferId: transferIds[sourcePaths.indexOf(existingFiles[0])],
        pendingFiles: sourcePaths,
        currentIndex: 0,
        fileSizes: fileSizes,
        transferIds: transferIds,
      });
      return; // Wait for user decision - modal handlers will call processFilesInParallel with the right flags
    }

    // No conflicts - process all files in parallel
    await processFilesInParallel(sourcePaths, transferIds, fileSizes, concurrency, false);
  }

  // Process files in parallel with a concurrency limit
  // When a file conflict is detected, switches to sequential mode for proper modal handling
  async function processFilesInParallel(
    sourcePaths: string[],
    transferIds: string[],
    fileSizes?: Map<string, number>,
    concurrency: number = 2,
    forceOverwrite: boolean = false
  ) {
    console.log(`[Parallel] Starting parallel processing of ${sourcePaths.length} files with concurrency ${concurrency}, forceOverwrite=${forceOverwrite}`);

    let conflictDetected = false;
    let conflictIndex = -1;
    const completedIndices = new Set<number>();
    const activePromises: Map<number, Promise<void>> = new Map();
    let queueIndex = 0;

    // Helper to process a single file - returns true if conflict detected
    const processFile = async (sourcePath: string, index: number): Promise<boolean> => {
      const transferId = transferIds[index];
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      console.log(`[Parallel] Starting file ${index}: ${fileName}`);

      // Update status to "copying"
      setTransfers(prev => prev.map(t =>
        t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
      ));

      try {
        await invoke("copy_audio_file_with_progress", {
          sourcePath: sourcePath,
          destinationDir: destinationPath,
          transferId: transferId,
          overwrite: forceOverwrite,
        });

        console.log(`[Parallel] Completed file ${index}: ${fileName}`);
        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            // Don't overwrite cancelled status - user already cancelled this transfer
            if (t.status === "cancelled") {
              return t;
            }
            return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
          }
          return t;
        }));
        completedIndices.add(index);
        return false; // No conflict
      } catch (error) {
        const errorStr = String(error);

        // Handle cancellation specifically
        if (errorStr.includes("cancelled")) {
          console.log(`[Parallel] Transfer cancelled: ${fileName}`);
          setTransfers(prev => prev.map(t =>
            t.id === transferId ? { ...t, status: "cancelled" as const } : t
          ));
          return false; // No conflict
        }

        if (errorStr.includes('already exists') && !forceOverwrite) {
          console.log(`[Parallel] Conflict detected for file ${index}: ${fileName}`);
          // Mark as pending conflict - will be handled by modal
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
              return { ...t, status: "pending" as const }; // Reset to pending for modal handling
            }
            return t;
          }));
          return true; // Conflict detected
        } else {
          console.error(`[Parallel] Error copying ${fileName}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
              return { ...t, status: "failed" as const, error: errorStr };
            }
            return t;
          }));
          completedIndices.add(index);
          return false; // Not a conflict, just an error
        }
      }
    };

    // Process files in parallel until a conflict is detected
    while (queueIndex < sourcePaths.length && !conflictDetected) {
      // Start new tasks to fill available slots
      const startedThisRound: number[] = [];
      while (queueIndex < sourcePaths.length && activePromises.size < concurrency && !conflictDetected) {
        const currentIndex = queueIndex++;
        const sourcePath = sourcePaths[currentIndex];
        startedThisRound.push(currentIndex);

        const promise = processFile(sourcePath, currentIndex).then((hasConflict) => {
          activePromises.delete(currentIndex);
          if (hasConflict && !conflictDetected) {
            conflictDetected = true;
            conflictIndex = currentIndex;
          }
        });
        activePromises.set(currentIndex, promise);
      }

      console.log(`[Parallel] Started ${startedThisRound.length} tasks this round (indices: ${startedThisRound.join(', ')}), active: ${activePromises.size}`);

      // Wait for at least one to complete
      if (activePromises.size > 0 && !conflictDetected) {
        console.log(`[Parallel] Waiting for one of ${activePromises.size} active tasks to complete...`);
        await Promise.race(Array.from(activePromises.values()));
        console.log(`[Parallel] A task completed, active now: ${activePromises.size}`);
      }
    }

    // Wait for all active promises to complete before handling conflict
    if (activePromises.size > 0) {
      console.log(`[Parallel] Waiting for ${activePromises.size} remaining tasks to complete...`);
      await Promise.all(Array.from(activePromises.values()));
    }

    console.log(`[Parallel] All tasks done. Conflict: ${conflictDetected}, conflictIndex: ${conflictIndex}`);

    // If a conflict was detected, switch to sequential processing with modal
    if (conflictDetected && conflictIndex >= 0) {
      // Find remaining files (not completed and not the conflict)
      const remainingPaths: string[] = [];
      const remainingIds: string[] = [];

      for (let i = conflictIndex; i < sourcePaths.length; i++) {
        if (!completedIndices.has(i)) {
          remainingPaths.push(sourcePaths[i]);
          remainingIds.push(transferIds[i]);
        }
      }

      if (remainingPaths.length > 0) {
        console.log(`[Parallel] Switching to sequential mode for ${remainingPaths.length} remaining files`);
        // Use processCopyQueue for sequential processing with modal support
        await processCopyQueue(remainingPaths, 0, false, fileSizes, false, remainingIds);
        return; // processCopyQueue will handle refreshing
      }
    }

    // Refresh destination files after all complete
    await loadDestinationFiles(destinationPath);
  }

  // Process copy queue with overwrite handling
  async function processCopyQueue(sourcePaths: string[], startIndex: number, forceOverwrite: boolean = false, fileSizes?: Map<string, number>, forceSkip: boolean = false, transferIds?: string[]) {
    for (let i = startIndex; i < sourcePaths.length; i++) {
      const sourcePath = sourcePaths[i];
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      const fileSize = fileSizes?.get(sourcePath) || 0;

      // Use pre-generated transferId if available, otherwise generate new one
      const transferId = transferIds?.[i] || `${Date.now()}-${fileName}`;

      // If we have pre-generated IDs, update status to "copying"; otherwise add new transfer
      if (transferIds?.[i]) {
        setTransfers(prev => prev.map(t =>
          t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
        ));
      } else {
        const newTransfer: TransferItem = {
          id: transferId,
          fileName: fileName,
          fileSize: fileSize,
          bytesTransferred: 0,
          status: "copying" as const,
          startTime: Date.now(),
          sourcePath: sourcePath,
        };
        setTransfers(prev => [...prev, newTransfer]);
      }

      // Use force flags directly (don't rely on state which may be stale due to async updates)
      const shouldOverwrite = forceOverwrite;
      const shouldSkip = forceSkip;

      try {
        // Use the progress-enabled command for single file copy with conversion
        await invoke("copy_audio_file_with_progress", {
          sourcePath: sourcePath,
          destinationDir: destinationPath,
          transferId: transferId,
          overwrite: shouldOverwrite,
        });

        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            // Don't overwrite cancelled status
            if (t.status === "cancelled") return t;
            return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
          }
          return t;
        }));
      } catch (error) {
        const errorStr = String(error);
        console.log('Copy error:', errorStr, 'overwriteAllMode:', overwriteAllMode);

        // Handle cancellation specifically
        if (errorStr.includes("cancelled")) {
          console.log(`Transfer cancelled: ${fileName}`);
          setTransfers(prev => prev.map(t =>
            t.id === transferId ? { ...t, status: "cancelled" as const } : t
          ));
          return; // Stop processing
        }

        // Check if it's a "file already exists" error
        if (errorStr.includes('already exists')) {
          // Check overwrite mode (use computed values that include force flags)
          if (shouldOverwrite) {
            // Retry with overwrite
            try {
              await invoke("copy_audio_file_with_progress", {
                sourcePath: sourcePath,
                destinationDir: destinationPath,
                transferId: transferId,
                overwrite: true,
              });
              setTransfers(prev => prev.map(t => {
                if (t.id === transferId) {
                  // Don't overwrite cancelled status
                  if (t.status === "cancelled") return t;
                  return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
                }
                return t;
              }));
            } catch (retryError) {
              const retryErrorStr = String(retryError);
              if (retryErrorStr.includes("cancelled")) {
                setTransfers(prev => prev.map(t =>
                  t.id === transferId ? { ...t, status: "cancelled" as const } : t
                ));
                return;
              }
              setTransfers(prev => prev.map(t => {
                if (t.id === transferId) {
                  // Don't overwrite cancelled status
                  if (t.status === "cancelled") return t;
                  return { ...t, status: "failed" as const, error: String(retryError) };
                }
                return t;
              }));
            }
          } else if (shouldSkip) {
            // Mark as skipped
            setTransfers(prev => prev.map(t => {
              if (t.id === transferId) {
                return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
              }
              return t;
            }));
          } else {
            // Show modal and pause processing
            setOverwriteModal({
              isOpen: true,
              fileName: fileName,
              sourcePath: sourcePath,
              transferId: transferId,
              pendingFiles: sourcePaths,
              currentIndex: i,
              fileSizes: fileSizes,
              transferIds: transferIds,
            });
            return; // Pause processing until user decides
          }
        } else {
          // Other error
          console.error(`Error copying ${fileName}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
              // Don't overwrite cancelled status
              if (t.status === "cancelled") return t;
              return { ...t, status: "failed" as const, error: errorStr };
            }
            return t;
          }));
        }
      }
    }

    await loadDestinationFiles(destinationPath);
  }

  // Handle overwrite modal actions
  async function handleOverwrite() {
    const { sourcePath, transferId, pendingFiles, currentIndex, fileSizes, transferIds } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Ensure status is "copying" so progress events are applied
    setTransfers(prev => prev.map(t =>
      t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
    ));

    // Start the overwrite copy in the background (don't await)
    // This allows the queue to continue processing while this file copies
    const copyPromise = invoke("copy_audio_file_with_progress", {
      sourcePath: sourcePath,
      destinationDir: destinationPath,
      transferId: transferId,
      overwrite: true,
    }).then(() => {
      setTransfers(prev => prev.map(t => {
        if (t.id === transferId) {
          // Don't overwrite cancelled status
          if (t.status === "cancelled") return t;
          return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
        }
        return t;
      }));
    }).catch((error) => {
      const errorStr = String(error);
      if (errorStr.includes("cancelled")) {
        setTransfers(prev => prev.map(t =>
          t.id === transferId ? { ...t, status: "cancelled" as const } : t
        ));
        return;
      }
      setTransfers(prev => prev.map(t => {
        if (t.id === transferId) {
          // Don't overwrite cancelled status
          if (t.status === "cancelled") return t;
          return { ...t, status: "failed" as const, error: String(error) };
        }
        return t;
      }));
    });

    // Continue with remaining files immediately (don't wait for current file)
    await processCopyQueue(pendingFiles, currentIndex + 1, false, fileSizes, false, transferIds);

    // Wait for the overwrite copy to finish before refreshing
    await copyPromise;
  }

  async function handleOverwriteAll() {
    const { pendingFiles, fileSizes, transferIds } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));
    setOverwriteAllMode('overwrite');

    // Get concurrency for parallel processing
    let concurrency = 2;
    try {
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      concurrency = resources.recommended_concurrency;
    } catch (e) {
      console.warn('Could not get system resources:', e);
    }

    // Process ALL files in parallel with forceOverwrite=true
    // Since user clicked "Overwrite All", process from the beginning
    console.log(`[Parallel] Overwrite All selected - processing ${pendingFiles.length} files in parallel with forceOverwrite=true`);
    await processFilesInParallel(pendingFiles, transferIds!, fileSizes, concurrency, true);
  }

  function handleSkip() {
    const { transferId, pendingFiles, currentIndex, fileSizes, transferIds } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Mark as skipped
    setTransfers(prev => prev.map(t => {
      if (t.id === transferId) {
        return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
      }
      return t;
    }));

    // Continue with remaining files
    processCopyQueue(pendingFiles, currentIndex + 1, false, fileSizes, false, transferIds);
  }

  async function handleSkipAll() {
    const { transferId, pendingFiles, currentIndex, fileSizes, transferIds } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));
    setOverwriteAllMode('skip');

    // Mark current as skipped
    setTransfers(prev => prev.map(t => {
      if (t.id === transferId) {
        return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
      }
      return t;
    }));

    // Continue with remaining files, passing forceSkip=true
    await processCopyQueue(pendingFiles, currentIndex + 1, false, fileSizes, true, transferIds);
  }

  function handleCancelImport() {
    const { transferId, transferIds, currentIndex } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Mark current and all remaining pending transfers as cancelled
    const remainingIds = transferIds ? new Set(transferIds.slice(currentIndex)) : new Set([transferId]);
    setTransfers(prev => prev.map(t => {
      if (remainingIds.has(t.id) && (t.status === "pending" || t.status === "copying")) {
        return { ...t, status: "cancelled" as const, error: 'Import cancelled' };
      }
      return t;
    }));

    // Don't process remaining files
    loadDestinationFiles(destinationPath);
  }

  // Copy selected source files to pool
  async function copySelectedToPool(fromKeyboard: boolean = false) {
    // Get files to copy - either selected files or the right-clicked file
    let filesToCopy: AudioFile[] = [];

    if (fromKeyboard) {
      // Called from keyboard shortcut or button - use selected files
      filesToCopy = sourceFiles.filter(f => selectedSourceFiles.has(f.path));
    } else if (contextMenu.file && selectedSourceFiles.has(contextMenu.file.path)) {
      // Right-clicked on a selected file - copy all selected files
      filesToCopy = sourceFiles.filter(f => selectedSourceFiles.has(f.path));
    } else if (contextMenu.file) {
      // Right-clicked on an unselected file - copy just that file
      filesToCopy = [contextMenu.file];
    } else {
      // Fallback to selected files
      filesToCopy = sourceFiles.filter(f => selectedSourceFiles.has(f.path));
    }

    if (filesToCopy.length === 0) return;

    setSelectedSourceFiles(new Set());

    // Build file sizes map
    const fileSizes = new Map<string, number>();
    filesToCopy.forEach(f => fileSizes.set(f.path, f.size));

    // Use copyFilesToPool which adds all files as "pending" first, then processes
    const sourcePaths = filesToCopy.map(f => f.path);
    await copyFilesToPool(sourcePaths, fileSizes);
  }

  // Copy selected dest files back to source directory
  async function copyBackToSource(fromKeyboard: boolean = false) {
    if (!sourcePath) return;

    // Get files to copy - either selected files or the right-clicked file
    let filesToCopy: AudioFile[] = [];

    if (fromKeyboard) {
      // Called from keyboard shortcut - use selected files
      filesToCopy = destinationFiles.filter(f => selectedDestFiles.has(f.path));
    } else if (contextMenu.file && selectedDestFiles.has(contextMenu.file.path)) {
      // Right-clicked on a selected file - copy all selected files
      filesToCopy = destinationFiles.filter(f => selectedDestFiles.has(f.path));
    } else if (contextMenu.file) {
      // Right-clicked on an unselected file - copy just that file
      filesToCopy = [contextMenu.file];
    }

    if (filesToCopy.length === 0) return;

    setSelectedDestFiles(new Set());
    setIsTransferQueueOpen(true);

    // First, add all files to the transfer queue with "pending" status
    const baseTimestamp = Date.now();
    const transferIds: string[] = [];
    const newTransfers: TransferItem[] = filesToCopy.map((file, index) => {
      const transferId = `${baseTimestamp}-${index}-${file.name}`;
      transferIds.push(transferId);
      return {
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        bytesTransferred: 0,
        status: "pending" as const,
        startTime: baseTimestamp,
        sourcePath: file.path,
      };
    });

    setTransfers(prev => [...prev, ...newTransfers]);

    // Get system resources for dynamic concurrency
    let concurrency = 2;
    try {
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      concurrency = resources.recommended_concurrency;
    } catch (e) {
      console.warn('Could not get system resources, using default concurrency:', e);
    }

    // Process files in parallel
    const sourcePaths = filesToCopy.map(f => f.path);
    await processFilesInParallelToSource(sourcePaths, transferIds, sourcePath, concurrency);

    // Refresh source files
    await loadSourceFiles(sourcePath);
  }

  // Process files in parallel to source directory
  async function processFilesInParallelToSource(
    sourcePaths: string[],
    transferIds: string[],
    targetDir: string,
    concurrency: number = 2
  ) {
    const queue = sourcePaths.map((path, index) => ({ path, index }));
    const activePromises: Promise<void>[] = [];
    let queueIndex = 0;

    const processFile = async (filePath: string, index: number): Promise<void> => {
      const transferId = transferIds[index];
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;

      setTransfers(prev => prev.map(t =>
        t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
      ));

      try {
        await invoke("copy_audio_file_with_progress", {
          sourcePath: filePath,
          destinationDir: targetDir,
          transferId: transferId,
          overwrite: false,
        });

        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            if (t.status === "cancelled") return t;
            return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
          }
          return t;
        }));
      } catch (error) {
        const errorStr = String(error);
        if (errorStr.includes("cancelled")) {
          setTransfers(prev => prev.map(t =>
            t.id === transferId ? { ...t, status: "cancelled" as const } : t
          ));
          return;
        }
        console.error(`Error copying ${fileName}:`, error);
        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            if (t.status === "cancelled") return t;
            return { ...t, status: "failed" as const, error: String(error) };
          }
          return t;
        }));
      }
    };

    // Start initial batch
    while (queueIndex < queue.length && activePromises.length < concurrency) {
      const item = queue[queueIndex++];
      const promise = processFile(item.path, item.index).then(() => {
        const promiseIndex = activePromises.indexOf(promise);
        if (promiseIndex > -1) activePromises.splice(promiseIndex, 1);
      });
      activePromises.push(promise);
    }

    // Continue processing
    while (queueIndex < queue.length || activePromises.length > 0) {
      if (activePromises.length > 0) {
        await Promise.race(activePromises);
      }
      while (queueIndex < queue.length && activePromises.length < concurrency) {
        const item = queue[queueIndex++];
        const promise = processFile(item.path, item.index).then(() => {
          const promiseIndex = activePromises.indexOf(promise);
          if (promiseIndex > -1) activePromises.splice(promiseIndex, 1);
        });
        activePromises.push(promise);
      }
    }
  }

  async function navigateToParentSource() {
    if (!sourcePath) return;

    try {
      const parentPath = await invoke<string>("navigate_to_parent", { path: sourcePath });
      setSourcePath(parentPath);
    } catch (error) {
      console.error("Error navigating to parent:", error);
    }
  }

  async function navigateToParentDest() {
    if (!destinationPath) return;

    // Prevent navigating above AUDIO directory level
    if (destinationPath === audioPoolPath) {
      return;
    }

    try {
      const parentPath = await invoke<string>("navigate_to_parent", { path: destinationPath });
      // Double-check we don't go above AUDIO directory
      if (parentPath.length < audioPoolPath.length) {
        return;
      }
      setDestinationPath(parentPath);
    } catch (error) {
      console.error("Error navigating to parent:", error);
    }
  }

  function resetToAudioRoot() {
    setDestinationPath(audioPoolPath);
  }

  function handleSourceFileClick(file: AudioFile, index: number, event: React.MouseEvent) {
    // Double-click or single click without modifier on directory navigates into it
    if (file.is_directory && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      setSourcePath(file.path);
      return;
    }

    const newSelected = new Set(selectedSourceFiles);

    if (event.shiftKey && lastClickedSourceIndex !== -1) {
      const start = Math.min(lastClickedSourceIndex, index);
      const end = Math.max(lastClickedSourceIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(sourceFiles[i].path);
      }
      setSelectedSourceFiles(newSelected);
      setCursorIndexSource(index);
    } else if (event.ctrlKey || event.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedSourceFiles(newSelected);
      setLastClickedSourceIndex(index);
      setCursorIndexSource(index);
    } else {
      newSelected.clear();
      newSelected.add(file.path);
      setSelectedSourceFiles(newSelected);
      setLastClickedSourceIndex(index);
      setCursorIndexSource(index);
    }
  }

  function handleDestFileClick(file: AudioFile, index: number, event: React.MouseEvent) {
    if (file.is_directory) {
      setDestinationPath(file.path);
      return;
    }

    const newSelected = new Set(selectedDestFiles);

    if (event.shiftKey && lastClickedDestIndex !== -1) {
      const start = Math.min(lastClickedDestIndex, index);
      const end = Math.max(lastClickedDestIndex, index);
      for (let i = start; i <= end; i++) {
        if (!destinationFiles[i].is_directory) {
          newSelected.add(destinationFiles[i].path);
        }
      }
      setSelectedDestFiles(newSelected);
      setCursorIndexDest(index);
    } else if (event.ctrlKey || event.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedDestFiles(newSelected);
      setLastClickedDestIndex(index);
      setCursorIndexDest(index);
    } else {
      newSelected.clear();
      newSelected.add(file.path);
      setSelectedDestFiles(newSelected);
      setLastClickedDestIndex(index);
      setCursorIndexDest(index);
    }
  }

  // Transfer queue management
  function clearAllTransfers() {
    setTransfers([]);
  }

  function clearFinishedTransfers() {
    setTransfers(prev => prev.filter(t =>
      t.status !== "completed" && t.status !== "failed" && t.status !== "cancelled"
    ));
  }

  async function cancelTransfer(transferId: string) {
    // Call Rust backend to signal cancellation
    try {
      await invoke("cancel_audio_transfer", { transferId });
    } catch (e) {
      console.error("Failed to cancel transfer:", e);
    }
    // Update UI immediately
    setTransfers(prev => prev.map(t =>
      t.id === transferId && (t.status === "copying" || t.status === "pending")
        ? { ...t, status: "cancelled" as const }
        : t
    ));
  }

  function handleTransferSort(column: 'num' | 'progress' | 'file' | 'size' | 'status') {
    if (transferSortColumn === column) {
      setTransferSortDirection(transferSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setTransferSortColumn(column);
      setTransferSortDirection('asc');
    }
  }

  // Context menu handlers
  function handleContextMenu(e: React.MouseEvent, file: AudioFile | null, panel: 'source' | 'dest') {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      file,
      panel,
    });
  }

  function closeContextMenu() {
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  }

  // Close context menu when clicking outside
  useEffect(() => {
    function handleClick() {
      if (contextMenu.isOpen) {
        closeContextMenu();
      }
    }
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu.isOpen]);

  // Adjust context menu position to stay within viewport
  useLayoutEffect(() => {
    if (contextMenu.isOpen && contextMenuRef.current) {
      const menu = contextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = contextMenu.x;
      let newY = contextMenu.y;

      // Adjust if menu extends beyond right edge
      if (rect.right > viewportWidth) {
        newX = viewportWidth - rect.width - 10;
      }

      // Adjust if menu extends beyond bottom edge
      if (rect.bottom > viewportHeight) {
        newY = viewportHeight - rect.height - 10;
      }

      // Apply adjusted position if needed
      if (newX !== contextMenu.x || newY !== contextMenu.y) {
        menu.style.left = `${Math.max(10, newX)}px`;
        menu.style.top = `${Math.max(10, newY)}px`;
      }
    }
  }, [contextMenu.isOpen, contextMenu.x, contextMenu.y]);

  // Reveal in explorer handler
  async function handleRevealInExplorer() {
    try {
      const currentPath = contextMenu.panel === 'source' ? sourcePath : destinationPath;

      if (contextMenu.file && contextMenu.file.is_directory) {
        // If it's a directory, open that directory in file manager
        await invoke("open_in_file_manager", { path: contextMenu.file.path });
      } else {
        // If it's a file or no selection, open the current directory in file manager
        await invoke("open_in_file_manager", { path: currentPath });
      }
    } catch (error) {
      console.error("Error revealing in explorer:", error);
    }
    closeContextMenu();
  }

  // Rename handlers
  function handleRenameClick() {
    if (contextMenu.file) {
      setRenameModal({
        isOpen: true,
        file: contextMenu.file,
        panel: contextMenu.panel,
        newName: contextMenu.file.name,
      });
    }
    closeContextMenu();
  }

  async function handleRenameConfirm() {
    if (!renameModal.file || !renameModal.newName.trim()) return;

    try {
      await invoke("rename_file", {
        oldPath: renameModal.file.path,
        newName: renameModal.newName.trim(),
      });

      // Refresh the appropriate panel
      if (renameModal.panel === 'source') {
        loadSourceFiles(sourcePath);
      } else {
        loadDestinationFiles(destinationPath);
      }
    } catch (error) {
      console.error("Error renaming:", error);
      alert(`Error renaming: ${error}`);
    }

    setRenameModal({ isOpen: false, file: null, panel: 'dest', newName: '' });
  }

  // Delete handlers
  function handleDeleteClick() {
    const panel = contextMenu.panel;
    const selectedFiles = panel === 'source' ? selectedSourceFiles : selectedDestFiles;
    const allFiles = panel === 'source' ? sourceFiles : destinationFiles;

    // Get files to delete - either selected files or the right-clicked file
    let filesToDelete: AudioFile[] = [];

    if (contextMenu.file && selectedFiles.has(contextMenu.file.path)) {
      // Right-clicked on a selected file - delete all selected files
      filesToDelete = allFiles.filter(f => selectedFiles.has(f.path));
    } else if (contextMenu.file) {
      // Right-clicked on an unselected file - delete just that file
      filesToDelete = [contextMenu.file];
    }

    if (filesToDelete.length > 0) {
      setDeleteModal({
        isOpen: true,
        files: filesToDelete,
        panel,
        selectedButton: 0,
      });
    }
    closeContextMenu();
  }

  async function handleDeleteConfirm() {
    if (deleteModal.files.length === 0) return;

    try {
      // Delete all files using delete_audio_files (accepts array)
      const paths = deleteModal.files.map(f => f.path);
      await invoke("delete_audio_files", {
        filePaths: paths,
      });

      // Clear selection for the panel
      if (deleteModal.panel === 'source') {
        setSelectedSourceFiles(new Set());
        loadSourceFiles(sourcePath);
      } else {
        setSelectedDestFiles(new Set());
        loadDestinationFiles(destinationPath);
      }
    } catch (error) {
      console.error("Error deleting:", error);
      alert(`Error deleting: ${error}`);
    }

    setDeleteModal({ isOpen: false, files: [], panel: 'dest', selectedButton: 0 });
  }

  // Create folder handlers
  function handleCreateFolderClick() {
    setCreateFolderModal({
      isOpen: true,
      panel: contextMenu.panel,
      folderName: '',
    });
    closeContextMenu();
  }

  async function handleCreateFolderConfirm() {
    if (!createFolderModal.folderName.trim()) return;

    const basePath = createFolderModal.panel === 'source' ? sourcePath : destinationPath;

    try {
      await invoke("create_new_directory", {
        path: basePath,
        name: createFolderModal.folderName.trim(),
      });

      // Refresh the appropriate panel
      if (createFolderModal.panel === 'source') {
        loadSourceFiles(sourcePath);
      } else {
        loadDestinationFiles(destinationPath);
      }
    } catch (error) {
      console.error("Error creating folder:", error);
      alert(`Error creating folder: ${error}`);
    }

    setCreateFolderModal({ isOpen: false, panel: 'dest', folderName: '' });
  }

  // Sort transfers based on current sort column and direction
  const sortedTransfers = [...transfers].map((t, idx) => ({ ...t, originalIndex: idx })).sort((a, b) => {
    let compareA: string | number;
    let compareB: string | number;

    switch (transferSortColumn) {
      case 'num':
        compareA = a.originalIndex;
        compareB = b.originalIndex;
        break;
      case 'progress':
        compareA = a.status === 'completed' ? 100 : a.fileSize > 0 ? (a.bytesTransferred / a.fileSize) * 100 : 0;
        compareB = b.status === 'completed' ? 100 : b.fileSize > 0 ? (b.bytesTransferred / b.fileSize) * 100 : 0;
        break;
      case 'file':
        compareA = a.fileName.toLowerCase();
        compareB = b.fileName.toLowerCase();
        break;
      case 'size':
        compareA = a.fileSize;
        compareB = b.fileSize;
        break;
      case 'status':
        const statusOrder = { copying: 0, pending: 1, completed: 2, failed: 3, cancelled: 4 };
        compareA = statusOrder[a.status];
        compareB = statusOrder[b.status];
        break;
      default:
        return 0;
    }

    if (compareA < compareB) return transferSortDirection === 'asc' ? -1 : 1;
    if (compareA > compareB) return transferSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't handle if modal is open or user is typing in an input
      if (overwriteModal.isOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const files = activePanel === 'source' ? sourceFiles : destinationFiles;
      const cursorIndex = activePanel === 'source' ? cursorIndexSource : cursorIndexDest;
      const setCursorIndex = activePanel === 'source' ? setCursorIndexSource : setCursorIndexDest;
      const selectedFiles = activePanel === 'source' ? selectedSourceFiles : selectedDestFiles;
      const setSelectedFiles = activePanel === 'source' ? setSelectedSourceFiles : setSelectedDestFiles;
      const rowRefs = activePanel === 'source' ? sourceRowRefs : destRowRefs;

      // Helper to scroll row into view, accounting for sticky header
      const scrollToRow = (index: number) => {
        const row = rowRefs.current.get(index);
        if (row) {
          const tableWrapper = row.closest('.table-wrapper');
          const thead = row.closest('table')?.querySelector('thead');
          if (tableWrapper) {
            const headerHeight = thead?.getBoundingClientRect().height || 0;
            const rowRect = row.getBoundingClientRect();
            const wrapperRect = tableWrapper.getBoundingClientRect();
            const visibleTop = wrapperRect.top + headerHeight;

            if (rowRect.top < visibleTop) {
              // Row is above visible area (under header), scroll up
              tableWrapper.scrollTop -= (visibleTop - rowRect.top);
            } else if (rowRect.bottom > wrapperRect.bottom) {
              // Row is below visible area, scroll down
              tableWrapper.scrollTop += (rowRect.bottom - wrapperRect.bottom);
            }
          }
        }
      };

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault();
          const newIndex = Math.max(0, cursorIndex - 1);
          setCursorIndex(newIndex);
          scrollToRow(newIndex);
          if (files[newIndex]) {
            if (e.shiftKey) {
              // Extend selection (include directories)
              const newSelected = new Set(selectedFiles);
              newSelected.add(files[newIndex].path);
              setSelectedFiles(newSelected);
            } else {
              // Single selection (include directories)
              const newSelected = new Set<string>();
              newSelected.add(files[newIndex].path);
              setSelectedFiles(newSelected);
            }
          }
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const newIndex = Math.min(files.length - 1, cursorIndex + 1);
          setCursorIndex(newIndex);
          scrollToRow(newIndex);
          if (files[newIndex]) {
            if (e.shiftKey) {
              // Extend selection (include directories)
              const newSelected = new Set(selectedFiles);
              newSelected.add(files[newIndex].path);
              setSelectedFiles(newSelected);
            } else {
              // Single selection (include directories)
              const newSelected = new Set<string>();
              newSelected.add(files[newIndex].path);
              setSelectedFiles(newSelected);
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Navigate to parent directory
            if (activePanel === 'source') {
              navigateToParentSource();
            } else {
              navigateToParentDest();
            }
          } else {
            // Switch to source panel
            if (isSourcePanelOpen) {
              setActivePanel('source');
            }
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Enter directory if cursor is on a directory
            const currentFile = files[cursorIndex];
            if (currentFile?.is_directory) {
              if (activePanel === 'source') {
                setSourcePath(currentFile.path);
                setCursorIndexSource(0);
              } else {
                setDestinationPath(currentFile.path);
                setCursorIndexDest(0);
              }
            }
          } else {
            // Switch to dest panel
            setActivePanel('dest');
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          // Ctrl+Enter: Copy selected files from source to audio pool
          if ((e.ctrlKey || e.metaKey) && activePanel === 'source' && selectedSourceFiles.size > 0) {
            copySelectedToPool(true);
            break;
          }
          // Ctrl+Enter: Copy selected files from audio pool to source
          if ((e.ctrlKey || e.metaKey) && activePanel === 'dest' && selectedDestFiles.size > 0 && sourcePath) {
            copyBackToSource(true);
            break;
          }
          const currentFile = files[cursorIndex];
          if (currentFile?.is_directory) {
            // Enter directory
            if (activePanel === 'source') {
              setSourcePath(currentFile.path);
              setCursorIndexSource(0);
            } else {
              setDestinationPath(currentFile.path);
              setCursorIndexDest(0);
            }
          } else if (activePanel === 'source' && selectedSourceFiles.size > 0) {
            // Copy selected files to pool
            copySelectedToPool(true);
          }
          break;
        }
        case 'a': {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Select all files and directories
            const newSelected = new Set<string>();
            files.forEach(f => {
              newSelected.add(f.path);
            });
            setSelectedFiles(newSelected);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          // Clear selection
          setSelectedFiles(new Set());
          break;
        }
        case ' ': {
          e.preventDefault();
          // Enter directory if cursor is on a directory
          const currentFile = files[cursorIndex];
          if (currentFile?.is_directory) {
            if (activePanel === 'source') {
              setSourcePath(currentFile.path);
              setCursorIndexSource(0);
            } else {
              setDestinationPath(currentFile.path);
              setCursorIndexDest(0);
            }
          }
          break;
        }
        case 'Backspace': {
          e.preventDefault();
          // Navigate to parent directory
          if (activePanel === 'source') {
            navigateToParentSource();
          } else {
            navigateToParentDest();
          }
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activePanel, sourceFiles, destinationFiles,
    cursorIndexSource, cursorIndexDest,
    selectedSourceFiles, selectedDestFiles,
    isSourcePanelOpen, overwriteModal.isOpen
  ]);

  // Drag and drop handlers
  function handleDragStart(e: React.DragEvent) {
    const filePaths = Array.from(selectedSourceFiles);
    e.dataTransfer.setData("application/json", JSON.stringify(filePaths));
    e.dataTransfer.effectAllowed = "copy";
  }

  function handleDragEnd() {
    // Cleanup after drag ends
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsOverDropZone(true);
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsOverDropZone(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsOverDropZone(false);

    try {
      const filePathsJson = e.dataTransfer.getData("application/json");
      if (!filePathsJson) {
        return;
      }

      const sourcePaths = JSON.parse(filePathsJson) as string[];
      if (sourcePaths.length === 0) {
        return;
      }

      const filesToCopy = sourceFiles.filter(f => sourcePaths.includes(f.path));

      setSelectedSourceFiles(new Set());
      setIsTransferQueueOpen(true);

      for (const file of filesToCopy) {
        const transferId = `${Date.now()}-${file.name}`;

        const newTransfer: TransferItem = {
          id: transferId,
          fileName: file.name,
          fileSize: file.size,
          bytesTransferred: 0,
          status: "copying" as const,
          startTime: Date.now(),
          sourcePath: file.path,
        };

        setTransfers(prev => [...prev, newTransfer]);

        try {
          await invoke("copy_audio_file_with_progress", {
            sourcePath: file.path,
            destinationDir: destinationPath,
            transferId: transferId
          });

          setTransfers(prev => prev.map(t => {
            if (t.fileName === file.name && t.id === transferId) {
              if (t.status === "cancelled") return t;
              return { ...t, status: "completed" as const, bytesTransferred: t.fileSize, progress: 1.0, stage: "complete" };
            }
            return t;
          }));
        } catch (error) {
          const errorStr = String(error);
          if (errorStr.includes("cancelled")) {
            setTransfers(prev => prev.map(t =>
              t.id === transferId ? { ...t, status: "cancelled" as const } : t
            ));
            continue;
          }
          console.error(`Error copying file ${file.name}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.fileName === file.name && t.id === transferId) {
              if (t.status === "cancelled") return t;
              return { ...t, status: "failed" as const, error: String(error) };
            }
            return t;
          }));
        }
      }

      await loadDestinationFiles(destinationPath);
    } catch (error) {
      console.error("Error during file operation:", error);
      alert(`Error: ${error}`);
    }
  }

  return (
    <main className="container audio-pool-page">
      <div className="project-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1' }}>
          <button onClick={() => navigate("/")} className="back-button">
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>{setName}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => setIsSourcePanelOpen(!isSourcePanelOpen)}
            className={`toolbar-button ${isSourcePanelOpen ? 'active' : ''}`}
            title={isSourcePanelOpen ? 'Hide source browser' : 'Show source browser'}
          >
            <i className="fas fa-columns"></i> Browse
          </button>
          <ImportDropdown
            onImportFiles={directImportFiles}
            onImportFolder={directImportFolder}
          />
          <div className="toolbar-separator"></div>
          <button
            onClick={() => setIsTransferQueueOpen(!isTransferQueueOpen)}
            className={`toolbar-button ${isTransferQueueOpen ? 'active' : ''} ${activeTransfersCount > 0 ? 'has-activity' : ''}`}
            title={isTransferQueueOpen ? 'Hide transfers' : 'Show transfers'}
          >
            <i className="fas fa-exchange-alt"></i>
            {hasTransfers && (
              <span className={`badge ${allTransfersSucceeded ? 'badge-success' : ''} ${hasFailedTransfers ? 'badge-error' : ''}`}>
                {transfers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { loadSourceFiles(sourcePath); loadDestinationFiles(destinationPath); }}
            className={`toolbar-button ${isLoadingSource || isLoadingDest ? 'refreshing' : ''}`}
            disabled={isLoadingSource || isLoadingDest}
            title="Refresh file lists"
          >
            <i className="fas fa-sync-alt"></i>
          </button>
          <Version />
        </div>
      </div>

      <div
        ref={panelContainerRef}
        className="audio-pool-container"
      >
        {/* Left Panel - Source (My Computer) */}
        {isSourcePanelOpen && (
          <div className="audio-panel source-panel" style={{ width: `${sourcePanelWidth}%` }}>
            <div className="panel-header-bar">
              <span className="panel-title">Source</span>
              <div className="panel-path-controls">
                <input
                  type="text"
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  placeholder="Select a folder..."
                  className="path-input"
                />
                <button className="icon-button" title="Browse..." onClick={browseSourceDirectory}>
                  <i className="fas fa-folder-open"></i>
                </button>
                <button className="icon-button" title="Go up" onClick={navigateToParentSource}>
                  <i className="fas fa-arrow-up"></i>
                </button>
                <div className="toolbar-separator"></div>
                <button
                  className="icon-button copy-to-pool-btn"
                  title="Copy selected to Audio Pool"
                  onClick={() => copySelectedToPool(true)}
                  disabled={selectedSourceFiles.size === 0}
                >
                  <i className="fas fa-arrow-right"></i> Copy
                </button>
              </div>
            </div>

            <AudioFileTable
              files={sourceFiles}
              selectedFiles={selectedSourceFiles}
              onFileClick={handleSourceFileClick}
              isLoading={isLoadingSource}
              emptyMessage={sourcePath ? 'No audio files found' : 'Select a folder to browse'}
              onEmptyClick={() => !sourcePath && browseSourceDirectory()}
              draggable={true}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              tableId="source"
              cursorIndex={cursorIndexSource}
              isActive={activePanel === 'source'}
              onPanelClick={() => setActivePanel('source')}
              onContextMenu={(e, file) => handleContextMenu(e, file, 'source')}
              rowRefs={sourceRowRefs}
            />
          </div>
        )}

        {/* Panel Divider */}
        {isSourcePanelOpen && (
          <div
            className="panel-divider"
            onMouseDown={handlePanelResizeStart}
          />
        )}

        {/* Right Panel - Destination (Audio Pool) */}
        <div
          className={`audio-panel dest-panel ${isOverDropZone ? 'drop-zone-active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="panel-header-bar">
            <span className="panel-title">Audio Pool</span>
            <div className="panel-path-controls">
              <input
                type="text"
                value={destinationPath}
                readOnly
                placeholder="/"
                className="path-input"
              />
              <button
                className="icon-button"
                title="Reset to AUDIO directory"
                onClick={resetToAudioRoot}
                disabled={destinationPath === audioPoolPath}
              >
                <i className="fas fa-undo"></i>
              </button>
              <button
                className="icon-button"
                title="Go up"
                onClick={navigateToParentDest}
                disabled={destinationPath === audioPoolPath}
              >
                <i className="fas fa-arrow-up"></i>
              </button>
            </div>
          </div>

          <AudioFileTable
            files={destinationFiles}
            selectedFiles={selectedDestFiles}
            onFileClick={handleDestFileClick}
            isLoading={isLoadingDest}
            emptyMessage="No files in audio pool"
            tableId="dest"
            cursorIndex={cursorIndexDest}
            isActive={activePanel === 'dest'}
            onPanelClick={() => setActivePanel('dest')}
            onContextMenu={(e, file) => handleContextMenu(e, file, 'dest')}
            rowRefs={destRowRefs}
          />
        </div>
      </div>

      {/* Transfer Queue - Only visible when toggled or has transfers */}
      {isTransferQueueOpen && (
        <div className="transfer-queue" style={{ height: `${transferPaneHeight}px` }}>
          <div
            className="transfer-resize-handle"
            onMouseDown={handleTransferResizeStart}
          />
          <div className="transfer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3>Transfers</h3>
              {activeTransfersCount > 0 && (
                <span className="transfer-count-badge">{activeTransfersCount} active</span>
              )}
            </div>
            <div className="transfer-controls">
              <button
                className="transfer-button"
                onClick={clearFinishedTransfers}
                disabled={transfers.filter(t => t.status === "completed" || t.status === "failed" || t.status === "cancelled").length === 0}
              >
                Clear finished
              </button>
              <button
                className="transfer-button"
                onClick={clearAllTransfers}
                disabled={transfers.length === 0}
              >
                Clear all
              </button>
              <button
                className="icon-button"
                onClick={() => setIsTransferQueueOpen(false)}
                title="Close"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
          <div className="transfer-list-container" ref={transferListRef}>
            <table className="transfer-list">
              <thead>
                <tr>
                  <th className="transfer-col-num sortable" onClick={() => handleTransferSort('num')}>
                    # {transferSortColumn === 'num' && <span className="sort-arrow">{transferSortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className="transfer-col-progress sortable" onClick={() => handleTransferSort('progress')}>
                    Progress {transferSortColumn === 'progress' && <span className="sort-arrow">{transferSortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className="transfer-col-file sortable" onClick={() => handleTransferSort('file')}>
                    File {transferSortColumn === 'file' && <span className="sort-arrow">{transferSortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className="transfer-col-size sortable" onClick={() => handleTransferSort('size')}>
                    Size {transferSortColumn === 'size' && <span className="sort-arrow">{transferSortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className="transfer-col-status sortable" onClick={() => handleTransferSort('status')}>
                    Status {transferSortColumn === 'status' && <span className="sort-arrow">{transferSortDirection === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                  <th className="transfer-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransfers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>
                      No transfers
                    </td>
                  </tr>
                ) : (
                  sortedTransfers.map((transfer) => {
                    // Compute progress percentage once to ensure bar and text are synchronized
                    const progressPercent = transfer.status === 'completed' ? 100 :
                                           transfer.status === 'failed' || transfer.status === 'cancelled' ? 0 :
                                           transfer.progress !== undefined ? Math.min(transfer.progress * 100, 100) :
                                           0;
                    return (
                    <tr key={transfer.id} className={`transfer-row transfer-${transfer.status}`}>
                      <td>{transfer.originalIndex + 1}</td>
                      <td>
                        <div className="progress-container">
                          <div
                            className={`progress-bar ${transfer.status === 'completed' ? 'completed' : ''}`}
                            style={{ width: `${progressPercent}%` }}
                          />
                          <span className="progress-text">
                            {transfer.status === 'failed' || transfer.status === 'cancelled' ? '-' : `${Math.round(progressPercent)}%`}
                          </span>
                        </div>
                      </td>
                      <td title={transfer.fileName}>{transfer.fileName}</td>
                      <td>{formatFileSize(transfer.fileSize)}</td>
                      <td>
                        <span
                          className={`status-badge status-${transfer.status}`}
                          title={transfer.error ? (transfer.error.includes('already exists') ? 'File already exists' : transfer.error) : (transfer.stage || '')}
                        >
                          {transfer.status === 'copying' && transfer.stage ? transfer.stage : transfer.status}
                        </span>
                      </td>
                      <td>
                        {(transfer.status === "copying" || transfer.status === "pending") && (
                          <button
                            className="icon-button small"
                            onClick={() => cancelTransfer(transfer.id)}
                            title="Cancel transfer"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="audio-pool-status">
        {selectedSourceFiles.size > 0 && (
          <span>{selectedSourceFiles.size} file(s) selected - Drag to audio pool to copy</span>
        )}
        {selectedDestFiles.size > 0 && <span>{selectedDestFiles.size} file(s) selected in audio pool</span>}
        {selectedSourceFiles.size === 0 && selectedDestFiles.size === 0 && (
          <span>{isSourcePanelOpen ? 'Select files to copy' : 'Click "Import" to add files to audio pool'}</span>
        )}
      </div>

      {/* Overwrite confirmation modal */}
      <OverwriteModal
        isOpen={overwriteModal.isOpen}
        fileName={overwriteModal.fileName}
        remainingFiles={overwriteModal.pendingFiles.slice(overwriteModal.currentIndex)}
        onOverwrite={handleOverwrite}
        onOverwriteAll={handleOverwriteAll}
        onSkip={handleSkip}
        onSkipAll={handleSkipAll}
        onCancel={handleCancelImport}
      />

      {/* Context menu */}
      {contextMenu.isOpen && (() => {
        const selectedFiles = contextMenu.panel === 'source' ? selectedSourceFiles : selectedDestFiles;
        const isMultipleSelected = !!(contextMenu.file && selectedFiles.has(contextMenu.file.path) && selectedFiles.size > 1);
        const selectedCount = isMultipleSelected ? selectedFiles.size : 1;

        return (
          <div
            ref={contextMenuRef}
            className="context-menu"
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.file && (
              <>
                <button
                  className={`context-menu-item ${isMultipleSelected ? 'disabled' : ''}`}
                  onClick={isMultipleSelected ? undefined : handleRevealInExplorer}
                  disabled={isMultipleSelected}
                >
                  <i className="fas fa-folder-open"></i> Reveal in Explorer
                </button>
                {contextMenu.panel === 'dest' && sourcePath && (
                  <button
                    className="context-menu-item"
                    onClick={() => { copyBackToSource(); closeContextMenu(); }}
                  >
                    <i className="fas fa-arrow-left"></i> Copy to Source{isMultipleSelected ? ` (${selectedCount})` : ''}
                  </button>
                )}
                {contextMenu.panel === 'source' && (
                  <button
                    className="context-menu-item"
                    onClick={() => { copySelectedToPool(); closeContextMenu(); }}
                  >
                    <i className="fas fa-arrow-right"></i> Copy to Audio Pool{isMultipleSelected ? ` (${selectedCount})` : ''}
                  </button>
                )}
                <div className="context-menu-separator"></div>
                <button
                  className={`context-menu-item ${isMultipleSelected ? 'disabled' : ''}`}
                  onClick={isMultipleSelected ? undefined : handleRenameClick}
                  disabled={isMultipleSelected}
                >
                  <i className="fas fa-edit"></i> Rename
                </button>
                <button className="context-menu-item danger" onClick={handleDeleteClick}>
                  <i className="fas fa-trash"></i> Delete{isMultipleSelected ? ` (${selectedCount})` : ''}
                </button>
                <div className="context-menu-separator"></div>
              </>
            )}
            {!contextMenu.file && (
              <>
                <button className="context-menu-item" onClick={handleRevealInExplorer}>
                  <i className="fas fa-folder-open"></i> Reveal in Explorer
                </button>
                <div className="context-menu-separator"></div>
              </>
            )}
            <button className="context-menu-item" onClick={handleCreateFolderClick}>
              <i className="fas fa-folder-plus"></i> Create Folder
            </button>
          </div>
        );
      })()}

      {/* Rename modal */}
      {renameModal.isOpen && (
        <div className="modal-overlay" onClick={() => setRenameModal({ isOpen: false, file: null, panel: 'dest', newName: '' })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-edit" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Rename</h3>
            </div>
            <div className="modal-body">
              <p>Enter new name for <strong>"{renameModal.file?.name}"</strong>:</p>
              <input
                type="text"
                className="modal-input"
                value={renameModal.newName}
                onChange={(e) => setRenameModal({ ...renameModal, newName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameConfirm();
                  if (e.key === 'Escape') setRenameModal({ isOpen: false, file: null, panel: 'dest', newName: '' });
                }}
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <div className="modal-buttons-row">
                <button className="modal-button" onClick={() => setRenameModal({ isOpen: false, file: null, panel: 'dest', newName: '' })}>
                  Cancel
                </button>
                <button className="modal-button primary" onClick={handleRenameConfirm} disabled={!renameModal.newName.trim()}>
                  Rename
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteModal.isOpen && (
        <div className="modal-overlay" onClick={() => setDeleteModal({ isOpen: false, files: [], panel: 'dest', selectedButton: 0 })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-trash" style={{ color: '#dc3545', marginRight: '0.5rem' }}></i>Delete</h3>
            </div>
            <div className="modal-body">
              {deleteModal.files.length === 1 ? (
                <>
                  <p>Are you sure you want to delete <strong>"{deleteModal.files[0]?.name}"</strong>?</p>
                  {deleteModal.files[0]?.is_directory && (
                    <p style={{ color: '#dc3545' }}>This will delete the folder and all its contents!</p>
                  )}
                </>
              ) : (
                <>
                  <p>Are you sure you want to delete <strong>{deleteModal.files.length} items</strong>?</p>
                  <ul style={{ maxHeight: '150px', overflowY: 'auto', margin: '0.5rem 0', paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--elektron-text-secondary)' }}>
                    {deleteModal.files.map((f, idx) => (
                      <li key={idx}>{f.name}{f.is_directory ? ' (folder)' : ''}</li>
                    ))}
                  </ul>
                  {deleteModal.files.some(f => f.is_directory) && (
                    <p style={{ color: '#dc3545' }}>This will delete folders and all their contents!</p>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <div className="modal-buttons-row">
                <button className={`modal-button ${deleteModal.selectedButton === 0 ? 'focused' : ''}`} onClick={() => setDeleteModal({ isOpen: false, files: [], panel: 'dest', selectedButton: 0 })}>
                  Cancel
                </button>
                <button className={`modal-button danger ${deleteModal.selectedButton === 1 ? 'focused' : ''}`} onClick={handleDeleteConfirm}>
                  Delete{deleteModal.files.length > 1 ? ` (${deleteModal.files.length})` : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create folder modal */}
      {createFolderModal.isOpen && (
        <div className="modal-overlay" onClick={() => setCreateFolderModal({ isOpen: false, panel: 'dest', folderName: '' })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-folder-plus" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Create Folder</h3>
            </div>
            <div className="modal-body">
              <p>Enter name for the new folder:</p>
              <input
                type="text"
                className="modal-input"
                value={createFolderModal.folderName}
                onChange={(e) => setCreateFolderModal({ ...createFolderModal, folderName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolderConfirm();
                  if (e.key === 'Escape') setCreateFolderModal({ isOpen: false, panel: 'dest', folderName: '' });
                }}
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <div className="modal-buttons-row">
                <button className="modal-button" onClick={() => setCreateFolderModal({ isOpen: false, panel: 'dest', folderName: '' })}>
                  Cancel
                </button>
                <button className="modal-button primary" onClick={handleCreateFolderConfirm} disabled={!createFolderModal.folderName.trim()}>
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
