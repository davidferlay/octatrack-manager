import { useState, useEffect, useTransition, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectMetadata, Bank } from "../context/ProjectsContext";
import { BankSelector, ALL_BANKS, formatBankName } from "../components/BankSelector";
import { TrackSelector, ALL_AUDIO_TRACKS, ALL_MIDI_TRACKS } from "../components/TrackSelector";
import { PatternSelector, ALL_PATTERNS } from "../components/PatternSelector";
import { SampleSlotsTable } from "../components/SampleSlotsTable";
import PartsPanel from "../components/PartsPanel";
import ToolsPanel from "../components/ToolsPanel";
import { WriteStatus, IDLE_STATUS } from "../types/writeStatus";
import { TrackBadge } from "../components/TrackBadge";
import { ScrollToTop } from "../components/ScrollToTop";
import { Version } from "../components/Version";
import "../App.css";

// Most type definitions are now imported from ProjectsContext via Bank and ProjectMetadata types

interface MachineParams {
  param1: number | null;
  param2: number | null;
  param3: number | null;
  param4: number | null;
  param5: number | null;
  param6: number | null;
}

interface LfoParams {
  spd1: number | null;
  spd2: number | null;
  spd3: number | null;
  dep1: number | null;
  dep2: number | null;
  dep3: number | null;
}

interface AmpParams {
  atk: number | null;
  hold: number | null;
  rel: number | null;
  vol: number | null;
  bal: number | null;
  f: number | null;
}

interface AudioParameterLocks {
  machine: MachineParams;
  lfo: LfoParams;
  amp: AmpParams;
  static_slot_id: number | null;
  flex_slot_id: number | null;
}

interface MidiParams {
  note: number | null;
  vel: number | null;
  len: number | null;
  not2: number | null;
  not3: number | null;
  not4: number | null;
}

interface MidiParameterLocks {
  midi: MidiParams;
  lfo: LfoParams;
}

interface TrigStep {
  step: number;              // Step number (0-63)
  trigger: boolean;          // Has trigger trig
  trigless: boolean;         // Has trigless trig
  plock: boolean;            // Has parameter lock
  oneshot: boolean;          // Has oneshot trig (audio only)
  swing: boolean;            // Has swing trig
  slide: boolean;            // Has slide trig (audio only)
  recorder: boolean;         // Has recorder trig (audio only)
  trig_condition: string | null; // Trig condition (Fill, NotFill, Pre, percentages, etc.)
  trig_repeats: number;      // Number of trig repeats (0-7)
  micro_timing: string | null;  // Micro-timing offset (e.g., "+1/32", "-1/64")
  notes: number[];           // MIDI note values (up to 4 notes for chords) for MIDI tracks
  velocity: number | null;   // Velocity/level value (0-127)
  plock_count: number;       // Number of parameter locks on this step
  sample_slot: number | null; // Sample slot ID if locked (audio tracks)
  audio_plocks: AudioParameterLocks | null; // Audio parameter locks (audio tracks only)
  midi_plocks: MidiParameterLocks | null;   // MIDI parameter locks (MIDI tracks only)
}

// TrackInfo, Pattern, Part, and Bank interfaces are imported from ProjectsContext via Bank type

type TabType = "overview" | "parts" | "patterns" | "tracks" | "static-slots" | "flex-slots" | "tools";

// Helper function to calculate the display denominator for length fraction
function getLengthDenominator(length: number): number {
  if (length <= 16) return 16;
  if (length <= 32) return 32;
  if (length <= 48) return 48;
  return 64;
}

