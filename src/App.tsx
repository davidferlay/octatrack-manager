import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

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

function App() {
  const [locations, setLocations] = useState<OctatrackLocation[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [openLocations, setOpenLocations] = useState<Set<number>>(new Set());

  async function scanDevices() {
    setIsScanning(true);
    try {
      const foundLocations = await invoke<OctatrackLocation[]>("scan_devices");
      setLocations(foundLocations);
      setHasScanned(true);
      // Open all locations by default
      setOpenLocations(new Set(foundLocations.map((_, idx) => idx)));
    } catch (error) {
      console.error("Error scanning devices:", error);
    } finally {
      setIsScanning(false);
    }
  }

  function toggleLocation(index: number) {
    setOpenLocations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }

  function getDeviceTypeLabel(type: string): string {
    switch (type) {
      case "CompactFlash":
        return "CF Card";
      case "LocalCopy":
        return "Local Copy";
      case "Usb":
        return "USB";
      default:
        return type;
    }
  }

  return (
    <main className="container">
      <h1>Octatrack Manager</h1>
      <p className="subtitle">Discover and manage your Elektron Octatrack projects</p>

      <div className="scan-section">
        <button
          onClick={scanDevices}
          disabled={isScanning}
          className="scan-button"
        >
          {isScanning ? "Scanning..." : "Scan for Devices"}
        </button>
      </div>

      {hasScanned && locations.length === 0 && (
        <div className="no-devices">
          <p>No Octatrack content found.</p>
          <p className="hint">
            Make sure your Octatrack CF card is mounted or you have local copies in your home directory (Documents, Music, Downloads, etc.).
          </p>
        </div>
      )}

      {locations.length > 0 && (
        <div className="devices-list">
          <h2>Found {locations.length} location{locations.length > 1 ? 's' : ''}</h2>
          {locations.map((location, locIdx) => {
            const isOpen = openLocations.has(locIdx);
            return (
              <div key={locIdx} className={`location-card location-type-${location.device_type.toLowerCase()}`}>
                <div
                  className="location-header clickable"
                  onClick={() => toggleLocation(locIdx)}
                >
                  <div className="location-header-left">
                    <span className="collapse-indicator">{isOpen ? '▼' : '▶'}</span>
                    <h3>{location.name || "Untitled Location"}</h3>
                  </div>
                  <span className="device-type">{getDeviceTypeLabel(location.device_type)}</span>
                </div>
                <p className="location-path">
                  <strong>Path:</strong> {location.path}
                </p>

                {isOpen && location.sets.length > 0 && (
                <div className="sets-section">
                  <h4>Sets ({location.sets.length})</h4>
                  {location.sets.map((set, setIdx) => (
                    <div key={setIdx} className="set-card">
                      <div className="set-header">
                        <div className="set-name">{set.name}</div>
                        <div className="set-info">
                          <span className={set.has_audio_pool ? "status-yes" : "status-no"}>
                            {set.has_audio_pool ? "✓ Audio Pool" : "✗ Audio Pool"}
                          </span>
                          <span className="project-count">
                            {set.projects.length} Project{set.projects.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="set-path">{set.path}</div>

                      {set.projects.length > 0 && (
                        <div className="projects-grid">
                          {set.projects.map((project, projIdx) => (
                            <div key={projIdx} className="project-card">
                              <div className="project-name">{project.name}</div>
                              <div className="project-info">
                                <span className={project.has_project_file ? "status-yes" : "status-no"}>
                                  {project.has_project_file ? "✓ Project" : "✗ Project"}
                                </span>
                                <span className={project.has_banks ? "status-yes" : "status-no"}>
                                  {project.has_banks ? "✓ Banks" : "✗ Banks"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default App;
