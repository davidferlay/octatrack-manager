import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { AudioFileTable } from "./AudioFileTable";
import type { AudioFile } from "../types/audioFile";
import "./AudioPoolSidebar.css";

interface AudioPoolSidebarProps {
  audioPoolPath: string;
  isEditMode: boolean;
  toggleButton?: ReactNode;
  dndMode?: boolean;
  refreshKey?: number;
  onCurrentPathChange?: (path: string) => void;
  /** Import audio files from the system into the given pool directory. */
  onImport?: (paths: string[], destDir: string) => void;
  /** Assign the given files to the first empty sample slot (Edit mode only). */
  onAssignToFirstEmpty?: (paths: string[]) => void;
  /** Whether at least one empty sample slot exists (enables "Assign to first empty slot"). */
  hasEmptySlot?: boolean;
  /** Assign the given files starting at the currently-selected slot (Edit mode only). */
  onAssignToSelected?: (paths: string[]) => void;
  /** Whether at least one sample slot is currently selected (enables "Assign to selected slot"). */
  hasSelectedSlot?: boolean;
  /** Open the full Audio Pool page for this Set. */
  onOpenAudioPoolPage?: () => void;
  /** Session-storage key prefix for remembering browsed dir + scroll across navigation. */
  persistKey?: string;
}