export function ProjectDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = searchParams.get("path");
  const projectName = searchParams.get("name");

  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedBankIndices, setLoadedBankIndices] = useState<Set<number>>(new Set());
  const [failedBankIndices, setFailedBankIndices] = useState<Map<number, string>>(new Map()); // bank index -> error message
  const [allBanksLoaded, setAllBanksLoaded] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [selectedBankIndex, setSelectedBankIndex] = useState<number>(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0); // Default to track 0, will be set to active track
  const [selectedPatternIndex, setSelectedPatternIndex] = useState<number>(0); // Default to pattern 0, will be set to active pattern
  const [selectedStepNumber, setSelectedStepNumber] = useState<number | null>(null); // Selected step number (synchronized across all patterns)
  const [sharedPartsPageIndex, setSharedPartsPageIndex] = useState<number>(0); // Shared page index for Parts panels when "All banks" is selected
  const [sharedPartsLfoTab, setSharedPartsLfoTab] = useState<'LFO1' | 'LFO2' | 'LFO3' | 'DESIGN'>('LFO1'); // Shared LFO tab for Parts panels when "All banks" is selected

  // Pattern display settings
  const [hideEmptyPatterns, setHideEmptyPatterns] = useState<boolean>(false); // Hide patterns with no trigs
  const [hideEmptyPatternsVisual, setHideEmptyPatternsVisual] = useState<boolean>(false); // Immediate visual state for toggle
  const [isPending, startTransition] = useTransition(); // For smooth UI updates
  const [isSpinning, setIsSpinning] = useState<boolean>(false); // For refresh button animation
  const [partsWriteStatus, setPartsWriteStatus] = useState<WriteStatus>(IDLE_STATUS); // Parts write status
  const [lastStatusMessage, setLastStatusMessage] = useState<string>(''); // Keep last message for fade-out
  const [isEditMode, setIsEditMode] = useState<boolean>(false); // Global edit mode toggle
  const [showBankWarning, setShowBankWarning] = useState<boolean>(false); // Show failed banks warning
  const [showBankWarningModal, setShowBankWarningModal] = useState<boolean>(false); // Show modal with details

  // Wrapper to capture last message before going idle (for fade-out effect)
  const handleWriteStatusChange = useCallback((status: WriteStatus) => {
    if (status.state !== 'idle' && status.message) {
      setLastStatusMessage(status.message);
    } else if (status.state !== 'idle') {
      // Set default messages
      if (status.state === 'writing') setLastStatusMessage('Saving...');
      else if (status.state === 'success') setLastStatusMessage('Saved');
      else if (status.state === 'error') setLastStatusMessage('Error');
    }
    setPartsWriteStatus(status);
  }, []);

  // Reload a specific bank (used after copy operations in Tools panel)
  const reloadBank = useCallback(async (bankIndex: number) => {
    if (!projectPath) return;
    try {
      const bank = await invoke<Bank | null>("load_single_bank", {
        path: projectPath,
        bankIndex
      });
      if (bank) {
        setBanks(prev => {
          const newBanks = [...prev];
          newBanks[bankIndex] = bank;
          return newBanks;
        });
      }
    } catch (err) {
      console.error(`Failed to reload bank ${bankIndex}:`, err);
    }
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;

    loadProjectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Show bank warning when failed banks are detected, auto-hide after 90 seconds
  useEffect(() => {
    if (failedBankIndices.size > 0) {
      setShowBankWarning(true);
      const timer = setTimeout(() => setShowBankWarning(false), 90000);
      return () => clearTimeout(timer);
    }
  }, [failedBankIndices.size]);

  // Hide bank warning when save status indicator appears
  useEffect(() => {
    if (partsWriteStatus.state !== 'idle') {
      setShowBankWarning(false);
    }
  }, [partsWriteStatus.state]);

  async function loadProjectData() {
    setIsLoading(true);
    setLoadedBankIndices(new Set());
    setFailedBankIndices(new Map());
    setAllBanksLoaded(false);
    setError(null);
    try {
      // Step 1: Load metadata first (fast) - this enables Overview tab immediately
      setLoadingStatus("Reading project metadata...");
      const projectMetadata = await invoke<ProjectMetadata>("load_project_metadata", { path: projectPath });

      setMetadata(projectMetadata);
      const activeBankIndex = projectMetadata.current_state.bank;
      // Set the selected bank to the currently active bank
      setSelectedBankIndex(activeBankIndex);
      // Set the selected track to the currently active track
      setSelectedTrackIndex(projectMetadata.current_state.track);
      // Set the selected pattern to the currently active pattern
      setSelectedPatternIndex(projectMetadata.current_state.pattern);

      // Step 2: Show UI immediately with metadata loaded
      setIsLoading(false);

      // Step 3: Get list of existing bank files (skip non-existent banks early)
      const existingBankIndices = await invoke<number[]>("get_existing_banks", { path: projectPath });
      const existingBanksSet = new Set(existingBankIndices);

      // Mark non-existent banks as "loaded" immediately (nothing to load)
      const nonExistentIndices = Array.from({ length: 16 }, (_, i) => i).filter(i => !existingBanksSet.has(i));
      if (nonExistentIndices.length > 0) {
        setLoadedBankIndices(new Set(nonExistentIndices));
      }

      // Step 4: Load only the active bank first (fast) - enables Parts/Patterns/Tracks for active bank
      setLoadingStatus("Loading active bank...");
      const activeBank = await invoke<Bank | null>("load_single_bank", {
        path: projectPath,
        bankIndex: activeBankIndex
      });

      if (activeBank) {
        // Initialize banks array with just the active bank
        const initialBanks: Bank[] = [];
        initialBanks[activeBankIndex] = activeBank;
        setBanks(initialBanks);
        setLoadedBankIndices(prev => new Set([...prev, activeBankIndex]));
      }

      // Step 5: Load remaining existing banks in parallel with dynamic concurrency
      setLoadingStatus("Loading remaining banks...");
      const remainingIndices = existingBankIndices.filter(i => i !== activeBankIndex);

      // Get system resources to determine optimal concurrency
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      const concurrency = Math.max(2, Math.min(resources.recommended_concurrency, 4)); // Between 2 and 4 (conservative for UI)

      // Helper to load a single bank
      const loadBank = async (bankIndex: number): Promise<{ bankIndex: number; bank: Bank | null; error?: string }> => {
        try {
          const bank = await invoke<Bank | null>("load_single_bank", {
            path: projectPath,
            bankIndex
          });
          return { bankIndex, bank };
        } catch (err) {
          console.error(`Failed to load bank ${bankIndex}:`, err);
          return { bankIndex, bank: null, error: String(err) };
        }
      };

      // Helper to yield to the main thread for UI responsiveness
      const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

      // Process banks with controlled concurrency
      for (let i = 0; i < remainingIndices.length; i += concurrency) {
        const batch = remainingIndices.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(loadBank));

        // Update state progressively after each batch using startTransition for smooth UI
        const batchLoaded = batchResults.filter((r): r is { bankIndex: number; bank: Bank } => r.bank !== null);
        const batchFailed = batchResults.filter(r => r.bank === null && r.error);

        // Always mark all attempted banks as loaded (even if they failed/returned null)
        // This prevents "(loading...)" state from persisting forever for failed banks
        startTransition(() => {
          if (batchLoaded.length > 0) {
            setBanks(prev => {
              const newBanks = [...prev];
              for (const { bankIndex, bank } of batchLoaded) {
                newBanks[bankIndex] = bank;
              }
              return newBanks;
            });
          }
          setLoadedBankIndices(prev => {
            const newSet = new Set(prev);
            for (const { bankIndex } of batchResults) {
              newSet.add(bankIndex);
            }
            return newSet;
          });
          // Track failed banks for user-friendly error display
          if (batchFailed.length > 0) {
            setFailedBankIndices(prev => {
              const newMap = new Map(prev);
              for (const { bankIndex, error } of batchFailed) {
                newMap.set(bankIndex, error || 'Unknown error');
              }
              return newMap;
            });
          }
        });

        // Yield to main thread between batches to keep UI responsive
        await yieldToMain();
      }

      setAllBanksLoaded(true);
      setLoadingStatus("");
    } catch (err) {
      console.error("Error loading project data:", err);
      setError(String(err));
      setIsLoading(false);
    }
  }

  if (!projectPath || !projectName) {
    return (
      <main className="container">
        <div className="no-devices">
          <p>No project selected</p>
          <button onClick={() => navigate("/")} className="scan-button">
            Return to Home
          </button>
        </div>
      </main>
    );
  }

  const handleRefresh = () => {
    // Trigger spin animation
    setIsSpinning(true);
    setTimeout(() => setIsSpinning(false), 600);
    loadProjectData();
  };

  return (
    <main className="container">
      <div className="project-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1' }}>
          <button onClick={() => navigate("/")} className="back-button">
            ← Back
          </button>
          <h1 title={projectPath || ''}>{projectName}</h1>
          {/* View/Edit mode toggle - hidden during loading */}
          {!isLoading && (
            <div className="mode-toggle" onClick={() => setIsEditMode(!isEditMode)}>
              <span className={`mode-toggle-btn ${!isEditMode ? 'active' : ''}`}>
                View
              </span>
              <span className={`mode-toggle-btn ${isEditMode ? 'active' : ''}`}>
                Edit
              </span>
            </div>
          )}
          {/* Status indicator area - shows either save status or bank warning */}
          <div className="status-indicator-area">
            <span className={`save-status-indicator ${partsWriteStatus.state}`}>
              {partsWriteStatus.state === 'writing' && (partsWriteStatus.message || 'Saving...')}
              {partsWriteStatus.state === 'success' && (partsWriteStatus.message || 'Saved')}
              {partsWriteStatus.state === 'error' && (partsWriteStatus.message || 'Error')}
              {partsWriteStatus.state === 'idle' && lastStatusMessage}
            </span>
            {/* Failed banks warning indicator - only shown when save status is idle */}
            {showBankWarning && failedBankIndices.size > 0 && partsWriteStatus.state === 'idle' && (
              <span
                className="bank-warning-indicator"
                onClick={() => setShowBankWarningModal(true)}
                title="Click for details"
              >
                <i className="fas fa-exclamation-triangle"></i> Unsupported banks
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!isLoading && !error && metadata && (
            <div className="header-tabs">
              <button
                className={`header-tab ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button
                className={`header-tab ${activeTab === "parts" ? "active" : ""}`}
                onClick={() => setActiveTab("parts")}
              >
                Parts
              </button>
              <button
                className={`header-tab ${activeTab === "patterns" ? "active" : ""}`}
                onClick={() => setActiveTab("patterns")}
              >
                Patterns
              </button>
              <button
                className={`header-tab ${activeTab === "tracks" ? "active" : ""}`}
                onClick={() => setActiveTab("tracks")}
              >
                Tracks
              </button>
              <button
                className={`header-tab ${activeTab === "flex-slots" ? "active" : ""}`}
                onClick={() => setActiveTab("flex-slots")}
              >
                Flex ({metadata.sample_slots.flex_slots.filter(slot => slot.path).length})
              </button>
              <button
                className={`header-tab ${activeTab === "static-slots" ? "active" : ""}`}
                onClick={() => setActiveTab("static-slots")}
              >
                Static ({metadata.sample_slots.static_slots.filter(slot => slot.path).length})
              </button>
              <button
                className={`header-tab ${activeTab === "tools" ? "active" : ""}`}
                onClick={() => setActiveTab("tools")}
              >
                Tools
              </button>
            </div>
          )}
          <button
            onClick={handleRefresh}
            className={`toolbar-button ${isSpinning ? 'refreshing' : ''}`}
            disabled={isLoading}
            title="Refresh project"
          >
            <i className="fas fa-sync-alt"></i>
          </button>
          <Version />
        </div>
      </div>

      {isLoading && (
        <div className="loading-section">
          <div className="loading-spinner"></div>
          <p>Loading project data...</p>
          <p className="loading-status">{loadingStatus}</p>
        </div>
      )}

      {error && (
        <div className="error-section">
          <p>Error loading project: {error}</p>
        </div>
      )}

      {/* Modal for failed banks details */}
      {showBankWarningModal && (
        <div className="modal-overlay" onClick={() => setShowBankWarningModal(false)}>
          <div className="modal-content warning-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-exclamation-triangle"></i> Some banks could not be loaded</h3>
              <button className="modal-close" onClick={() => setShowBankWarningModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>
                <strong>Failed banks: </strong>
                {Array.from(failedBankIndices.entries()).map(([idx]) =>
                  String.fromCharCode(65 + idx)
                ).join(', ')}
              </p>
              <p>
                These banks may be from an older Octatrack OS version with an incompatible file format.
              </p>
              <p>
                <strong>To fix:</strong> Open the project on your Octatrack and re-save the affected banks.
                This will update them to the current file format.
              </p>
            </div>
          </div>
        </div>
      )}

      {!isLoading && !error && metadata && (
        <div className="project-content">
          <div className="tab-content">
            {activeTab === "overview" && (
              <div className="overview-tab">
                <div className="overview-grid">
                  {/* Project Info */}
                  <section className="overview-section">
                    <h2>Project Info</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Tempo</span>
                        <span className="compact-value">{metadata.tempo} BPM</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Time Sig</span>
                        <span className="compact-value">{metadata.time_signature}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">OS</span>
                        <span className="compact-value">{metadata.os_version}</span>
                      </div>
                    </div>
                  </section>

                  {/* Current State */}
                  <section className="overview-section">
                    <h2>Current State</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Bank</span>
                        <span className="compact-value">{metadata.current_state.bank_name}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Pattern</span>
                        <span className="compact-value">{metadata.current_state.pattern + 1}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Part</span>
                        <span className="compact-value">{metadata.current_state.part + 1}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Mode</span>
                        <span className="compact-value">{metadata.current_state.midi_mode === 0 ? "Audio" : "MIDI"}</span>
                      </div>
                    </div>
                  </section>

                  {/* Memory Settings */}
                  <section className="overview-section">
                    <h2>Memory</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">24-bit Flex</span>
                        <span className="compact-value">{metadata.memory_settings.load_24bit_flex ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Dyn Rec</span>
                        <span className="compact-value">{metadata.memory_settings.dynamic_recorders ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">24-bit Rec</span>
                        <span className="compact-value">{metadata.memory_settings.record_24bit ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Res Rec #</span>
                        <span className="compact-value">{metadata.memory_settings.reserved_recorder_count}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Rec Len</span>
                        <span className="compact-value">{metadata.memory_settings.reserved_recorder_length}</span>
                      </div>
                    </div>
                  </section>

                  {/* Audio Mode State */}
                  <section className="overview-section">
                    <h2>Audio Mode</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Track</span>
                        <span className="compact-value">
                          <TrackBadge trackId={metadata.current_state.midi_mode === 0 ? metadata.current_state.track : metadata.current_state.track_othermode} />
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Muted</span>
                        <span className="compact-value">
                          {metadata.current_state.audio_muted_tracks.length > 0
                            ? metadata.current_state.audio_muted_tracks.map((t: number, idx: number) => (
                                <TrackBadge key={`audio-muted-${idx}`} trackId={t} />
                              ))
                            : "—"}
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Cued</span>
                        <span className="compact-value">
                          {metadata.current_state.audio_cued_tracks.length > 0
                            ? metadata.current_state.audio_cued_tracks.map((t: number, idx: number) => (
                                <TrackBadge key={`audio-cued-${idx}`} trackId={t} />
                              ))
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* MIDI Mode State */}
                  <section className="overview-section">
                    <h2>MIDI Mode</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Track</span>
                        <span className="compact-value">
                          <TrackBadge trackId={(metadata.current_state.midi_mode === 1 ? metadata.current_state.track : metadata.current_state.track_othermode) + 8} />
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Muted</span>
                        <span className="compact-value">
                          {metadata.current_state.midi_muted_tracks.length > 0
                            ? metadata.current_state.midi_muted_tracks.map((t: number, idx: number) => (
                                <TrackBadge key={`midi-muted-${idx}`} trackId={t + 8} />
                              ))
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* MIDI Sync */}
                  {metadata.midi_settings && (
                  <section className="overview-section">
                    <h2>MIDI Sync</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Clock TX</span>
                        <span className="compact-value">{metadata.midi_settings.clock_send ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Clock RX</span>
                        <span className="compact-value">{metadata.midi_settings.clock_receive ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Trans TX</span>
                        <span className="compact-value">{metadata.midi_settings.transport_send ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Trans RX</span>
                        <span className="compact-value">{metadata.midi_settings.transport_receive ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">PC TX</span>
                        <span className="compact-value">
                          {metadata.midi_settings.prog_change_send
                            ? (metadata.midi_settings.prog_change_send_channel === -1 ? 'Auto' : `Ch ${metadata.midi_settings.prog_change_send_channel}`)
                            : "Off"}
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">PC RX</span>
                        <span className="compact-value">
                          {metadata.midi_settings.prog_change_receive
                            ? (metadata.midi_settings.prog_change_receive_channel === -1 ? 'Auto' : `Ch ${metadata.midi_settings.prog_change_receive_channel}`)
                            : "Off"}
                        </span>
                      </div>
                    </div>
                  </section>
                  )}

                  {/* MIDI Channels */}
                  {metadata.midi_settings && (
                  <section className="overview-section">
                    <h2>MIDI Channels</h2>
                    <div className="compact-grid">
                      {metadata.midi_settings.trig_channels.map((ch, idx) => (
                        <div key={idx} className="compact-item">
                          <span className="compact-label">T{idx + 1}</span>
                          <span className="compact-value">{ch === -1 ? 'Off' : ch}</span>
                        </div>
                      ))}
                      <div className="compact-item">
                        <span className="compact-label">Auto</span>
                        <span className="compact-value">{metadata.midi_settings.auto_channel === -1 ? 'Off' : metadata.midi_settings.auto_channel}</span>
                      </div>
                    </div>
                  </section>
                  )}

                  {/* Mixer Settings */}
                  <section className="overview-section">
                    <h2>Mixer</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Gain AB</span>
                        <span className="compact-value">{metadata.mixer_settings.gain_ab}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Gain CD</span>
                        <span className="compact-value">{metadata.mixer_settings.gain_cd}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Dir AB</span>
                        <span className="compact-value">{metadata.mixer_settings.dir_ab}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Dir CD</span>
                        <span className="compact-value">{metadata.mixer_settings.dir_cd}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Phones</span>
                        <span className="compact-value">{metadata.mixer_settings.phones_mix}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Main</span>
                        <span className="compact-value">{metadata.mixer_settings.main_level}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Cue</span>
                        <span className="compact-value">{metadata.mixer_settings.cue_level}</span>
                      </div>
                    </div>
                  </section>

                  {/* Metronome Settings */}
                  {metadata.metronome_settings && (
                  <section className="overview-section">
                    <h2>Metronome</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Enabled</span>
                        <span className="compact-value">{metadata.metronome_settings.enabled ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Main Vol</span>
                        <span className="compact-value">{metadata.metronome_settings.main_volume}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Cue Vol</span>
                        <span className="compact-value">{metadata.metronome_settings.cue_volume}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Pitch</span>
                        <span className="compact-value">{metadata.metronome_settings.pitch}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Tonal</span>
                        <span className="compact-value">{metadata.metronome_settings.tonal ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Preroll</span>
                        <span className="compact-value">{metadata.metronome_settings.preroll}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Time Sig</span>
                        <span className="compact-value">{metadata.metronome_settings.time_signature_numerator}/{metadata.metronome_settings.time_signature_denominator}</span>
                      </div>
                    </div>
                  </section>
                  )}
                </div>
              </div>
            )}

            {activeTab === "parts" && (
              <div className="banks-tab">
                <div className="bank-selector-section">
                  <BankSelector
                    id="parts-bank-select"
                    banks={banks}
                    value={selectedBankIndex}
                    onChange={setSelectedBankIndex}
                    currentBank={metadata?.current_state.bank}
                    loadedBankIndices={loadedBankIndices}
                    failedBankIndices={failedBankIndices}
                    allBanksLoaded={allBanksLoaded}
                  />

                  <TrackSelector
                    id="parts-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                  />
                </div>

                {loadedBankIndices.size === 0 ? (
                  <div className="loading-section">
                    <div className="loading-spinner"></div>
                    <p>Loading banks...</p>
                  </div>
                ) : (
                <div className="bank-cards">
                  {(() => {
                    // Determine which banks to display (only show loaded banks)
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? Array.from(loadedBankIndices).sort((a, b) => a - b)
                      : loadedBankIndices.has(selectedBankIndex) ? [selectedBankIndex] : [];

                    return banksToDisplay.map((bankIndex) => {
                      const bank = banks[bankIndex];
                      if (!bank) return null;

                      // Determine selected track for PartsPanel
                      let trackForParts: number | undefined;
                      if (selectedTrackIndex === ALL_AUDIO_TRACKS) {
                        trackForParts = ALL_AUDIO_TRACKS; // Show all audio tracks
                      } else if (selectedTrackIndex === ALL_MIDI_TRACKS) {
                        trackForParts = ALL_MIDI_TRACKS; // Show all MIDI tracks
                      } else if (selectedTrackIndex >= 0 && selectedTrackIndex < 8) {
                        trackForParts = selectedTrackIndex; // Show specific audio track
                      } else if (selectedTrackIndex >= 8 && selectedTrackIndex < 16) {
                        trackForParts = selectedTrackIndex; // Show specific MIDI track
                      } else {
                        trackForParts = undefined; // Default to all audio tracks
                      }

                      // Get part names from bank
                      const partNames = bank.parts.map(part => part.name);

                      // Pass initial active part only for the current bank from project state
                      const initialPart = bankIndex === metadata?.current_state.bank ? metadata?.current_state.part : undefined;

                      return (
                        <PartsPanel
                          key={`bank-parts-${bankIndex}`}
                          projectPath={projectPath || ''}
                          bankId={bank.id}
                          bankName={formatBankName(bank.name, bankIndex)}
                          partNames={partNames}
                          selectedTrack={trackForParts}
                          initialActivePart={initialPart}
                          isEditMode={isEditMode}
                          sharedPageIndex={selectedBankIndex === ALL_BANKS ? sharedPartsPageIndex : undefined}
                          onSharedPageChange={selectedBankIndex === ALL_BANKS ? setSharedPartsPageIndex : undefined}
                          sharedLfoTab={selectedBankIndex === ALL_BANKS ? sharedPartsLfoTab : undefined}
                          onSharedLfoTabChange={selectedBankIndex === ALL_BANKS ? setSharedPartsLfoTab : undefined}
                          onWriteStatusChange={handleWriteStatusChange}
                        />
                      );
                    });
                  })()}
                </div>
                )}
              </div>
            )}

            {activeTab === "patterns" && (
              <div className="banks-tab">
                <div className="bank-selector-section">
                  <BankSelector
                    id="patterns-bank-select"
                    banks={banks}
                    value={selectedBankIndex}
                    onChange={setSelectedBankIndex}
                    currentBank={metadata?.current_state.bank}
                    loadedBankIndices={loadedBankIndices}
                    failedBankIndices={failedBankIndices}
                    allBanksLoaded={allBanksLoaded}
                  />

                  <label className={`toggle-switch ${isPending ? 'pending' : ''}`}>
                    <span className="toggle-label">Hide empty</span>
                    <div className="toggle-slider-container">
                      <input
                        type="checkbox"
                        checked={hideEmptyPatternsVisual}
                        onChange={(e) => {
                          const newValue = e.target.checked;
                          // Update visual state immediately for smooth toggle animation
                          setHideEmptyPatternsVisual(newValue);
                          // Update actual filter state in a transition for smooth UI
                          startTransition(() => {
                            setHideEmptyPatterns(newValue);
                          });
                        }}
                      />
                      <span className="toggle-slider"></span>
                    </div>
                  </label>

                  <TrackSelector
                    id="patterns-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                  />
                </div>

                {loadedBankIndices.size === 0 ? (
                  <div className="loading-section">
                    <div className="loading-spinner"></div>
                    <p>Loading banks...</p>
                  </div>
                ) : (
                <div className="bank-cards">
                  {(() => {
                    // Determine which banks to display (only show loaded banks)
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? Array.from(loadedBankIndices).sort((a, b) => a - b)
                      : loadedBankIndices.has(selectedBankIndex) ? [selectedBankIndex] : [];

                    return banksToDisplay.map((bankIndex) => {
                      const bank = banks[bankIndex];
                      if (!bank) return null;

                      return (
                        <div key={`bank-patterns-${bankIndex}`} className="bank-card">
                          <div className="bank-card-header">
                            <h3>{formatBankName(bank.name, bankIndex)} - Pattern Details</h3>
                            <PatternSelector
                              id={`pattern-select-${bankIndex}`}
                              value={selectedPatternIndex}
                              onChange={setSelectedPatternIndex}
                              currentPattern={metadata?.current_state.pattern}
                            />
                          </div>
                          <div className="patterns-list">
                            {(() => {
                              // Determine which patterns to display
                              const patternsToDisplay = selectedPatternIndex === ALL_PATTERNS
                                ? [...Array(16)].map((_, i) => i)
                                : [selectedPatternIndex];

                              return patternsToDisplay.map((patternIndex) => {
                                // Get the pattern
                                const pattern = bank.parts[0]?.patterns[patternIndex];
                                if (!pattern) return null;

                          // Determine which tracks to display
                          let tracksToDisplay: number[];
                          if (selectedTrackIndex === ALL_AUDIO_TRACKS) {
                            tracksToDisplay = [0, 1, 2, 3, 4, 5, 6, 7];
                          } else if (selectedTrackIndex === ALL_MIDI_TRACKS) {
                            tracksToDisplay = [8, 9, 10, 11, 12, 13, 14, 15];
                          } else {
                            tracksToDisplay = [selectedTrackIndex];
                          }

                                // Render pattern card for each track
                                return tracksToDisplay.map((trackIndex) => {
                                  const trackData = pattern.tracks[trackIndex];

                                  // Check if pattern/track has any trigs
                                  const hasAnyTrigs = trackData.steps.slice(0, pattern.length).some(
                                    (step: TrigStep) => step.trigger || step.trigless
                                  );

                                  // Skip empty patterns if hideEmptyPatterns is enabled
                                  if (hideEmptyPatterns && !hasAnyTrigs) {
                                    return null;
                                  }

                                  return (
                                <div key={`pattern-${patternIndex}-track-${trackIndex}`} className="pattern-card">
                            <div className="pattern-header">
                              <span className="pattern-name">{pattern.name}</span>
                              <span className="pattern-part">→ Part {pattern.part_assignment + 1}</span>
                              <TrackBadge trackId={trackData.track_id} />
                              {pattern.tempo_info && <span className="pattern-tempo-indicator">{pattern.tempo_info}</span>}
                              <span className="pattern-tempo-indicator">Scale Mode: {pattern.scale_mode === "Normal" ? "Pattern" : pattern.scale_mode}</span>
                              <span className="pattern-tempo-indicator">Chain after: {pattern.chain_mode}</span>
                              {pattern.scale_mode === "Per Track" ? (
                                <>
                                  <span className="pattern-tempo-indicator">
                                    Length: {trackData.per_track_len !== null
                                      ? `${trackData.per_track_len}/${getLengthDenominator(trackData.per_track_len)}`
                                      : `${pattern.length}/${getLengthDenominator(pattern.length)}`}
                                  </span>
                                  <span className="pattern-tempo-indicator">
                                    Speed: {trackData.per_track_scale || pattern.master_scale}
                                  </span>
                                  {pattern.per_track_settings && (
                                    <>
                                      <span
                                        className="pattern-tempo-indicator"
                                        style={{
                                          color: '#999999',
                                          backgroundColor: 'rgba(153, 153, 153, 0.15)',
                                          borderColor: 'rgba(153, 153, 153, 0.4)'
                                        }}
                                      >
                                        Master Len: {pattern.per_track_settings.master_len}
                                      </span>
                                      <span
                                        className="pattern-tempo-indicator"
                                        style={{
                                          color: '#999999',
                                          backgroundColor: 'rgba(153, 153, 153, 0.15)',
                                          borderColor: 'rgba(153, 153, 153, 0.4)'
                                        }}
                                      >
                                        Master Speed: {pattern.per_track_settings.master_scale}
                                      </span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="pattern-tempo-indicator">Length: {pattern.length}/{getLengthDenominator(pattern.length)}</span>
                                  <span className="pattern-tempo-indicator">Speed: {pattern.master_scale}</span>
                                </>
                              )}
                            </div>
                            {/* Pattern Grid Visualization */}
                            <div className="pattern-grid-section">
                              <div className="pattern-grid-container">
                                {(() => {
                                  // Helper to convert MIDI note to name
                                  const noteName = (note: number) => {
                                    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                                    const octave = Math.floor(note / 12) - 1;
                                    return names[note % 12] + octave;
                                  };

                                  // Helper to detect chord type
                                  const detectChord = (notes: number[]) => {
                                    if (notes.length < 2) return null;

                                      // Sort notes and get intervals from root
                                      const sortedNotes = [...notes].sort((a, b) => a - b);
                                      const intervals = sortedNotes.slice(1).map(n => n - sortedNotes[0]);

                                      // Common chord patterns (intervals in semitones from root)
                                      const chordPatterns: { [key: string]: number[][] } = {
                                        'maj': [[4, 7], [4, 7, 11], [4, 7, 12]],           // Major, maj7, maj octave
                                        'min': [[3, 7], [3, 7, 10], [3, 7, 12]],           // Minor, min7, min octave
                                        'dim': [[3, 6], [3, 6, 9]],                         // Diminished, dim7
                                        'aug': [[4, 8]],                                     // Augmented
                                        'sus2': [[2, 7]],                                    // Suspended 2
                                        'sus4': [[5, 7]],                                    // Suspended 4
                                        '7': [[4, 7, 10]],                                   // Dominant 7
                                        'maj7': [[4, 7, 11]],                                // Major 7
                                        'min7': [[3, 7, 10]],                                // Minor 7
                                        '5': [[7], [7, 12]],                                 // Power chord
                                      };

                                      // Check each pattern
                                      for (const [chordName, patterns] of Object.entries(chordPatterns)) {
                                        for (const pattern of patterns) {
                                          if (intervals.length === pattern.length &&
                                              intervals.every((iv, idx) => iv === pattern[idx])) {
                                            return `${noteName(sortedNotes[0])}${chordName}`;
                                          }
                                        }
                                      }

                                      return null; // Unknown chord
                                    };

                                  // Helper to get all notes for a step (including default note when needed)
                                  const getStepNotes = (step: TrigStep, trackData: any): number[] => {
                                    // step.notes already contains all notes (NOTE, NOT2, NOT3, NOT4) from the Rust parser
                                    let allNotes = [...step.notes];

                                    // For MIDI tracks, check if we need to add the default note
                                    if (trackData.track_type === "MIDI" && trackData.default_note !== null) {
                                      // Check if the primary NOTE is parameter-locked
                                      const noteIsLocked = step.midi_plocks?.midi?.note !== null && step.midi_plocks?.midi?.note !== undefined;

                                      // Check if additional notes are present
                                      const hasAdditionalNotes = step.midi_plocks?.midi?.not2 !== null ||
                                                                  step.midi_plocks?.midi?.not3 !== null ||
                                                                  step.midi_plocks?.midi?.not4 !== null;

                                      // Add default note if:
                                      // 1. There's a trigger but no notes at all, OR
                                      // 2. There are additional notes but the primary note is not locked
                                      if ((allNotes.length === 0 && step.trigger) || (hasAdditionalNotes && !noteIsLocked)) {
                                        allNotes.unshift(trackData.default_note); // Add at the beginning
                                      }
                                    }

                                    return allNotes;
                                  };

                                  // Track which indicators are actually used in this pattern
                                  const usedIndicators = new Set<string>();
                                  const steps = trackData.steps.slice(0, pattern.length);

                                  steps.forEach((step) => {
                                    const hasTrig = step.trigger || step.trigless;
                                    if (!hasTrig) return; // Only track indicators for steps with trigs

                                    const allNotes = getStepNotes(step, trackData);
                                    if (step.trigger && !(trackData.track_type === "MIDI" && allNotes.length > 0)) usedIndicators.add('trigger');
                                    if (step.trigless) usedIndicators.add('trigless');
                                    if (step.plock || step.plock_count > 0) usedIndicators.add('plock');
                                    if (step.oneshot) usedIndicators.add('oneshot');
                                    if (step.swing) usedIndicators.add('swing');
                                    if (step.slide) usedIndicators.add('slide');
                                    if (step.recorder) usedIndicators.add('recorder');
                                    if (step.trig_condition) usedIndicators.add('condition');
                                    if (step.trig_repeats > 0) usedIndicators.add('repeats');
                                    if (step.micro_timing) usedIndicators.add('timing');
                                    if (allNotes.length > 0) usedIndicators.add('note');
                                    if (step.velocity !== null) usedIndicators.add('velocity');
                                    if (step.sample_slot !== null) usedIndicators.add('sample');
                                  });

                                  return (
                                    <>
                                      {/* Grid */}
                                      <div className="pattern-grid">
                                        {steps.map((step) => {
                                          const hasTrig = step.trigger || step.trigless;
                                          const trigTypes = [];
                                          if (step.trigger) trigTypes.push('trigger');
                                          if (step.trigless) trigTypes.push('trigless');
                                          if (step.plock) trigTypes.push('plock');
                                          if (step.oneshot) trigTypes.push('oneshot');
                                          if (step.swing) trigTypes.push('swing');
                                          if (step.slide) trigTypes.push('slide');
                                          if (step.recorder) trigTypes.push('recorder');

                                    const allNotes = getStepNotes(step, trackData);
                                    const chordName = detectChord(allNotes);

                                    // Build comprehensive tooltip
                                    const tooltipParts = [`Step ${step.step + 1}`];
                                    if (trigTypes.length > 0) tooltipParts.push(`Trigs: ${trigTypes.join(', ')}`);
                                    if (step.trig_condition) tooltipParts.push(`Condition: ${step.trig_condition}`);
                                    if (step.trig_repeats > 0) tooltipParts.push(`Repeats: ${step.trig_repeats + 1}x`);
                                    if (step.micro_timing) tooltipParts.push(`Timing: ${step.micro_timing}`);
                                    if (allNotes.length > 0) {
                                      const notesStr = allNotes.map(noteName).join(', ');
                                      tooltipParts.push(chordName ? `Chord: ${chordName} (${notesStr})` : `Notes: ${notesStr}`);
                                    }
                                    if (step.velocity !== null) tooltipParts.push(`${trackData.track_type === "MIDI" ? "Velocity" : "Volume"}: ${step.velocity}`);
                                    if (step.plock_count > 0) tooltipParts.push(`P-Locks: ${step.plock_count}`);
                                    if (step.sample_slot !== null) tooltipParts.push(`Sample: ${step.sample_slot}`);

                                    // Check if step has any data to display (p-locks, velocity, sample, notes, etc.)
                                    // For MIDI tracks, only show notes if there's a trigger (otherwise it's just showing default note on empty steps)
                                    const hasData = hasTrig || step.plock_count > 0 || step.velocity !== null ||
                                                    step.sample_slot !== null || (allNotes.length > 0 && (hasTrig || trackData.track_type !== "MIDI")) ||
                                                    step.trig_condition || step.trig_repeats > 0 || step.micro_timing ||
                                                    step.swing || step.slide || step.oneshot || step.recorder;

                                    return (
                                      <div
                                        key={step.step}
                                        className={`pattern-step ${hasTrig ? 'has-trig' : ''} ${trigTypes.join(' ')} ${selectedStepNumber === step.step ? 'selected' : ''}`}
                                        title={tooltipParts.join('\n')}
                                        onClick={() => setSelectedStepNumber(step.step)}
                                        style={{ cursor: 'pointer' }}
                                      >
                                        <div className="step-number">{step.step + 1}</div>
                                        {hasData && (
                                          <div className="step-indicators">
                                            {/* 1. Trig indicators first */}
                                            {step.trigger && !(trackData.track_type === "MIDI" && allNotes.length > 0) && <span className="indicator-trigger"><i className="fas fa-circle"></i></span>}
                                            {step.trigless && <span className="indicator-trigless"><i className="far fa-circle"></i></span>}

                                            {/* 2. MIDI Notes */}
                                            {allNotes.length > 0 && (hasTrig || trackData.track_type !== "MIDI") && (
                                              <div className="note-indicator-wrapper">
                                                {allNotes.map((note, idx) => (
                                                  <span key={idx} className={`indicator-note ${chordName ? 'indicator-chord' : ''}`}>
                                                    {noteName(note)}
                                                  </span>
                                                ))}
                                              </div>
                                            )}

                                            {/* 3. P-lock count */}
                                            {(step.plock || (step.plock_count > 0 && step.plock_count <= 1)) && <span className="indicator-plock">P</span>}
                                            {step.plock_count > 1 && <span className="indicator-plock-count">{step.plock_count}P</span>}

                                            {/* 4. Other indicators */}
                                            {step.oneshot && <span className="indicator-oneshot">1</span>}
                                            {step.slide && <span className="indicator-slide">~</span>}
                                            {step.recorder && <span className="indicator-recorder">R</span>}
                                            {step.trig_condition && <span className="indicator-condition">%</span>}
                                            {step.trig_repeats > 0 && <span className="indicator-repeats">X</span>}
                                            {step.micro_timing && <span className="indicator-timing">µ</span>}
                                            {step.velocity !== null && <span className="indicator-velocity">V</span>}
                                            {step.sample_slot !== null && <span className="indicator-sample">S</span>}

                                            {/* 5. Swing last */}
                                            {step.swing && <span className="indicator-swing"><svg viewBox="0 0 20 14" width="13" height="11"><path d="M1 7 C4 1 7 1 10 7 C13 13 16 13 19 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg></span>}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Legend - only show indicators that are actually used */}
                                {usedIndicators.size > 0 && (
                                  <div className="pattern-grid-legend">
                                    {usedIndicators.has('trigger') && <div className="legend-item"><span className="indicator-trigger"><i className="fas fa-circle"></i></span> Trigger</div>}
                                    {usedIndicators.has('trigless') && <div className="legend-item"><span className="indicator-trigless"><i className="far fa-circle"></i></span> Trigless</div>}
                                    {usedIndicators.has('plock') && <div className="legend-item"><span className="indicator-plock">P</span> P-Lock</div>}
                                    {usedIndicators.has('oneshot') && <div className="legend-item"><span className="indicator-oneshot">1</span> One-Shot</div>}
                                    {usedIndicators.has('swing') && <div className="legend-item"><span className="indicator-swing"><svg viewBox="0 0 20 14" width="14" height="11"><path d="M1 7 C4 1 7 1 10 7 C13 13 16 13 19 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg></span> Swing</div>}
                                    {usedIndicators.has('slide') && <div className="legend-item"><span className="indicator-slide">~</span> Slide</div>}
                                    {usedIndicators.has('recorder') && <div className="legend-item"><span className="indicator-recorder">R</span> Recorder</div>}
                                    {usedIndicators.has('condition') && <div className="legend-item"><span className="indicator-condition">%</span> Condition</div>}
                                    {usedIndicators.has('repeats') && <div className="legend-item"><span className="indicator-repeats">X</span> Repeats</div>}
                                    {usedIndicators.has('timing') && <div className="legend-item"><span className="indicator-timing">µ</span> Micro-timing</div>}
                                    {usedIndicators.has('note') && <div className="legend-item"><span className="indicator-note">C4</span> MIDI Note/Chord</div>}
                                    {usedIndicators.has('velocity') && <div className="legend-item"><span className="indicator-velocity">V</span> {trackData.track_type === "MIDI" ? "Velocity" : "Volume"}</div>}
                                    {usedIndicators.has('sample') && <div className="legend-item"><span className="indicator-sample">S</span> Sample</div>}
                                  </div>
                                )}

                                {/* Parameter Details Panel */}
                                {selectedStepNumber !== null && (() => {
                                  // Find the step data for this specific pattern/track
                                  const selectedStep = trackData.steps.find(s => s.step === selectedStepNumber);
                                  if (!selectedStep) return null;

                                  return (
                                  <div className="parameter-details-panel">
                                    <div className="parameter-panel-header">
                                      <h4>Step {selectedStep.step + 1} details</h4>
                                      <button onClick={() => setSelectedStepNumber(null)} className="close-button">×</button>
                                    </div>
                                    <div className="parameter-panel-content">
                                      <div className="param-grid">
                                        {/* Trig Information - only show if there's a trig */}
                                        {selectedStep.trigger && <div className="param-item"><span>Trig Type:</span> Trigger</div>}
                                        {selectedStep.trigless && <div className="param-item"><span>Trig Type:</span> Trigless</div>}
                                        {selectedStep.oneshot && <div className="param-item"><span>One-Shot:</span> Yes</div>}
                                        {selectedStep.swing && <div className="param-item"><span>Swing:</span> Yes</div>}
                                        {selectedStep.slide && <div className="param-item"><span>Slide:</span> Yes</div>}
                                        {selectedStep.recorder && <div className="param-item"><span>Recorder Trig:</span> Yes</div>}
                                        {selectedStep.trig_condition && <div className="param-item"><span>Condition:</span> {selectedStep.trig_condition}</div>}
                                        {selectedStep.trig_repeats > 0 && <div className="param-item"><span>Repeats:</span> {selectedStep.trig_repeats + 1}x</div>}
                                        {selectedStep.micro_timing && <div className="param-item"><span>Micro-timing:</span> {selectedStep.micro_timing}</div>}
                                        {selectedStep.velocity !== null && <div className="param-item"><span>{trackData.track_type === "MIDI" ? "VEL (Velocity)" : "VOL (Volume)"}:</span> {selectedStep.velocity}</div>}
                                        {selectedStep.sample_slot !== null && <div className="param-item"><span>Sample Slot:</span> {selectedStep.sample_slot}</div>}

                                        {/* Audio P-Locks: Machine Parameters */}
                                        {selectedStep.audio_plocks?.machine?.param1 != null && <div className="param-item"><span>PTCH (Pitch):</span> {selectedStep.audio_plocks?.machine?.param1}</div>}
                                        {selectedStep.audio_plocks?.machine?.param2 != null && <div className="param-item"><span>STRT (Start):</span> {selectedStep.audio_plocks?.machine?.param2}</div>}
                                        {selectedStep.audio_plocks?.machine?.param3 != null && <div className="param-item"><span>LEN (Length):</span> {selectedStep.audio_plocks?.machine?.param3}</div>}
                                        {selectedStep.audio_plocks?.machine?.param4 != null && <div className="param-item"><span>RATE (Rate):</span> {selectedStep.audio_plocks?.machine?.param4}</div>}
                                        {selectedStep.audio_plocks?.machine?.param5 != null && <div className="param-item"><span>RTRG (Retrigs):</span> {selectedStep.audio_plocks?.machine?.param5}</div>}
                                        {selectedStep.audio_plocks?.machine?.param6 != null && <div className="param-item"><span>RTIM (Retrig Time):</span> {selectedStep.audio_plocks?.machine?.param6}</div>}

                                        {/* Audio P-Locks: LFO Parameters */}
                                        {selectedStep.audio_plocks?.lfo?.spd1 != null && <div className="param-item"><span>LFO1 Speed:</span> {selectedStep.audio_plocks?.lfo?.spd1}</div>}
                                        {selectedStep.audio_plocks?.lfo?.spd2 != null && <div className="param-item"><span>LFO2 Speed:</span> {selectedStep.audio_plocks?.lfo?.spd2}</div>}
                                        {selectedStep.audio_plocks?.lfo?.spd3 != null && <div className="param-item"><span>LFO3 Speed:</span> {selectedStep.audio_plocks?.lfo?.spd3}</div>}
                                        {selectedStep.audio_plocks?.lfo?.dep1 != null && <div className="param-item"><span>LFO1 Depth:</span> {selectedStep.audio_plocks?.lfo?.dep1}</div>}
                                        {selectedStep.audio_plocks?.lfo?.dep2 != null && <div className="param-item"><span>LFO2 Depth:</span> {selectedStep.audio_plocks?.lfo?.dep2}</div>}
                                        {selectedStep.audio_plocks?.lfo?.dep3 != null && <div className="param-item"><span>LFO3 Depth:</span> {selectedStep.audio_plocks?.lfo?.dep3}</div>}

                                        {/* Audio P-Locks: Amp Parameters */}
                                        {selectedStep.audio_plocks?.amp?.atk != null && <div className="param-item"><span>ATK (Attack):</span> {selectedStep.audio_plocks?.amp?.atk}</div>}
                                        {selectedStep.audio_plocks?.amp?.hold != null && <div className="param-item"><span>HOLD (Hold):</span> {selectedStep.audio_plocks?.amp?.hold}</div>}
                                        {selectedStep.audio_plocks?.amp?.rel != null && <div className="param-item"><span>REL (Release):</span> {selectedStep.audio_plocks?.amp?.rel}</div>}
                                                                                {selectedStep.audio_plocks?.amp?.bal != null && <div className="param-item"><span>BAL (Balance):</span> {selectedStep.audio_plocks?.amp?.bal}</div>}
                                        {selectedStep.audio_plocks?.amp?.f != null && <div className="param-item"><span>FILT (Filter):</span> {selectedStep.audio_plocks?.amp?.f}</div>}


                                        {/* MIDI track parameters */}
                                        {trackData.track_type === "MIDI" && (() => {
                                          const allNotes = getStepNotes(selectedStep, trackData);
                                          return (
                                            <>
                                              {allNotes.map((note, idx) => {
                                                const isDefaultNote = trackData.default_note === note &&
                                                                      selectedStep.midi_plocks?.midi?.note !== note &&
                                                                      selectedStep.midi_plocks?.midi?.not2 !== note &&
                                                                      selectedStep.midi_plocks?.midi?.not3 !== note &&
                                                                      selectedStep.midi_plocks?.midi?.not4 !== note;
                                                return (
                                                  <div key={idx} className="param-item">
                                                    <span>NOTE {idx + 1}:</span> {noteName(note)}{isDefaultNote ? ' (default)' : ''}
                                                  </div>
                                                );
                                              })}
                                            </>
                                          );
                                        })()}
                                                                                {selectedStep.midi_plocks?.midi?.len != null && <div className="param-item"><span>LEN (Length):</span> {selectedStep.midi_plocks?.midi?.len}</div>}

                                        {/* MIDI P-Locks: LFO Parameters */}
                                        {selectedStep.midi_plocks?.lfo?.spd1 != null && <div className="param-item"><span>LFO1 Speed:</span> {selectedStep.midi_plocks?.lfo?.spd1}</div>}
                                        {selectedStep.midi_plocks?.lfo?.spd2 != null && <div className="param-item"><span>LFO2 Speed:</span> {selectedStep.midi_plocks?.lfo?.spd2}</div>}
                                        {selectedStep.midi_plocks?.lfo?.spd3 != null && <div className="param-item"><span>LFO3 Speed:</span> {selectedStep.midi_plocks?.lfo?.spd3}</div>}
                                        {selectedStep.midi_plocks?.lfo?.dep1 != null && <div className="param-item"><span>LFO1 Depth:</span> {selectedStep.midi_plocks?.lfo?.dep1}</div>}
                                        {selectedStep.midi_plocks?.lfo?.dep2 != null && <div className="param-item"><span>LFO2 Depth:</span> {selectedStep.midi_plocks?.lfo?.dep2}</div>}
                                        {selectedStep.midi_plocks?.lfo?.dep3 != null && <div className="param-item"><span>LFO3 Depth:</span> {selectedStep.midi_plocks?.lfo?.dep3}</div>}
                                      </div>
                                    </div>
                                  </div>
                                  );
                                })()}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      );
                    });
                  });
                })()}
              </div>
            </div>
            );
          });
        })()}
      </div>
                )}
    </div>
  )}

            {activeTab === "tracks" && (
              <div className="tracks-tab">
                <div className="bank-selector-section">
                  <BankSelector
                    id="track-bank-select"
                    banks={banks}
                    value={selectedBankIndex}
                    onChange={setSelectedBankIndex}
                    currentBank={metadata?.current_state.bank}
                    loadedBankIndices={loadedBankIndices}
                    failedBankIndices={failedBankIndices}
                    allBanksLoaded={allBanksLoaded}
                  />

                  <TrackSelector
                    id="track-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                  />
                </div>

                {loadedBankIndices.size === 0 ? (
                  <div className="loading-section">
                    <div className="loading-spinner"></div>
                    <p>Loading banks...</p>
                  </div>
                ) : (
                <section className="tracks-section">
                  {(() => {
                    // Determine which banks to display (only show loaded banks)
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? Array.from(loadedBankIndices).sort((a, b) => a - b)
                      : loadedBankIndices.has(selectedBankIndex) ? [selectedBankIndex] : [];

                    return banksToDisplay.map((bankIndex) => {
                      const bank = banks[bankIndex];
                      if (!bank) return null;

                      // For track settings, use pattern 0 if ALL_PATTERNS is selected
                      const patternIndexToUse = selectedPatternIndex === ALL_PATTERNS ? 0 : selectedPatternIndex;
                      const pattern = bank.parts[0]?.patterns[patternIndexToUse];
                      if (!pattern) return null;

                      // Determine which tracks to display
                      let tracksToDisplay: number[];
                      if (selectedTrackIndex === ALL_AUDIO_TRACKS) {
                        tracksToDisplay = [0, 1, 2, 3, 4, 5, 6, 7];
                      } else if (selectedTrackIndex === ALL_MIDI_TRACKS) {
                        tracksToDisplay = [8, 9, 10, 11, 12, 13, 14, 15];
                      } else {
                        tracksToDisplay = [selectedTrackIndex];
                      }

                      // Render track settings for each track
                      return tracksToDisplay.map((trackIndex) => {
                        const trackData = pattern.tracks[trackIndex];

                        return (
                        <div key={`bank-${bankIndex}-track-settings-${trackIndex}`} className="bank-card">
                          <h3>
                            {formatBankName(bank.name, bankIndex)} - <TrackBadge trackId={trackData.track_id} />
                          </h3>
                          <div className="pattern-details">
                            <div className="pattern-detail-group track-settings-row">
                              <div className="pattern-detail-item">
                                <span className="pattern-detail-label">Swing:</span>
                                <span className="pattern-detail-value">{trackData.swing_amount > 0 ? `${trackData.swing_amount + 50}%` : '50% (Off)'}</span>
                              </div>
                              <div className="pattern-detail-item">
                                <span className="pattern-detail-label">Trig Mode:</span>
                                <span className="pattern-detail-value">{trackData.pattern_settings.trig_mode}</span>
                              </div>
                              <div className="pattern-detail-item">
                                <span className="pattern-detail-label">Trig Quantization:</span>
                                <span className="pattern-detail-value">{trackData.pattern_settings.trig_quant}</span>
                              </div>
                              <div className="pattern-detail-item">
                                <span className="pattern-detail-label">Start Silent:</span>
                                <span className="pattern-detail-value">{trackData.pattern_settings.start_silent ? 'Yes' : 'No'}</span>
                              </div>
                              <div className="pattern-detail-item">
                                <span className="pattern-detail-label">Plays Free:</span>
                                <span className="pattern-detail-value">{trackData.pattern_settings.plays_free ? 'Yes' : 'No'}</span>
                              </div>
                              <div className="pattern-detail-item">
                                <span className="pattern-detail-label">One-Shot Track:</span>
                                <span className="pattern-detail-value">{trackData.pattern_settings.oneshot_trk ? 'Yes' : 'No'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      });
                    });
                  })()}
                </section>
                )}
              </div>
            )}

            {activeTab === "flex-slots" && (
              <SampleSlotsTable slots={metadata.sample_slots.flex_slots} slotPrefix="F" tableType="flex" projectPath={projectPath} />
            )}

            {activeTab === "static-slots" && (
              <SampleSlotsTable slots={metadata.sample_slots.static_slots} slotPrefix="S" tableType="static" projectPath={projectPath} />
            )}

            {activeTab === "tools" && projectPath && (
              <ToolsPanel
                projectPath={projectPath}
                projectName={projectName || ""}
                banks={banks}
                loadedBankIndices={loadedBankIndices}
                onBankUpdated={reloadBank}
              />
            )}

          </div>
        </div>
      )}
      <ScrollToTop />
    </main>
  );
}

export default ProjectDetail;
