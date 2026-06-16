import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
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
}

export function AudioPoolSidebar({ audioPoolPath, toggleButton, dndMode = false, refreshKey, onCurrentPathChange }: AudioPoolSidebarProps) {
  const [currentPath, setCurrentPath] = useState(audioPoolPath);
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

  // Reset path when audioPoolPath changes
  useEffect(() => {
    setCurrentPath(audioPoolPath);
  }, [audioPoolPath]);

  // Report path changes to parent
  useEffect(() => {
    onCurrentPathChange?.(currentPath);
  }, [currentPath, onCurrentPathChange]);

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
        headerPrefix={
          <>
            {toggleButton}
            <button
              className="sidebar-back-btn"
              onClick={navigateUp}
              disabled={isAtRoot}
              title="Go up one directory"
            >
              <i className="fas fa-arrow-left"></i>
            </button>
          </>
        }
      />
      <div className="sidebar-path-row" title={getRelativePath()}>
        <span className="sidebar-path">{getRelativePath()}</span>
      </div>
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
