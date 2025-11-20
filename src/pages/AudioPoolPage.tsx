import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
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
  const [autoPreview, setAutoPreview] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingDest, setIsLoadingDest] = useState(false);
  const [isTransferQueueOpen, setIsTransferQueueOpen] = useState(false);
  const [isSourcePanelOpen, setIsSourcePanelOpen] = useState(false);
  const [isOverDropZone, setIsOverDropZone] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

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

  // Auto-open transfer queue when transfers start
  useEffect(() => {
    const activeCount = transfers.filter(t => t.status === "copying" || t.status === "pending").length;
    if (activeCount > 0) {
      setIsTransferQueueOpen(true);
    }
  }, [transfers]);

  // Note: Real-time progress tracking removed for now due to technical limitations
  // Progress is shown as indeterminate while copying

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
      }
    } catch (error) {
      console.error("Error opening directory dialog:", error);
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
    if (file.is_directory) {
      setSourcePath(file.path);
      return;
    }

    const newSelected = new Set(selectedSourceFiles);

    if (event.shiftKey && lastClickedSourceIndex !== -1) {
      // Shift+click: select range
      const start = Math.min(lastClickedSourceIndex, index);
      const end = Math.max(lastClickedSourceIndex, index);
      for (let i = start; i <= end; i++) {
        if (!sourceFiles[i].is_directory) {
          newSelected.add(sourceFiles[i].path);
        }
      }
      setSelectedSourceFiles(newSelected);
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl+click: toggle selection
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedSourceFiles(newSelected);
      setLastClickedSourceIndex(index);
    } else {
      // Regular click: select only this item
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
      // Shift+click: select range
      const start = Math.min(lastClickedDestIndex, index);
      const end = Math.max(lastClickedDestIndex, index);
      for (let i = start; i <= end; i++) {
        if (!destinationFiles[i].is_directory) {
          newSelected.add(destinationFiles[i].path);
        }
      }
      setSelectedDestFiles(newSelected);
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl+click: toggle selection
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
      setSelectedDestFiles(newSelected);
      setLastClickedDestIndex(index);
    } else {
      // Regular click: select only this item
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

  // Drag and drop handlers
  function handleDragStart(e: React.DragEvent) {
    // Store the selected files in the drag data
    const filePaths = Array.from(selectedSourceFiles);
    e.dataTransfer.setData("application/json", JSON.stringify(filePaths));
    e.dataTransfer.effectAllowed = "copy";
    // Note: Custom drag image removed as it was causing freezing in Tauri
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
    // Only set to false if we're leaving the drop zone entirely
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

      // Get file info for the selected files
      const filesToCopy = sourceFiles.filter(f => sourcePaths.includes(f.path));

      setSelectedSourceFiles(new Set());

      // Process each file
      for (const file of filesToCopy) {
        // Generate a unique transfer ID
        const transferId = `${Date.now()}-${file.name}`;

        // Add transfer to queue
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

          // Mark as completed if not already marked by progress events
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

      // Refresh destination
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
          <h1 style={{ margin: 0 }}>{setName} - Audio Pool</h1>
          <button onClick={() => { loadSourceFiles(sourcePath); loadDestinationFiles(destinationPath); }} className="back-button refresh-button" disabled={isLoadingSource || isLoadingDest} title="Refresh file lists">
            ↻ Refresh
          </button>
          <Version />
        </div>
      </div>

      <div className={`audio-pool-container ${isSourcePanelOpen ? 'source-open' : 'source-closed'}`}>
        {/* Left Panel - Source (My Computer) */}
        <div className="audio-panel source-panel">
          <div className={`source-panel-header ${isSourcePanelOpen ? 'open' : 'closed'}`}>
            <div className="source-panel-toggle" onClick={() => setIsSourcePanelOpen(!isSourcePanelOpen)} title={isSourcePanelOpen ? 'Collapse source panel' : 'Expand source panel'}>
              <span className="collapse-indicator">{isSourcePanelOpen ? '◀' : '▶'}</span>
            </div>
            {isSourcePanelOpen && (
            <div className="panel-path">
            <input
              type="text"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="Select a folder..."
              className="path-input"
            />
            <div className="path-controls">
              <button className="icon-button" title="Browse..." onClick={browseSourceDirectory}>...</button>
              <button className="icon-button" title="Go up" onClick={navigateToParentSource}>↑</button>
            </div>
          </div>
            )}
          </div>

          {isSourcePanelOpen && (
          <div className="file-list-container">
            <table className="file-list">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>SIZE</th>
                  <th>CHANNELS</th>
                  <th>BIT RATE</th>
                  <th>SAMPLE RATE</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSource && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', opacity: 0.5 }}>
                      Loading...
                    </td>
                  </tr>
                )}
                {!isLoadingSource && sourceFiles.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: 'center', opacity: 0.5, cursor: sourcePath ? 'default' : 'pointer' }}
                      onClick={() => !sourcePath && browseSourceDirectory()}
                    >
                      {sourcePath ? 'No files found' : 'Select a folder to browse'}
                    </td>
                  </tr>
                )}
                {!isLoadingSource && sourceFiles.map((file, idx) => (
                  <tr
                    key={idx}
                    className={selectedSourceFiles.has(file.path) ? 'selected' : ''}
                    onClick={(e) => handleSourceFileClick(file, idx, e)}
                    draggable={!file.is_directory && selectedSourceFiles.has(file.path)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    style={{ cursor: file.is_directory ? 'pointer' : (selectedSourceFiles.has(file.path) ? 'grab' : 'pointer') }}
                  >
                    <td>{file.is_directory ? <span className="folder-icon">📂 </span> : ''}{file.name}</td>
                    <td>{file.size ? formatFileSize(file.size) : ''}</td>
                    <td>{file.channels || ''}</td>
                    <td>{file.bit_rate || ''}</td>
                    <td>{file.sample_rate ? `${(file.sample_rate / 1000).toFixed(1)} kHz` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* Right Panel - Destination (Samples) */}
        <div
          className={`audio-panel dest-panel ${isOverDropZone ? 'drop-zone-active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="panel-path">
            <input
              type="text"
              value={destinationPath}
              readOnly
              placeholder="/"
              className="path-input"
            />
            <div className="path-controls">
              <button
                className="icon-button"
                title="Reset to AUDIO directory"
                onClick={resetToAudioRoot}
                disabled={destinationPath === audioPoolPath}
              >⌂</button>
              <button
                className="icon-button"
                title="Go up"
                onClick={navigateToParentDest}
                disabled={destinationPath === audioPoolPath}
              >↑</button>
            </div>
          </div>

          <div className="file-list-container">
            <table className="file-list">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>SIZE</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingDest && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', opacity: 0.5 }}>
                      Loading...
                    </td>
                  </tr>
                )}
                {!isLoadingDest && destinationFiles.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', opacity: 0.5 }}>
                      No files in audio pool
                    </td>
                  </tr>
                )}
                {!isLoadingDest && destinationFiles.map((file, idx) => (
                  <tr
                    key={idx}
                    className={selectedDestFiles.has(file.path) ? 'selected' : ''}
                    onClick={(e) => handleDestFileClick(file, idx, e)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{file.is_directory ? <span className="folder-icon">📂 </span> : ''}{file.name}</td>
                    <td>{file.size ? formatFileSize(file.size) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="audio-pool-controls">
        <div className="preview-controls">
          <label>
            <input
              type="checkbox"
              checked={autoPreview}
              onChange={(e) => setAutoPreview(e.target.checked)}
            />
            <span style={{ marginLeft: '0.5rem' }}>Auto Preview</span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="volume-slider"
          />
          <span>{volume}</span>
        </div>
        <div className="status-info">
          {selectedSourceFiles.size > 0 && (
            <span>
              {selectedSourceFiles.size} file(s) selected - Drag to audio pool to copy
            </span>
          )}
          {selectedDestFiles.size > 0 && <span>{selectedDestFiles.size} file(s) selected in audio pool</span>}
          {selectedSourceFiles.size === 0 && selectedDestFiles.size === 0 && <span>Select files to copy</span>}
        </div>
      </div>

      {/* Transfer Queue */}
      <div className={`transfer-queue ${isTransferQueueOpen ? 'open' : 'collapsed'}`}>
        <div className="transfer-header" onClick={() => setIsTransferQueueOpen(!isTransferQueueOpen)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="collapse-indicator">{isTransferQueueOpen ? '▼' : '▶'}</span>
            <h3>Transfers</h3>
          </div>
          <div className="transfer-controls">
            <label>
              <input type="checkbox" defaultChecked />
              <span style={{ marginLeft: '0.5rem' }}>Auto-Scroll</span>
            </label>
            <button
              className="transfer-button"
              onClick={(e) => { e.stopPropagation(); clearAllTransfers(); }}
            >
              Clear all
            </button>
            <button
              className="transfer-button"
              onClick={(e) => { e.stopPropagation(); clearFinishedTransfers(); }}
            >
              Clear finished
            </button>
          </div>
        </div>
        {isTransferQueueOpen && (
          <table className="transfer-list">
          <thead>
            <tr>
              <th>#</th>
              <th>PROGRESS</th>
              <th>FILE</th>
              <th>SIZE</th>
              <th>STATUS</th>
              <th>SPEED</th>
              <th>DIRECTION</th>
              <th>TIME LEFT</th>
              <th>INFO</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>
                  No transfers
                </td>
              </tr>
            ) : (
              transfers.map((transfer, idx) => (
                <tr key={transfer.id} className={`transfer-row transfer-${transfer.status}`}>
                  <td>{idx + 1}</td>
                  <td>
                    <div className="progress-container">
                      <div
                        className="progress-bar"
                        style={{
                          width: `${(transfer.bytesTransferred / transfer.fileSize) * 100}%`
                        }}
                      />
                      <span className="progress-text">
                        {((transfer.bytesTransferred / transfer.fileSize) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td title={transfer.fileName}>{transfer.fileName}</td>
                  <td>{formatFileSize(transfer.fileSize)}</td>
                  <td>
                    <span className={`status-badge status-${transfer.status}`}>
                      {transfer.status}
                    </span>
                  </td>
                  <td>{transfer.speed ? formatSpeed(transfer.speed) : '--'}</td>
                  <td>→</td>
                  <td>{transfer.timeLeft ? formatTime(transfer.timeLeft) : '--'}</td>
                  <td>{transfer.error || ''}</td>
                  <td>
                    {(transfer.status === "copying" || transfer.status === "pending") && (
                      <button
                        className="icon-button"
                        onClick={() => cancelTransfer(transfer.id)}
                        title="Cancel transfer"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        )}
      </div>
    </main>
  );
}
