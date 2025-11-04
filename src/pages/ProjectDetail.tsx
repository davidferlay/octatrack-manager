import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import "../App.css";

interface ProjectMetadata {
  name: string;
  tempo: number;
  swing: number;
  time_signature: string;
  pattern_length: number;
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

export function ProjectDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = searchParams.get("path");
  const projectName = searchParams.get("name");

  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <section className="metadata-section">
            <h2>Metadata</h2>
            <div className="metadata-grid">
              <div className="metadata-item">
                <span className="metadata-label">Tempo</span>
                <span className="metadata-value">{metadata.tempo} BPM</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Swing</span>
                <span className="metadata-value">{metadata.swing}%</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Time Signature</span>
                <span className="metadata-value">{metadata.time_signature}</span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Pattern Length</span>
                <span className="metadata-value">{metadata.pattern_length} steps</span>
              </div>
            </div>
          </section>

          <section className="banks-section">
            <h2>Banks ({banks.length})</h2>
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
    </main>
  );
}

export default ProjectDetail;
