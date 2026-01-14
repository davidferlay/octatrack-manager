import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjects } from "../context/ProjectsContext";
import type { Bank } from "../context/ProjectsContext";
import { formatBankName } from "./BankSelector";
import "../App.css";

const TOOLS_STORAGE_KEY = "octatrack-tools-settings";

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

function loadToolsSettings(): Partial<ToolsSettings> {
  try {
    const stored = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Error loading tools settings:", error);
  }
  return {};
}

function saveToolsSettings(settings: ToolsSettings): void {
  try {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving tools settings:", error);
  }
}

export function ToolsPanel({ projectPath, projectName, banks, loadedBankIndices, onBankUpdated }: ToolsPanelProps) {
  const { locations, standaloneProjects } = useProjects();

  // Load saved settings
  const savedSettings = loadToolsSettings();

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
  const [destPartIndices, setDestPartIndices] = useState<number[]>([0]);
  const [destPatternStart, setDestPatternStart] = useState<number>(0);
  const [destTrackIndices, setDestTrackIndices] = useState<number[]>([0]);
  const [destSampleIndices, setDestSampleIndices] = useState<number[]>(Array.from({ length: 128 }, (_, i) => i));

  // Operation-specific options
  // Copy Patterns options
  const [partAssignmentMode, setPartAssignmentMode] = useState<PartAssignmentMode>(savedSettings.partAssignmentMode || "keep_original");
  const [destPart, setDestPart] = useState<number>(0);
  const [trackMode, setTrackMode] = useState<TrackMode>(savedSettings.trackMode || "all");

  // Copy Tracks options
  const [copyTrackMode, setCopyTrackMode] = useState<CopyTrackMode>(savedSettings.copyTrackMode || "both");
  const [sourcePartIndex, setSourcePartIndex] = useState<number>(0);
  const [destPartIndex, setDestPartIndex] = useState<number>(0);

  // Copy Sample Slots options
  const [slotType, setSlotType] = useState<SlotType>(savedSettings.slotType || "both");
  const [audioMode, setAudioMode] = useState<AudioMode>(savedSettings.audioMode || "move_to_pool");
  const [includeEditorSettings, setIncludeEditorSettings] = useState<boolean>(savedSettings.includeEditorSettings ?? true);

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

  // Available destination banks for the destination project
  const [destBanks, setDestBanks] = useState<number[]>([]);

  // Save settings to localStorage when they change
  useEffect(() => {
    saveToolsSettings({
      operation,
      partAssignmentMode,
      trackMode,
      copyTrackMode,
      slotType,
      audioMode,
      includeEditorSettings,
    });
  }, [operation, partAssignmentMode, trackMode, copyTrackMode, slotType, audioMode, includeEditorSettings]);

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

  // Load destination banks when destination project changes
  useEffect(() => {
    async function loadDestBanks() {
      if (destProject === projectPath) {
        // Use currently loaded banks
        setDestBanks(Array.from(loadedBankIndices).sort((a, b) => a - b));
      } else {
        // Load bank indices from the destination project
        try {
          const indices = await invoke<number[]>("get_existing_banks", { path: destProject });
          setDestBanks(indices);
        } catch (err) {
          console.error("Error loading destination banks:", err);
          setDestBanks([]);
        }
      }
    }
    loadDestBanks();
  }, [destProject, projectPath, loadedBankIndices]);

  // Reset audio mode if move_to_pool is selected but projects aren't in same set
  useEffect(() => {
    if (audioMode === "move_to_pool" && !sameSetStatus) {
      setAudioMode("copy");
    }
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
        return `Copying Bank ${String.fromCharCode(65 + sourceBankIndex)}...`;
      case "copy_parts":
        return `Copying ${sourcePartIndices.length} part${sourcePartIndices.length > 1 ? 's' : ''}...`;
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
            destBankIndex,
          });
          setStatusMessage(`Bank ${String.fromCharCode(65 + sourceBankIndex)} copied successfully`);
          if (destProject === projectPath && onBankUpdated) {
            onBankUpdated(destBankIndex);
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
          setStatusMessage(`${sourcePartIndices.length} part${sourcePartIndices.length > 1 ? 's' : ''} copied successfully`);
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
            sourcePartIndex,
            sourceTrackIndices,
            destProject,
            destBankIndex,
            destPartIndex,
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

  // Get available source bank indices
  const availableSourceBanks = Array.from(loadedBankIndices).sort((a, b) => a - b);

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
          <option value="copy_bank">Copy Bank</option>
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

          {/* Bank selector for bank-related operations */}
          {(operation === "copy_bank" || operation === "copy_parts" || operation === "copy_patterns" || operation === "copy_tracks") && (
            <div className="tools-field">
              <label>Bank</label>
              <select
                value={sourceBankIndex}
                onChange={(e) => setSourceBankIndex(Number(e.target.value))}
              >
                {availableSourceBanks.map((idx) => {
                  const bank = banks[idx];
                  return (
                    <option key={idx} value={idx}>
                      {bank ? formatBankName(bank.name, idx) : `Bank ${String.fromCharCode(65 + idx)}`}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Part selector for copy_parts */}
          {operation === "copy_parts" && (
            <div className="tools-field">
              <label>Parts</label>
              <div className="tools-multi-select">
                {[0, 1, 2, 3].map((idx) => (
                  <button
                    key={idx}
                    className={`tools-multi-btn ${sourcePartIndices.includes(idx) ? "selected" : ""}`}
                    onClick={() => toggleIndex(sourcePartIndices, idx, setSourcePartIndices)}
                  >
                    {idx + 1}
                  </button>
                ))}
                <button
                  className="tools-multi-btn tools-select-all"
                  onClick={() => selectAllIndices(4, setSourcePartIndices)}
                >
                  All
                </button>
              </div>
            </div>
          )}

          {/* Pattern selector for copy_patterns */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Patterns</label>
              <div className="tools-multi-select patterns">
                {Array.from({ length: 16 }, (_, idx) => (
                  <button
                    key={idx}
                    className={`tools-multi-btn ${sourcePatternIndices.includes(idx) ? "selected" : ""}`}
                    onClick={() => toggleIndex(sourcePatternIndices, idx, setSourcePatternIndices)}
                  >
                    {idx + 1}
                  </button>
                ))}
                <button
                  className="tools-multi-btn tools-select-all"
                  onClick={() => selectAllIndices(16, setSourcePatternIndices)}
                >
                  All
                </button>
              </div>
            </div>
          )}

          {/* Part and Track selector for copy_tracks */}
          {operation === "copy_tracks" && (
            <>
              <div className="tools-field">
                <label>Part</label>
                <select
                  value={sourcePartIndex}
                  onChange={(e) => setSourcePartIndex(Number(e.target.value))}
                >
                  {[0, 1, 2, 3].map((idx) => (
                    <option key={idx} value={idx}>Part {idx + 1}</option>
                  ))}
                </select>
              </div>
              <div className="tools-field">
                <label>Tracks</label>
                <div className="tools-multi-select tracks">
                  <div className="tools-track-group">
                    <span className="tools-track-label">Audio:</span>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                      >
                        T{idx + 1}
                      </button>
                    ))}
                  </div>
                  <div className="tools-track-group">
                    <span className="tools-track-label">MIDI:</span>
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                      >
                        M{idx - 7}
                      </button>
                    ))}
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
                  <div className="tools-slot-count">
                    <span className="tools-slot-count-number">{sourceSampleIndices.length}</span>
                    <span className="tools-slot-count-label">slot{sourceSampleIndices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="tools-slot-all-btn"
                    onClick={() => setSourceSampleIndices(Array.from({ length: 128 }, (_, i) => i))}
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
                <select
                  value={partAssignmentMode}
                  onChange={(e) => setPartAssignmentMode(e.target.value as PartAssignmentMode)}
                >
                  <option value="keep_original">Keep Original</option>
                  <option value="copy_source_part">Copy Source Part</option>
                  <option value="select_specific">Assign to Specific Part</option>
                </select>
              </div>
              {partAssignmentMode === "select_specific" && (
                <div className="tools-field">
                  <label>Destination Part</label>
                  <select value={destPart} onChange={(e) => setDestPart(Number(e.target.value))}>
                    {[0, 1, 2, 3].map((idx) => (
                      <option key={idx} value={idx}>Part {idx + 1}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="tools-field">
                <label>Track Scope</label>
                <select value={trackMode} onChange={(e) => setTrackMode(e.target.value as TrackMode)}>
                  <option value="all">All Tracks</option>
                  <option value="specific">Specific Tracks</option>
                </select>
              </div>
              {trackMode === "specific" && (
                <div className="tools-field">
                  <label>Tracks</label>
                  <div className="tools-multi-select tracks">
                    <div className="tools-track-group">
                      <span className="tools-track-label">Audio:</span>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
                          onClick={() => toggleIndex(sourceTrackIndices, idx, setSourceTrackIndices)}
                        >
                          T{idx + 1}
                        </button>
                      ))}
                    </div>
                    <div className="tools-track-group">
                      <span className="tools-track-label">MIDI:</span>
                      {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                        <button
                          key={idx}
                          className={`tools-multi-btn ${sourceTrackIndices.includes(idx) ? "selected" : ""}`}
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
              <select
                value={copyTrackMode}
                onChange={(e) => setCopyTrackMode(e.target.value as CopyTrackMode)}
              >
                <option value="both">Part Params + Pattern Triggers</option>
                <option value="part_params">Part Params Only</option>
                <option value="pattern_triggers">Pattern Triggers Only</option>
              </select>
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
                  {audioMode === "move_to_pool" && !audioPoolStatus?.exists && (
                    <span className="tools-hint-inline">Pool will be created</span>
                  )}
                </label>
                <div className="tools-toggle-group">
                  <button
                    type="button"
                    className={`tools-toggle-btn ${audioMode === "copy" ? "selected" : ""}`}
                    onClick={() => setAudioMode("copy")}
                    title="Copy audio files to the destination project's sample folder"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className={`tools-toggle-btn ${audioMode === "move_to_pool" ? "selected" : ""}`}
                    onClick={() => sameSetStatus && setAudioMode("move_to_pool")}
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
                    onClick={() => setAudioMode("none")}
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

          {/* Copy Bank - no extra options */}
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
            >
              <span className="tools-project-selector-name">
                {destProjectInfo.name}
                {destProjectInfo.isCurrentProject && <span className="tools-project-selector-current">(Current)</span>}
              </span>
              {destProjectInfo.setName && (
                <span className="tools-project-selector-set">{destProjectInfo.setName}</span>
              )}
              <i className="fas fa-folder-open"></i>
            </button>
          </div>

          {/* Bank selector */}
          {(operation === "copy_bank" || operation === "copy_parts" || operation === "copy_patterns" || operation === "copy_tracks") && (
            <div className="tools-field">
              <label>Bank</label>
              <select
                value={destBankIndex}
                onChange={(e) => setDestBankIndex(Number(e.target.value))}
              >
                {destBanks.length > 0 ? (
                  destBanks.map((idx) => (
                    <option key={idx} value={idx}>
                      Bank {String.fromCharCode(65 + idx)}
                    </option>
                  ))
                ) : (
                  // Show all banks if none loaded yet
                  Array.from({ length: 16 }, (_, idx) => (
                    <option key={idx} value={idx}>
                      Bank {String.fromCharCode(65 + idx)}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {/* Part selector for copy_parts */}
          {operation === "copy_parts" && (
            <div className="tools-field">
              <label>Parts</label>
              <div className="tools-multi-select">
                {[0, 1, 2, 3].map((idx) => (
                  <button
                    key={idx}
                    className={`tools-multi-btn ${destPartIndices.includes(idx) ? "selected" : ""}`}
                    onClick={() => toggleIndex(destPartIndices, idx, setDestPartIndices)}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
              {sourcePartIndices.length !== destPartIndices.length && (
                <span className="tools-warning">
                  Source and destination part count must match
                </span>
              )}
            </div>
          )}

          {/* Pattern start for copy_patterns */}
          {operation === "copy_patterns" && (
            <div className="tools-field">
              <label>Starting at Pattern</label>
              <select
                value={destPatternStart}
                onChange={(e) => setDestPatternStart(Number(e.target.value))}
              >
                {Array.from({ length: 16 }, (_, idx) => (
                  <option key={idx} value={idx}>
                    Pattern {idx + 1}
                  </option>
                ))}
              </select>
              {sourcePatternIndices.length + destPatternStart > 16 && (
                <span className="tools-warning">
                  Some patterns will overflow (max 16)
                </span>
              )}
            </div>
          )}

          {/* Part and Track selector for copy_tracks */}
          {operation === "copy_tracks" && (
            <>
              <div className="tools-field">
                <label>Part</label>
                <select
                  value={destPartIndex}
                  onChange={(e) => setDestPartIndex(Number(e.target.value))}
                >
                  {[0, 1, 2, 3].map((idx) => (
                    <option key={idx} value={idx}>Part {idx + 1}</option>
                  ))}
                </select>
              </div>
              <div className="tools-field">
                <label>Tracks</label>
                <div className="tools-multi-select tracks">
                  <div className="tools-track-group">
                    <span className="tools-track-label">Audio:</span>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn ${destTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(destTrackIndices, idx, setDestTrackIndices)}
                      >
                        T{idx + 1}
                      </button>
                    ))}
                  </div>
                  <div className="tools-track-group">
                    <span className="tools-track-label">MIDI:</span>
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((idx) => (
                      <button
                        key={idx}
                        className={`tools-multi-btn ${destTrackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => toggleIndex(destTrackIndices, idx, setDestTrackIndices)}
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
            </>
          )}

          {/* Sample slot destination for copy_sample_slots */}
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
                      defaultValue={destSampleIndices[0] + 1}
                      key={`dest-from-${destSampleIndices[0]}`}
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
                    <span className="tools-slot-value-display">{Math.min(128, destSampleIndices[0] + sourceSampleIndices.length)}</span>
                  </div>
                  <div className="tools-slot-count">
                    <span className="tools-slot-count-number">{sourceSampleIndices.length}</span>
                    <span className="tools-slot-count-label">slot{sourceSampleIndices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="tools-slot-all-btn"
                    onClick={() => {
                      const count = sourceSampleIndices.length;
                      setDestSampleIndices(Array.from({ length: count }, (_, i) => i));
                    }}
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
                {sourceSampleIndices.length + destSampleIndices[0] > 128 && (
                  <span className="tools-warning">
                    Some slots will overflow (max 128)
                  </span>
                )}
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
          disabled={isExecuting || (operation === "copy_parts" && sourcePartIndices.length !== destPartIndices.length) || (operation === "copy_tracks" && sourceTrackIndices.length !== destTrackIndices.length)}
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
              {/* Current Project */}
              <div className="project-selector-section">
                <h4>Current Project</h4>
                <div
                  className={`project-selector-item ${destProject === projectPath ? 'selected' : ''}`}
                  onClick={() => {
                    setDestProject(projectPath);
                    setShowProjectSelector(false);
                  }}
                >
                  <div className="project-selector-item-name">{projectName}</div>
                  <div className="project-selector-item-path">{projectPath}</div>
                </div>
              </div>

              {/* Projects from Locations/Sets */}
              {locations.map((location, locIdx) => (
                location.sets.some(set => set.projects.some(p => p.path !== projectPath && p.has_project_file)) && (
                  <div key={locIdx} className="project-selector-section">
                    <h4>{location.name}</h4>
                    {location.sets.map((set, setIdx) => {
                      const validProjects = set.projects.filter(p => p.path !== projectPath && p.has_project_file);
                      if (validProjects.length === 0) return null;
                      return (
                        <div key={setIdx} className="project-selector-set">
                          <div className="project-selector-set-header">
                            <span className="project-selector-set-name">{set.name}</span>
                            {set.has_audio_pool && <span className="project-selector-set-pool">Audio Pool</span>}
                          </div>
                          {validProjects.map((project, projIdx) => (
                            <div
                              key={projIdx}
                              className={`project-selector-item ${destProject === project.path ? 'selected' : ''}`}
                              onClick={() => {
                                setDestProject(project.path);
                                setShowProjectSelector(false);
                              }}
                            >
                              <div className="project-selector-item-name">{project.name}</div>
                              <div className="project-selector-item-path">{project.path}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )
              ))}

              {/* Standalone Projects */}
              {standaloneProjects.some(p => p.path !== projectPath && p.has_project_file) && (
                <div className="project-selector-section">
                  <h4>Individual Projects</h4>
                  {standaloneProjects
                    .filter(p => p.path !== projectPath && p.has_project_file)
                    .map((project, projIdx) => (
                      <div
                        key={projIdx}
                        className={`project-selector-item ${destProject === project.path ? 'selected' : ''}`}
                        onClick={() => {
                          setDestProject(project.path);
                          setShowProjectSelector(false);
                        }}
                      >
                        <div className="project-selector-item-name">{project.name}</div>
                        <div className="project-selector-item-path">{project.path}</div>
                      </div>
                    ))}
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
