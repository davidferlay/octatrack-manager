import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import "../App.css";

interface CurrentState {
  bank: number;
  bank_name: string;
  pattern: number;
  part: number;
  track: number;
  muted_tracks: number[];
  soloed_tracks: number[];
}

interface MixerSettings {
  gain_ab: number;
  gain_cd: number;
  dir_ab: number;
  dir_cd: number;
  phones_mix: number;
  main_level: number;
  cue_level: number;
}

interface SampleSlot {
  slot_id: number;
  slot_type: string;
  path: string;
  gain: number;
  loop_mode: string;
  timestretch_mode: string;
}

interface SampleSlots {
  static_slots: SampleSlot[];
  flex_slots: SampleSlot[];
}

interface ProjectMetadata {
  name: string;
  tempo: number;
  time_signature: string;
  pattern_length: number;
  current_state: CurrentState;
  mixer_settings: MixerSettings;
  sample_slots: SampleSlots;
  os_version: string;
}

interface TrigCounts {
  trigger: number;      // Standard trigger trigs
  trigless: number;     // Trigless trigs (p-locks without triggering)
  plock: number;        // Parameter lock trigs
  oneshot: number;      // One-shot trigs
  swing: number;        // Swing trigs
  slide: number;        // Parameter slide trigs
  total: number;        // Total of all trig types
}

interface PerTrackSettings {
  master_len: string;        // Master length in per-track mode (can be "INF")
  master_scale: string;      // Master scale in per-track mode
}

interface TrackSettings {
  start_silent: boolean;
  plays_free: boolean;
  trig_mode: string;         // "ONE", "ONE2", "HOLD"
  trig_quant: string;        // Quantization setting
  oneshot_trk: boolean;
}

interface TrigStep {
  step: number;              // Step number (0-63)
  trigger: boolean;          // Has trigger trig
  trigless: boolean;         // Has trigless trig
  plock: boolean;            // Has parameter lock
  oneshot: boolean;          // Has oneshot trig (audio only)
  swing: boolean;            // Has swing trig
  slide: boolean;            // Has slide trig (audio only)
}

interface TrackInfo {
  track_id: number;
  track_type: string;        // "Audio" or "MIDI"
  swing_amount: number;      // 0-30 (50-80 on device)
  per_track_len: number | null; // Track length in per-track mode
  per_track_scale: string | null; // Track scale in per-track mode
  pattern_settings: TrackSettings;
  trig_counts: TrigCounts;   // Per-track trig statistics
  steps: TrigStep[];         // Per-step trig information (64 steps)
}

interface Pattern {
  id: number;
  name: string;
  length: number;
  part_assignment: number;       // Which part (0-3 for Parts 1-4) this pattern is assigned to
  scale_mode: string;            // "Normal" or "Per Track"
  master_scale: string;          // Playback speed multiplier (2x, 3/2x, 1x, etc.)
  chain_mode: string;            // "Project" or "Pattern"
  tempo_info: string | null;     // Pattern tempo if set, or null if using project tempo
  active_tracks: number;         // Number of tracks with at least one trigger trig
  trig_counts: TrigCounts;       // Detailed trig statistics
  per_track_settings: PerTrackSettings | null; // Settings for per-track mode
  has_swing: boolean;            // Whether pattern has any swing trigs
  tracks: TrackInfo[];           // Per-track information
}

interface Part {
  id: number;
  name: string;
  patterns: Pattern[];
}

interface Bank {
  id: string;
  name: string;
  parts: Part[];
}

type TabType = "overview" | "banks" | "samples";

