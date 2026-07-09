import { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Version } from "../components/Version";
import { AudioFileTable, audioKind } from "../components/AudioFileTable";
import { FixPoolFilesModal, PoolIncompatibleListModal, type IncompatibleFile } from "../components/FixPoolFilesModal";
import { OverwriteModal } from "../components/OverwriteModal";
import { TransferProgressPanel } from "../components/TransferProgressPanel";
import { useAudioPoolTransfer } from "../hooks/useAudioPoolTransfer";
import { useAudioPreview, shouldAutoPreview, scrubTarget, volumeStep, isAudioFile } from "../hooks/useAudioPreview";
import { SamplePlayerBar } from "../components/SamplePlayerBar";
import type { AudioFile } from "../types/audioFile";
import "./AudioPoolPage.css";

// Droppable wrapper for the Audio Pool (destination) pane. Uses @dnd-kit (pointer-based)
// so in-app drag from the Source pane works on macOS WebKit, which does not fire HTML5
// drag events - same reason the Project List page uses @dnd-kit to drop projects on sets.
function PoolDropZone({ osOver, children }: { osOver: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'audio-pool-dest', data: { type: 'pool' } });
  return (
    <div ref={setNodeRef} className={`audio-panel dest-panel ${osOver || isOver ? 'drop-zone-active' : ''}`}>
      {children}
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
  // When opened from a project's slot tab, remember how to navigate back to it.
  const fromPath = searchParams.get("fromPath");
  const fromName = searchParams.get("fromName") || "";
  const fromTab = searchParams.get("fromTab") || "flex-slots";

  const [sourcePath, setSourcePath] = useState("");
  const [destinationPath, setDestinationPath] = useState(audioPoolPath);
  const [sourceFiles, setSourceFiles] = useState<AudioFile[]>([]);
  const [destinationFiles, setDestinationFiles] = useState<AudioFile[]>([]);
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<Set<string>>(new Set());
  const [selectedDestFiles, setSelectedDestFiles] = useState<Set<string>>(new Set());
  const [lastClickedSourceIndex, setLastClickedSourceIndex] = useState<number>(-1);
  const [lastClickedDestIndex, setLastClickedDestIndex] = useState<number>(-1);
  const [activePanel, setActivePanel] = useState<'source' | 'dest'>('dest');

  const player = useAudioPreview();
  const [activePlayable, setActivePlayable] = useState(false);

  const previewCandidate = useCallback((path: string | null, name: string, selectionSize: number) => {
    // Only preview real audio files; non-audio selections reset the bar and are never
    // read/decoded, so a huge non-audio file can't freeze the UI.
    const playable = !!path && isAudioFile(path);
    setActivePlayable(playable);
    if (!playable) { player.reset(); return; }
    if (shouldAutoPreview(player.autoPreview, selectionSize, playable)) {
      player.play(path, name);
    } else {
      player.load(path, name);
    }
  }, [player]);

  // Explicit playback (double-click or context-menu Play) — plays regardless of the
  // Auto-preview toggle.
  const playFile = useCallback((file: AudioFile) => {
    if (file.is_directory || !isAudioFile(file.path)) return;
    setActivePlayable(true);
    player.play(file.path, file.name);
  }, [player]);

  const [cursorIndexSource, setCursorIndexSource] = useState<number>(0);
  const [cursorIndexDest, setCursorIndexDest] = useState<number>(0);
  const sourceRowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const destRowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingDest, setIsLoadingDest] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(true);
  const [isOverDropZone, setIsOverDropZone] = useState(false);
  // Files currently being dragged from the Source pane (drives the drag overlay).
  const [dndDragFiles, setDndDragFiles] = useState<string[]>([]);
  // Pointer sensor with a small activation distance so clicks still select (drag only past 5px).
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  // Files / Tools page tabs
  const [activeTab, setActiveTab] = useState<'files' | 'tools'>('files');
  // OT compatibility of pool files (fed by the Audio Pool table's background inspection)
  const [destCompatMap, setDestCompatMap] = useState<Record<string, string>>({});
  // Fix Audio Pool Samples modal, pre-loaded with the files to convert
  const [fixModal, setFixModal] = useState<{ files: IncompatibleFile[]; skipReview: boolean } | null>(null);
  // Tools tab: "Review before applying changes" option + incompatible-files list modal
  const [reviewBeforeApply, setReviewBeforeApply] = useState(true);
  const [showPoolList, setShowPoolList] = useState(false);

  // Tools tab status: scan the whole pool for incompatible files on entry (and after a fix)
  const [poolScanLoading, setPoolScanLoading] = useState(false);
  const [poolScanTotal, setPoolScanTotal] = useState(0);
  const [incompatibleFiles, setIncompatibleFiles] = useState<IncompatibleFile[]>([]);
  const [poolScanKey, setPoolScanKey] = useState(0);
  useEffect(() => {
    if (activeTab !== 'tools' || !audioPoolPath) return;
    let cancelled = false;
    setPoolScanLoading(true);
    (async () => {
      try {
        const paths = (await invoke<string[]>('list_audio_files_recursive', { path: audioPoolPath })) ?? [];
        if (cancelled) return;
        setPoolScanTotal(paths.length);
        // Only WAV/AIFF need header inspection; other audio formats are unplayable by definition
        const otherAudio = paths.filter(p => audioKind(p) === 'other-audio')
          .map(p => ({ path: p, compatibility: 'unsupported_format' }));
        const nativePaths = paths.filter(p => audioKind(p) === 'native');
        const checks = nativePaths.length
          ? await invoke<{ path: string; compatibility: string }[]>('inspect_audio_files', { paths: nativePaths })
          : [];
        if (cancelled) return;
        setIncompatibleFiles([
          ...(checks ?? [])
            .filter(c => c.compatibility !== 'compatible')
            .map(c => ({ path: c.path, compatibility: c.compatibility })),
          ...otherAudio,
        ]);
      } catch (e) {
        console.error('Pool compatibility scan failed:', e);
      } finally {
        if (!cancelled) setPoolScanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, audioPoolPath, poolScanKey]);
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

  // Audio transfer hook (copy to audio pool with progress, overwrite modal, etc.)
  const {
    transfers,
    isTransferQueueOpen,
    setIsTransferQueueOpen,
    overwriteModal,
    copyFilesToPool,
    cancelTransfer,
    clearAllTransfers,
    clearFinishedTransfers,
    handleOverwrite,
    handleOverwriteAll,
    handleSkip,
    handleSkipAll,
    handleCancelImport,
  } = useAudioPoolTransfer({
    onComplete: (path) => (path === sourcePath ? loadSourceFiles(path) : loadDestinationFiles(path)),
  });

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
    let cancelled = false;

    // getCurrentWindow() throws if the Tauri runtime isn't present (e.g. plain
    // browser / e2e smoke without mocks) — guard so it never blanks the page.
    try {
      getCurrentWindow().onDragDropEvent(async (event) => {
        if (event.payload.type === 'over') {
          setIsOverDropZone(true);
        } else if (event.payload.type === 'leave') {
          setIsOverDropZone(false);
        } else if (event.payload.type === 'drop') {
          setIsOverDropZone(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0 && destinationPathRef.current) {
            await copyFilesToPool(paths, destinationPathRef.current);
          }
        }
      }).then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      }).catch(() => { /* drag-drop unavailable */ });
    } catch {
      /* Tauri runtime unavailable — drag-drop import disabled */
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Count active transfers
  const activeTransfersCount = transfers.filter(t => t.status === "copying" || t.status === "pending").length;
  const hasTransfers = transfers.length > 0;
  const allTransfersSucceeded = hasTransfers && activeTransfersCount === 0 && transfers.every(t => t.status === "completed");
  const hasFailedTransfers = transfers.some(t => t.status === "failed");

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
          await copyFilesToPool(filePaths, destinationPath);
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

      if (selected && !Array.isArray(selected)) {
        // The per-file transfer pipeline can't copy a directory directly —
        // expand it into its audio files (recursively) first.
        const files = await invoke<string[]>("list_audio_files_recursive", { path: selected });
        if (files.length === 0) return;
        await copyFilesToPool(files, destinationPath);
      }
    } catch (error) {
      console.error("Error importing folder:", error);
    }
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
    await copyFilesToPool(sourcePaths, destinationPath, fileSizes);
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

    // Reuse the shared transfer pipeline (progress, conflict modal, concurrency).
    // onComplete reloads the source pane because the destination is sourcePath.
    const fileSizes = new Map<string, number>();
    filesToCopy.forEach(f => fileSizes.set(f.path, f.size));

    const sourcePaths = filesToCopy.map(f => f.path);
    await copyFilesToPool(sourcePaths, sourcePath, fileSizes);
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

  // Single click selects a directory (so it can be dragged to the pool); double-click
  // enters it. Double-clicking a file plays it.
  function handleSourceFileDoubleClick(file: AudioFile) {
    if (file.is_directory) setSourcePath(file.path);
    else playFile(file);
  }

  function handleSourceFileClick(file: AudioFile, index: number, event: React.MouseEvent) {
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

    const hasModifier = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!file.is_directory) previewCandidate(file.path, file.name, hasModifier ? 2 : 1);
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

    const hasModifier = event.shiftKey || event.ctrlKey || event.metaKey;
    previewCandidate(file.path, file.name, hasModifier ? 2 : 1);
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

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't handle if modal is open or user is typing in an input
      if (overwriteModal.isOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Player controls take precedence over row/panel navigation.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === ' ') {
        if (tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'A') { e.preventDefault(); player.togglePlay(); }
        return;
      }
      // Shift+Enter: toggle Auto-preview (Ctrl+Enter stays the copy shortcut here).
      if (e.shiftKey && e.key === 'Enter') { e.preventDefault(); player.setAutoPreview(!player.autoPreview); return; }
      // Shift+L: toggle Loop.
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); player.setLoop(!player.loop); return; }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(scrubTarget(player.currentTime, player.duration, -1)); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(scrubTarget(player.currentTime, player.duration, 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); player.setVolume(volumeStep(player.volume, 1)); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); player.setVolume(volumeStep(player.volume, -1)); return; }
      }

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
              // Preview the focused file (directories reset the bar).
              previewCandidate(files[newIndex].is_directory ? null : files[newIndex].path, files[newIndex].name, 1);
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
              // Preview the focused file (directories reset the bar).
              previewCandidate(files[newIndex].is_directory ? null : files[newIndex].path, files[newIndex].name, 1);
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
        case 'b':
        case 'B': {
          if (e.ctrlKey || e.metaKey) break;
          e.preventDefault();
          // Toggle the source (Browse) panel
          setIsSourcePanelOpen(prev => !prev);
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
    isSourcePanelOpen, overwriteModal.isOpen, player, previewCandidate
  ]);

  // In-app drag from the Source pane to the Audio Pool pane uses @dnd-kit (pointer-based)
  // so it works on macOS WebKit, which does not deliver HTML5 drag events. OS-level file
  // drops keep coming through the Tauri onDragDropEvent listener above.
  function handleDndDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { files?: string[] } | undefined;
    setDndDragFiles(data?.files ?? []);
  }

  async function handleDndDragEnd(event: DragEndEvent) {
    setDndDragFiles([]);
    const { active, over } = event;
    if (!over || (over.data.current as { type?: string } | undefined)?.type !== 'pool') return;

    const draggedPaths = (active.data.current as { files?: string[] } | undefined)?.files ?? [];
    if (draggedPaths.length === 0) return;

    const filesToCopy = sourceFiles.filter(f => draggedPaths.includes(f.path));
    if (filesToCopy.length === 0) return;

    setSelectedSourceFiles(new Set());

    try {
      // Build file sizes map and use the hook's copyFilesToPool for proper transfer tracking
      const fileSizes = new Map<string, number>();
      filesToCopy.forEach(f => fileSizes.set(f.path, f.size));
      await copyFilesToPool(filesToCopy.map(f => f.path), destinationPath, fileSizes);
    } catch (error) {
      console.error("Error during file operation:", error);
      alert(`Error: ${error}`);
    }
  }

  return (
    <main className="container audio-pool-page">
      <div className="project-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1' }}>
          {fromPath ? (
            <button
              onClick={() => navigate(`/project?path=${encodeURIComponent(fromPath)}&name=${encodeURIComponent(fromName)}&tab=${encodeURIComponent(fromTab)}`)}
              className="back-button"
              title="Back to the project's sample slots"
            >
              ← Back to project
            </button>
          ) : (
            <button onClick={() => navigate("/")} className="back-button">
              ← Back
            </button>
          )}
          <h1 title={destinationPath} className="pool-title">
            <span className="pool-title-name">{setName}</span>
            <span>&nbsp;- Audio Pool</span>
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="header-tabs">
            <button
              className={`header-tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files
            </button>
            <button
              className={`header-tab ${activeTab === 'tools' ? 'active' : ''}`}
              onClick={() => setActiveTab('tools')}
            >
              Tools
            </button>
          </div>
          <button
            onClick={() => setIsSourcePanelOpen(!isSourcePanelOpen)}
            className={`toolbar-button ${isSourcePanelOpen ? 'active' : ''}`}
            title={isSourcePanelOpen ? 'Hide source browser (B)' : 'Show source browser (B)'}
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
            className={`copy-table-btn ${isTransferQueueOpen ? 'active' : ''} ${activeTransfersCount > 0 ? 'has-activity' : ''}`}
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
            onClick={() => {
              setIsSpinning(true);
              setTimeout(() => setIsSpinning(false), 600);
              loadSourceFiles(sourcePath);
              loadDestinationFiles(destinationPath);
            }}
            className={`toolbar-button ${isSpinning ? 'refreshing' : ''}`}
            disabled={isLoadingSource || isLoadingDest}
            title="Refresh file lists"
          >
            <i className="fas fa-sync-alt"></i>
          </button>
          <Version />
        </div>
      </div>

      {activeTab === 'tools' && (
        <div className="tools-panel pool-tools-panel">
          <div className="tools-section">
            <label className="tools-label">Operation</label>
            <select className="tools-select" value="fix_audio_pool" onChange={() => {}}>
              <option value="fix_audio_pool">Fix Audio Pool Samples</option>
            </select>
          </div>
          <div className="tools-fix-missing-layout">
            <div className="tools-description-pane">
              <p>
                Scans every audio file of this Set's Audio Pool and lists the ones the Octatrack
                cannot play (wrong sample rate, bit depth or format). Execute converts them
                to 44.1 kHz WAV in place: the original file is replaced, and sample slots referencing
                it in any project of this Set are updated to the new file (each modified project is
                backed up first).
              </p>
            </div>
            {incompatibleFiles.length > 0 && (
              <div className="tools-options-panel">
                <h3>Options</h3>
                <div className="tools-field tools-checkbox">
                  <label title="Show the review screen listing planned conversions before applying them">
                    <input
                      type="checkbox"
                      checked={reviewBeforeApply}
                      onChange={(e) => setReviewBeforeApply(e.target.checked)}
                    />
                    Review before applying changes
                  </label>
                </div>
              </div>
            )}
            <div className="tools-fix-status-panel">
              <h3>Status</h3>
              {poolScanLoading ? (
                <div className="tools-fix-status loading">
                  <span className="loading-spinner-small"></span>
                  <span>Scanning Audio Pool...</span>
                </div>
              ) : incompatibleFiles.length === 0 ? (
                <div className="tools-fix-status all-good">
                  <div className="tools-fix-status-count">0</div>
                  <div className="tools-fix-status-label">incompatible audio files - the whole Audio Pool is playable by the Octatrack</div>
                </div>
              ) : (
                <button
                  className="tools-missing-files-summary"
                  onClick={() => setShowPoolList(true)}
                  title="Click to view the incompatible files list"
                >
                  <span className="tools-fix-status-count">{incompatibleFiles.length}</span>
                  {" "}incompatible audio file{incompatibleFiles.length !== 1 ? 's' : ''}
                  <span className="tools-fix-status-detail">{" — "}of {poolScanTotal} scanned</span>
                </button>
              )}
            </div>
            {incompatibleFiles.length > 0 && (
              <div className="tools-actions">
                <button
                  className="tools-execute-btn"
                  onClick={() => setFixModal({ files: incompatibleFiles, skipReview: !reviewBeforeApply })}
                  disabled={poolScanLoading}
                >
                  <i className="fas fa-wrench"></i>
                  Execute
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'files' && (
      <div
        ref={panelContainerRef}
        className="audio-pool-container"
      >
        <DndContext
          sensors={dndSensors}
          onDragStart={handleDndDragStart}
          onDragEnd={handleDndDragEnd}
          onDragCancel={() => setDndDragFiles([])}
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
                <button className="icon-button" title="Go up (Backspace)" onClick={navigateToParentSource}>
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
              onFileDoubleClick={handleSourceFileDoubleClick}
              isLoading={isLoadingSource}
              emptyMessage={sourcePath ? 'No audio files found' : 'Select a folder to browse'}
              onEmptyClick={() => !sourcePath && browseSourceDirectory()}
              draggable={true}
              dndMode={true}
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
        <PoolDropZone osOver={isOverDropZone}>
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
                title="Go up (Backspace)"
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
            onFileDoubleClick={(file) => playFile(file)}
            isLoading={isLoadingDest}
            emptyMessage="No files in audio pool"
            tableId="dest"
            cursorIndex={cursorIndexDest}
            isActive={activePanel === 'dest'}
            onPanelClick={() => setActivePanel('dest')}
            onContextMenu={(e, file) => handleContextMenu(e, file, 'dest')}
            rowRefs={destRowRefs}
            poolRoot={audioPoolPath}
            searchRoot={destinationPath}
            onCompatMap={setDestCompatMap}
          />
        </PoolDropZone>

        <DragOverlay dropAnimation={null}>
          {dndDragFiles.length > 0 ? (
            <div style={{
              background: 'rgba(255, 102, 0, 0.9)',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '0.8rem',
              fontFamily: "'Courier New', monospace",
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
              {dndDragFiles.length === 1
                ? dndDragFiles[0].split(/[\\/]/).pop()
                : `${dndDragFiles.length} items`}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
      </div>
      )}

      {/* Transfer Queue Panel */}
      <TransferProgressPanel
        transfers={transfers}
        isOpen={isTransferQueueOpen}
        onClose={() => setIsTransferQueueOpen(false)}
        onCancelTransfer={cancelTransfer}
        onClearFinished={clearFinishedTransfers}
        onClearAll={clearAllTransfers}
        height={transferPaneHeight}
        onResizeStart={handleTransferResizeStart}
      />

      {/* Status bar (left) + sample player (right) share one row — Files tab only */}
      {activeTab === 'files' && (
      <div className="audio-pool-status">
        <div className="audio-pool-status-msg">
          {selectedSourceFiles.size > 0 && (
            <span>{selectedSourceFiles.size} file(s) selected - Drag to audio pool to copy</span>
          )}
          {selectedDestFiles.size > 0 && <span>{selectedDestFiles.size} file(s) selected in audio pool</span>}
          {selectedSourceFiles.size === 0 && selectedDestFiles.size === 0 && (
            <span>{isSourcePanelOpen ? 'Select files to copy' : 'Click "Import" to add files to audio pool'}</span>
          )}
        </div>
        <SamplePlayerBar player={player} playable={activePlayable} compact={isSourcePanelOpen} />
      </div>
      )}

      {/* Incompatible files list (Tools tab status summary) */}
      {showPoolList && (
        <PoolIncompatibleListModal
          poolPath={audioPoolPath}
          files={incompatibleFiles}
          onClose={() => setShowPoolList(false)}
        />
      )}

      {/* Fix incompatible pool files (Tools tab, or context-menu convert) */}
      {fixModal && (
        <FixPoolFilesModal
          poolPath={audioPoolPath}
          files={fixModal.files}
          skipReview={fixModal.skipReview}
          onClose={() => setFixModal(null)}
          onFixed={() => { loadDestinationFiles(destinationPath); setPoolScanKey(k => k + 1); }}
        />
      )}

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
                  className="context-menu-item"
                  disabled={contextMenu.file.is_directory || !isAudioFile(contextMenu.file.path)}
                  onClick={() => { if (contextMenu.file) playFile(contextMenu.file); closeContextMenu(); }}
                >
                  <i className="fas fa-play"></i> Play
                </button>
                <div className="context-menu-separator"></div>
                <button
                  className={`context-menu-item ${isMultipleSelected ? 'disabled' : ''}`}
                  onClick={isMultipleSelected ? undefined : handleRevealInExplorer}
                  disabled={isMultipleSelected}
                >
                  <i className="fas fa-folder-open"></i> Reveal in Explorer
                </button>
                <button
                  className={`context-menu-item ${isMultipleSelected ? 'disabled' : ''}`}
                  onClick={isMultipleSelected ? undefined : () => { if (contextMenu.file) navigator.clipboard.writeText(contextMenu.file.path); closeContextMenu(); }}
                  disabled={isMultipleSelected}
                >
                  <i className="fas fa-copy"></i> Copy path to clipboard
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
                {contextMenu.panel === 'dest' && (() => {
                  // Convert targets: the multi-selection when the clicked file is part of
                  // it, otherwise just the clicked file — restricted to incompatible ones
                  const targets = (isMultipleSelected
                    ? destinationFiles.filter(f => selectedDestFiles.has(f.path))
                    : [contextMenu.file])
                    .filter((f): f is AudioFile => !!f && !f.is_directory)
                    .filter(f => destCompatMap[f.path] && destCompatMap[f.path] !== 'compatible')
                    .map(f => ({ path: f.path, compatibility: destCompatMap[f.path] }));
                  return (
                    <button
                      className={`context-menu-item ${targets.length === 0 ? 'disabled' : ''}`}
                      disabled={targets.length === 0}
                      title={targets.length === 0 ? 'Already Octatrack-compatible' : undefined}
                      onClick={() => { setFixModal({ files: targets, skipReview: false }); closeContextMenu(); }}
                    >
                      <i className="fas fa-wrench"></i> Convert to Octatrack format{targets.length > 1 ? ` (${targets.length})` : ''}
                    </button>
                  );
                })()}
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
