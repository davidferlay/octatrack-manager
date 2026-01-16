import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjects } from "../context/ProjectsContext";
import type { Bank } from "../context/ProjectsContext";
import { formatBankName } from "./BankSelector";
import "../App.css";

const TOOLS_STORAGE_KEY_PREFIX = "octatrack-tools-settings-";

// Operation types
type OperationType = "copy_bank" | "copy_parts" | "copy_patterns" | "copy_tracks" | "copy_sample_slots";

// Part assignment modes for copy_patterns
type PartAssignmentMode = "keep_original" | "copy_source_part" | "select_specific";

// Track mode for copy_patterns
type TrackMode = "all" | "specific";

// Copy mode for copy_tracks
type CopyTrackMode = "part_params" | "pattern_triggers" | "both";

// Slot type for copy_sample_slots
type SlotType = "static" | "flex" | "both";

// Audio mode for copy_sample_slots
type AudioMode = "none" | "copy" | "move_to_pool";

interface AudioPoolStatus {
  exists: boolean;
  path: string | null;
  set_path: string | null;
}

interface ToolsPanelProps {
  projectPath: string;
  projectName: string;
  banks: Bank[];
  loadedBankIndices: Set<number>;
  onBankUpdated?: (bankIndex: number) => void;
}

interface ProjectOption {
  name: string;
  path: string;
}

interface ToolsSettings {
  operation: OperationType;
  partAssignmentMode: PartAssignmentMode;
  trackMode: TrackMode;
  copyTrackMode: CopyTrackMode;
  slotType: SlotType;
  audioMode: AudioMode;
  includeEditorSettings: boolean;
}

function loadToolsSettings(projectPath: string): Partial<ToolsSettings> {
  try {
    const key = TOOLS_STORAGE_KEY_PREFIX + projectPath;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Error loading tools settings:", error);
  }
  return {};
}

