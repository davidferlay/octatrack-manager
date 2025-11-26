import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Version } from "../components/Version";
import "./AudioPoolPage.css";

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
}

interface OverwriteModalProps {
  isOpen: boolean;
  fileName: string;
  onOverwrite: () => void;
  onOverwriteAll: () => void;
  onSkip: () => void;
  onSkipAll: () => void;
  onCancel: () => void;
}

function OverwriteModal({ isOpen, fileName, onOverwrite, onOverwriteAll, onSkip, onSkipAll, onCancel }: OverwriteModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3><i className="fas fa-exclamation-triangle" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>File Already Exists</h3>
        </div>
        <div className="modal-body">
          <p>The file <strong>"{fileName}"</strong> already exists in the destination folder.</p>
          <p>What would you like to do?</p>
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button primary" onClick={onOverwrite}>
              Overwrite
            </button>
            <button className="modal-button" onClick={onOverwriteAll}>
              Overwrite All
            </button>
          </div>
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onSkip}>
              Skip
            </button>
            <button className="modal-button" onClick={onSkipAll}>
              Skip All
            </button>
          </div>
          <div className="modal-buttons-row">
            <button className="modal-button danger" onClick={onCancel}>
              Cancel Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type SortColumn = 'name' | 'size' | 'channels' | 'bitrate' | 'samplerate';
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
}: AudioFileTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchText, setSearchText] = useState('');
  const [hideDirectories, setHideDirectories] = useState(false);
  const [channelsFilter, setChannelsFilter] = useState<string>('all');
  const [sampleRateFilter, setSampleRateFilter] = useState<string>('all');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
  const getUniqueChannels = () => {
    const channels = new Set<number>();
    files.forEach(file => {
      if (file.channels !== null) {
        channels.add(file.channels);
      }
    });
    return Array.from(channels).sort((a, b) => a - b);
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

  // Filter files
  const filteredFiles = files.filter(file => {
    if (hideDirectories && file.is_directory) return false;
    if (searchText && !file.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (channelsFilter !== 'all' && file.channels?.toString() !== channelsFilter) return false;
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
      case 'channels':
        compareA = a.channels ?? -1;
        compareB = b.channels ?? -1;
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

  const hasActiveFilters = searchText || hideDirectories || channelsFilter !== 'all' || sampleRateFilter !== 'all';

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
          {channelsFilter !== 'all' && <span className="filter-badge">Ch: {channelsFilter}</span>}
          {sampleRateFilter !== 'all' && <span className="filter-badge">Rate: {(parseInt(sampleRateFilter) / 1000).toFixed(1)}kHz</span>}
        </div>
        {hasActiveFilters && (
          <button
            className="clear-all-filters-btn"
            onClick={() => {
              setSearchText('');
              setHideDirectories(false);
              setChannelsFilter('all');
              setSampleRateFilter('all');
            }}
          >
            Clear All
          </button>
        )}
      </div>
      <div className="table-wrapper">
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
              <th className="filterable-header col-channels">
                <div className="header-content">
                  <span className="sort-indicator" onClick={() => handleSort('channels')}>
                    {sortColumn === 'channels' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </span>
                  <span onClick={() => handleSort('channels')} className="sortable-label">
                    Ch
                  </span>
                  <button
                    className={`filter-icon ${openDropdown === `${tableId}-channels` || channelsFilter !== 'all' ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === `${tableId}-channels` ? null : `${tableId}-channels`);
                    }}
                  >
                    ⋮
                  </button>
                </div>
                {openDropdown === `${tableId}-channels` && (
                  <div className="filter-dropdown">
                    <div className="dropdown-options">
                      <label className="dropdown-option">
                        <input
                          type="radio"
                          name={`${tableId}-channels`}
                          checked={channelsFilter === 'all'}
                          onChange={() => setChannelsFilter('all')}
                        />
                        <span>All</span>
                      </label>
                      {getUniqueChannels().map((ch) => (
                        <label key={ch} className="dropdown-option">
                          <input
                            type="radio"
                            name={`${tableId}-channels`}
                            checked={channelsFilter === ch.toString()}
                            onChange={() => setChannelsFilter(ch.toString())}
                          />
                          <span>{ch === 1 ? 'Mono' : ch === 2 ? 'Stereo' : ch}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </th>
              <th onClick={() => handleSort('bitrate')} className="sortable col-bitrate">
                Bit {sortColumn === 'bitrate' && (sortDirection === 'asc' ? '▲' : '▼')}
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
                <td className="col-channels">{file.channels || ''}</td>
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
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingDest, setIsLoadingDest] = useState(false);
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);
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

  // Delete confirmation modal state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    file: AudioFile | null;
    panel: 'source' | 'dest';
  }>({
    isOpen: false,
    file: null,
    panel: 'dest',
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
            // Import dropped files/folders to Audio Pool
            setIsTransferQueueOpen(true);

            for (const sourcePath of paths) {
              const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
              const transferId = `${Date.now()}-${fileName}`;

              const newTransfer: TransferItem = {
                id: transferId,
                fileName: fileName,
                fileSize: 0,
                bytesTransferred: 0,
                status: "copying" as const,
                startTime: Date.now(),
              };

              setTransfers(prev => [...prev, newTransfer]);

              try {
                await invoke("copy_audio_files", {
                  sourcePaths: [sourcePath],
                  destinationDir: destinationPathRef.current
                });

                setTransfers(prev => prev.map(t => {
                  if (t.id === transferId) {
                    return { ...t, status: "completed" as const, bytesTransferred: 1 };
                  }
                  return t;
                }));
              } catch (error) {
                console.error(`Error copying ${fileName}:`, error);
                setTransfers(prev => prev.map(t => {
                  if (t.id === transferId) {
                    return { ...t, status: "failed" as const, error: String(error) };
                  }
                  return t;
                }));
              }
            }

            // Refresh destination files
            const files = await invoke<AudioFile[]>("list_audio_directory", { path: destinationPathRef.current });
            setDestinationFiles(files);
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

  // Shared function to copy files to pool with overwrite handling
  async function copyFilesToPool(sourcePaths: string[], fileSizes?: Map<string, number>) {
    setIsTransferQueueOpen(true);
    setOverwriteAllMode('none'); // Reset overwrite mode for new batch

    await processCopyQueue(sourcePaths, 0, false, fileSizes);
  }

  // Process copy queue with overwrite handling
  async function processCopyQueue(sourcePaths: string[], startIndex: number, forceOverwrite: boolean = false, fileSizes?: Map<string, number>) {
    for (let i = startIndex; i < sourcePaths.length; i++) {
      const sourcePath = sourcePaths[i];
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      const transferId = `${Date.now()}-${fileName}`;
      const fileSize = fileSizes?.get(sourcePath) || 0;

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

      try {
        // Check current overwrite mode
        const shouldOverwrite = forceOverwrite || overwriteAllMode === 'overwrite';

        await invoke("copy_audio_files", {
          sourcePaths: [sourcePath],
          destinationDir: destinationPath,
          overwrite: shouldOverwrite,
        });

        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1 };
          }
          return t;
        }));
      } catch (error) {
        const errorStr = String(error);
        console.log('Copy error:', errorStr, 'overwriteAllMode:', overwriteAllMode);

        // Check if it's a "file already exists" error
        if (errorStr.includes('already exists')) {
          // Check overwrite mode
          if (overwriteAllMode === 'overwrite') {
            // Retry with overwrite
            try {
              await invoke("copy_audio_files", {
                sourcePaths: [sourcePath],
                destinationDir: destinationPath,
                overwrite: true,
              });
              setTransfers(prev => prev.map(t => {
                if (t.id === transferId) {
                  return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1 };
                }
                return t;
              }));
            } catch (retryError) {
              setTransfers(prev => prev.map(t => {
                if (t.id === transferId) {
                  return { ...t, status: "failed" as const, error: String(retryError) };
                }
                return t;
              }));
            }
          } else if (overwriteAllMode === 'skip') {
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
            });
            return; // Pause processing until user decides
          }
        } else {
          // Other error
          console.error(`Error copying ${fileName}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
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
    const { sourcePath, transferId, pendingFiles, currentIndex, fileSizes } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Retry with overwrite
    try {
      await invoke("copy_audio_files", {
        sourcePaths: [sourcePath],
        destinationDir: destinationPath,
        overwrite: true,
      });
      setTransfers(prev => prev.map(t => {
        if (t.id === transferId) {
          return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1 };
        }
        return t;
      }));
    } catch (error) {
      setTransfers(prev => prev.map(t => {
        if (t.id === transferId) {
          return { ...t, status: "failed" as const, error: String(error) };
        }
        return t;
      }));
    }

    // Continue with remaining files
    await processCopyQueue(pendingFiles, currentIndex + 1, false, fileSizes);
  }

  async function handleOverwriteAll() {
    setOverwriteAllMode('overwrite');
    await handleOverwrite();
  }

  function handleSkip() {
    const { transferId, pendingFiles, currentIndex, fileSizes } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Mark as skipped
    setTransfers(prev => prev.map(t => {
      if (t.id === transferId) {
        return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
      }
      return t;
    }));

    // Continue with remaining files
    processCopyQueue(pendingFiles, currentIndex + 1, false, fileSizes);
  }

  function handleSkipAll() {
    setOverwriteAllMode('skip');
    handleSkip();
  }

  function handleCancelImport() {
    const { transferId } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Mark current as cancelled
    setTransfers(prev => prev.map(t => {
      if (t.id === transferId) {
        return { ...t, status: "cancelled" as const, error: 'Import cancelled' };
      }
      return t;
    }));

    // Don't process remaining files
    loadDestinationFiles(destinationPath);
  }

  // Copy selected source files to pool
  async function copySelectedToPool() {
    if (selectedSourceFiles.size === 0) return;

    const filesToCopy = sourceFiles.filter(f => selectedSourceFiles.has(f.path));
    setSelectedSourceFiles(new Set());
    setIsTransferQueueOpen(true);

    // Reset overwrite mode for new batch
    setOverwriteAllMode('none');

    // Build file sizes map
    const fileSizes = new Map<string, number>();
    filesToCopy.forEach(f => fileSizes.set(f.path, f.size));

    // Use the same queue processing as drag-and-drop to handle file conflicts
    const sourcePaths = filesToCopy.map(f => f.path);
    await processCopyQueue(sourcePaths, 0, false, fileSizes);
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
    } else if (event.ctrlKey || event.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedSourceFiles(newSelected);
      setLastClickedSourceIndex(index);
    } else {
      newSelected.clear();
      newSelected.add(file.path);
      setSelectedSourceFiles(newSelected);
      setLastClickedSourceIndex(index);
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
    } else if (event.ctrlKey || event.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedDestFiles(newSelected);
      setLastClickedDestIndex(index);
    } else {
      newSelected.clear();
      newSelected.add(file.path);
      setSelectedDestFiles(newSelected);
      setLastClickedDestIndex(index);
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

  function cancelTransfer(transferId: string) {
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
    if (contextMenu.file) {
      setDeleteModal({
        isOpen: true,
        file: contextMenu.file,
        panel: contextMenu.panel,
      });
    }
    closeContextMenu();
  }

  async function handleDeleteConfirm() {
    if (!deleteModal.file) return;

    try {
      await invoke("delete_file", {
        path: deleteModal.file.path,
      });

      // Refresh the appropriate panel
      if (deleteModal.panel === 'source') {
        loadSourceFiles(sourcePath);
      } else {
        loadDestinationFiles(destinationPath);
      }
    } catch (error) {
      console.error("Error deleting:", error);
      alert(`Error deleting: ${error}`);
    }

    setDeleteModal({ isOpen: false, file: null, panel: 'dest' });
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

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault();
          const newIndex = Math.max(0, cursorIndex - 1);
          setCursorIndex(newIndex);
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
            copySelectedToPool();
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
        };

        setTransfers(prev => [...prev, newTransfer]);

        try {
          await invoke("copy_audio_files", {
            sourcePaths: [file.path],
            destinationDir: destinationPath
          });

          setTransfers(prev => prev.map(t => {
            if (t.fileName === file.name && t.id === transferId) {
              return { ...t, status: "completed" as const, bytesTransferred: t.fileSize };
            }
            return t;
          }));
        } catch (error) {
          console.error(`Error copying file ${file.name}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.fileName === file.name && t.id === transferId) {
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
            {hasTransfers && <span className="badge">{transfers.length}</span>}
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
        className={`audio-pool-container ${isSourcePanelOpen ? 'source-open' : 'source-closed'}`}
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
                  onClick={copySelectedToPool}
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
          <div className="transfer-list-container">
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
                  sortedTransfers.map((transfer) => (
                    <tr key={transfer.id} className={`transfer-row transfer-${transfer.status}`}>
                      <td>{transfer.originalIndex + 1}</td>
                      <td>
                        <div className="progress-container">
                          <div
                            className={`progress-bar ${transfer.status === 'completed' ? 'completed' : ''}`}
                            style={{
                              width: transfer.status === 'completed' ? '100%' :
                                     transfer.status === 'failed' || transfer.status === 'cancelled' ? '0%' :
                                     transfer.fileSize > 0 ? `${Math.min((transfer.bytesTransferred / transfer.fileSize) * 100, 100)}%` : '0%'
                            }}
                          />
                          <span className="progress-text">
                            {transfer.status === 'completed' ? '100%' :
                             transfer.status === 'failed' || transfer.status === 'cancelled' ? '-' :
                             transfer.fileSize > 0 ? `${Math.min(Math.round((transfer.bytesTransferred / transfer.fileSize) * 100), 100)}%` : '-'}
                          </span>
                        </div>
                      </td>
                      <td title={transfer.fileName}>{transfer.fileName}</td>
                      <td>{formatFileSize(transfer.fileSize)}</td>
                      <td>
                        <span
                          className={`status-badge status-${transfer.status}`}
                          title={transfer.error || ''}
                        >
                          {transfer.status}
                        </span>
                        {transfer.error && (
                          <div className="transfer-error-message" title={transfer.error}>
                            {transfer.error.includes('already exists') ? 'File already exists' : transfer.error}
                          </div>
                        )}
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
                  ))
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
        onOverwrite={handleOverwrite}
        onOverwriteAll={handleOverwriteAll}
        onSkip={handleSkip}
        onSkipAll={handleSkipAll}
        onCancel={handleCancelImport}
      />

      {/* Context menu */}
      {contextMenu.isOpen && (
        <div
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
              <button className="context-menu-item" onClick={handleRenameClick}>
                <i className="fas fa-edit"></i> Rename
              </button>
              <button className="context-menu-item danger" onClick={handleDeleteClick}>
                <i className="fas fa-trash"></i> Delete
              </button>
              <div className="context-menu-separator"></div>
            </>
          )}
          <button className="context-menu-item" onClick={handleCreateFolderClick}>
            <i className="fas fa-folder-plus"></i> Create Folder
          </button>
        </div>
      )}

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
        <div className="modal-overlay" onClick={() => setDeleteModal({ isOpen: false, file: null, panel: 'dest' })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-trash" style={{ color: '#dc3545', marginRight: '0.5rem' }}></i>Delete</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete <strong>"{deleteModal.file?.name}"</strong>?</p>
              {deleteModal.file?.is_directory && (
                <p style={{ color: '#dc3545' }}>This will delete the folder and all its contents!</p>
              )}
            </div>
            <div className="modal-footer">
              <div className="modal-buttons-row">
                <button className="modal-button" onClick={() => setDeleteModal({ isOpen: false, file: null, panel: 'dest' })}>
                  Cancel
                </button>
                <button className="modal-button danger" onClick={handleDeleteConfirm}>
                  Delete
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