export function AudioPoolSidebar({ audioPoolPath, isEditMode, toggleButton, dndMode = false, refreshKey, onCurrentPathChange, onImport, onAssignToFirstEmpty, hasEmptySlot = true, onAssignToSelected, hasSelectedSlot, onOpenAudioPoolPage, persistKey }: AudioPoolSidebarProps) {
  // Restore the last-browsed directory (only if it still sits under this pool root).
  const [currentPath, setCurrentPath] = useState(() => {
    if (persistKey) {
      const saved = sessionStorage.getItem(`${persistKey}:dir`);
      if (saved && saved.startsWith(audioPoolPath)) return saved;
    }
    return audioPoolPath;
  });
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [lastClickedIndex, setLastClickedIndex] = useState(-1);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = moveEvent.clientX;
      // Clamp between 250px and 70% of viewport
      const maxWidth = window.innerWidth * 0.7;
      const clampedWidth = Math.max(250, Math.min(newWidth, maxWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Reset path only when the pool root actually changes (not on mount — that would
  // clobber a restored directory).
  const prevPoolRef = useRef(audioPoolPath);
  useEffect(() => {
    if (prevPoolRef.current !== audioPoolPath) {
      prevPoolRef.current = audioPoolPath;
      setCurrentPath(audioPoolPath);
    }
  }, [audioPoolPath]);

  // Report path changes to parent + remember for next visit
  useEffect(() => {
    onCurrentPathChange?.(currentPath);
    if (persistKey) sessionStorage.setItem(`${persistKey}:dir`, currentPath);
  }, [currentPath, onCurrentPathChange, persistKey]);

  // Load files when path changes or refresh is requested
  useEffect(() => {
    loadFiles(currentPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, refreshKey]);

  async function loadFiles(path: string) {
    if (!path) return;
    setIsLoading(true);
    try {
      const result = await invoke<AudioFile[]>("list_audio_directory", { path });
      setFiles(result);
      setSelectedFiles(new Set());
      setCursorIndex(-1);
      setLastClickedIndex(-1);
    } catch (error) {
      console.error("Error loading audio pool files:", error);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }

  function navigateUp() {
    // Don't navigate above the audio pool root
    if (currentPath === audioPoolPath) return;
    const parent = currentPath.replace(/[/\\][^/\\]+$/, '');
    if (parent.length >= audioPoolPath.length) {
      setCurrentPath(parent);
    } else {
      setCurrentPath(audioPoolPath);
    }
  }

  // Get breadcrumb path relative to AUDIO/ root
  function getRelativePath(): string {
    if (currentPath === audioPoolPath) return "AUDIO/";
    const relative = currentPath.slice(audioPoolPath.length);
    // Remove leading separator
    const clean = relative.replace(/^[/\\]/, '');
    return `AUDIO/${clean}/`;
  }

  function handleFileClick(file: AudioFile, index: number, event: React.MouseEvent) {
    // Click on directory navigates into it (unless modifier key)
    if (file.is_directory && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      setCurrentPath(file.path);
      return;
    }

    // Don't select directories
    if (file.is_directory) return;

    const newSelected = new Set(selectedFiles);

    if (event.shiftKey && lastClickedIndex !== -1) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      for (let i = start; i <= end; i++) {
        if (!files[i].is_directory) {
          newSelected.add(files[i].path);
        }
      }
      setSelectedFiles(newSelected);
      setCursorIndex(index);
    } else if (event.ctrlKey || event.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedFiles(newSelected);
      setLastClickedIndex(index);
      setCursorIndex(index);
    } else {
      newSelected.clear();
      newSelected.add(file.path);
      setSelectedFiles(newSelected);
      setLastClickedIndex(index);
      setCursorIndex(index);
    }
  }

  function handleDragStart(e: React.DragEvent) {
    // Build drag data with selected file paths
    const selectedPaths = Array.from(selectedFiles);
    if (selectedPaths.length === 0) return;

    const dragData = JSON.stringify({
      source: "audio-pool-sidebar",
      files: selectedPaths,
    });

    e.dataTransfer.setData("application/json", dragData);
    e.dataTransfer.setData("text/x-source", "audio-pool-sidebar");
    e.dataTransfer.effectAllowed = "copy";
  }

  // Right-click context menu on pool items
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; file: AudioFile } | null>(null);

  useEffect(() => {
    if (!itemMenu) return;
    const close = () => setItemMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setItemMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [itemMenu]);

  function handleItemContextMenu(e: React.MouseEvent, file: AudioFile | null) {
    if (!file || file.is_directory) return;
    e.preventDefault();
    setItemMenu({ x: e.clientX, y: e.clientY, file });
  }

  // Files to act on: the multi-selection if the right-clicked file is part of it, else just that file.
  function menuTargets(file: AudioFile): string[] {
    return selectedFiles.has(file.path) ? Array.from(selectedFiles) : [file.path];
  }

  // Import dropdown (Files… / Folder…) — mirrors the Audio Pool page.
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  useEffect(() => {
    if (!importMenuOpen) return;
    const close = () => setImportMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [importMenuOpen]);

  async function handleImportFiles() {
    const selected = await openFileDialog({
      multiple: true,
      filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length > 0) onImport?.(paths, currentPath);
  }

  async function handleImportFolder() {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    // The transfer pipeline copies file-by-file, so expand the folder into its audio files (recursively).
    const files = await invoke<string[]>("list_audio_files_recursive", { path: selected });
    if (files.length > 0) onImport?.(files, currentPath);
  }

  const isAtRoot = currentPath === audioPoolPath;

  return (
    <div
      className="audio-pool-sidebar"
      ref={sidebarRef}
      style={sidebarWidth ? { width: `${sidebarWidth}px` } : undefined}
    >
      <AudioFileTable
        files={files}
        selectedFiles={selectedFiles}
        onFileClick={handleFileClick}
        isLoading={isLoading}
        emptyMessage="No audio files"
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={() => {}}
        tableId="audio-pool-sidebar"
        cursorIndex={cursorIndex}
        isActive={true}
        rowRefs={rowRefs}
        dndMode={dndMode}
        initialColumnVisibility={{ format: false, bitrate: false, samplerate: false }}
        scrollStorageKey={persistKey ? `${persistKey}:scroll` : undefined}
        onContextMenu={handleItemContextMenu}
        headerPrefix={
          <>
            {toggleButton}
            {onOpenAudioPoolPage && (
              <button
                className="audio-pool-page-btn"
                onClick={onOpenAudioPoolPage}
                title="Open the Audio Pool page for this Set"
              >
                <i className="fas fa-up-right-from-square"></i>
              </button>
            )}
            <div className="sidebar-import-dropdown" onClick={(e) => e.stopPropagation()}>
              <button
                className={`sidebar-back-btn ${importMenuOpen ? 'active' : ''}`}
                onClick={() => setImportMenuOpen(o => !o)}
                title="Import audio into this Audio Pool directory"
              >
                <i className="fas fa-file-import"></i>
                <i className="fas fa-caret-down" style={{ marginLeft: '0.2rem', fontSize: '0.6rem' }}></i>
              </button>
              {importMenuOpen && (
                <div className="import-dropdown-menu">
                  <button className="import-dropdown-item" onClick={() => { setImportMenuOpen(false); handleImportFiles(); }}>
                    <i className="fas fa-file-audio"></i> Files…
                  </button>
                  <button className="import-dropdown-item" onClick={() => { setImportMenuOpen(false); handleImportFolder(); }}>
                    <i className="fas fa-folder"></i> Folder…
                  </button>
                </div>
              )}
            </div>
          </>
        }
      />
      <div className="sidebar-path-row" title={getRelativePath()}>
        <button
          className="icon-button"
          onClick={navigateUp}
          disabled={isAtRoot}
          title="Go up"
        >
          <i className="fas fa-arrow-up"></i>
        </button>
        <span className="sidebar-path">{getRelativePath()}</span>
      </div>
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleResizeStart}
      />
      {itemMenu && (
        <div
          className="context-menu"
          style={{ position: 'fixed', top: itemMenu.y, left: itemMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            disabled={!isEditMode || !hasEmptySlot}
            title={!isEditMode ? 'Toggle Edit mode to assign to slots' : (!hasEmptySlot ? 'No empty slot available' : undefined)}
            onClick={() => { onAssignToFirstEmpty?.(menuTargets(itemMenu.file)); setItemMenu(null); }}
          >
            <i className="fas fa-arrow-right"></i> Assign to first empty slot
          </button>
          {hasSelectedSlot && (
            <button
              className="context-menu-item"
              disabled={!isEditMode}
              title={!isEditMode ? 'Toggle Edit mode to assign to slots' : undefined}
              onClick={() => { onAssignToSelected?.(menuTargets(itemMenu.file)); setItemMenu(null); }}
            >
              <i className="fas fa-crosshairs"></i> Assign to selected slot
            </button>
          )}
        </div>
      )}
    </div>
  );
}
