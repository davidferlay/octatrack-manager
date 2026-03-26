import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjects } from "../context/ProjectsContext";
import type { Bank } from "../context/ProjectsContext";
import { formatBankName } from "./BankSelector";
import "../App.css";

const TOOLS_STORAGE_KEY_PREFIX = "octatrack-tools-settings-";

// Natural sort comparator: "Project_2" < "Project_10" (not lexicographic)
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// Operation types
type OperationType = "copy_bank" | "copy_parts" | "copy_patterns" | "copy_tracks" | "copy_sample_slots";

// Part assignment modes for copy_patterns
type PartAssignmentMode = "keep_original" | "copy_source_part" | "select_specific";

// Track mode for copy_patterns
type TrackMode = "all" | "specific";

// Mode scope for copy_patterns (when trackMode is "all")
type ModeScope = "audio" | "both" | "midi";

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
  onProjectRefresh?: () => void;
}

interface ProjectOption {
  name: string;
  path: string;
}

interface ToolsSettings {
  operation: OperationType;
  partAssignmentMode: PartAssignmentMode;
  trackMode: TrackMode;
  modeScope: ModeScope;
  copyTrackMode: CopyTrackMode;
  slotType: SlotType;
  audioMode: AudioMode;
  includeEditorSettings: boolean;
  destProject: string;
  sourceSampleStart: number;
  sourceSampleEnd: number;
  destSampleStart: number;
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

export function ToolsPanel({ projectPath, projectName, banks, loadedBankIndices, onBankUpdated, onProjectRefresh }: ToolsPanelProps) {
  const { locations, standaloneProjects, setLocations, setStandaloneProjects, setHasScanned } = useProjects();

  // Load saved settings (per-project, session-only)
  const savedSettings = loadToolsSettings(projectPath);

  // Operation selection
  const [operation, setOperation] = useState<OperationType>(savedSettings.operation || "copy_bank");

  // Source selection (current project only)
  const [sourceBankIndex, setSourceBankIndex] = useState<number>(0);
  const [sourcePartIndices, setSourcePartIndices] = useState<number[]>([0]);
  const [sourcePatternIndices, setSourcePatternIndices] = useState<number[]>([0]);
  const [sourceTrackIndices, setSourceTrackIndices] = useState<number[]>([]);
  const [sourceSampleIndices, setSourceSampleIndices] = useState<number[]>(() => {
    const start = savedSettings.sourceSampleStart ?? 0;
    const end = savedSettings.sourceSampleEnd ?? 127;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  // Destination selection
  const [destProject, setDestProject] = useState<string>(savedSettings.destProject || projectPath);
  const [destBankIndex, setDestBankIndex] = useState<number>(0);
  const [destBankIndices, setDestBankIndices] = useState<number[]>([0]); // For copy_bank multi-select
  const [destPartBankIndices, setDestPartBankIndices] = useState<number[]>([0]); // For copy_parts multi-select dest banks
  const [destPartIndices, setDestPartIndices] = useState<number[]>([0]);
  const [destPatternIndices, setDestPatternIndices] = useState<number[]>([0]); // For copy_patterns multi-select
  const [destTrackIndices, setDestTrackIndices] = useState<number[]>([]);
  const [destSampleStart, setDestSampleStart] = useState<number>(savedSettings.destSampleStart ?? 0);

  // Operation-specific options
  // Copy Patterns options
  const [partAssignmentMode, setPartAssignmentMode] = useState<PartAssignmentMode>(savedSettings.partAssignmentMode || "keep_original");
  const [destPart, setDestPart] = useState<number>(-1); // -1 = no selection
  const [trackMode, setTrackMode] = useState<TrackMode>(savedSettings.trackMode || "all");
  const [modeScope, setModeScope] = useState<ModeScope>(savedSettings.modeScope || "audio");

  // Copy Tracks options
  const [copyTrackMode, setCopyTrackMode] = useState<CopyTrackMode>(savedSettings.copyTrackMode || "part_params");
  const [copyTrackSourcePatternIndex, setCopyTrackSourcePatternIndex] = useState<number>(-1); // -1 = All, 0-15 = specific
  const [copyTrackDestPatternIndices, setCopyTrackDestPatternIndices] = useState<number[]>([]); // empty = All, [0-15] = specific
  const [sourcePartIndex, setSourcePartIndex] = useState<number>(0); // 0 = Part 1, -1 = All parts, -2 = no selection
  const [destTrackPartIndices, setDestTrackPartIndices] = useState<number[]>([0]); // Copy Tracks dest parts: array of 0-3, or [0,1,2,3] for All

  // Copy Sample Slots options
  const [slotType, setSlotType] = useState<SlotType>(savedSettings.slotType || "flex");
  const [audioMode, setAudioMode] = useState<AudioMode>(savedSettings.audioMode || "copy");
  const [includeEditorSettings, setIncludeEditorSettings] = useState<boolean>(savedSettings.includeEditorSettings ?? true);
  const [sampleSelectionMode, setSampleSelectionMode] = useState<"one" | "range">("range");
  const userChangedAudioMode = useRef<boolean>(!!savedSettings.audioMode);

  // Audio Pool status
  const [audioPoolStatus, setAudioPoolStatus] = useState<AudioPoolStatus | null>(null);
  const [sameSetStatus, setSameSetStatus] = useState<boolean>(false);
  const [missingSourceFiles, setMissingSourceFiles] = useState<number>(0);

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
        naturalCompare(a.name, b.name)
      );
      const sortedStandaloneProjects = [...result.standalone_projects].sort((a, b) =>
        naturalCompare(a.name, b.name)
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
      modeScope,
      copyTrackMode,
      slotType,
      audioMode,
      includeEditorSettings,
      destProject,
      sourceSampleStart: sourceSampleIndices[0],
      sourceSampleEnd: sourceSampleIndices[sourceSampleIndices.length - 1],
      destSampleStart,
    });
  }, [projectPath, operation, partAssignmentMode, trackMode, modeScope, copyTrackMode, slotType, audioMode, includeEditorSettings, destProject, sourceSampleIndices, destSampleStart]);

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

  // Check for missing source audio files when audio mode requires files
  useEffect(() => {
    if (operation !== "copy_sample_slots" || audioMode === "none") {
      setMissingSourceFiles(0);
      return;
    }
    let cancelled = false;
    invoke<number>("check_missing_source_files", {
      projectPath,
      slotType,
      sourceIndices: sourceSampleIndices.map(i => i + 1),
    }).then(count => {
      if (!cancelled) setMissingSourceFiles(count);
    }).catch(() => {
      if (!cancelled) setMissingSourceFiles(0);
    });
    return () => { cancelled = true; };
  }, [operation, audioMode, slotType, sourceSampleIndices, projectPath]);

  // Derive destination sample indices from destSampleStart and source count
  const destSampleIndices = useMemo(() => {
    const count = sourceSampleIndices.length;
    return Array.from({ length: count }, (_, i) => Math.min(127, destSampleStart + i));
  }, [destSampleStart, sourceSampleIndices.length]);

  // Auto-sync destination tracks when source "All Audio" or "All MIDI" is selected
  useEffect(() => {
    const isAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
    const isAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
    if (isAllAudio) {
      setDestTrackIndices([0, 1, 2, 3, 4, 5, 6, 7]);
    } else if (isAllMidi) {
      setDestTrackIndices([8, 9, 10, 11, 12, 13, 14, 15]);
    }
  }, [sourceTrackIndices]);

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

  // Determine which files need backing up before an operation
  async function getBackupFiles(): Promise<{ project: string; files: string[]; label: string }> {
    const bankFile = (idx: number) => `bank${String(idx + 1).padStart(2, '0')}.work`;
    switch (operation) {
      case "copy_bank":
        return {
          project: destProject,
          files: destBankIndices.map(bankFile),
          label: "copy_bank",
        };
      case "copy_parts":
        return {
          project: destProject,
          files: destPartBankIndices.map(bankFile),
          label: "copy_parts",
        };
      case "copy_patterns":
        return {
          project: destProject,
          files: [bankFile(destBankIndex)],
          label: "copy_patterns",
        };
      case "copy_tracks":
        return {
          project: destProject,
          files: [bankFile(destBankIndex)],
          label: "copy_tracks",
        };
      case "copy_sample_slots": {
        const baseFiles = ["project.work", "markers.work"];
        if (audioMode !== "none") {
          // Also back up destination audio files (+ .ot) that would be overwritten
          try {
            const audioPaths = await invoke<string[]>("get_slot_audio_paths", {
              projectPath,
              slotType,
              sourceIndices: sourceSampleIndices.map(i => i + 1),
            });
            return {
              project: destProject,
              files: [...baseFiles, ...audioPaths],
              label: "copy_sample_slots",
            };
          } catch {
            // Fall through to base files only
          }
        }
        return {
          project: destProject,
          files: baseFiles,
          label: "copy_sample_slots",
        };
      }
      default:
        return { project: destProject, files: [], label: "unknown" };
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
      // Back up destination files before modifying them
      const backup = await getBackupFiles();
      if (backup.files.length > 0) {
        await invoke("backup_project_files", {
          projectPath: backup.project,
          files: backup.files,
          label: backup.label,
        });
      }

      switch (operation) {
        case "copy_bank":
          await invoke("copy_bank", {
            sourceProject: projectPath,
            sourceBankIndex,
            destProject,
            destBankIndices,
          });
          setStatusMessage(`Bank ${String.fromCharCode(65 + sourceBankIndex)} copied to ${destBankIndices.length} bank${destBankIndices.length > 1 ? 's' : ''} successfully`);
          if (destProject === projectPath) {
            if (onBankUpdated) destBankIndices.forEach(idx => onBankUpdated(idx));
            if (onProjectRefresh) onProjectRefresh();
          }
          break;

        case "copy_parts":
          for (const bankIdx of destPartBankIndices) {
            await invoke("copy_parts", {
              sourceProject: projectPath,
              sourceBankIndex,
              sourcePartIndices,
              destProject,
              destBankIndex: bankIdx,
              destPartIndices,
            });
          }
          setStatusMessage(sourcePartIndices.length === 4
            ? `All parts copied to ${destPartBankIndices.length} bank${destPartBankIndices.length > 1 ? 's' : ''} successfully`
            : `Part copied to ${destPartIndices.length} part${destPartIndices.length > 1 ? 's' : ''} in ${destPartBankIndices.length} bank${destPartBankIndices.length > 1 ? 's' : ''} successfully`);
          if (destProject === projectPath) {
            if (onBankUpdated) destPartBankIndices.forEach(idx => onBankUpdated(idx));
            if (onProjectRefresh) onProjectRefresh();
          }
          break;

        case "copy_patterns":
          await invoke("copy_patterns", {
            sourceProject: projectPath,
            sourceBankIndex,
            sourcePatternIndices,
            destProject,
            destBankIndex,
            destPatternIndices,
            partAssignmentMode,
            destPart: partAssignmentMode === "select_specific" ? destPart : null,
            trackMode,
            trackIndices: trackMode === "specific" ? sourceTrackIndices : null,
            modeScope: trackMode === "all" ? modeScope : null,
          });
          // Success message
          if (sourcePatternIndices.length === 1) {
            if (destPatternIndices.length > 1) {
              setStatusMessage(`Pattern copied to ${destPatternIndices.length} destination patterns successfully`);
            } else {
              setStatusMessage("Pattern copied successfully");
            }
          } else {
            setStatusMessage(`${sourcePatternIndices.length} patterns copied successfully`);
          }
          if (destProject === projectPath) {
            if (onBankUpdated) onBankUpdated(destBankIndex);
            if (onProjectRefresh) onProjectRefresh();
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
            destPartIndices: sourcePartIndex === -1 ? null : destTrackPartIndices, // null = all parts (synced with source)
            destTrackIndices,
            mode: copyTrackMode,
            sourcePatternIndex: (copyTrackMode !== "part_params" && copyTrackSourcePatternIndex !== -1) ? copyTrackSourcePatternIndex : null,
            destPatternIndices: (copyTrackMode !== "part_params" && copyTrackDestPatternIndices.length > 0) ? copyTrackDestPatternIndices : null,
          });
          setStatusMessage(sourceTrackIndices.length === 1
            ? "Track copied successfully"
            : `${sourceTrackIndices.length} tracks copied successfully`);
          if (destProject === projectPath) {
            if (onBankUpdated) onBankUpdated(destBankIndex);
            if (onProjectRefresh) onProjectRefresh();
          }
          break;

        case "copy_sample_slots":
          // Convert 0-based indices to 1-based for backend
          const slotsResult = await invoke<{ shared_files_kept: number }>("copy_sample_slots", {
            sourceProject: projectPath,
            destProject,
            slotType,
            sourceIndices: sourceSampleIndices.map(i => i + 1),
            destIndices: destSampleIndices.map(i => i + 1),
            audioMode,
            includeEditorSettings: audioMode === "move_to_pool" ? true : includeEditorSettings,
          });
          {
            let msg = sourceSampleIndices.length === 1
              ? "Sample slot copied successfully"
              : `${sourceSampleIndices.length} sample slots copied successfully`;
            if (slotsResult.shared_files_kept > 0) {
              msg += ` (${slotsResult.shared_files_kept} source file${slotsResult.shared_files_kept > 1 ? 's' : ''} kept: also referenced by ${slotType === 'static' ? 'Flex' : 'Static'} slots)`;
            }
            setStatusMessage(msg);
          }
          if (destProject === projectPath && onProjectRefresh) {
            onProjectRefresh();
          }
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

          {/* Bank selector for copy_patterns - stacked layout with click-to-deselect */}
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
                    title="Part 1"
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
                    title="Part 4"
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
                    title="Select all Parts"
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
                    title="Part 2"
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
                    title="Part 3"
                  >
                    3
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pattern selector for copy_patterns - single select or All */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Pattern</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      className={`tools-multi-btn pattern-btn ${(sourcePatternIndices.length === 1 && sourcePatternIndices.includes(idx)) || sourcePatternIndices.length === 16 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePatternIndices.length === 1 && sourcePatternIndices.includes(idx)) {
                          setSourcePatternIndices([]);
                        } else {
                          setSourcePatternIndices([idx]);
                        }
                      }}
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
                      className={`tools-multi-btn pattern-btn ${(sourcePatternIndices.length === 1 && sourcePatternIndices.includes(idx)) || sourcePatternIndices.length === 16 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePatternIndices.length === 1 && sourcePatternIndices.includes(idx)) {
                          setSourcePatternIndices([]);
                        } else {
                          setSourcePatternIndices([idx]);
                        }
                      }}
                      title={`Pattern ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <div className="tools-select-actions">
                  <button
                    className={`tools-multi-btn pattern-btn tools-select-all ${sourcePatternIndices.length === 16 ? "selected" : ""}`}
                    onClick={() => {
                      if (sourcePatternIndices.length === 16) {
                        setSourcePatternIndices([]);
                        setDestPatternIndices([]);
                      } else {
                        setSourcePatternIndices(Array.from({ length: 16 }, (_, i) => i));
                        setDestPatternIndices(Array.from({ length: 16 }, (_, i) => i));
                      }
                    }}
                    title="Select all patterns"
                  >
                    All
                  </button>
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
              <div className="tools-field">
                <label>Tracks</label>
                <div className={`tools-multi-select tracks-stacked ${(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) ? "disabled" : ""}`}>
                  <div className="tools-track-row-buttons">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => {
                      const isAllAudioMode = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                      const isAllMidiMode = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                      const destHasMidi = destTrackIndices.some(i => i >= 8);
                      const isDisabled = isAllAudioMode || isAllMidiMode || destHasMidi;
                      return (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""} ${isDisabled && !isAllAudioMode ? "disabled" : ""}`}
                          onClick={() => {
                            if (isDisabled) return;
                            if (sourceTrackIndices.includes(idx)) {
                              setSourceTrackIndices([]);
                            } else {
                              // Single selection only - replace any existing selection
                              setSourceTrackIndices([idx]);
                            }
                          }}
                          title={destHasMidi ? "Destination has MIDI tracks selected" : `Audio Track ${idx + 1}`}
                        >
                          T{idx + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tools-track-row-buttons">
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => {
                      const isAllAudioMode = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                      const isAllMidiMode = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                      const destHasAudio = destTrackIndices.some(i => i < 8);
                      const isDisabled = isAllAudioMode || isAllMidiMode || destHasAudio;
                      return (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""} ${isDisabled && !isAllMidiMode ? "disabled" : ""}`}
                          onClick={() => {
                            if (isDisabled) return;
                            if (sourceTrackIndices.includes(idx)) {
                              setSourceTrackIndices([]);
                            } else {
                              // Single selection only - replace any existing selection
                              setSourceTrackIndices([idx]);
                            }
                          }}
                          title={destHasAudio ? "Destination has Audio tracks selected" : `MIDI Track ${idx - 7}`}
                        >
                          M{idx - 7}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tools-select-actions">
                    <button
                      type="button"
                      className={`tools-multi-btn track-btn tools-select-all ${sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8) ? "selected" : ""} ${destTrackIndices.some(i => i >= 8) ? "disabled" : ""}`}
                      onClick={() => {
                        if (destTrackIndices.some(i => i >= 8)) return;
                        const isAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                        if (isAllAudio) {
                          setSourceTrackIndices([]);
                          setDestTrackIndices([]);
                        } else {
                          setSourceTrackIndices([0, 1, 2, 3, 4, 5, 6, 7]);
                        }
                      }}
                      disabled={destTrackIndices.some(i => i >= 8)}
                      title={destTrackIndices.some(i => i >= 8) ? "Destination has MIDI tracks selected" : "Select all Audio tracks"}
                    >
                      All Audio
                    </button>
                    <button
                      type="button"
                      className={`tools-multi-btn track-btn tools-select-all ${sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8) ? "selected" : ""} ${destTrackIndices.some(i => i < 8) ? "disabled" : ""}`}
                      onClick={() => {
                        if (destTrackIndices.some(i => i < 8)) return;
                        const isAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                        if (isAllMidi) {
                          setSourceTrackIndices([]);
                          setDestTrackIndices([]);
                        } else {
                          setSourceTrackIndices([8, 9, 10, 11, 12, 13, 14, 15]);
                        }
                      }}
                      disabled={destTrackIndices.some(i => i < 8)}
                      title={destTrackIndices.some(i => i < 8) ? "Destination has Audio tracks selected" : "Select all MIDI tracks"}
                    >
                      All MIDI
                    </button>
                  </div>
                </div>
              </div>
              <div className="tools-field">
                <label>Part</label>
                <div className="tools-part-cross">
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 0 || sourcePartIndex === -1 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePartIndex === 0) {
                          setSourcePartIndex(-2);
                        } else {
                          setSourcePartIndex(0);
                        }
                      }}
                      title="Part 1"
                    >
                      1
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 3 || sourcePartIndex === -1 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePartIndex === 3) {
                          setSourcePartIndex(-2);
                        } else {
                          setSourcePartIndex(3);
                        }
                      }}
                      title="Part 4"
                    >
                      4
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn part-all ${sourcePartIndex === -1 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePartIndex === -1) {
                          setSourcePartIndex(-2);
                          setDestTrackPartIndices([]);
                        } else {
                          setSourcePartIndex(-1);
                          setDestTrackPartIndices([0, 1, 2, 3]);
                        }
                      }}
                      title="Select all Parts"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 1 || sourcePartIndex === -1 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePartIndex === 1) {
                          setSourcePartIndex(-2);
                        } else {
                          setSourcePartIndex(1);
                        }
                      }}
                      title="Part 2"
                    >
                      2
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${sourcePartIndex === 2 || sourcePartIndex === -1 ? "selected" : ""}`}
                      onClick={() => {
                        if (sourcePartIndex === 2) {
                          setSourcePartIndex(-2);
                        } else {
                          setSourcePartIndex(2);
                        }
                      }}
                      title="Part 3"
                    >
                      3
                    </button>
                  </div>
                </div>
              </div>
              {/* Pattern selector for copy_tracks (only when mode includes pattern triggers) */}
              {copyTrackMode !== "part_params" && (
                <div className="tools-field">
                  <label>Pattern</label>
                  <div className="tools-multi-select banks-stacked">
                    <div className="tools-track-row-buttons">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn pattern-btn ${copyTrackSourcePatternIndex === idx || copyTrackSourcePatternIndex === -1 ? "selected" : ""}`}
                          onClick={() => {
                            if (copyTrackSourcePatternIndex === idx) {
                              setCopyTrackSourcePatternIndex(-1);
                            } else {
                              setCopyTrackSourcePatternIndex(idx);
                            }
                          }}
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
                          className={`tools-multi-btn pattern-btn ${copyTrackSourcePatternIndex === idx || copyTrackSourcePatternIndex === -1 ? "selected" : ""}`}
                          onClick={() => {
                            if (copyTrackSourcePatternIndex === idx) {
                              setCopyTrackSourcePatternIndex(-1);
                            } else {
                              setCopyTrackSourcePatternIndex(idx);
                            }
                          }}
                          title={`Pattern ${idx + 1}`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                    <div className="tools-select-actions">
                      <button
                        className={`tools-multi-btn pattern-btn tools-select-all ${copyTrackSourcePatternIndex === -1 ? "selected" : ""}`}
                        onClick={() => {
                          if (copyTrackSourcePatternIndex === -1) {
                            setCopyTrackSourcePatternIndex(0);
                            setCopyTrackDestPatternIndices([0]);
                          } else {
                            setCopyTrackSourcePatternIndex(-1);
                            setCopyTrackDestPatternIndices([]);
                          }
                        }}
                        title="All patterns"
                      >
                        All
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sample slot selector for copy_sample_slots */}
          {operation === "copy_sample_slots" && (
            <div className="tools-field">
              <label>Slots</label>
              <div className="tools-slot-selector">
                <div className="tools-slot-header">
                  {sampleSelectionMode === "one" ? (
                    <div className="tools-slot-range-display">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="tools-slot-value-input"
                        defaultValue={sourceSampleIndices[0] + 1}
                        key={`one-${sourceSampleIndices[0]}`}
                        title="Slot number to copy"
                        onBlur={(e) => {
                          let val = parseInt(e.target.value, 10);
                          if (isNaN(val) || val < 1) val = 1;
                          if (val > 128) val = 128;
                          e.target.value = String(val);
                          setSourceSampleIndices([val - 1]);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                    </div>
                  ) : (
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
                  )}
                  <div className="tools-slot-count" title="Number of slots selected">
                    <span className="tools-slot-count-number">{sourceSampleIndices.length}</span>
                    <span className="tools-slot-count-label">slot{sourceSampleIndices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className={`tools-slot-all-btn ${sampleSelectionMode === "one" ? "selected" : ""}`}
                    onClick={() => {
                      setSampleSelectionMode("one");
                      setSourceSampleIndices([sourceSampleIndices[0]]);
                    }}
                    title="Select a single slot"
                  >
                    One
                  </button>
                  <button
                    type="button"
                    className={`tools-slot-all-btn ${sampleSelectionMode === "range" ? "selected" : ""}`}
                    onClick={() => {
                      setSampleSelectionMode("range");
                    }}
                    title="Select a range of slots"
                  >
                    Range
                  </button>
                </div>
                {sampleSelectionMode === "one" ? (
                <div className="tools-dual-range-slider tools-single-range">
                  <input
                    type="range"
                    className="tools-dual-range-input"
                    min="1"
                    max="128"
                    value={sourceSampleIndices[0] + 1}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(127, Number(e.target.value) - 1));
                      setSourceSampleIndices([val]);
                    }}
                  />
                </div>
                ) : (
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
                )}
              </div>
            </div>
          )}
        </div>

        {/* Options Panel */}
        <div className="tools-options-column">
          {/* Operation Description */}
          <div className="tools-description-pane">
            {operation === "copy_bank" && (
              <p>Copies entire bank including all 4 Parts and 16 Patterns.</p>
            )}
            {operation === "copy_parts" && (
              <p>Copies Part sound design (machines, amps, LFOs, FX).</p>
            )}
            {operation === "copy_patterns" && (
              <p>Copies pattern step data (trigs, parameter locks) with configurable Part assignment and track scope.</p>
            )}
            {operation === "copy_tracks" && (
              <p>Copies individual track data: Part parameters (sound design per track) and/or pattern triggers (step sequence).</p>
            )}
            {operation === "copy_sample_slots" && (
              <p>Copies sample slot assignments between projects, with optional audio file transfer and editor settings.</p>
            )}
          </div>

        {(operation === "copy_patterns" || operation === "copy_tracks" || operation === "copy_sample_slots") && (
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
                    title="Keep the destination pattern's current Part assignment"
                  >
                    Keep Original
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${partAssignmentMode === "copy_source_part" ? "selected" : ""}`}
                    onClick={() => setPartAssignmentMode("copy_source_part")}
                    title="Use the same Part assignment as the source pattern"
                  >
                    Copy Source
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${partAssignmentMode === "select_specific" ? "selected" : ""}`}
                    onClick={() => setPartAssignmentMode("select_specific")}
                    title="Assign copied pattern to a Part you select"
                  >
                    User Selection
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
                        onClick={() => setDestPart(destPart === 0 ? -1 : 0)}
                        title="Part 1"
                      >
                        1
                      </button>
                    </div>
                    <div className="tools-part-cross-row">
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 3 ? "selected" : ""}`}
                        onClick={() => setDestPart(destPart === 3 ? -1 : 3)}
                        title="Part 4"
                      >
                        4
                      </button>
                      <span className="tools-part-cross-spacer"></span>
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 1 ? "selected" : ""}`}
                        onClick={() => setDestPart(destPart === 1 ? -1 : 1)}
                        title="Part 2"
                      >
                        2
                      </button>
                    </div>
                    <div className="tools-part-cross-row">
                      <button
                        type="button"
                        className={`tools-toggle-btn part-btn ${destPart === 2 ? "selected" : ""}`}
                        onClick={() => setDestPart(destPart === 2 ? -1 : 2)}
                        title="Part 3"
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
              {trackMode === "all" && (
                <div className="tools-field">
                  <label>Mode Scope</label>
                  <div className="tools-toggle-group">
                    <button
                      type="button"
                      className={`tools-toggle-btn ${modeScope === "audio" ? "selected" : ""}`}
                      onClick={() => setModeScope("audio")}
                      title="Copy only Audio tracks (T1-T8)"
                    >
                      Audio
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn ${modeScope === "both" ? "selected" : ""}`}
                      onClick={() => setModeScope("both")}
                      title="Copy both Audio and MIDI tracks"
                    >
                      Both
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn ${modeScope === "midi" ? "selected" : ""}`}
                      onClick={() => setModeScope("midi")}
                      title="Copy only MIDI tracks (M1-M8)"
                    >
                      MIDI
                    </button>
                  </div>
                </div>
              )}
              {trackMode === "specific" && (
                <div className="tools-field">
                  <label>Tracks</label>
                  <div className="tools-multi-select tracks-stacked">
                    <div className="tools-track-row-buttons">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                          onClick={() => sourceTrackIndices.includes(idx)
                            ? setSourceTrackIndices(sourceTrackIndices.filter(i => i !== idx))
                            : setSourceTrackIndices([...sourceTrackIndices, idx].sort((a, b) => a - b))
                          }
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
                          onClick={() => sourceTrackIndices.includes(idx)
                            ? setSourceTrackIndices(sourceTrackIndices.filter(i => i !== idx))
                            : setSourceTrackIndices([...sourceTrackIndices, idx].sort((a, b) => a - b))
                          }
                          title={`MIDI Track ${idx - 7}`}
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
                  Part Parameters
                </button>
                <button
                  type="button"
                  className={`tools-toggle-btn ${copyTrackMode === "both" ? "selected" : ""}`}
                  onClick={() => {
                    setCopyTrackMode("both");
                    setCopyTrackSourcePatternIndex(0);
                    setCopyTrackDestPatternIndices([0]);
                  }}
                  title="Copy both Part parameters (machines, amps, LFOs, FX) and Pattern triggers (trigs, plocks)"
                >
                  Both
                </button>
                <button
                  type="button"
                  className={`tools-toggle-btn ${copyTrackMode === "pattern_triggers" ? "selected" : ""}`}
                  onClick={() => {
                    setCopyTrackMode("pattern_triggers");
                    setCopyTrackSourcePatternIndex(0);
                    setCopyTrackDestPatternIndices([0]);
                  }}
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
                  {audioMode !== "none" && missingSourceFiles > 0 && (
                    <span
                      className="tools-warning-badge"
                      title={`${missingSourceFiles} source audio file${missingSourceFiles > 1 ? 's' : ''} not found on disk. These slots will be copied without their audio.`}
                    >
                      {missingSourceFiles} missing file{missingSourceFiles > 1 ? 's' : ''}
                    </span>
                  )}
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
                <label title={audioMode === "move_to_pool"
                  ? "Always enabled for Move to Pool — relocating files preserves all settings and .ot metadata."
                  : "Per-slot settings from the project file (gain, BPM, loop mode, timestretch, trig quantization), markers file (trim points, loop points, slices), and .ot metadata files. When off, all are reset to defaults and .ot files are not copied."
                }>
                  <input
                    type="checkbox"
                    checked={audioMode === "move_to_pool" ? true : includeEditorSettings}
                    disabled={audioMode === "move_to_pool"}
                    onChange={(e) => setIncludeEditorSettings(e.target.checked)}
                  />
                  Include Editor Settings
                </label>
              </div>
            </>
          )}

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
              onClick={() => {
                // Auto-open the most relevant fieldset based on current project context
                let foundInSet = false;
                for (let locIdx = 0; locIdx < locations.length; locIdx++) {
                  const loc = locations[locIdx];
                  for (const set of loc.sets) {
                    if (set.projects.some(p => p.path === projectPath)) {
                      const setKey = `${locIdx}-${set.name}`;
                      setOpenLocationsInModal(new Set([locIdx]));
                      setOpenSetsInModal(new Set([setKey]));
                      setIsLocationsOpenInModal(true);
                      setIsIndividualProjectsOpenInModal(false);
                      foundInSet = true;
                      break;
                    }
                  }
                  if (foundInSet) break;
                }
                if (!foundInSet) {
                  if (locations.length > 0) {
                    setIsLocationsOpenInModal(true);
                    setOpenLocationsInModal(new Set());
                    setOpenSetsInModal(new Set());
                    setIsIndividualProjectsOpenInModal(false);
                  } else {
                    setIsIndividualProjectsOpenInModal(true);
                    setIsLocationsOpenInModal(false);
                  }
                }
                setShowProjectSelector(true);
              }}
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
                      title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
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
                      title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-select-actions">
                  <button
                    className="tools-multi-btn bank-btn tools-select-all"
                    onClick={() => setDestBankIndices([])}
                    title="Deselect all banks"
                  >
                    None
                  </button>
                  <button
                    className={`tools-multi-btn bank-btn tools-select-all ${destBankIndices.length === 16 ? "selected" : ""}`}
                    onClick={() => destBankIndices.length === 16 ? setDestBankIndices([]) : selectAllIndices(16, setDestBankIndices)}
                    title="Select all banks"
                  >
                    All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bank selector for copy_parts - multi-select */}
          {operation === "copy_parts" && (
            <div className="tools-field">
              <label>Banks</label>
              <div className="tools-multi-select banks-stacked">
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn bank-btn ${destPartBankIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => destPartBankIndices.includes(idx)
                        ? setDestPartBankIndices(destPartBankIndices.filter(i => i !== idx))
                        : setDestPartBankIndices([...destPartBankIndices, idx].sort((a, b) => a - b))
                      }
                      title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
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
                      className={`tools-multi-btn bank-btn ${destPartBankIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => destPartBankIndices.includes(idx)
                        ? setDestPartBankIndices(destPartBankIndices.filter(i => i !== idx))
                        : setDestPartBankIndices([...destPartBankIndices, idx].sort((a, b) => a - b))
                      }
                      title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
                    >
                      {String.fromCharCode(65 + idx)}
                    </button>
                  ))}
                </div>
                <div className="tools-select-actions">
                  <button
                    className="tools-multi-btn bank-btn tools-select-all"
                    onClick={() => setDestPartBankIndices([])}
                    title="Deselect all banks"
                  >
                    None
                  </button>
                  <button
                    className={`tools-multi-btn bank-btn tools-select-all ${destPartBankIndices.length === 16 ? "selected" : ""}`}
                    onClick={() => destPartBankIndices.length === 16 ? setDestPartBankIndices([]) : selectAllIndices(16, setDestPartBankIndices)}
                    title="Select all banks"
                  >
                    All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bank selector for copy_patterns - stacked layout with click-to-deselect */}
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
                      onClick={() => setDestBankIndex(destBankIndex === idx ? -1 : idx)}
                      title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
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
                      title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
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
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : "Part 1"}
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
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : "Part 4"}
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
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : "Select all Parts"}
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
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : "Part 2"}
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
                    title={sourcePartIndices.length === 4 ? "Synced with source All selection" : "Part 3"}
                  >
                    3
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Pattern selector for copy_patterns - multi-select, disabled when source All is selected */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Patterns</label>
              <div className={`tools-multi-select banks-stacked ${sourcePatternIndices.length === 16 ? "disabled" : ""}`}>
                <div className="tools-track-row-buttons">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn pattern-btn ${destPatternIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => sourcePatternIndices.length !== 16 && (destPatternIndices.includes(idx)
                        ? setDestPatternIndices(destPatternIndices.filter(i => i !== idx))
                        : setDestPatternIndices([...destPatternIndices, idx].sort((a, b) => a - b))
                      )}
                      disabled={sourcePatternIndices.length === 16}
                      title={sourcePatternIndices.length === 16 ? "Synced with source All selection" : `Pattern ${idx + 1}`}
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
                      className={`tools-multi-btn pattern-btn ${destPatternIndices.includes(idx) ? "selected" : ""}`}
                      onClick={() => sourcePatternIndices.length !== 16 && (destPatternIndices.includes(idx)
                        ? setDestPatternIndices(destPatternIndices.filter(i => i !== idx))
                        : setDestPatternIndices([...destPatternIndices, idx].sort((a, b) => a - b))
                      )}
                      disabled={sourcePatternIndices.length === 16}
                      title={sourcePatternIndices.length === 16 ? "Synced with source All selection" : `Pattern ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <div className="tools-select-actions">
                  <button
                    className="tools-multi-btn pattern-btn tools-select-all"
                    onClick={() => sourcePatternIndices.length !== 16 && setDestPatternIndices([])}
                    disabled={sourcePatternIndices.length === 16}
                    title={sourcePatternIndices.length === 16 ? "Synced with source All selection" : "Deselect all patterns"}
                  >
                    None
                  </button>
                  <button
                    className={`tools-multi-btn pattern-btn tools-select-all ${destPatternIndices.length === 16 ? "selected" : ""}`}
                    onClick={() => sourcePatternIndices.length !== 16 && (destPatternIndices.length === 16
                      ? setDestPatternIndices([])
                      : setDestPatternIndices(Array.from({ length: 16 }, (_, i) => i))
                    )}
                    disabled={sourcePatternIndices.length === 16}
                    title={sourcePatternIndices.length === 16 ? "Synced with source All selection" : "Select all patterns"}
                  >
                    All
                  </button>
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
                        onClick={() => setDestBankIndex(destBankIndex === idx ? -1 : idx)}
                        title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
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
                        title={`Bank ${String.fromCharCode(65 + idx)} (${idx + 1})`}
                      >
                        {String.fromCharCode(65 + idx)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="tools-field">
                <label>Tracks</label>
                <div className={`tools-multi-select tracks-stacked ${(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) ? "disabled" : ""}`}>
                  <div className="tools-track-row-buttons">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => {
                      const isSourceAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                      const isSourceAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                      const sourceIsMidi = sourceTrackIndices.length === 1 && sourceTrackIndices[0] >= 8;
                      const isDisabled = isSourceAllAudio || isSourceAllMidi || sourceIsMidi;
                      return (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${destTrackIndices.includes(idx) ? "selected" : ""} ${isDisabled ? "disabled" : ""}`}
                          onClick={() => {
                            if (isDisabled) return;
                            if (destTrackIndices.includes(idx)) {
                              setDestTrackIndices(destTrackIndices.filter(i => i !== idx));
                            } else {
                              // Only allow audio tracks when source is audio
                              setDestTrackIndices([...destTrackIndices.filter(i => i < 8), idx].sort((a, b) => a - b));
                            }
                          }}
                          title={isSourceAllAudio || isSourceAllMidi ? "Synced with source All selection" : sourceIsMidi ? "Source is a MIDI track" : `Audio Track ${idx + 1}`}
                        >
                          T{idx + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tools-track-row-buttons">
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => {
                      const isSourceAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                      const isSourceAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                      const sourceIsAudio = sourceTrackIndices.length === 1 && sourceTrackIndices[0] < 8;
                      const isDisabled = isSourceAllAudio || isSourceAllMidi || sourceIsAudio;
                      return (
                        <button
                          key={idx}
                          className={`tools-multi-btn track-btn ${destTrackIndices.includes(idx) ? "selected" : ""} ${isDisabled ? "disabled" : ""}`}
                          onClick={() => {
                            if (isDisabled) return;
                            if (destTrackIndices.includes(idx)) {
                              setDestTrackIndices(destTrackIndices.filter(i => i !== idx));
                            } else {
                              // Only allow MIDI tracks when source is MIDI
                              setDestTrackIndices([...destTrackIndices.filter(i => i >= 8), idx].sort((a, b) => a - b));
                            }
                          }}
                          title={isSourceAllAudio || isSourceAllMidi ? "Synced with source All selection" : sourceIsAudio ? "Source is an Audio track" : `MIDI Track ${idx - 7}`}
                        >
                          M{idx - 7}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tools-select-actions">
                    <button
                      type="button"
                      className={`tools-multi-btn track-btn tools-select-all ${destTrackIndices.length === 8 && destTrackIndices.every(i => i < 8) ? "selected" : ""} ${(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) || (sourceTrackIndices.length === 1 && sourceTrackIndices[0] >= 8) ? "disabled" : ""}`}
                      onClick={() => {
                        const isSourceAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                        const isSourceAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                        const sourceIsMidi = sourceTrackIndices.length === 1 && sourceTrackIndices[0] >= 8;
                        if (isSourceAllAudio || isSourceAllMidi || sourceIsMidi) return;
                        const isAllAudio = destTrackIndices.length === 8 && destTrackIndices.every(i => i < 8);
                        if (isAllAudio) {
                          setDestTrackIndices([]);
                        } else {
                          setDestTrackIndices([0, 1, 2, 3, 4, 5, 6, 7]);
                        }
                      }}
                      disabled={(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) || (sourceTrackIndices.length === 1 && sourceTrackIndices[0] >= 8)}
                      title={(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) ? "Synced with source All selection" : (sourceTrackIndices.length === 1 && sourceTrackIndices[0] >= 8) ? "Source is a MIDI track" : "Select all Audio tracks"}
                    >
                      All Audio
                    </button>
                    <button
                      className={`tools-multi-btn track-btn tools-select-all ${(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) ? "disabled" : ""}`}
                      onClick={() => {
                        const isSourceAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                        const isSourceAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                        if (isSourceAllAudio || isSourceAllMidi) return;
                        setDestTrackIndices([]);
                      }}
                      disabled={(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8))}
                      title={(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) ? "Synced with source All selection" : "Deselect all tracks"}
                    >
                      None
                    </button>
                    <button
                      type="button"
                      className={`tools-multi-btn track-btn tools-select-all ${destTrackIndices.length === 8 && destTrackIndices.every(i => i >= 8) ? "selected" : ""} ${(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) || (sourceTrackIndices.length === 1 && sourceTrackIndices[0] < 8) ? "disabled" : ""}`}
                      onClick={() => {
                        const isSourceAllAudio = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8);
                        const isSourceAllMidi = sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8);
                        const sourceIsAudio = sourceTrackIndices.length === 1 && sourceTrackIndices[0] < 8;
                        if (isSourceAllAudio || isSourceAllMidi || sourceIsAudio) return;
                        const isAllMidi = destTrackIndices.length === 8 && destTrackIndices.every(i => i >= 8);
                        if (isAllMidi) {
                          setDestTrackIndices([]);
                        } else {
                          setDestTrackIndices([8, 9, 10, 11, 12, 13, 14, 15]);
                        }
                      }}
                      disabled={(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) || (sourceTrackIndices.length === 1 && sourceTrackIndices[0] < 8)}
                      title={(sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i < 8)) || (sourceTrackIndices.length === 8 && sourceTrackIndices.every(i => i >= 8)) ? "Synced with source All selection" : (sourceTrackIndices.length === 1 && sourceTrackIndices[0] < 8) ? "Source is an Audio track" : "Select all MIDI tracks"}
                    >
                      All MIDI
                    </button>
                  </div>
                </div>
              </div>
              <div className="tools-field">
                <label>Parts</label>
                <div className={`tools-part-cross ${sourcePartIndex === -1 ? "disabled" : ""}`}>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destTrackPartIndices.includes(0) ? "selected" : ""}`}
                      onClick={() => sourcePartIndex !== -1 && (destTrackPartIndices.includes(0)
                        ? setDestTrackPartIndices(destTrackPartIndices.filter(i => i !== 0))
                        : setDestTrackPartIndices([...destTrackPartIndices, 0].sort((a, b) => a - b))
                      )}
                      disabled={sourcePartIndex === -1}
                      title={sourcePartIndex === -1 ? "Synced with source All selection" : "Part 1"}
                    >
                      1
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destTrackPartIndices.includes(3) ? "selected" : ""}`}
                      onClick={() => sourcePartIndex !== -1 && (destTrackPartIndices.includes(3)
                        ? setDestTrackPartIndices(destTrackPartIndices.filter(i => i !== 3))
                        : setDestTrackPartIndices([...destTrackPartIndices, 3].sort((a, b) => a - b))
                      )}
                      disabled={sourcePartIndex === -1}
                      title={sourcePartIndex === -1 ? "Synced with source All selection" : "Part 4"}
                    >
                      4
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn part-all ${destTrackPartIndices.length === 4 ? "selected" : ""}`}
                      onClick={() => sourcePartIndex !== -1 && (destTrackPartIndices.length === 4
                        ? setDestTrackPartIndices([])
                        : setDestTrackPartIndices([0, 1, 2, 3])
                      )}
                      disabled={sourcePartIndex === -1}
                      title={sourcePartIndex === -1 ? "Synced with source All selection" : "Select all Parts"}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destTrackPartIndices.includes(1) ? "selected" : ""}`}
                      onClick={() => sourcePartIndex !== -1 && (destTrackPartIndices.includes(1)
                        ? setDestTrackPartIndices(destTrackPartIndices.filter(i => i !== 1))
                        : setDestTrackPartIndices([...destTrackPartIndices, 1].sort((a, b) => a - b))
                      )}
                      disabled={sourcePartIndex === -1}
                      title={sourcePartIndex === -1 ? "Synced with source All selection" : "Part 2"}
                    >
                      2
                    </button>
                  </div>
                  <div className="tools-part-cross-row">
                    <button
                      type="button"
                      className={`tools-toggle-btn part-btn ${destTrackPartIndices.includes(2) ? "selected" : ""}`}
                      onClick={() => sourcePartIndex !== -1 && (destTrackPartIndices.includes(2)
                        ? setDestTrackPartIndices(destTrackPartIndices.filter(i => i !== 2))
                        : setDestTrackPartIndices([...destTrackPartIndices, 2].sort((a, b) => a - b))
                      )}
                      disabled={sourcePartIndex === -1}
                      title={sourcePartIndex === -1 ? "Synced with source All selection" : "Part 3"}
                    >
                      3
                    </button>
                  </div>
                </div>
              </div>
              {/* Pattern selector for copy_tracks destination (only when mode includes pattern triggers) */}
              {copyTrackMode !== "part_params" && (
                <div className="tools-field">
                  <label>Pattern</label>
                  <div className={`tools-multi-select banks-stacked ${copyTrackSourcePatternIndex === -1 ? "disabled" : ""}`}>
                    <div className="tools-track-row-buttons">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn pattern-btn ${copyTrackDestPatternIndices.includes(idx) || copyTrackDestPatternIndices.length === 0 ? "selected" : ""}`}
                          onClick={() => {
                            if (copyTrackSourcePatternIndex === -1) return;
                            if (copyTrackDestPatternIndices.length === 0) {
                              // Was "All" → select only this one
                              setCopyTrackDestPatternIndices([idx]);
                            } else if (copyTrackDestPatternIndices.includes(idx)) {
                              const remaining = copyTrackDestPatternIndices.filter(i => i !== idx);
                              setCopyTrackDestPatternIndices(remaining.length === 0 ? [] : remaining);
                            } else {
                              setCopyTrackDestPatternIndices([...copyTrackDestPatternIndices, idx].sort((a, b) => a - b));
                            }
                          }}
                          disabled={copyTrackSourcePatternIndex === -1}
                          title={copyTrackSourcePatternIndex === -1 ? "Synced with source All selection" : `Pattern ${idx + 1}`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                    <div className="tools-track-row-buttons">
                      {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn pattern-btn ${copyTrackDestPatternIndices.includes(idx) || copyTrackDestPatternIndices.length === 0 ? "selected" : ""}`}
                          onClick={() => {
                            if (copyTrackSourcePatternIndex === -1) return;
                            if (copyTrackDestPatternIndices.length === 0) {
                              setCopyTrackDestPatternIndices([idx]);
                            } else if (copyTrackDestPatternIndices.includes(idx)) {
                              const remaining = copyTrackDestPatternIndices.filter(i => i !== idx);
                              setCopyTrackDestPatternIndices(remaining.length === 0 ? [] : remaining);
                            } else {
                              setCopyTrackDestPatternIndices([...copyTrackDestPatternIndices, idx].sort((a, b) => a - b));
                            }
                          }}
                          disabled={copyTrackSourcePatternIndex === -1}
                          title={copyTrackSourcePatternIndex === -1 ? "Synced with source All selection" : `Pattern ${idx + 1}`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                    <div className="tools-select-actions">
                      <button
                        className={`tools-multi-btn pattern-btn tools-select-all ${copyTrackDestPatternIndices.length === 0 ? "selected" : ""}`}
                        onClick={() => {
                          if (copyTrackSourcePatternIndex === -1) return;
                          setCopyTrackDestPatternIndices([]);
                        }}
                        disabled={copyTrackSourcePatternIndex === -1}
                        title={copyTrackSourcePatternIndex === -1 ? "Synced with source All selection" : "All patterns"}
                      >
                        All
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sample slot destination for copy_sample_slots */}
          {operation === "copy_sample_slots" && (
            <div className="tools-field">
              <label className="tools-label-with-warning">
                Slots
                {sourceSampleIndices.length + destSampleStart > 128 && (
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
                      defaultValue={destSampleStart + 1}
                      key={`dest-from-${destSampleStart}`}
                      title="Starting destination slot"
                      onBlur={(e) => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val) || val < 1) val = 1;
                        if (val > 128) val = 128;
                        e.target.value = String(val);
                        setDestSampleStart(val - 1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    <span className="tools-slot-separator">–</span>
                    <span className="tools-slot-value-display" title="Ending destination slot (based on source count)">{Math.min(128, destSampleStart + sourceSampleIndices.length)}</span>
                  </div>
                  <div className="tools-slot-count" title={`Effective slots to copy${Math.min(sourceSampleIndices.length, 128 - destSampleStart) < sourceSampleIndices.length ? ` (${sourceSampleIndices.length - Math.min(sourceSampleIndices.length, 128 - destSampleStart)} will overflow)` : ''}`}>
                    <span className="tools-slot-count-number">{Math.min(sourceSampleIndices.length, 128 - destSampleStart)}</span>
                    <span className="tools-slot-count-label">slot{Math.min(sourceSampleIndices.length, 128 - destSampleStart) !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="tools-slot-all-btn"
                    onClick={() => {
                      setDestSampleStart(0);
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
                    value={destSampleStart + 1}
                    onChange={(e) => {
                      setDestSampleStart(Math.max(0, Math.min(127, Number(e.target.value) - 1)));
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
          disabled={isExecuting || (operation === "copy_bank" && sourceBankIndex === -1) || (operation === "copy_bank" && destBankIndices.length === 0) || (operation === "copy_parts" && sourceBankIndex === -1) || (operation === "copy_parts" && destPartBankIndices.length === 0) || (operation === "copy_parts" && sourcePartIndices.length === 0) || (operation === "copy_parts" && destPartIndices.length === 0) || (operation === "copy_tracks" && sourceBankIndex === -1) || (operation === "copy_tracks" && sourceTrackIndices.length === 0) || (operation === "copy_tracks" && sourcePartIndex === -2) || (operation === "copy_tracks" && destBankIndex === -1) || (operation === "copy_tracks" && destTrackIndices.length === 0) || (operation === "copy_tracks" && sourcePartIndex !== -1 && destTrackPartIndices.length === 0) || (operation === "copy_patterns" && sourceBankIndex === -1) || (operation === "copy_patterns" && sourcePatternIndices.length === 0) || (operation === "copy_patterns" && destBankIndex === -1) || (operation === "copy_patterns" && destPatternIndices.length === 0) || (operation === "copy_patterns" && partAssignmentMode === "select_specific" && destPart === -1) || (operation === "copy_patterns" && trackMode === "specific" && sourceTrackIndices.length === 0)}
          title={
            isExecuting ? "Operation in progress..." :
            (operation === "copy_bank" && sourceBankIndex === -1 && destBankIndices.length === 0) ? "Select source and destination banks" :
            (operation === "copy_bank" && sourceBankIndex === -1) ? "Select a source bank" :
            (operation === "copy_bank" && destBankIndices.length === 0) ? "Select at least one destination bank" :
            (operation === "copy_parts" && sourceBankIndex === -1 && destPartBankIndices.length === 0) ? "Select source and destination banks" :
            (operation === "copy_parts" && sourceBankIndex === -1) ? "Select a source bank" :
            (operation === "copy_parts" && destPartBankIndices.length === 0) ? "Select at least one destination bank" :
            (operation === "copy_parts" && sourcePartIndices.length === 0 && destPartIndices.length === 0) ? "Select source and destination parts" :
            (operation === "copy_parts" && sourcePartIndices.length === 0) ? "Select a source part" :
            (operation === "copy_parts" && destPartIndices.length === 0) ? "Select at least one destination part" :
            (operation === "copy_tracks" && sourceBankIndex === -1 && destBankIndex === -1) ? "Select source and destination banks" :
            (operation === "copy_tracks" && sourceBankIndex === -1) ? "Select a source bank" :
            (operation === "copy_tracks" && destBankIndex === -1) ? "Select a destination bank" :
            (operation === "copy_tracks" && sourceTrackIndices.length === 0 && destTrackIndices.length === 0) ? "Select source and destination tracks" :
            (operation === "copy_tracks" && sourceTrackIndices.length === 0) ? "Select a source track" :
            (operation === "copy_tracks" && destTrackIndices.length === 0) ? "Select at least one destination track" :
            (operation === "copy_tracks" && sourcePartIndex === -2 && destTrackPartIndices.length === 0) ? "Select source and destination parts" :
            (operation === "copy_tracks" && sourcePartIndex === -2) ? "Select a source part" :
            (operation === "copy_tracks" && sourcePartIndex !== -1 && destTrackPartIndices.length === 0) ? "Select at least one destination part" :
            (operation === "copy_patterns" && sourceBankIndex === -1 && destBankIndex === -1) ? "Select source and destination banks" :
            (operation === "copy_patterns" && sourceBankIndex === -1) ? "Select a source bank" :
            (operation === "copy_patterns" && destBankIndex === -1) ? "Select a destination bank" :
            (operation === "copy_patterns" && sourcePatternIndices.length === 0 && destPatternIndices.length === 0) ? "Select source and destination patterns" :
            (operation === "copy_patterns" && sourcePatternIndices.length === 0) ? "Select a source pattern" :
            (operation === "copy_patterns" && destPatternIndices.length === 0) ? "Select at least one destination pattern" :
            (operation === "copy_patterns" && partAssignmentMode === "select_specific" && destPart === -1) ? "Select a destination part" :
            (operation === "copy_patterns" && trackMode === "specific" && sourceTrackIndices.length === 0) ? "Select at least one track" :
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
                        title={projectPath}
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
                        {[...standaloneProjects]
                          .filter(p => p.path !== projectPath && p.has_project_file)
                          .sort((a, b) => naturalCompare(a.name, b.name))
                          .map((project, projIdx) => (
                            <div
                              key={projIdx}
                              className={`project-card project-selector-card ${destProject === project.path ? 'selected' : ''}`}
                              onClick={() => {
                                setDestProject(project.path);
                                setShowProjectSelector(false);
                              }}
                              title={project.path}
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
                            return naturalCompare(a.name, b.name);
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
                                    <span
                                      className={set.has_audio_pool ? "status-audio-pool" : "status-audio-pool-empty"}
                                      title={set.has_audio_pool ? "Audio Pool folder contains samples" : "Audio Pool folder is empty or missing"}
                                    >
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
                                      {[...validProjects].sort((a, b) => naturalCompare(a.name, b.name)).map((project, projIdx) => (
                                        <div
                                          key={projIdx}
                                          className={`project-card project-selector-card ${destProject === project.path ? 'selected' : ''}`}
                                          onClick={() => {
                                            setDestProject(project.path);
                                            setShowProjectSelector(false);
                                          }}
                                          title={project.path}
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
