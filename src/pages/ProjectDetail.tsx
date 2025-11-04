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

interface Pattern {
  id: number;
  name: string;
  length: number;
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
                <section className="banks-section">
                  {banks.map((bank) => (
                    <div key={bank.id} className="bank-card">
                      <h3>{bank.name}</h3>
                      <div className="parts-list">
                        {bank.parts.map((part) => (
                          <div key={part.id} className="part-card">
                            <h4>{part.name}</h4>
                            <div className="patterns-list">
                              {part.patterns.map((pattern) => (
                                <div key={pattern.id} className="pattern-card">
                                  <span className="pattern-name">{pattern.name}</span>
                                  <span className="pattern-length">{pattern.length} steps</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
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
