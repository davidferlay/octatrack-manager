import { useState, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../context/ProjectsContext";
import { Version } from "../components/Version";
import { ScrollToTop } from "../components/ScrollToTop";
import "../App.css";

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

interface ScanResult {
  locations: OctatrackLocation[];
  standalone_projects: OctatrackProject[];
}

export function HomePage() {
  const {
    locations,
    standaloneProjects,
    hasScanned,
    openLocations,
    isIndividualProjectsOpen,
    isLocationsOpen,
    setLocations,
    setStandaloneProjects,
    setHasScanned,
    setOpenLocations,
    setIsIndividualProjectsOpen,
    setIsLocationsOpen,
  } = useProjects();
  const [isScanning, setIsScanning] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  // Helper to sort projects within a location's sets
  function sortProjectsInLocations(locations: OctatrackLocation[]): OctatrackLocation[] {
    return locations.map(loc => ({
      ...loc,
      sets: loc.sets.map(set => ({
        ...set,
        projects: [...set.projects].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        )
      }))
    }));
  }

  async function scanDevices() {
    setIsScanning(true);
    try {
      const result = await invoke<ScanResult>("scan_devices");
      // Sort locations alphabetically by name and projects within each set
      const sortedLocations = sortProjectsInLocations(
        [...result.locations].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        )
      );
      // Sort standalone projects alphabetically
      const sortedStandaloneProjects = [...result.standalone_projects].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      setLocations(sortedLocations);
      setStandaloneProjects(sortedStandaloneProjects);
      setHasScanned(true);
      // Open all locations by default
      setOpenLocations(new Set(sortedLocations.map((_, idx) => idx)));
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

  async function browseDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Octatrack Directory"
      });

      if (selected) {
        setIsScanning(true);
        try {
          const result = await invoke<ScanResult>("scan_custom_directory", { path: selected });

          // Merge with existing locations, avoiding duplicates based on path
          setLocations(prev => {
            const existingPaths = new Set(prev.map(loc => loc.path));
            const newLocations = result.locations.filter(loc => !existingPaths.has(loc.path));
            const merged = [...prev, ...newLocations];

            // Sort locations alphabetically by name and projects within each set
            const sortedMerged = sortProjectsInLocations(
              merged.sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
              )
            );

            // Update open locations to include new ones
            setOpenLocations(new Set(sortedMerged.map((_, idx) => idx)));

            return sortedMerged;
          });

          // Merge standalone projects, avoiding duplicates, then sort
          setStandaloneProjects(prev => {
            const existingPaths = new Set(prev.map(proj => proj.path));
            const newProjects = result.standalone_projects.filter(proj => !existingPaths.has(proj.path));
            return [...prev, ...newProjects].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            );
          });

          setHasScanned(true);
        } catch (error) {
          console.error("Error scanning directory:", error);
        } finally {
          setIsScanning(false);
        }
      }
    } catch (error) {
      console.error("Error opening directory dialog:", error);
    }
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

  function handleRefresh() {
    // Trigger spin animation
    setIsSpinning(true);
    setTimeout(() => setIsSpinning(false), 600);

    // Clear existing data
    setLocations([]);
    setStandaloneProjects([]);
    setOpenLocations(new Set());
    setHasScanned(false);
  }

  return (
    <main className="container">
      <div className="project-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1' }}>
          <h1>Octatrack Manager</h1>
          <span className="header-path-info">Discover and manage your Elektron Octatrack projects</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={handleRefresh}
            className={`toolbar-button ${isSpinning ? 'refreshing' : ''}`}
            disabled={isScanning}
            title="Refresh projects list"
          >
            <i className="fas fa-sync-alt"></i>
          </button>
          <Version />
        </div>
      </div>

      <div className="scan-section">
        <button
          onClick={scanDevices}
          disabled={isScanning}
          className="scan-button"
        >
          {isScanning ? "Scanning..." : "Scan for Projects"}
        </button>
        <button
          onClick={browseDirectory}
          disabled={isScanning}
          className="scan-button browse-button"
        >
          Browse...
        </button>
      </div>

      {hasScanned && locations.length === 0 && standaloneProjects.length === 0 && (
        <div className="no-devices">
          <p>No Octatrack content found.</p>
          <p className="hint">
            Make sure your Octatrack CF card is mounted or you have local copies in your home directory (Documents, Music, Downloads, etc.).
          </p>
        </div>
      )}

      {(locations.length > 0 || standaloneProjects.length > 0) && (
        <div className="devices-list">
          {standaloneProjects.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2
                className="clickable"
                onClick={() => setIsIndividualProjectsOpen(!isIndividualProjectsOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
              >
                <span>{isIndividualProjectsOpen ? '▼' : '▶'}</span>
                Found {standaloneProjects.length} individual project{standaloneProjects.length > 1 ? 's' : ''}
              </h2>
              <div className={`sets-section ${isIndividualProjectsOpen ? 'open' : 'closed'}`}>
                <div className="sets-section-content">
                  <div className="projects-grid">
                    {[...standaloneProjects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map((project, projIdx) => (
                    <div
                      key={projIdx}
                      className="project-card clickable-project"
                      onClick={() => {
                        startTransition(() => {
                          navigate(`/project?path=${encodeURIComponent(project.path)}&name=${encodeURIComponent(project.name)}`);
                        });
                      }}
                      title="Click to view project details"
                    >
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
                </div>
              </div>
            </div>
          )}

          {locations.length > 0 && (
            <>
              <h2
                className="clickable"
                onClick={() => setIsLocationsOpen(!isLocationsOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
              >
                <span>{isLocationsOpen ? '▼' : '▶'}</span>
                Found {locations.length} location{locations.length > 1 ? 's' : ''}
              </h2>
              <div className={`sets-section ${isLocationsOpen ? 'open' : 'closed'}`}>
                <div className="sets-section-content">
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
                            <span className="location-path-inline">{location.path}</span>
                          </div>
                          <div className="location-header-right">
                            <span className="device-type">{getDeviceTypeLabel(location.device_type)}</span>
                            <span className="sets-count">{location.sets.length} Set{location.sets.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>

                        {location.sets.length > 0 && (
                          <div className={`sets-section ${isOpen ? 'open' : 'closed'}`}>
                            <div className="sets-section-content">
                              {location.sets.map((set, setIdx) => (
                                <div key={setIdx} className="set-card" title={set.path}>
                                  <div className="set-header">
                                    <div className="set-name">{set.name}</div>
                                    <div className="set-info">
                                      <span className={set.has_audio_pool ? "status-audio-pool" : "status-audio-pool-empty"}>
                                        {set.has_audio_pool ? "✓ Audio Pool" : "✗ Audio Pool"}
                                      </span>
                                      <span className="project-count">
                                        {set.projects.length} Project{set.projects.length !== 1 ? 's' : ''}
                                      </span>
                                    </div>
                                  </div>

                                  {set.projects.length > 0 && (
                                    <div className="projects-grid">
                                      <div
                                        className={`audio-pool-card ${!set.has_audio_pool ? 'audio-pool-empty' : ''}`}
                                        onClick={() => {
                                          startTransition(() => {
                                            navigate(`/audio-pool?path=${encodeURIComponent(set.path + '/AUDIO')}&name=${encodeURIComponent(set.name)}`);
                                          });
                                        }}
                                        title={set.has_audio_pool ? "Audio Pool - Click to view samples" : "Audio Pool - No samples found"}
                                      >
                                        <div className="audio-pool-name">Audio Pool</div>
                                        <div className="audio-pool-info">
                                          <span>{set.has_audio_pool ? "SAMPLES" : "NO SAMPLE"}</span>
                                        </div>
                                      </div>
                                      {[...set.projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map((project, projIdx) => (
                                        <div
                                          key={projIdx}
                                          className="project-card clickable-project"
                                          onClick={() => {
                                            startTransition(() => {
                                              navigate(`/project?path=${encodeURIComponent(project.path)}&name=${encodeURIComponent(project.name)}`);
                                            });
                                          }}
                                          title="Click to view project details"
                                        >
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
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
      <ScrollToTop />
    </main>
  );
}