export function ProjectDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = searchParams.get("path");
  const projectName = searchParams.get("name");

  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [selectedBankIndex, setSelectedBankIndex] = useState<number>(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0); // Default to track 0, will be set to active track
  const [selectedPatternIndex, setSelectedPatternIndex] = useState<number>(0); // Default to pattern 0, will be set to active pattern

  useEffect(() => {
    if (projectPath) {
      loadProjectData();
    }
  }, [projectPath]);

  async function loadProjectData() {
    setIsLoading(true);
    setError(null);
    try {
      const projectMetadata = await invoke<ProjectMetadata>("load_project_metadata", { path: projectPath });
      const projectBanks = await invoke<Bank[]>("load_project_banks", { path: projectPath });
      setMetadata(projectMetadata);
      setBanks(projectBanks);
      // Set the selected bank to the currently active bank
      setSelectedBankIndex(projectMetadata.current_state.bank);
      // Set the selected track to the currently active track
      setSelectedTrackIndex(projectMetadata.current_state.track);
      // Set the selected pattern to the currently active pattern
      setSelectedPatternIndex(projectMetadata.current_state.pattern);
    } catch (err) {
      console.error("Error loading project data:", err);
      setError(String(err));
    } finally {
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

  return (
    <main className="container">
      <div className="project-header">
        <button onClick={() => navigate("/")} className="back-button">
          ← Back
        </button>
        <h1>{projectName}</h1>
      </div>

      <div className="project-path-info">
        <strong>Path:</strong> {projectPath}
      </div>

      {isLoading && (
        <div className="loading-section">
          <p>Loading project data...</p>
        </div>
      )}

      {error && (
        <div className="error-section">
          <p>Error loading project: {error}</p>
        </div>
      )}

      {!isLoading && !error && metadata && (
        <div className="project-content">
          <div className="tabs">
            <button
              className={`tab ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={`tab ${activeTab === "banks" ? "active" : ""}`}
              onClick={() => setActiveTab("banks")}
            >
              Banks ({banks.length})
            </button>
            <button
              className={`tab ${activeTab === "samples" ? "active" : ""}`}
              onClick={() => setActiveTab("samples")}
            >
              Samples ({metadata.sample_slots.static_slots.length + metadata.sample_slots.flex_slots.length})
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "overview" && (
              <div className="overview-tab">
                <section className="metadata-section">
                  <h2>Project Info</h2>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Tempo</span>
                      <span className="metadata-value">{metadata.tempo} BPM</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Time Signature</span>
                      <span className="metadata-value">{metadata.time_signature}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">OS Version</span>
                      <span className="metadata-value">{metadata.os_version}</span>
                    </div>
                  </div>
                </section>

                <section className="current-state-section">
                  <h2>Current State</h2>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Bank</span>
                      <span className="metadata-value">{metadata.current_state.bank_name}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Pattern</span>
                      <span className="metadata-value">{metadata.current_state.pattern + 1}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Part</span>
                      <span className="metadata-value">{metadata.current_state.part + 1}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Track</span>
                      <span className="metadata-value">T{metadata.current_state.track + 1}</span>
                    </div>
                  </div>
                  {metadata.current_state.muted_tracks.length > 0 && (
                    <div className="track-states">
                      <span className="state-label">Muted Tracks:</span>
                      <span className="state-value">
                        {metadata.current_state.muted_tracks.map(t => `T${t + 1}`).join(", ")}
                      </span>
                    </div>
                  )}
                </section>

                <section className="mixer-section">
                  <h2>Mixer Settings</h2>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Gain AB</span>
                      <span className="metadata-value">{metadata.mixer_settings.gain_ab}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Gain CD</span>
                      <span className="metadata-value">{metadata.mixer_settings.gain_cd}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Direct AB</span>
                      <span className="metadata-value">{metadata.mixer_settings.dir_ab}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Direct CD</span>
                      <span className="metadata-value">{metadata.mixer_settings.dir_cd}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Phones Mix</span>
                      <span className="metadata-value">{metadata.mixer_settings.phones_mix}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Main Level</span>
                      <span className="metadata-value">{metadata.mixer_settings.main_level}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Cue Level</span>
                      <span className="metadata-value">{metadata.mixer_settings.cue_level}</span>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "banks" && (
              <div className="banks-tab">
                <div className="bank-selector-section">
                  <div className="selector-group">
                    <label htmlFor="bank-select" className="bank-selector-label">
                      Bank:
                    </label>
                    <select
                      id="bank-select"
                      className="bank-selector"
                      value={selectedBankIndex}
                      onChange={(e) => setSelectedBankIndex(Number(e.target.value))}
                    >
                      {banks.map((bank, index) => (
                        <option key={bank.id} value={index}>
                          {bank.name} ({index + 1}){index === metadata?.current_state.bank ? ' (Active)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="selector-group">
                    <label htmlFor="track-select" className="bank-selector-label">
                      Track:
                    </label>
                    <select
                      id="track-select"
                      className="bank-selector"
                      value={selectedTrackIndex}
                      onChange={(e) => setSelectedTrackIndex(Number(e.target.value))}
                    >
                      <optgroup label="Audio Tracks">
                        {[0, 1, 2, 3, 4, 5, 6, 7].map((trackNum) => (
                          <option key={`audio-${trackNum}`} value={trackNum}>
                            T{trackNum + 1} (Audio){trackNum === metadata?.current_state.track ? ' (Active)' : ''}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="MIDI Tracks">
                        {[8, 9, 10, 11, 12, 13, 14, 15].map((trackNum) => (
                          <option key={`midi-${trackNum}`} value={trackNum}>
                            T{trackNum + 1} (MIDI){trackNum === metadata?.current_state.track ? ' (Active)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                </div>

                {banks[selectedBankIndex] && (
                  <section className="banks-section">
                    {/* Parts Section */}
                    <div className="bank-card">
                      <h3>Parts ({banks[selectedBankIndex].parts.length})</h3>
                      <div className="parts-list">
                        {banks[selectedBankIndex].parts.map((part) => (
                          <div key={part.id} className="part-card">
                            <h4>{part.name}</h4>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Pattern Detail Section */}
                    <div className="bank-card">
                      <div className="bank-card-header">
                        <h3>Pattern Details</h3>
                        <div className="selector-group">
                          <label htmlFor="pattern-select" className="bank-selector-label">
                            Pattern:
                          </label>
                          <select
                            id="pattern-select"
                            className="bank-selector"
                            value={selectedPatternIndex}
                            onChange={(e) => setSelectedPatternIndex(Number(e.target.value))}
                          >
                            {[...Array(16)].map((_, patternNum) => (
                              <option key={patternNum} value={patternNum}>
                                Pattern {patternNum + 1}{patternNum === metadata?.current_state.pattern ? ' (Active)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="patterns-list">
                        {(() => {
                          // Get the selected pattern
                          const pattern = banks[selectedBankIndex].parts[0]?.patterns[selectedPatternIndex];
                          if (!pattern) return null;

                          // Get track-specific data for the selected track
                          const trackData = pattern.tracks[selectedTrackIndex];

                          return (
                          <div className="pattern-card">
                            <div className="pattern-header">
                              <span className="pattern-name">{pattern.name}</span>
                              <span className="pattern-part">→ Part {pattern.part_assignment + 1}</span>
                              <span className="pattern-track-indicator">T{trackData.track_id + 1} ({trackData.track_type})</span>
                              {trackData.trig_counts.swing > 0 && <span className="pattern-swing-indicator">♪ {trackData.swing_amount + 50}%</span>}
                              {pattern.tempo_info && <span className="pattern-tempo-indicator">{pattern.tempo_info}</span>}
                            </div>
                            <div className="pattern-details">
                              <div className="pattern-detail-group">
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Length:</span>
                                  <span className="pattern-detail-value">{pattern.length} steps</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Speed:</span>
                                  <span className="pattern-detail-value">{pattern.master_scale}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Mode:</span>
                                  <span className="pattern-detail-value">{pattern.scale_mode}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Chain:</span>
                                  <span className="pattern-detail-value">{pattern.chain_mode}</span>
                                </div>
                              </div>
                              <div className="pattern-detail-separator"></div>
                              <div className="pattern-detail-group">
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Total Trigs:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.total}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Trigger:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.trigger}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">P-Locks:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.plock}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Trigless:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.trigless}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">One-Shot:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.oneshot}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Slide:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.slide}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Swing:</span>
                                  <span className="pattern-detail-value">{trackData.swing_amount > 0 ? `${trackData.swing_amount + 50}%` : '-'}</span>
                                </div>
                              </div>
                              <div className="pattern-detail-separator"></div>
                              <div className="pattern-detail-group">
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Trig Mode:</span>
                                  <span className="pattern-detail-value">{trackData.pattern_settings.trig_mode}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Trig Quant:</span>
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
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Track Len:</span>
                                  <span className="pattern-detail-value">{trackData.per_track_len !== null ? trackData.per_track_len : '-'}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Track Scale:</span>
                                  <span className="pattern-detail-value">{trackData.per_track_scale || '-'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Pattern Grid Visualization */}
                            <div className="pattern-grid-section">
                              <h4>Pattern Grid</h4>
                              <div className="pattern-grid-container">
                                {/* Page markers */}
                                <div className="pattern-grid-pages">
                                  <div className="page-label">Page 1</div>
                                  <div className="page-label">Page 2</div>
                                  <div className="page-label">Page 3</div>
                                  <div className="page-label">Page 4</div>
                                </div>

                                {/* Grid */}
                                <div className="pattern-grid">
                                  {trackData.steps.slice(0, pattern.length).map((step) => {
                                    const hasTrig = step.trigger || step.trigless;
                                    const trigTypes = [];
                                    if (step.trigger) trigTypes.push('trigger');
                                    if (step.trigless) trigTypes.push('trigless');
                                    if (step.plock) trigTypes.push('plock');
                                    if (step.oneshot) trigTypes.push('oneshot');
                                    if (step.swing) trigTypes.push('swing');
                                    if (step.slide) trigTypes.push('slide');

                                    return (
                                      <div
                                        key={step.step}
                                        className={`pattern-step ${hasTrig ? 'has-trig' : ''} ${trigTypes.join(' ')}`}
                                        title={`Step ${step.step + 1}${trigTypes.length > 0 ? '\n' + trigTypes.join(', ') : ''}`}
                                      >
                                        <div className="step-number">{step.step + 1}</div>
                                        {hasTrig && (
                                          <div className="step-indicators">
                                            {step.trigger && <span className="indicator-trigger">●</span>}
                                            {step.trigless && <span className="indicator-trigless">○</span>}
                                            {step.plock && <span className="indicator-plock">P</span>}
                                            {step.oneshot && <span className="indicator-oneshot">1</span>}
                                            {step.swing && <span className="indicator-swing">♪</span>}
                                            {step.slide && <span className="indicator-slide">~</span>}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Legend */}
                                <div className="pattern-grid-legend">
                                  <div className="legend-item"><span className="indicator-trigger">●</span> Trigger</div>
                                  <div className="legend-item"><span className="indicator-trigless">○</span> Trigless</div>
                                  <div className="legend-item"><span className="indicator-plock">P</span> P-Lock</div>
                                  <div className="legend-item"><span className="indicator-oneshot">1</span> One-Shot</div>
                                  <div className="legend-item"><span className="indicator-swing">♪</span> Swing</div>
                                  <div className="legend-item"><span className="indicator-slide">~</span> Slide</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                        })()}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            {activeTab === "samples" && (
              <div className="samples-tab">
                <section className="samples-section">
                  <h2>Static Slots ({metadata.sample_slots.static_slots.length})</h2>
                  <div className="samples-grid">
                    {metadata.sample_slots.static_slots.map((slot) => (
                      <div key={slot.slot_id} className="sample-card">
                        <div className="sample-header">
                          <span className="sample-id">S{slot.slot_id}</span>
                          <span className="sample-gain">Gain: {slot.gain}</span>
                        </div>
                        <div className="sample-name">{slot.path}</div>
                        <div className="sample-info">
                          <span className="sample-mode">{slot.timestretch_mode}</span>
                          <span className="sample-loop">{slot.loop_mode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="samples-section">
                  <h2>Flex Slots ({metadata.sample_slots.flex_slots.length})</h2>
                  <div className="samples-grid">
                    {metadata.sample_slots.flex_slots.map((slot) => (
                      <div key={slot.slot_id} className="sample-card">
                        <div className="sample-header">
                          <span className="sample-id">F{slot.slot_id}</span>
                          <span className="sample-gain">Gain: {slot.gain}</span>
                        </div>
                        <div className="sample-name">{slot.path}</div>
                        <div className="sample-info">
                          <span className="sample-mode">{slot.timestretch_mode}</span>
                          <span className="sample-loop">{slot.loop_mode}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

          </div>
        </div>
      )}
    </main>
  );
}

export default ProjectDetail;