function saveToolsSettings(projectPath: string, settings: ToolsSettings): void {
  try {
    const key = TOOLS_STORAGE_KEY_PREFIX + projectPath;
    sessionStorage.setItem(key, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving tools settings:", error);
  }
}

interface ScanResult {
  locations: OctatrackLocation[];
  standalone_projects: OctatrackProject[];
}

interface OctatrackProject {
  name: string;
  path: string;
  has_project_file: boolean;
  has_banks: boolean;
}

interface OctatrackSet {
  name: string;
  path: string;
  has_audio_pool: boolean;
  projects: OctatrackProject[];
}

interface OctatrackLocation {
  name: string;
  path: string;
  device_type: "CompactFlash" | "Usb" | "LocalCopy";
  sets: OctatrackSet[];
}

export function ToolsPanel({ projectPath, projectName, banks, loadedBankIndices, onBankUpdated }: ToolsPanelProps) {
  const { locations, standaloneProjects, setLocations, setStandaloneProjects, setHasScanned } = useProjects();

  // Load saved settings (per-project, session-only)
  const savedSettings = loadToolsSettings(projectPath);

  // Operation selection
  const [operation, setOperation] = useState<OperationType>(savedSettings.operation || "copy_bank");

  // Source selection (current project only)
  const [sourceBankIndex, setSourceBankIndex] = useState<number>(0);
  const [sourcePartIndices, setSourcePartIndices] = useState<number[]>([0]);
  const [sourcePatternIndices, setSourcePatternIndices] = useState<number[]>([0]);
  const [sourceTrackIndices, setSourceTrackIndices] = useState<number[]>([0]);
  const [sourceSampleIndices, setSourceSampleIndices] = useState<number[]>(Array.from({ length: 128 }, (_, i) => i));

  // Destination selection
  const [destProject, setDestProject] = useState<string>(projectPath);
  const [destBankIndex, setDestBankIndex] = useState<number>(0);
  const [destBankIndices, setDestBankIndices] = useState<number[]>([0]); // For copy_bank multi-select
  const [destPartIndices, setDestPartIndices] = useState<number[]>([0]);
  const [destPatternStart, setDestPatternStart] = useState<number>(0);
  const [destTrackIndices, setDestTrackIndices] = useState<number[]>([0]);
  const [destSampleIndices, setDestSampleIndices] = useState<number[]>(Array.from({ length: 128 }, (_, i) => i));

  // Operation-specific options
  // Copy Patterns options
  const [partAssignmentMode, setPartAssignmentMode] = useState<PartAssignmentMode>(savedSettings.partAssignmentMode || "keep_original");
  const [destPart, setDestPart] = useState<number>(-1); // -1 = no selection
  const [trackMode, setTrackMode] = useState<TrackMode>(savedSettings.trackMode || "all");

  // Copy Tracks options
  const [copyTrackMode, setCopyTrackMode] = useState<CopyTrackMode>(savedSettings.copyTrackMode || "both");
  const [sourcePartIndex, setSourcePartIndex] = useState<number>(-1); // -1 = All parts
  const [destPartIndex, setDestPartIndex] = useState<number>(-1); // -1 = All parts

  // Copy Sample Slots options
  const [slotType, setSlotType] = useState<SlotType>(savedSettings.slotType || "both");
  const [audioMode, setAudioMode] = useState<AudioMode>(savedSettings.audioMode || "move_to_pool");
  const [includeEditorSettings, setIncludeEditorSettings] = useState<boolean>(savedSettings.includeEditorSettings ?? true);
  const userChangedAudioMode = useRef<boolean>(!!savedSettings.audioMode);

  // Audio Pool status
  const [audioPoolStatus, setAudioPoolStatus] = useState<AudioPoolStatus | null>(null);
  const [sameSetStatus, setSameSetStatus] = useState<boolean>(false);

  // UI state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [showProgress, setShowProgress] = useState<boolean>(false);
  const [progressFading, setProgressFading] = useState<boolean>(false);
  const [executingDetails, setExecutingDetails] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusType, setStatusType] = useState<"success" | "error" | "info" | "">("");
  const [showProjectSelector, setShowProjectSelector] = useState<boolean>(false);
  const [openSetsInModal, setOpenSetsInModal] = useState<Set<string>>(new Set()); // Track which sets are open in modal
  const [openLocationsInModal, setOpenLocationsInModal] = useState<Set<number>>(new Set()); // Track which locations are open in modal
  const [isIndividualProjectsOpenInModal, setIsIndividualProjectsOpenInModal] = useState<boolean>(false);
  const [isLocationsOpenInModal, setIsLocationsOpenInModal] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [browsedProject, setBrowsedProject] = useState<{ name: string; path: string } | null>(null);


  // Rescan for devices
  async function handleRescan() {
    setIsScanning(true);
    try {
      const result = await invoke<ScanResult>("scan_devices");
      const sortedLocations = [...result.locations].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      const sortedStandaloneProjects = [...result.standalone_projects].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      setLocations(sortedLocations);
      setStandaloneProjects(sortedStandaloneProjects);
      setHasScanned(true);
    } catch (error) {
      console.error("Error scanning devices:", error);
    } finally {
      setIsScanning(false);
    }
  }

  // Browse for a project folder
  async function handleBrowse() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Octatrack Project Folder",
      });
      if (selected && typeof selected === 'string') {
        // Validate that the selected folder is a valid Octatrack project
        try {
          const result = await invoke<ScanResult>("scan_custom_directory", { path: selected });

          // Check if the selected path is a valid project
          let validProject: OctatrackProject | null = null;

          // Check standalone projects
          validProject = result.standalone_projects.find(p => p.path === selected && p.has_project_file) || null;

          // Check projects in locations/sets
          if (!validProject) {
            for (const location of result.locations) {
              for (const set of location.sets) {
                const found = set.projects.find(p => p.path === selected && p.has_project_file);
                if (found) {
                  validProject = found;
                  break;
                }
              }
              if (validProject) break;
            }
          }

          if (validProject) {
            setBrowsedProject({ name: validProject.name, path: validProject.path });
            setDestProject(validProject.path);
            setShowProjectSelector(false);
          } else {
            setShowProjectSelector(false);
            setStatusMessage("Selected folder is not a valid Octatrack project. Please select a folder containing a project.oct file.");
            setStatusType("error");
          }
        } catch (err) {
          setShowProjectSelector(false);
          setStatusMessage("Failed to validate project folder: " + String(err));
          setStatusType("error");
        }
      }
    } catch (error) {
      console.error("Error browsing for project:", error);
    }
  }

  // Save settings to sessionStorage when they change (per-project, session-only)
  useEffect(() => {
    saveToolsSettings(projectPath, {
      operation,
      partAssignmentMode,
      trackMode,
      copyTrackMode,
      slotType,
      audioMode,
      includeEditorSettings,
    });
  }, [projectPath, operation, partAssignmentMode, trackMode, copyTrackMode, slotType, audioMode, includeEditorSettings]);

  // Collect all available projects from context
  const availableProjects: ProjectOption[] = [];

  // Add current project first
  availableProjects.push({ name: projectName + " (Current)", path: projectPath });

  // Add projects from locations (Sets)
  locations.forEach((location) => {
    location.sets.forEach((set) => {
      set.projects.forEach((project) => {
        if (project.path !== projectPath && project.has_project_file) {
          availableProjects.push({ name: `${project.name} (${set.name})`, path: project.path });
        }
      });
    });
  });

  // Add standalone projects
  standaloneProjects.forEach((project) => {
    if (project.path !== projectPath && project.has_project_file) {
      availableProjects.push({ name: project.name, path: project.path });
    }
  });

  // Helper to get display info for selected destination project
  function getDestProjectInfo(): { name: string; setName?: string; isCurrentProject: boolean } {
    if (destProject === projectPath) {
      return { name: projectName, isCurrentProject: true };
    }
    // Check in locations
    for (const location of locations) {
      for (const set of location.sets) {
        const project = set.projects.find(p => p.path === destProject);
        if (project) {
          return { name: project.name, setName: set.name, isCurrentProject: false };
        }
      }
    }
    // Check in standalone projects
    const standalone = standaloneProjects.find(p => p.path === destProject);
    if (standalone) {
      return { name: standalone.name, isCurrentProject: false };
    }
    return { name: "Unknown", isCurrentProject: false };
  }

  const destProjectInfo = getDestProjectInfo();

  // Check audio pool status when destination project changes
  useEffect(() => {
    async function checkAudioPool() {
      if (destProject && operation === "copy_sample_slots") {
        try {
          const status = await invoke<AudioPoolStatus>("get_audio_pool_status", { projectPath });
          setAudioPoolStatus(status);

          if (destProject !== projectPath) {
            const sameSet = await invoke<boolean>("check_projects_in_same_set", {
              project1: projectPath,
              project2: destProject,
            });
            setSameSetStatus(sameSet);
          } else {
            setSameSetStatus(true);
          }
        } catch (err) {
          console.error("Error checking audio pool:", err);
          setAudioPoolStatus(null);
          setSameSetStatus(false);
        }
      }
    }
    checkAudioPool();
  }, [destProject, projectPath, operation]);

  // Track previous sameSetStatus to detect transitions
  const prevSameSetStatus = useRef<boolean | null>(null);

  // Adjust audio mode based on sameSetStatus transitions
  useEffect(() => {
    // When projects are no longer in same set, fall back to "copy" if on "move_to_pool"
    if (prevSameSetStatus.current === true && !sameSetStatus && audioMode === "move_to_pool") {
      setAudioMode("copy");
    }
    // When projects become in same set, switch back to "move_to_pool" if on "copy"
    // (only if user hasn't manually selected an option)
    if (prevSameSetStatus.current === false && sameSetStatus && audioMode === "copy" && !userChangedAudioMode.current) {
      setAudioMode("move_to_pool");
    }
    prevSameSetStatus.current = sameSetStatus;
  }, [audioMode, sameSetStatus]);

  // Sync destination sample indices with source sample indices count
  useEffect(() => {
    const start = destSampleIndices[0] || 0;
    const count = sourceSampleIndices.length;
    setDestSampleIndices(Array.from({ length: count }, (_, i) => Math.min(127, start + i)));
  }, [sourceSampleIndices.length]);

  // Helper to get operation details for display
  function getExecutingDetails(): string {
    switch (operation) {
      case "copy_bank":
        return `Copying Bank ${String.fromCharCode(65 + sourceBankIndex)} to ${destBankIndices.length} bank${destBankIndices.length > 1 ? 's' : ''}...`;
      case "copy_parts":
        return sourcePartIndices.length === 4
          ? "Copying all parts..."
          : `Copying part to ${destPartIndices.length} destination${destPartIndices.length > 1 ? 's' : ''}...`;
      case "copy_patterns":
        return `Copying ${sourcePatternIndices.length} pattern${sourcePatternIndices.length > 1 ? 's' : ''}...`;
      case "copy_tracks":
        return `Copying ${sourceTrackIndices.length} track${sourceTrackIndices.length > 1 ? 's' : ''}...`;
      case "copy_sample_slots": {
        const slotCount = sourceSampleIndices.length;
        const audioInfo = audioMode === "copy" ? " + audio files" : audioMode === "move_to_pool" ? " + moving to pool" : "";
        return `Copying ${slotCount} sample slot${slotCount > 1 ? 's' : ''}${audioInfo}...`;
      }
      default:
        return "Processing...";
    }
  }

  // Execute operation
  async function executeOperation() {
    setIsExecuting(true);
    setShowProgress(true);
    setProgressFading(false);
    setExecutingDetails(getExecutingDetails());
    setStatusMessage("");
    setStatusType("");

    try {
      switch (operation) {
        case "copy_bank":
          await invoke("copy_bank", {
            sourceProject: projectPath,
            sourceBankIndex,
            destProject,
            destBankIndices,
          });
          setStatusMessage(`Bank ${String.fromCharCode(65 + sourceBankIndex)} copied to ${destBankIndices.length} bank${destBankIndices.length > 1 ? 's' : ''} successfully`);
          if (destProject === projectPath && onBankUpdated) {
            destBankIndices.forEach(idx => onBankUpdated(idx));
          }
          break;

        case "copy_parts":
          await invoke("copy_parts", {
            sourceProject: projectPath,
            sourceBankIndex,
            sourcePartIndices,
            destProject,
            destBankIndex,
            destPartIndices,
          });
          setStatusMessage(sourcePartIndices.length === 4
            ? "All parts copied successfully"
            : `Part copied to ${destPartIndices.length} destination${destPartIndices.length > 1 ? 's' : ''} successfully`);
          if (destProject === projectPath && onBankUpdated) {
            onBankUpdated(destBankIndex);
          }
          break;

        case "copy_patterns":
          await invoke("copy_patterns", {
            sourceProject: projectPath,
            sourceBankIndex,
            sourcePatternIndices,
            destProject,
            destBankIndex,
            destPatternStart,
            partAssignmentMode,
            destPart: partAssignmentMode === "select_specific" ? destPart : null,
            trackMode,
            trackIndices: trackMode === "specific" ? sourceTrackIndices : null,
          });
          setStatusMessage(`${sourcePatternIndices.length} pattern${sourcePatternIndices.length > 1 ? 's' : ''} copied successfully`);
          if (destProject === projectPath && onBankUpdated) {
            onBankUpdated(destBankIndex);
          }
          break;

        case "copy_tracks":
          await invoke("copy_tracks", {
            sourceProject: projectPath,
            sourceBankIndex,
            sourcePartIndex: sourcePartIndex === -1 ? null : sourcePartIndex, // null = all parts
            sourceTrackIndices,
            destProject,
            destBankIndex,
            destPartIndex: destPartIndex === -1 ? null : destPartIndex, // null = all parts
            destTrackIndices,
            mode: copyTrackMode,
          });
          setStatusMessage(`${sourceTrackIndices.length} track${sourceTrackIndices.length > 1 ? 's' : ''} copied successfully`);
          if (destProject === projectPath && onBankUpdated) {
            onBankUpdated(destBankIndex);
          }
          break;

        case "copy_sample_slots":
          // Convert 0-based indices to 1-based for backend
          await invoke("copy_sample_slots", {
            sourceProject: projectPath,
            destProject,
            slotType,
            sourceIndices: sourceSampleIndices.map(i => i + 1),
            destIndices: destSampleIndices.map(i => i + 1),
            audioMode,
            includeEditorSettings,
          });
          setStatusMessage(`${sourceSampleIndices.length} sample slot${sourceSampleIndices.length > 1 ? 's' : ''} copied successfully`);
          break;
      }
      setStatusType("success");
    } catch (err) {
      setStatusMessage(String(err));
      setStatusType("error");
    } finally {
      setIsExecuting(false);
      setProgressFading(true);
      setTimeout(() => {
        setShowProgress(false);
        setProgressFading(false);
        setExecutingDetails("");
      }, 300);
    }
  }

  // Multi-select helpers
  function toggleIndex(indices: number[], index: number, setIndices: (arr: number[]) => void) {
    if (indices.includes(index)) {
      if (indices.length > 1) {
        setIndices(indices.filter((i) => i !== index));
      }
    } else {
      setIndices([...indices, index].sort((a, b) => a - b));
    }
  }

  function selectAllIndices(max: number, setIndices: (arr: number[]) => void) {
    setIndices(Array.from({ length: max }, (_, i) => i));
  }

  return (
    <div className="tools-panel">
      {/* Operation Selector */}
      <div className="tools-section">
        <label className="tools-label">Operation</label>
        <select
          className="tools-select"
          value={operation}
          onChange={(e) => setOperation(e.target.value as OperationType)}
        >
          <option value="copy_bank">Copy Banks</option>
          <option value="copy_parts">Copy Parts</option>
          <option value="copy_patterns">Copy Patterns</option>
          <option value="copy_tracks">Copy Tracks</option>
          <option value="copy_sample_slots">Copy Sample Slots</option>
        </select>
      </div>

      <div className="tools-panels">
        {/* Source Panel */}
        <div className="tools-source-panel">
          <h3>Source</h3>

          {/* Bank selector for bank-related operations (except copy_tracks) */}
          {(operation === "copy_bank" || operation === "copy_parts") && (
            <div className="tools-field">
              <label>Bank</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${sourceBankIndex === idx ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
                      onClick={() => loadedBankIndices.has(idx) && setSourceBankIndex(sourceBankIndex === idx ? -1 : idx)}
                      disabled={!loadedBankIndices.has(idx)}
                      title={loadedBankIndices.has(idx) ? (banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${String.fromCharCode(65 + idx)}`) : "Bank not loaded"}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${sourceBankIndex === idx ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
                      onClick={() => loadedBankIndices.has(idx) && setSourceBankIndex(sourceBankIndex === idx ? -1 : idx)}
                      disabled={!loadedBankIndices.has(idx)}
                      title={loadedBankIndices.has(idx) ? (banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${String.fromCharCode(65 + idx)}`) : "Bank not loaded"}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bank selector for copy_patterns - stacked layout */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Bank</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${sourceBankIndex === idx ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
                      onClick={() => loadedBankIndices.has(idx) && setSourceBankIndex(idx)}
                      disabled={!loadedBankIndices.has(idx)}
                      title={loadedBankIndices.has(idx) ? (banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${String.fromCharCode(65 + idx)}`) : "Bank not loaded"}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${sourceBankIndex === idx ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
                      onClick={() => loadedBankIndices.has(idx) && setSourceBankIndex(idx)}
                      disabled={!loadedBankIndices.has(idx)}
                      title={loadedBankIndices.has(idx) ? (banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${String.fromCharCode(65 + idx)}`) : "Bank not loaded"}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Part selector for copy_parts - single select or All */}
          {operation === "copy_parts" && (
            <div className="tools-field">
              <label>Part</label>
              <div className="tools-part-cross">
                <div className="tools-part-cross-row">
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${(sourcePartIndices.length === 1 && sourcePartIndices.includes(0)) || sourcePartIndices.length === 4 ? "selected" : ""}`}
                    onClick={() => {
                      if (sourcePartIndices.length === 1 && sourcePartIndices.includes(0)) {
                        setSourcePartIndices([]);
                      } else {
                        setSourcePartIndices([0]);
                      }
                    }}
                  >
                    1
                  </button>
                </div>
                <div className="tools-part-cross-row">
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${(sourcePartIndices.length === 1 && sourcePartIndices.includes(3)) || sourcePartIndices.length === 4 ? "selected" : ""}`}
                    onClick={() => {
                      if (sourcePartIndices.length === 1 && sourcePartIndices.includes(3)) {
                        setSourcePartIndices([]);
                      } else {
                        setSourcePartIndices([3]);
                      }
                    }}
                  >
                    4
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn part-all ${sourcePartIndices.length === 4 ? "selected" : ""}`}
                    onClick={() => {
                      if (sourcePartIndices.length === 4) {
                        setSourcePartIndices([]);
                        setDestPartIndices([]);
                      } else {
                        setSourcePartIndices([0, 1, 2, 3]);
                        setDestPartIndices([0, 1, 2, 3]);
                      }
                    }}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${(sourcePartIndices.length === 1 && sourcePartIndices.includes(1)) || sourcePartIndices.length === 4 ? "selected" : ""}`}
                    onClick={() => {
                      if (sourcePartIndices.length === 1 && sourcePartIndices.includes(1)) {
                        setSourcePartIndices([]);
                      } else {
                        setSourcePartIndices([1]);
                      }
                    }}
                  >
                    2
                  </button>
                </div>
                <div className="tools-part-cross-row">
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${(sourcePartIndices.length === 1 && sourcePartIndices.includes(2)) || sourcePartIndices.length === 4 ? "selected" : ""}`}
                    onClick={() => {
                      if (sourcePartIndices.length === 1 && sourcePartIndices.includes(2)) {
                        setSourcePartIndices([]);
                      } else {
                        setSourcePartIndices([2]);
                      }
                    }}
                  >
                    3
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pattern selector for copy_patterns */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Patterns</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      className={`tools-multi-btn pattern-btn ${sourcePatternIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => toggleIndex(sourcePatternIndices, idx, setSourcePatternIndices)}
                      title={`Pattern ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      className={`tools-multi-btn pattern-btn ${sourcePatternIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => toggleIndex(sourcePatternIndices, idx, setSourcePatternIndices)}
                      title={`Pattern ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <button
                  className="tools-multi-btn pattern-btn tools-select-all"
                  onClick={() => selectAllIndices(16, setSourcePatternIndices)}
                >
                  All
                </button>
              </div>
            </div>
          )}

          {/* Bank, Track and Part selector for copy_tracks */}
          {operation === "copy_tracks" && (
            <>
              <div className="tools-field">
                <label>Bank</label>
                <div className="tools-multi-select banks-stacked">
                  <div className="tools-track-row-buttons">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`tools-multi-btn bank-btn ${sourceBankIndex === idx ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
                        onClick={() => loadedBankIndices.has(idx) && setSourceBankIndex(idx)}
                        disabled={!loadedBankIndices.has(idx)}
                        title={loadedBankIndices.has(idx) ? (banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${String.fromCharCode(65 + idx)}`) : "Bank not loaded"}
                      >
                        {String.fromCharCode(65 + idx)}
                      </button>
                    ))}
                  </div>
                  <div className="tools-track-row-buttons">
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`tools-multi-btn bank-btn ${sourceBankIndex === idx ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
                        onClick={() => loadedBankIndices.has(idx) && setSourceBankIndex(idx)}
                        disabled={!loadedBankIndices.has(idx)}
                        title={loadedBankIndices.has(idx) ? (banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${String.fromCharCode(65 + idx)}`) : "Bank not loaded"}
                      >
                        {String.fromCharCode(65 + idx)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="tools-field">
                <label>Tracks</label>
                <div className="tools-multi-select tracks-stacked">
                  <div className="tools-track-row-buttons">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                        title={`Audio Track ${idx + 1}`}
                      >
                        T{idx + 1}
                      </button>
                    ))}
                  </div>
                  <div className="tools-track-row-buttons">
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                        title={`MIDI Track ${idx - 7}`}
                      >
                        M{idx - 7}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="tools-field">
                <label>Part</label>
                <div className="tools-part-cross">
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 0 ? "selected" : ""}`}
                      onClick={() => setSourcePartIndex(0)}
                    >
                      1
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 3 ? "selected" : ""}`}
                      onClick={() => setSourcePartIndex(3)}
                    >
                      4
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn part-all ${sourcePartIndex === -1 ? "selected" : ""}`}
                      onClick={() => setSourcePartIndex(-1)}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 1 ? "selected" : ""}`}
                      onClick={() => setSourcePartIndex(1)}
                    >
                      2
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 2 ? "selected" : ""}`}
                      onClick={() => setSourcePartIndex(2)}
                    >
                      3
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Sample slot selector for copy_sample_slots */}
          {operation === "copy_sample_slots" && (
            <div className="tools-field">
              <label>Slots</label>
              <div className="tools-slot-selector">
                <div className="tools-slot-header">
                  <div className="tools-slot-range-display">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="tools-slot-value-input"
                      defaultValue={sourceSampleIndices[0] + 1}
                      key={`from-${sourceSampleIndices[0]}`}
                      title="First slot to copy"
                      onBlur={(e) => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val) || val < 1) val = 1;
                        if (val > 128) val = 128;
                        e.target.value = String(val);
                        const start = val - 1;
                        const end = sourceSampleIndices[sourceSampleIndices.length - 1];
                        if (start <= end) {
                          setSourceSampleIndices(Array.from({ length: end - start + 1 }, (_, i) => start + i));
                        } else {
                          setSourceSampleIndices([start]);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    <span className="tools-slot-separator">–</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="tools-slot-value-input"
                      defaultValue={sourceSampleIndices[sourceSampleIndices.length - 1] + 1}
                      key={`to-${sourceSampleIndices[sourceSampleIndices.length - 1]}`}
                      title="Last slot to copy"
                      onBlur={(e) => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val) || val < 1) val = 1;
                        if (val > 128) val = 128;
                        e.target.value = String(val);
                        const end = val - 1;
                        const start = sourceSampleIndices[0];
                        if (end >= start) {
                          setSourceSampleIndices(Array.from({ length: end - start + 1 }, (_, i) => start + i));
                        } else {
                          setSourceSampleIndices([end]);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                  <div className="tools-slot-count" title="Number of slots selected">
                    <span className="tools-slot-count-number">{sourceSampleIndices.length}</span>
                    <span className="tools-slot-count-label">slot{sourceSampleIndices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="tools-slot-all-btn"
                    onClick={() => setSourceSampleIndices([sourceSampleIndices[0]])}
                    title="Select only the first slot"
                  >
                    One
                  </button>
                  <button
                    type="button"
                    className="tools-slot-all-btn"
                    onClick={() => setSourceSampleIndices(Array.from({ length: 128 }, (_, i) => i))}
                    title="Select all 128 slots"
                  >
                    All
                  </button>
                </div>
                <div className="tools-dual-range-slider">
                  <div
                    className="tools-dual-range-track-fill"
                    style={{
                      left: `${((sourceSampleIndices[0]) / 127) * 100}%`,
                      width: `${((sourceSampleIndices[sourceSampleIndices.length - 1] - sourceSampleIndices[0]) / 127) * 100}%`
                    }}
                  />
                  <input
                    type="range"
                    className="tools-dual-range-input tools-dual-range-min"
                    min="1"
                    max="128"
                    value={sourceSampleIndices[0] + 1}
                    onChange={(e) => {
                      const start = Math.max(0, Math.min(127, Number(e.target.value) - 1));
                      const end = sourceSampleIndices[sourceSampleIndices.length - 1];
                      if (start <= end) {
                        setSourceSampleIndices(Array.from({ length: end - start + 1 }, (_, i) => start + i));
                      }
                    }}
                  />
                  <input
                    type="range"
                    className="tools-dual-range-input tools-dual-range-max"
                    min="1"
                    max="128"
                    value={sourceSampleIndices[sourceSampleIndices.length - 1] + 1}
                    onChange={(e) => {
                      const end = Math.max(0, Math.min(127, Number(e.target.value) - 1));
                      const start = sourceSampleIndices[0];
                      if (end >= start) {
                        setSourceSampleIndices(Array.from({ length: end - start + 1 }, (_, i) => start + i));
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Options Panel */}
        <div className="tools-options-panel">
          <h3>Options</h3>

          {/* Copy Patterns options */}
          {operation === "copy_patterns" && (
            <>
              <div className="tools-field">
                <label>Part Assignment</label>
                <div className="tools-toggle-group">
                  <button
                    type="button"
                    className={`tools-toggle-btn ${partAssignmentMode === "keep_original" ? "selected" : ""}`}
                    onClick={() => setPartAssignmentMode("keep_original")}
                    title="Keep the same Part assignment as in the source patterns"
                  >
                    Keep Original
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${partAssignmentMode === "copy_source_part" ? "selected" : ""}`}
                    onClick={() => setPartAssignmentMode("copy_source_part")}
                    title="Copy the source Part data along with the patterns"
                  >
                    Copy Source Part
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${partAssignmentMode === "select_specific" ? "selected" : ""}`}
                    onClick={() => setPartAssignmentMode("select_specific")}
                    title="Assign all copied patterns to a specific Part at destination"
                  >
                    Specific Part
                  </button>
                </div>
              </div>
              {partAssignmentMode === "select_specific" && (
                <div className="tools-field">
                  <label>Destination Part</label>
                  <div className="tools-part-cross">
                    <div className="tools-part-cross-row">
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 0 ? "selected" : ""}`}
                        onClick={() => setDestPart(0)}
                      >
                        1
                      </button>
                    </div>
                    <div className="tools-part-cross-row">
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 3 ? "selected" : ""}`}
                        onClick={() => setDestPart(3)}
                      >
                        4
                      </button>
                      <span className="tools-part-cross-spacer"></span>
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 1 ? "selected" : ""}`}
                        onClick={() => setDestPart(1)}
                      >
                        2
                      </button>
                    </div>
                    <div className="tools-part-cross-row">
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 2 ? "selected" : ""}`}
                        onClick={() => setDestPart(2)}
                      >
                        3
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="tools-field">
                <label>Track Scope</label>
                <div className="tools-toggle-group">
                  <button
                    type="button"
                    className={`tools-toggle-btn ${trackMode === "all" ? "selected" : ""}`}
                    onClick={() => setTrackMode("all")}
                    title="Copy all track data from the source patterns"
                  >
                    All Tracks
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${trackMode === "specific" ? "selected" : ""}`}
                    onClick={() => setTrackMode("specific")}
                    title="Copy only specific tracks from the source patterns"
                  >
                    Specific Tracks
                  </button>
                </div>
              </div>
              {trackMode === "specific" && (
                <div className="tools-field">
                  <label>Tracks</label>
                  <div className="tools-multi-select tracks-inline">
                    <div className="tools-track-row">
                      <span className="tools-track-label">Audio:</span>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                          onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                        >
                          T{idx + 1}
                        </button>
                      ))}
                    </div>
                    <div className="tools-track-row">
                      <span className="tools-track-label">MIDI:</span>
                      {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                          onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                        >
                          M{idx - 7}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Copy Tracks options */}
          {operation === "copy_tracks" && (
            <div className="tools-field">
              <label>Copy Mode</label>
              <div className="tools-toggle-group">
                <button
                  type="button"
                  className={`tools-toggle-btn ${copyTrackMode === "part_params" ? "selected" : ""}`}
                  onClick={() => setCopyTrackMode("part_params")}
                  title="Copy only Part parameters: machines, amplifier, LFOs, effects settings"
                >
                  Part Params
                </button>
                <button
                  type="button"
                  className={`tools-toggle-btn ${copyTrackMode === "both" ? "selected" : ""}`}
                  onClick={() => setCopyTrackMode("both")}
                  title="Copy both Part parameters (machines, amps, LFOs, FX) and Pattern triggers (trigs, plocks)"
                >
                  Both
                </button>
                <button
                  type="button"
                  className={`tools-toggle-btn ${copyTrackMode === "pattern_triggers" ? "selected" : ""}`}
                  onClick={() => setCopyTrackMode("pattern_triggers")}
                  title="Copy only Pattern triggers: trigs, trigless, parameter locks, swing"
                >
                  Pattern Triggers
                </button>
              </div>
            </div>
          )}

          {/* Copy Sample Slots options */}
          {operation === "copy_sample_slots" && (
            <>
              <div className="tools-field">
                <label>Slot Type</label>
                <div className="tools-toggle-group">
                  <button
                    type="button"
                    className={`tools-toggle-btn ${slotType === "flex" ? "selected" : ""}`}
                    onClick={() => setSlotType("flex")}
                    title="Copy only Flex machine sample slots"
                  >
                    Flex
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${slotType === "both" ? "selected" : ""}`}
                    onClick={() => setSlotType("both")}
                    title="Copy both Static and Flex machine sample slots"
                  >
                    Static + Flex
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${slotType === "static" ? "selected" : ""}`}
                    onClick={() => setSlotType("static")}
                    title="Copy only Static machine sample slots"
                  >
                    Static
                  </button>
                </div>
              </div>
              <div className="tools-field">
                <label className="tools-label-with-hint">
                  Audio Files
                  {audioMode === "move_to_pool" && sameSetStatus && !audioPoolStatus?.exists && destProject !== projectPath && (
                    <span className="tools-hint-inline" title="Both Source and Destination projects seem to be in the same Set but the Audio Pool folder doesn't exist yet: It will be created automatically when the operation runs.">Pool will be created</span>
                  )}
                </label>
                <div className="tools-toggle-group">
                  <button
                    type="button"
                    className={`tools-toggle-btn ${audioMode === "copy" ? "selected" : ""}`}
                    onClick={() => { userChangedAudioMode.current = true; setAudioMode("copy"); }}
                    title="Copy audio files to the destination project's sample folder"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${audioMode === "move_to_pool" ? "selected" : ""}`}
                    onClick={() => { if (sameSetStatus) { userChangedAudioMode.current = true; setAudioMode("move_to_pool"); } }}
                    disabled={!sameSetStatus}
                    title={sameSetStatus
                      ? "Move audio files to the Set's Audio Pool folder, shared between all projects in the Set"
                      : "Source and destination projects must be in the same Set to use Audio Pool"
                    }
                  >
                    Move to Pool
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${audioMode === "none" ? "selected" : ""}`}
                    onClick={() => { userChangedAudioMode.current = true; setAudioMode("none"); }}
                    title="Only copy slot settings, don't copy audio files (files must already exist at destination)"
                  >
                    Don't Copy
                  </button>
                </div>
              </div>
              <div className="tools-field tools-checkbox">
                <label title="Gain, loop mode, timestretch">
                  <input
                    type="checkbox"
                    checked={includeEditorSettings}
                    onChange={(e) => setIncludeEditorSettings(e.target.checked)}
                  />
                  Include Editor Settings
                </label>
              </div>
            </>
          )}

          {/* Copy Banks - no extra options */}
          {operation === "copy_bank" && (
            <div className="tools-info">
              <p>Copies entire bank including all 4 Parts and 16 Patterns.</p>
            </div>
          )}

          {/* Copy Parts - no extra options */}
          {operation === "copy_parts" && (
            <div className="tools-info">
              <p>Copies Part sound design (machines, amps, LFOs, FX).</p>
            </div>
          )}
        </div>

        {/* Destination Panel */}
        <div className="tools-dest-panel">
          <h3>Destination</h3>

          {/* Project selector */}
          <div className="tools-field">
            <label>Project</label>
            <button
              type="button"
              className="tools-project-selector-btn"
              onClick={() => setShowProjectSelector(true)}
              title={destProject}
            >
              <span className="tools-project-selector-name">
                {destProjectInfo.name}
                {destProjectInfo.isCurrentProject && <span className="tools-project-selector-current">Current</span>}
              </span>
              {destProjectInfo.setName && (
                <span className="tools-project-selector-set">{destProjectInfo.setName}</span>
              )}
              <i className="fas fa-folder-open"></i>
            </button>
          </div>

          {/* Bank selector for copy_bank - multi-select */}
          {operation === "copy_bank" && (
            <div className="tools-field">
              <label>Banks</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destBankIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => destBankIndices.includes(idx)
                        ? setDestBankIndices(destBankIndices.filter(i => i !== idx))
                        : setDestBankIndices([...destBankIndices, idx].sort((a, b) => a - b))
                      }
                      title={`Bank ${String.fromCharCode(65 + idx)}`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destBankIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => destBankIndices.includes(idx)
                        ? setDestBankIndices(destBankIndices.filter(i => i !== idx))
                        : setDestBankIndices([...destBankIndices, idx].sort((a, b) => a - b))
                      }
                      title={`Bank ${String.fromCharCode(65 + idx)}`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-select-actions">
                  <button
                    className="tools-multi-btn bank-btn tools-select-all"
                    onClick={() => setDestBankIndices([])}
                  >
                    None
                  </button>
                  <button
                    className="tools-multi-btn bank-btn tools-select-all"
                    onClick={() => selectAllIndices(16, setDestBankIndices)}
                  >
                    All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bank selector for copy_parts - click-to-deselect */}
          {operation === "copy_parts" && (
            <div className="tools-field">
              <label>Bank</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destBankIndex === idx ? "selected" : ""}`}
                      onClick={() => setDestBankIndex(destBankIndex === idx ? -1 : idx)}
                      title={`Bank ${String.fromCharCode(65 + idx)}`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destBankIndex === idx ? "selected" : ""}`}
                      onClick={() => setDestBankIndex(destBankIndex === idx ? -1 : idx)}
                      title={`Bank ${String.fromCharCode(65 + idx)}`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bank selector for copy_patterns - stacked layout */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Bank</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destBankIndex === idx ? "selected" : ""}`}
                      onClick={() => setDestBankIndex(idx)}
                      title={`Bank ${String.fromCharCode(65 + idx)}`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destBankIndex === idx ? "selected" : ""}`}
                      onClick={() => setDestBankIndex(idx)}
                      title={`Bank ${String.fromCharCode(65 + idx)}`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Part selector for copy_parts - multi-select, disabled when source All is selected */}
          {operation === "copy_parts" && (
            <div className="tools-field">
              <label>Parts</label>
              <div className={`tools-part-cross ${sourcePartIndices.length === 4 ? "disabled" : ""}`}>
                <div className="tools-part-cross-row">
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${destPartIndices.includes(0) ? "selected" : ""}`}
                    onClick={() => sourcePartIndices.length !== 4 && (destPartIndices.includes(0)
                      ? setDestPartIndices(destPartIndices.filter(i => i !== 0))
                      : setDestPartIndices([...destPartIndices, 0].sort((a, b) => a - b))
                    )}
                    disabled={sourcePartIndices.length === 4}
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : undefined}
                  >
                    1
                  </button>
                </div>
                <div className="tools-part-cross-row">
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${destPartIndices.includes(3) ? "selected" : ""}`}
                    onClick={() => sourcePartIndices.length !== 4 && (destPartIndices.includes(3)
                      ? setDestPartIndices(destPartIndices.filter(i => i !== 3))
                      : setDestPartIndices([...destPartIndices, 3].sort((a, b) => a - b))
                    )}
                    disabled={sourcePartIndices.length === 4}
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : undefined}
                  >
                    4
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn part-all ${destPartIndices.length === 4 ? "selected" : ""}`}
                    onClick={() => sourcePartIndices.length !== 4 && (destPartIndices.length === 4
                      ? setDestPartIndices([])
                      : setDestPartIndices([0, 1, 2, 3])
                    )}
                    disabled={sourcePartIndices.length === 4}
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : undefined}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${destPartIndices.includes(1) ? "selected" : ""}`}
                    onClick={() => sourcePartIndices.length !== 4 && (destPartIndices.includes(1)
                      ? setDestPartIndices(destPartIndices.filter(i => i !== 1))
                      : setDestPartIndices([...destPartIndices, 1].sort((a, b) => a - b))
                    )}
                    disabled={sourcePartIndices.length === 4}
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : undefined}
                  >
                    2
                  </button>
                </div>
                <div className="tools-part-cross-row">
                  <button
                    type="button"
                    className={`tools-toggle-btn part-btn ${destPartIndices.includes(2) ? "selected" : ""}`}
                    onClick={() => sourcePartIndices.length !== 4 && (destPartIndices.includes(2)
                      ? setDestPartIndices(destPartIndices.filter(i => i !== 2))
                      : setDestPartIndices([...destPartIndices, 2].sort((a, b) => a - b))
                    )}
                    disabled={sourcePartIndices.length === 4}
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : undefined}
                  >
                    3
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pattern start for copy_patterns */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label className="tools-label-with-warning">
                Starting at Pattern
                {sourcePatternIndices.length + destPatternStart > 16 && (
                  <span
                    className="tools-warning-badge"
                    title="The selected pattern range exceeds the maximum of 16 patterns. Some patterns will not be copied."
                  >
                    Some patterns will overflow
                  </span>
                )}
              </label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn pattern-btn ${destPatternStart === idx ? "selected" : ""}`}
                      onClick={() => setDestPatternStart(idx)}
                      title={`Pattern ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <div className="tools-track-row-buttons">
                  {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn pattern-btn ${destPatternStart === idx ? "selected" : ""}`}
                      onClick={() => setDestPatternStart(idx)}
                      title={`Pattern ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bank, Track and Part selector for copy_tracks */}
          {operation === "copy_tracks" && (
            <>
              <div className="tools-field">
                <label>Bank</label>
                <div className="tools-multi-select banks-stacked">
                  <div className="tools-track-row-buttons">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`tools-multi-btn bank-btn ${destBankIndex === idx ? "selected" : ""}`}
                        onClick={() => setDestBankIndex(idx)}
                        title={`Bank ${String.fromCharCode(65 + idx)}`}
                      >
                        {String.fromCharCode(65 + idx)}
                      </button>
                    ))}
                  </div>
                  <div className="tools-track-row-buttons">
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`tools-multi-btn bank-btn ${destBankIndex === idx ? "selected" : ""}`}
                        onClick={() => setDestBankIndex(idx)}
                        title={`Bank ${String.fromCharCode(65 + idx)}`}
                      >
                        {String.fromCharCode(65 + idx)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="tools-field">
                <label>Tracks</label>
                <div className="tools-multi-select tracks-stacked">
                  <div className="tools-track-row-buttons">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn track-btn ${destTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(destTrackIndices, idx, setDestTrackIndices)}
                        title={`Audio Track ${idx + 1}`}
                      >
                        T{idx + 1}
                      </button>
                    ))}
                  </div>
                  <div className="tools-track-row-buttons">
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn track-btn ${destTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(destTrackIndices, idx, setDestTrackIndices)}
                        title={`MIDI Track ${idx - 7}`}
                      >
                        M{idx - 7}
                      </button>
                    ))}
                  </div>
                </div>
                {sourceTrackIndices.length !== destTrackIndices.length && (
                  <span className="tools-warning">
                    Source and destination track count must match
                  </span>
                )}
              </div>
              <div className="tools-field">
                <label>Part</label>
                <div className="tools-part-cross">
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destPartIndex === 0 ? "selected" : ""}`}
                      onClick={() => setDestPartIndex(0)}
                    >
                      1
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destPartIndex === 3 ? "selected" : ""}`}
                      onClick={() => setDestPartIndex(3)}
                    >
                      4
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn part-all ${destPartIndex === -1 ? "selected" : ""}`}
                      onClick={() => setDestPartIndex(-1)}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destPartIndex === 1 ? "selected" : ""}`}
                      onClick={() => setDestPartIndex(1)}
                    >
                      2
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destPartIndex === 2 ? "selected" : ""}`}
                      onClick={() => setDestPartIndex(2)}
                    >
                      3
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Sample slot destination for copy_sample_slots */}
          {operation === "copy_sample_slots" && (
            <div className="tools-field">
              <label className="tools-label-with-warning">
                Slots
                {sourceSampleIndices.length + destSampleIndices[0] > 128 && (
                  <span
                    className="tools-warning-badge"
                    title="The selected slot range exceeds the maximum of 128 slots. Some slots will not be copied."
                  >
                    Some slots will overflow
                  </span>
                )}
              </label>
              <div className="tools-slot-selector">
                <div className="tools-slot-header">
                  <div className="tools-slot-range-display">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="tools-slot-value-input"
                      defaultValue={destSampleIndices[0] + 1}
                      key={`dest-from-${destSampleIndices[0]}`}
                      title="Starting destination slot"
                      onBlur={(e) => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val) || val < 1) val = 1;
                        if (val > 128) val = 128;
                        e.target.value = String(val);
                        const start = val - 1;
                        const count = sourceSampleIndices.length;
                        setDestSampleIndices(Array.from({ length: count }, (_, i) => Math.min(127, start + i)));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    <span className="tools-slot-separator">–</span>
                    <span className="tools-slot-value-display" title="Ending destination slot (based on source count)">{Math.min(128, destSampleIndices[0] + sourceSampleIndices.length)}</span>
                  </div>
                  <div className="tools-slot-count" title={`Effective slots to copy${Math.min(sourceSampleIndices.length, 128 - destSampleIndices[0]) < sourceSampleIndices.length ? ` (${sourceSampleIndices.length - Math.min(sourceSampleIndices.length, 128 - destSampleIndices[0])} will overflow)` : ''}`}>
                    <span className="tools-slot-count-number">{Math.min(sourceSampleIndices.length, 128 - destSampleIndices[0])}</span>
                    <span className="tools-slot-count-label">slot{Math.min(sourceSampleIndices.length, 128 - destSampleIndices[0]) !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="tools-slot-all-btn"
                    onClick={() => {
                      const count = sourceSampleIndices.length;
                      setDestSampleIndices(Array.from({ length: count }, (_, i) => i));
                    }}
                    title="Reset destination to start at slot 1"
                  >
                    Reset
                  </button>
                </div>
                <div className="tools-dual-range-slider tools-single-range">
                  <input
                    type="range"
                    className="tools-dual-range-input"
                    min="1"
                    max="128"
                    value={destSampleIndices[0] + 1}
                    onChange={(e) => {
                      const start = Math.max(0, Math.min(127, Number(e.target.value) - 1));
                      const count = sourceSampleIndices.length;
                      setDestSampleIndices(Array.from({ length: count }, (_, i) => Math.min(127, start + i)));
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Execute Button */}
      <div className="tools-actions">
        <button
          className="tools-execute-btn"
          onClick={executeOperation}
          disabled={isExecuting || (operation === "copy_bank" && sourceBankIndex === -1) || (operation === "copy_bank" && destBankIndices.length === 0) || (operation === "copy_parts" && sourceBankIndex === -1) || (operation === "copy_parts" && destBankIndex === -1) || (operation === "copy_parts" && sourcePartIndices.length === 0) || (operation === "copy_parts" && destPartIndices.length === 0) || (operation === "copy_tracks" && sourceTrackIndices.length !== destTrackIndices.length) || (operation === "copy_patterns" && partAssignmentMode === "select_specific" && destPart === -1)}
          title={
            isExecuting ? "Operation in progress..." :
            (operation === "copy_bank" && sourceBankIndex === -1 && destBankIndices.length === 0) ? "Select source and destination banks" :
            (operation === "copy_bank" && sourceBankIndex === -1) ? "Select a source bank" :
            (operation === "copy_bank" && destBankIndices.length === 0) ? "Select at least one destination bank" :
            (operation === "copy_parts" && sourceBankIndex === -1 && destBankIndex === -1) ? "Select source and destination banks" :
            (operation === "copy_parts" && sourceBankIndex === -1) ? "Select a source bank" :
            (operation === "copy_parts" && destBankIndex === -1) ? "Select a destination bank" :
            (operation === "copy_parts" && sourcePartIndices.length === 0 && destPartIndices.length === 0) ? "Select source and destination parts" :
            (operation === "copy_parts" && sourcePartIndices.length === 0) ? "Select a source part" :
            (operation === "copy_parts" && destPartIndices.length === 0) ? "Select at least one destination part" :
            (operation === "copy_tracks" && sourceTrackIndices.length !== destTrackIndices.length) ? "Source and destination track count must match" :
            (operation === "copy_patterns" && partAssignmentMode === "select_specific" && destPart === -1) ? "Select a destination part" :
            undefined
          }
        >
          {isExecuting ? (
            <>
              <span className="loading-spinner-small"></span>
              Processing
            </>
          ) : (
            <>
              <i className="fas fa-copy"></i>
              Execute
            </>
          )}
        </button>

        {showProgress && (
          <details className={`tools-progress-details ${progressFading ? 'fading-out' : ''}`} open>
            <summary>Progress</summary>
            <div className="tools-progress-content">
              <div className="tools-progress-item">
                <span className="loading-spinner-small"></span>
                <span>{executingDetails}</span>
              </div>
            </div>
          </details>
        )}
      </div>

      {/* Status Modal */}
      {statusMessage && (
        <div className="modal-overlay" onClick={() => setStatusMessage("")}>
          <div className={`modal-content ${statusType === "error" ? "error-modal" : statusType === "success" ? "success-modal" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {statusType === "success" && <i className="fas fa-check-circle"></i>}
                {statusType === "error" && <i className="fas fa-exclamation-circle"></i>}
                {statusType === "info" && <i className="fas fa-info-circle"></i>}
                {statusType === "success" ? "Success" : statusType === "error" ? "Error" : "Info"}
              </h3>
              <button className="modal-close" onClick={() => setStatusMessage("")}>×</button>
            </div>
            <div className="modal-body">
              <p>{statusMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Project Selector Modal */}
      {showProjectSelector && (
        <div className="modal-overlay" onClick={() => setShowProjectSelector(false)}>
          <div className="modal-content project-selector-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Select Destination Project</h3>
              <button className="modal-close" onClick={() => setShowProjectSelector(false)}>×</button>
            </div>
            <div className="modal-body project-selector-body">
              {/* Header row with Current Project, Manual Browse, and Actions */}
              <div className="project-selector-header-row">
                <div className="project-selector-left-group">
                  <div className="project-selector-section project-selector-current">
                    <h4>Current Project</h4>
                    <div className="projects-grid">
                      <div
                        className={`project-card project-selector-card ${destProject === projectPath ? 'selected' : ''}`}
                        onClick={() => {
                          setDestProject(projectPath);
                          setShowProjectSelector(false);
                        }}
                      >
                        <div className="project-name">{projectName}</div>
                      </div>
                    </div>
                  </div>
                  {/* Manual Browse */}
                  {browsedProject && browsedProject.path !== projectPath && (
                    <div className="project-selector-section project-selector-manual">
                      <h4>Manual Browse</h4>
                      <div className="projects-grid">
                        <div
                          className={`project-card project-selector-card ${destProject === browsedProject.path ? 'selected' : ''}`}
                          onClick={() => {
                            setDestProject(browsedProject.path);
                            setShowProjectSelector(false);
                          }}
                          title={browsedProject.path}
                        >
                          <div className="project-name">{browsedProject.name}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="project-selector-section project-selector-actions-section">
                  <h4>Actions</h4>
                  <div className="project-selector-actions">
                    <button
                      onClick={handleRescan}
                      disabled={isScanning}
                      className="scan-button browse-button"
                    >
                      {isScanning ? "Scanning..." : "Rescan for Projects"}
                    </button>
                    <button
                      onClick={handleBrowse}
                      className="scan-button browse-button"
                    >
                      Browse...
                    </button>
                  </div>
                </div>
              </div>

              {/* Individual Projects (collapsible) */}
              {standaloneProjects.some(p => p.path !== projectPath && p.has_project_file) && (
                <div className="project-selector-section">
                  <h4
                    className="clickable"
                    onClick={() => setIsIndividualProjectsOpenInModal(!isIndividualProjectsOpenInModal)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                  >
                    <span className="collapse-indicator">{isIndividualProjectsOpenInModal ? '▼' : '▶'}</span>
                    {standaloneProjects.filter(p => p.path !== projectPath && p.has_project_file).length} Individual Project{standaloneProjects.filter(p => p.path !== projectPath && p.has_project_file).length !== 1 ? 's' : ''}
                  </h4>
                  <div className={`sets-section ${isIndividualProjectsOpenInModal ? 'open' : 'closed'}`}>
                    <div className="sets-section-content">
                      <div className="projects-grid">
                        {standaloneProjects
                          .filter(p => p.path !== projectPath && p.has_project_file)
                          .map((project, projIdx) => (
                            <div
                              key={projIdx}
                              className={`project-card project-selector-card ${destProject === project.path ? 'selected' : ''}`}
                              onClick={() => {
                                setDestProject(project.path);
                                setShowProjectSelector(false);
                              }}
                            >
                              <div className="project-name">{project.name}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Locations (collapsible, each containing sets) */}
              {locations.filter(loc => loc.sets.some(set => set.projects.some(p => p.path !== projectPath && p.has_project_file))).length > 0 && (
                <div className="project-selector-section">
                  <h4
                    className="clickable"
                    onClick={() => setIsLocationsOpenInModal(!isLocationsOpenInModal)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                  >
                    <span className="collapse-indicator">{isLocationsOpenInModal ? '▼' : '▶'}</span>
                    {locations.filter(loc => loc.sets.some(set => set.projects.some(p => p.path !== projectPath && p.has_project_file))).length} Location{locations.filter(loc => loc.sets.some(set => set.projects.some(p => p.path !== projectPath && p.has_project_file))).length !== 1 ? 's' : ''}
                  </h4>
                  <div className={`sets-section ${isLocationsOpenInModal ? 'open' : 'closed'}`}>
                    <div className="sets-section-content">
              {locations.map((location, locIdx) => {
                const hasValidProjects = location.sets.some(set => set.projects.some(p => p.path !== projectPath && p.has_project_file));
                if (!hasValidProjects) return null;
                const isLocationOpen = openLocationsInModal.has(locIdx);
                return (
                  <div key={locIdx} className="project-selector-location">
                    <div className={`location-card location-type-${location.device_type.toLowerCase()}`}>
                      <div
                        className="location-header clickable"
                        onClick={() => {
                          setOpenLocationsInModal(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(locIdx)) {
                              newSet.delete(locIdx);
                            } else {
                              newSet.add(locIdx);
                            }
                            return newSet;
                          });
                        }}
                      >
                        <div className="location-header-left">
                          <span className="collapse-indicator">{isLocationOpen ? '▼' : '▶'}</span>
                          <h3>{location.name}</h3>
                          <span className="location-path-inline">{location.path}</span>
                        </div>
                        <div className="location-header-right">
                          <span className="device-type">
                            {location.device_type === 'CompactFlash' ? 'CF Card' :
                             location.device_type === 'LocalCopy' ? 'Local Copy' :
                             location.device_type === 'Usb' ? 'USB' : location.device_type}
                          </span>
                          <span className="sets-count">{location.sets.filter(set => set.projects.some(p => p.path !== projectPath && p.has_project_file)).length} Set{location.sets.filter(set => set.projects.some(p => p.path !== projectPath && p.has_project_file)).length !== 1 ? 's' : ''}</span>
                        </div>
                      </div>

                      <div className={`sets-section ${isLocationOpen ? 'open' : 'closed'}`}>
                        <div className="sets-section-content">
                          {[...location.sets].sort((a, b) => {
                            const aIsPresets = a.name.toLowerCase() === 'presets';
                            const bIsPresets = b.name.toLowerCase() === 'presets';
                            if (aIsPresets && !bIsPresets) return 1;
                            if (!aIsPresets && bIsPresets) return -1;
                            return 0;
                          }).map((set, setIdx) => {
                            const validProjects = set.projects.filter(p => p.path !== projectPath && p.has_project_file);
                            if (validProjects.length === 0) return null;
                            const setKey = `${locIdx}-${set.name}`;
                            const isSetOpen = openSetsInModal.has(setKey);
                            return (
                              <div key={setIdx} className="set-card" title={set.path}>
                                <div
                                  className="set-header clickable"
                                  onClick={() => {
                                    setOpenSetsInModal(prev => {
                                      const newSet = new Set(prev);
                                      if (newSet.has(setKey)) {
                                        newSet.delete(setKey);
                                      } else {
                                        newSet.add(setKey);
                                      }
                                      return newSet;
                                    });
                                  }}
                                >
                                  <div className="set-name">
                                    <span className="collapse-indicator">{isSetOpen ? '▼' : '▶'}</span>
                                    {set.name}
                                  </div>
                                  <div className="set-info">
                                    <span className={set.has_audio_pool ? "status-audio-pool" : "status-audio-pool-empty"}>
                                      {set.has_audio_pool ? "✓ Audio Pool" : "✗ Audio Pool"}
                                    </span>
                                    <span className="project-count">
                                      {validProjects.length} Project{validProjects.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className={`sets-section ${isSetOpen ? 'open' : 'closed'}`}>
                                  <div className="sets-section-content">
                                    <div className="projects-grid">
                                      {validProjects.map((project, projIdx) => (
                                        <div
                                          key={projIdx}
                                          className={`project-card project-selector-card ${destProject === project.path ? 'selected' : ''}`}
                                          onClick={() => {
                                            setDestProject(project.path);
                                            setShowProjectSelector(false);
                                          }}
                                        >
                                          <div className="project-name">{project.name}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
                      </div>
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ToolsPanel;
