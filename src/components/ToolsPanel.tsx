import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjects } from "../context/ProjectsContext";
import type { Bank } from "../context/ProjectsContext";
import { formatBankName } from "./BankSelector";
import "../App.css";

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
}

interface ProjectOption {
  name: string;
  path: string;
}

export function ToolsPanel({ projectPath, projectName, banks, loadedBankIndices }: ToolsPanelProps) {
  const { locations, standaloneProjects } = useProjects();

  // Operation selection
  const [operation, setOperation] = useState<OperationType>("copy_bank");

  // Source selection (current project only)
  const [sourceBankIndex, setSourceBankIndex] = useState<number>(0);
  const [sourcePartIndices, setSourcePartIndices] = useState<number[]>([0]);
  const [sourcePatternIndices, setSourcePatternIndices] = useState<number[]>([0]);
  const [sourceTrackIndices, setSourceTrackIndices] = useState<number[]>([0]);
  const [sourceSampleIndices, setSourceSampleIndices] = useState<number[]>([0]);

  // Destination selection
  const [destProject, setDestProject] = useState<string>(projectPath);
  const [destBankIndex, setDestBankIndex] = useState<number>(0);
  const [destPartIndices, setDestPartIndices] = useState<number[]>([0]);
  const [destPatternStart, setDestPatternStart] = useState<number>(0);
  const [destTrackIndices, setDestTrackIndices] = useState<number[]>([0]);
  const [destSampleIndices, setDestSampleIndices] = useState<number[]>([0]);

  // Operation-specific options
  // Copy Patterns options
  const [partAssignmentMode, setPartAssignmentMode] = useState<PartAssignmentMode>("keep_original");
  const [destPart, setDestPart] = useState<number>(0);
  const [trackMode, setTrackMode] = useState<TrackMode>("all");

  // Copy Tracks options
  const [copyTrackMode, setCopyTrackMode] = useState<CopyTrackMode>("both");
  const [sourcePartIndex, setSourcePartIndex] = useState<number>(0);
  const [destPartIndex, setDestPartIndex] = useState<number>(0);

  // Copy Sample Slots options
  const [slotType, setSlotType] = useState<SlotType>("both");
  const [audioMode, setAudioMode] = useState<AudioMode>("none");
  const [includeEditorSettings, setIncludeEditorSettings] = useState<boolean>(true);

  // Audio Pool status
  const [audioPoolStatus, setAudioPoolStatus] = useState<AudioPoolStatus | null>(null);
  const [sameSetStatus, setSameSetStatus] = useState<boolean>(false);

  // UI state
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusType, setStatusType] = useState<"success" | "error" | "info" | "">("");

  // Available destination banks for the destination project
  const [destBanks, setDestBanks] = useState<number[]>([]);

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

  // Execute operation
  async function executeOperation() {
    setIsExecuting(true);
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
          setStatusMessage(`Parts copied successfully`);
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
          setStatusMessage(`Patterns copied successfully`);
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
          setStatusMessage(`Tracks copied successfully`);
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
          setStatusMessage(`Sample slots copied successfully`);
          break;
      }
      setStatusType("success");
    } catch (err) {
      setStatusMessage(String(err));
      setStatusType("error");
    } finally {
      setIsExecuting(false);
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
      <div className="tools-header">
        <h2>Tools</h2>
        {statusMessage && (
          <span className={`tools-status ${statusType}`}>{statusMessage}</span>
        )}
      </div>

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
          <div className="tools-source-info">
            <span className="tools-project-name">{projectName}</span>
          </div>

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
              <label>Slots (1-128)</label>
              <div className="tools-slot-range">
                <input
                  type="number"
                  min="1"
                  max="128"
                  value={sourceSampleIndices[0] + 1}
                  onChange={(e) => {
                    const start = Math.max(0, Math.min(127, Number(e.target.value) - 1));
                    const count = sourceSampleIndices.length;
                    setSourceSampleIndices(Array.from({ length: count }, (_, i) => Math.min(127, start + i)));
                  }}
                />
                <span>to</span>
                <input
                  type="number"
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
                <select value={slotType} onChange={(e) => setSlotType(e.target.value as SlotType)}>
                  <option value="both">Static + Flex</option>
                  <option value="static">Static Only</option>
                  <option value="flex">Flex Only</option>
                </select>
              </div>
              <div className="tools-field">
                <label>Audio Files</label>
                <select
                  value={audioMode}
                  onChange={(e) => setAudioMode(e.target.value as AudioMode)}
                >
                  <option value="none">Don't Copy Audio</option>
                  <option value="copy">Copy to Destination</option>
                  {sameSetStatus && audioPoolStatus && (
                    <option value="move_to_pool">Move to Audio Pool</option>
                  )}
                </select>
                {audioMode === "move_to_pool" && !audioPoolStatus?.exists && (
                  <span className="tools-hint">Audio Pool will be created</span>
                )}
              </div>
              <div className="tools-field tools-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={includeEditorSettings}
                    onChange={(e) => setIncludeEditorSettings(e.target.checked)}
                  />
                  Include Editor Settings
                </label>
                <span className="tools-hint">Gain, loop mode, timestretch</span>
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
            <select value={destProject} onChange={(e) => setDestProject(e.target.value)}>
              {availableProjects.map((proj) => (
                <option key={proj.path} value={proj.path}>
                  {proj.name}
                </option>
              ))}
            </select>
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
              <label>Starting at Slot</label>
              <input
                type="number"
                min="1"
                max="128"
                value={destSampleIndices[0] + 1}
                onChange={(e) => {
                  const start = Math.max(0, Math.min(127, Number(e.target.value) - 1));
                  const count = sourceSampleIndices.length;
                  setDestSampleIndices(Array.from({ length: count }, (_, i) => Math.min(127, start + i)));
                }}
              />
              {sourceSampleIndices.length + destSampleIndices[0] > 128 && (
                <span className="tools-warning">
                  Some slots will overflow (max 128)
                </span>
              )}
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
              Executing...
            </>
          ) : (
            <>
              <i className="fas fa-copy"></i>
              Execute
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ToolsPanel;
