import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useProjects } from "../context/ProjectsContext";
import type { ProjectMetadata, Bank } from "../context/ProjectsContext";
import { BankSelector, ALL_BANKS, formatBankName } from "../components/BankSelector";
import { TrackSelector, ALL_AUDIO_TRACKS, ALL_MIDI_TRACKS } from "../components/TrackSelector";
import { PatternSelector, ALL_PATTERNS } from "../components/PatternSelector";
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

type TabType = "overview" | "parts" | "patterns" | "tracks" | "static-slots" | "flex-slots";

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
  const { getCachedProject, setCachedProject } = useProjects();
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
  const [selectedStep, setSelectedStep] = useState<TrigStep | null>(null); // Selected step for parameter details

  useEffect(() => {
    if (projectPath) {
      // Check cache first
      const cachedData = getCachedProject(projectPath);
      if (cachedData) {
        console.log("Loading project from cache:", projectPath);
        setMetadata(cachedData.metadata);
        setBanks(cachedData.banks);
        // Set the selected bank to the currently active bank
        setSelectedBankIndex(cachedData.metadata.current_state.bank);
        // Set the selected track to the currently active track
        setSelectedTrackIndex(cachedData.metadata.current_state.track);
        // Set the selected pattern to the currently active pattern
        setSelectedPatternIndex(cachedData.metadata.current_state.pattern);
        setIsLoading(false);
      } else {
        // Use requestAnimationFrame to ensure loading UI is painted before data loading
        requestAnimationFrame(() => {
          setTimeout(() => {
            loadProjectData();
          }, 10);
        });
      }
    }
  }, [projectPath]);

  async function loadProjectData() {
    setIsLoading(true);
    setError(null);
    try {
      console.log("Loading project from backend:", projectPath);
      const projectMetadata = await invoke<ProjectMetadata>("load_project_metadata", { path: projectPath });
      const projectBanks = await invoke<Bank[]>("load_project_banks", { path: projectPath });
      setMetadata(projectMetadata);
      setBanks(projectBanks);
      // Cache the loaded data
      if (projectPath) {
        setCachedProject(projectPath, projectMetadata, projectBanks);
      }
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

  const handleRefresh = () => {
    loadProjectData();
  };

  return (
    <main className="container">
      <div className="project-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '0 1 auto' }}>
          <button onClick={() => navigate("/")} className="back-button">
            ← Back
          </button>
          <h1 style={{ margin: 0 }}>{projectName}</h1>
        </div>
        <button onClick={handleRefresh} className="back-button refresh-button" disabled={isLoading} title="Refresh project data" style={{ marginLeft: 'auto' }}>
          ↻ Refresh
        </button>
      </div>

      <div className="project-path-info">
        <strong>Path:</strong> {projectPath}
      </div>

      {isLoading && (
        <div className="loading-section">
          <div className="loading-spinner"></div>
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
              className={`tab ${activeTab === "parts" ? "active" : ""}`}
              onClick={() => setActiveTab("parts")}
            >
              Parts
            </button>
            <button
              className={`tab ${activeTab === "patterns" ? "active" : ""}`}
              onClick={() => setActiveTab("patterns")}
            >
              Patterns
            </button>
            <button
              className={`tab ${activeTab === "tracks" ? "active" : ""}`}
              onClick={() => setActiveTab("tracks")}
            >
              Track Settings
            </button>
            <button
              className={`tab ${activeTab === "flex-slots" ? "active" : ""}`}
              onClick={() => setActiveTab("flex-slots")}
            >
              Flex Slots ({metadata.sample_slots.flex_slots.length})
            </button>
            <button
              className={`tab ${activeTab === "static-slots" ? "active" : ""}`}
              onClick={() => setActiveTab("static-slots")}
            >
              Static Slots ({metadata.sample_slots.static_slots.length})
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "overview" && (
              <div className="overview-tab">
                <section className="metadata-section">
                  <h2>Project Info</h2>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Master Tempo</span>
                      <span className="metadata-value">{metadata.tempo} BPM</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Metronome Time Signature</span>
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
                      <span className="metadata-label">Mode</span>
                      <span className="metadata-value">{metadata.current_state.midi_mode === 0 ? "Audio" : "MIDI"}</span>
                    </div>
                  </div>
                </section>

                <section className="current-state-section">
                  <h2>Audio Mode State</h2>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Track</span>
                      <span className="metadata-value">T{(metadata.current_state.midi_mode === 0 ? metadata.current_state.track : metadata.current_state.track_othermode) + 1}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Muted Tracks</span>
                      <span className="metadata-value">
                        {metadata.current_state.audio_muted_tracks.length > 0
                          ? metadata.current_state.audio_muted_tracks.map(t => `T${t + 1}`).join(", ")
                          : "None"}
                      </span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Cued Tracks</span>
                      <span className="metadata-value">
                        {metadata.current_state.audio_cued_tracks.length > 0
                          ? metadata.current_state.audio_cued_tracks.map(t => `T${t + 1}`).join(", ")
                          : "None"}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="current-state-section">
                  <h2>MIDI Mode State</h2>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Track</span>
                      <span className="metadata-value">T{(metadata.current_state.midi_mode === 1 ? metadata.current_state.track : metadata.current_state.track_othermode) + 1 + 8}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Muted Tracks</span>
                      <span className="metadata-value">
                        {metadata.current_state.midi_muted_tracks.length > 0
                          ? metadata.current_state.midi_muted_tracks.map(t => `T${t + 1 + 8}`).join(", ")
                          : "None"}
                      </span>
                    </div>
                  </div>
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
                      <span className="metadata-label">Direct Out AB</span>
                      <span className="metadata-value">{metadata.mixer_settings.dir_ab}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Direct Out CD</span>
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

            {activeTab === "parts" && (
              <div className="banks-tab">
                <div className="bank-selector-section">
                  <BankSelector
                    id="parts-bank-select"
                    banks={banks}
                    value={selectedBankIndex}
                    onChange={setSelectedBankIndex}
                    currentBank={metadata?.current_state.bank}
                  />

                  <TrackSelector
                    id="parts-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                  />
                </div>

                <section className="banks-section">
                  {(() => {
                    // Determine which banks to display
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? banks.map((_, index) => index)
                      : [selectedBankIndex];

                    return banksToDisplay.map((bankIndex) => {
                      const bank = banks[bankIndex];
                      if (!bank) return null;

                      return (
                        <div key={`bank-parts-${bankIndex}`} className="bank-card">
                          <h3>{formatBankName(bank.name, bankIndex)} - Parts ({bank.parts.length})</h3>
                          <div className="parts-list">
                            {bank.parts.map((part) => (
                              <div key={part.id} className="part-card">
                                <h4>{part.name}</h4>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </section>
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
                  />

                  <TrackSelector
                    id="patterns-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                  />
                </div>

                <section className="banks-section">
                  {(() => {
                    // Determine which banks to display
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? banks.map((_, index) => index)
                      : [selectedBankIndex];

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

                                  return (
                                <div key={`pattern-${patternIndex}-track-${trackIndex}`} className="pattern-card">
                            <div className="pattern-header">
                              <span className="pattern-name">{pattern.name}</span>
                              <span className="pattern-part">→ Part {pattern.part_assignment + 1}</span>
                              <span className={`pattern-track-indicator ${trackData.track_type.toLowerCase()}`}>
                                T{trackData.track_id >= 8 ? trackData.track_id - 7 : trackData.track_id + 1}
                              </span>
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
                                          textDecoration: 'line-through',
                                          opacity: 0.6,
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
                            <div className="pattern-details">
                              <div className="pattern-detail-group trig-stats-row">
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Total Trigs:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.total}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Trigger:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.trigger}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Trigless:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.trigless}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">P-Locks:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.plock}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">One-Shot:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.oneshot}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Recorder:</span>
                                  <span className="pattern-detail-value">{trackData.steps.filter(step => step.recorder).length}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Slide:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.slide}</span>
                                </div>
                                <div className="pattern-detail-item">
                                  <span className="pattern-detail-label">Swing:</span>
                                  <span className="pattern-detail-value">{trackData.trig_counts.swing}</span>
                                </div>
                              </div>
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
                                    if (step.velocity !== null) tooltipParts.push(`Velocity: ${step.velocity}`);
                                    if (step.plock_count > 0) tooltipParts.push(`P-Locks: ${step.plock_count}`);
                                    if (step.sample_slot !== null) tooltipParts.push(`Sample: ${step.sample_slot}`);

                                    return (
                                      <div
                                        key={step.step}
                                        className={`pattern-step ${hasTrig ? 'has-trig' : ''} ${trigTypes.join(' ')} ${selectedStep?.step === step.step ? 'selected' : ''}`}
                                        title={tooltipParts.join('\n')}
                                        onClick={() => setSelectedStep(step)}
                                        style={{ cursor: 'pointer' }}
                                      >
                                        <div className="step-number">{step.step + 1}</div>
                                        {hasTrig && (
                                          <div className="step-indicators">
                                            {/* Primary trig indicators */}
                                            {/* Don't show trigger indicator on MIDI tracks if there are notes (including default note) */}
                                            {step.trigger && !(trackData.track_type === "MIDI" && allNotes.length > 0) && <span className="indicator-trigger">●</span>}
                                            {step.trigless && <span className="indicator-trigless">○</span>}
                                            {(step.plock || (step.plock_count > 0 && step.plock_count <= 1)) && <span className="indicator-plock">P</span>}
                                            {step.oneshot && <span className="indicator-oneshot">1</span>}
                                            {step.swing && <span className="indicator-swing">∿</span>}
                                            {step.slide && <span className="indicator-slide">~</span>}
                                            {step.recorder && <span className="indicator-recorder">R</span>}

                                            {/* Additional data indicators */}
                                            {step.trig_condition && <span className="indicator-condition">{step.trig_condition}</span>}
                                            {step.trig_repeats > 0 && <span className="indicator-repeats">{step.trig_repeats + 1}x</span>}
                                            {step.micro_timing && <span className="indicator-timing">{step.micro_timing}</span>}
                                            {step.velocity !== null && <span className="indicator-velocity">V{step.velocity}</span>}
                                            {step.plock_count > 1 && <span className="indicator-plock-count">{step.plock_count}p</span>}
                                            {step.sample_slot !== null && <span className="indicator-sample">S{step.sample_slot}</span>}
                                            {allNotes.length > 0 && (
                                              <div className="note-indicator-wrapper">
                                                {allNotes.map((note, idx) => (
                                                  <span key={idx} className={`indicator-note ${chordName ? 'indicator-chord' : ''}`}>
                                                    {noteName(note)}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Legend - only show indicators that are actually used */}
                                {usedIndicators.size > 0 && (
                                  <div className="pattern-grid-legend">
                                    {usedIndicators.has('trigger') && <div className="legend-item"><span className="indicator-trigger">●</span> Trigger</div>}
                                    {usedIndicators.has('trigless') && <div className="legend-item"><span className="indicator-trigless">○</span> Trigless</div>}
                                    {usedIndicators.has('plock') && <div className="legend-item"><span className="indicator-plock">P</span> P-Lock</div>}
                                    {usedIndicators.has('oneshot') && <div className="legend-item"><span className="indicator-oneshot">1</span> One-Shot</div>}
                                    {usedIndicators.has('swing') && <div className="legend-item"><span className="indicator-swing">∿</span> Swing</div>}
                                    {usedIndicators.has('slide') && <div className="legend-item"><span className="indicator-slide">~</span> Slide</div>}
                                    {usedIndicators.has('recorder') && <div className="legend-item"><span className="indicator-recorder">R</span> Recorder</div>}
                                    {usedIndicators.has('condition') && <div className="legend-item"><span className="indicator-condition">Fill</span> Condition</div>}
                                    {usedIndicators.has('repeats') && <div className="legend-item"><span className="indicator-repeats">2x</span> Repeats</div>}
                                    {usedIndicators.has('timing') && <div className="legend-item"><span className="indicator-timing">μ</span> Micro-timing</div>}
                                    {usedIndicators.has('note') && <div className="legend-item"><span className="indicator-note">C4</span> MIDI Note/Chord</div>}
                                    {usedIndicators.has('velocity') && <div className="legend-item"><span className="indicator-velocity">V</span> Velocity</div>}
                                    {usedIndicators.has('sample') && <div className="legend-item"><span className="indicator-sample">S</span> Sample</div>}
                                  </div>
                                )}

                                {/* Parameter Details Panel */}
                                {selectedStep && (
                                  <div className="parameter-details-panel">
                                    <div className="parameter-panel-header">
                                      <h4>Step {selectedStep.step + 1} - Parameter Locks</h4>
                                      <button onClick={() => setSelectedStep(null)} className="close-button">×</button>
                                    </div>
                                    <div className="parameter-panel-content">
                                      {selectedStep.audio_plocks && (
                                        <>
                                          {/* Machine Parameters */}
                                          {(selectedStep.audio_plocks.machine.param1 !== null ||
                                            selectedStep.audio_plocks.machine.param2 !== null ||
                                            selectedStep.audio_plocks.machine.param3 !== null ||
                                            selectedStep.audio_plocks.machine.param4 !== null ||
                                            selectedStep.audio_plocks.machine.param5 !== null ||
                                            selectedStep.audio_plocks.machine.param6 !== null) && (
                                            <div className="param-section">
                                              <h5>Machine Parameters</h5>
                                              <div className="param-grid">
                                                {selectedStep.audio_plocks.machine.param1 !== null && <div className="param-item"><span>PTCH (Pitch):</span> {selectedStep.audio_plocks.machine.param1}</div>}
                                                {selectedStep.audio_plocks.machine.param2 !== null && <div className="param-item"><span>STRT (Start):</span> {selectedStep.audio_plocks.machine.param2}</div>}
                                                {selectedStep.audio_plocks.machine.param3 !== null && <div className="param-item"><span>LEN (Length):</span> {selectedStep.audio_plocks.machine.param3}</div>}
                                                {selectedStep.audio_plocks.machine.param4 !== null && <div className="param-item"><span>RATE (Rate):</span> {selectedStep.audio_plocks.machine.param4}</div>}
                                                {selectedStep.audio_plocks.machine.param5 !== null && <div className="param-item"><span>RTRG (Retrigs):</span> {selectedStep.audio_plocks.machine.param5}</div>}
                                                {selectedStep.audio_plocks.machine.param6 !== null && <div className="param-item"><span>RTIM (Retrig Time):</span> {selectedStep.audio_plocks.machine.param6}</div>}
                                              </div>
                                            </div>
                                          )}

                                          {/* LFO Parameters */}
                                          {(selectedStep.audio_plocks.lfo.spd1 !== null ||
                                            selectedStep.audio_plocks.lfo.spd2 !== null ||
                                            selectedStep.audio_plocks.lfo.spd3 !== null ||
                                            selectedStep.audio_plocks.lfo.dep1 !== null ||
                                            selectedStep.audio_plocks.lfo.dep2 !== null ||
                                            selectedStep.audio_plocks.lfo.dep3 !== null) && (
                                            <div className="param-section">
                                              <h5>LFO Parameters</h5>
                                              <div className="param-grid">
                                                {selectedStep.audio_plocks.lfo.spd1 !== null && <div className="param-item"><span>LFO1 Speed:</span> {selectedStep.audio_plocks.lfo.spd1}</div>}
                                                {selectedStep.audio_plocks.lfo.spd2 !== null && <div className="param-item"><span>LFO2 Speed:</span> {selectedStep.audio_plocks.lfo.spd2}</div>}
                                                {selectedStep.audio_plocks.lfo.spd3 !== null && <div className="param-item"><span>LFO3 Speed:</span> {selectedStep.audio_plocks.lfo.spd3}</div>}
                                                {selectedStep.audio_plocks.lfo.dep1 !== null && <div className="param-item"><span>LFO1 Depth:</span> {selectedStep.audio_plocks.lfo.dep1}</div>}
                                                {selectedStep.audio_plocks.lfo.dep2 !== null && <div className="param-item"><span>LFO2 Depth:</span> {selectedStep.audio_plocks.lfo.dep2}</div>}
                                                {selectedStep.audio_plocks.lfo.dep3 !== null && <div className="param-item"><span>LFO3 Depth:</span> {selectedStep.audio_plocks.lfo.dep3}</div>}
                                              </div>
                                            </div>
                                          )}

                                          {/* Amp Parameters */}
                                          {(selectedStep.audio_plocks.amp.atk !== null ||
                                            selectedStep.audio_plocks.amp.hold !== null ||
                                            selectedStep.audio_plocks.amp.rel !== null ||
                                            selectedStep.audio_plocks.amp.vol !== null ||
                                            selectedStep.audio_plocks.amp.bal !== null ||
                                            selectedStep.audio_plocks.amp.f !== null) && (
                                            <div className="param-section">
                                              <h5>Amp Envelope</h5>
                                              <div className="param-grid">
                                                {selectedStep.audio_plocks.amp.atk !== null && <div className="param-item"><span>ATK (Attack):</span> {selectedStep.audio_plocks.amp.atk}</div>}
                                                {selectedStep.audio_plocks.amp.hold !== null && <div className="param-item"><span>HOLD (Hold):</span> {selectedStep.audio_plocks.amp.hold}</div>}
                                                {selectedStep.audio_plocks.amp.rel !== null && <div className="param-item"><span>REL (Release):</span> {selectedStep.audio_plocks.amp.rel}</div>}
                                                {selectedStep.audio_plocks.amp.vol !== null && <div className="param-item"><span>VOL (Volume):</span> {selectedStep.audio_plocks.amp.vol}</div>}
                                                {selectedStep.audio_plocks.amp.bal !== null && <div className="param-item"><span>BAL (Balance):</span> {selectedStep.audio_plocks.amp.bal}</div>}
                                                {selectedStep.audio_plocks.amp.f !== null && <div className="param-item"><span>FILT (Filter):</span> {selectedStep.audio_plocks.amp.f}</div>}
                                              </div>
                                            </div>
                                          )}

                                          {/* Sample Slots */}
                                          {(selectedStep.audio_plocks.static_slot_id !== null || selectedStep.audio_plocks.flex_slot_id !== null) && (
                                            <div className="param-section">
                                              <h5>Sample Slots</h5>
                                              <div className="param-grid">
                                                {selectedStep.audio_plocks.static_slot_id !== null && <div className="param-item"><span>Static Slot:</span> {selectedStep.audio_plocks.static_slot_id}</div>}
                                                {selectedStep.audio_plocks.flex_slot_id !== null && <div className="param-item"><span>Flex Slot:</span> {selectedStep.audio_plocks.flex_slot_id}</div>}
                                              </div>
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {/* MIDI track parameters - show even when no plocks if there are notes */}
                                      {trackData.track_type === "MIDI" && (() => {
                                        // Get all notes using the shared helper function
                                        const allNotes = getStepNotes(selectedStep, trackData);
                                        const hasMidiParams = allNotes.length > 0 ||
                                                              selectedStep.midi_plocks?.midi?.vel != null ||
                                                              selectedStep.midi_plocks?.midi?.len != null;
                                        const hasLfoParams = selectedStep.midi_plocks?.lfo?.spd1 != null ||
                                                             selectedStep.midi_plocks?.lfo?.spd2 != null ||
                                                             selectedStep.midi_plocks?.lfo?.spd3 != null ||
                                                             selectedStep.midi_plocks?.lfo?.dep1 != null ||
                                                             selectedStep.midi_plocks?.lfo?.dep2 != null ||
                                                             selectedStep.midi_plocks?.lfo?.dep3 != null;

                                        if (!hasMidiParams && !hasLfoParams) return null;

                                        return (
                                          <>
                                            {/* MIDI Parameters */}
                                            {hasMidiParams && (
                                              <div className="param-section">
                                                <h5>MIDI Parameters</h5>
                                                <div className="param-grid">
                                                  {allNotes.map((note, idx) => {
                                                    // Check if this note is the default note (not in midi_plocks)
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
                                                  {selectedStep.midi_plocks?.midi?.vel != null && <div className="param-item"><span>VEL (Velocity):</span> {selectedStep.midi_plocks?.midi?.vel}</div>}
                                                  {selectedStep.midi_plocks?.midi?.len != null && <div className="param-item"><span>LEN (Length):</span> {selectedStep.midi_plocks?.midi?.len}</div>}
                                              </div>
                                            </div>
                                          )}

                                          {/* LFO Parameters */}
                                          {hasLfoParams && selectedStep.midi_plocks && (
                                            <div className="param-section">
                                              <h5>LFO Parameters</h5>
                                              <div className="param-grid">
                                                {selectedStep.midi_plocks.lfo.spd1 !== null && <div className="param-item"><span>LFO1 Speed:</span> {selectedStep.midi_plocks.lfo.spd1}</div>}
                                                {selectedStep.midi_plocks.lfo.spd2 !== null && <div className="param-item"><span>LFO2 Speed:</span> {selectedStep.midi_plocks.lfo.spd2}</div>}
                                                {selectedStep.midi_plocks.lfo.spd3 !== null && <div className="param-item"><span>LFO3 Speed:</span> {selectedStep.midi_plocks.lfo.spd3}</div>}
                                                {selectedStep.midi_plocks.lfo.dep1 !== null && <div className="param-item"><span>LFO1 Depth:</span> {selectedStep.midi_plocks.lfo.dep1}</div>}
                                                {selectedStep.midi_plocks.lfo.dep2 !== null && <div className="param-item"><span>LFO2 Depth:</span> {selectedStep.midi_plocks.lfo.dep2}</div>}
                                                {selectedStep.midi_plocks.lfo.dep3 !== null && <div className="param-item"><span>LFO3 Depth:</span> {selectedStep.midi_plocks.lfo.dep3}</div>}
                                              </div>
                                            </div>
                                          )}
                                        </>
                                      );
                                      })()}

                                      {(() => {
                                        // Show "no parameter locks" message only when appropriate
                                        if (selectedStep.audio_plocks || selectedStep.midi_plocks) return null;
                                        // For MIDI tracks, also check if there are any notes (including default)
                                        if (trackData.track_type === "MIDI") {
                                          const allNotes = getStepNotes(selectedStep, trackData);
                                          if (allNotes.length > 0) return null;
                                        }
                                        return <p>No parameter locks on this step.</p>;
                                      })()}
                                    </div>
                                  </div>
                                )}
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
                </section>
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
                  />

                  <TrackSelector
                    id="track-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                  />
                </div>

                <section className="tracks-section">
                  {(() => {
                    // Determine which banks to display
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? banks.map((_, index) => index)
                      : [selectedBankIndex];

                    return banksToDisplay.map((bankIndex) => {
                      const bank = banks[bankIndex];
                      if (!bank) return null;

                      const pattern = bank.parts[0]?.patterns[selectedPatternIndex];
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
                          <h3>{formatBankName(bank.name, bankIndex)} - T{trackData.track_id >= 8 ? trackData.track_id - 7 : trackData.track_id + 1} ({trackData.track_type})</h3>
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
              </div>
            )}

            {activeTab === "flex-slots" && (
              <div className="samples-tab">
                <section className="samples-section">
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

            {activeTab === "static-slots" && (
              <div className="samples-tab">
                <section className="samples-section">
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
              </div>
            )}

          </div>
        </div>
      )}
    </main>
  );
}

export default ProjectDetail;
