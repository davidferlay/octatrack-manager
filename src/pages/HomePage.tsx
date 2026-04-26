import { useState, useTransition, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../context/ProjectsContext";
import { Version } from "../components/Version";
import { ScrollToTop } from "../components/ScrollToTop";
import { ProjectGrid } from "../components/ProjectGrid";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog";
import { RenameProjectModal } from "../components/RenameProjectModal";
import { ProjectContextMenu } from "../components/ProjectContextMenu";
import type {
  ClipboardState,
  ContextMenuState,
  DraggedProject,
  OctatrackProject,
  OctatrackSet,
} from "../types/projectManagement";
import "../App.css";

// Natural sort comparator: "Project_2" < "Project_10" (not lexicographic)
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
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
    openSets,
    isIndividualProjectsOpen,
    isLocationsOpen,
    setLocations,
    setStandaloneProjects,
    setHasScanned,
    setOpenLocations,
    setOpenSets,
    setIsIndividualProjectsOpen,
    setIsLocationsOpen,
  } = useProjects();
  const [isScanning, setIsScanning] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  // Project management state
  const [createModalTarget, setCreateModalTarget] = useState<{ setPath: string; setName: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ project: OctatrackProject; setName: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [renamingProject, setRenamingProject] = useState<{ project: OctatrackProject; setPath: string } | null>(null);
  const [draggedProject, setDraggedProject] = useState<DraggedProject | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  function copyToClipboard(path: string, name: string) {
    setClipboard({ path, name });
    setCopyToast(name);
    setTimeout(() => setCopyToast(null), 1500);
  }

  // Suppress the native Tauri WebView context menu on this page.
  // React's synthetic onContextMenu + preventDefault() doesn't suppress
  // the native WebView menu, so we need a real DOM listener.
  // Individual component handlers (ProjectGrid cards, set grids, standalone cards)
  // also attach their own native listeners that stopPropagation + set state.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    function handler(e: MouseEvent) {
      e.preventDefault();
    }
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
  }, []);

  // Helper to sort projects within a location's sets
  function sortProjectsInLocations(locations: OctatrackLocation[]): OctatrackLocation[] {
    return locations.map(loc => ({
      ...loc,
      sets: loc.sets.map(set => ({
        ...set,
        projects: [...set.projects].sort((a, b) =>
          naturalCompare(a.name, b.name)
        )
      }))
    }));
  }

  async function rescanSet(setPath: string) {
    try {
      const updatedSet = await invoke<OctatrackSet>('rescan_set', { setPath });
      setLocations((prev) =>
        prev.map((loc) => ({
          ...loc,
          sets: loc.sets.map((s) => (s.path === setPath ? updatedSet : s)),
        }))
      );
    } catch (err) {
      console.error('rescan_set failed', err);
    }
  }

  async function scanDevices() {
    setIsScanning(true);
    try {
      const result = await invoke<ScanResult>("scan_devices");
      // Sort locations alphabetically by name and projects within each set
      const sortedLocations = sortProjectsInLocations(
        [...result.locations].sort((a, b) =>
          naturalCompare(a.name, b.name)
        )
      );
      // Sort standalone projects alphabetically
      const sortedStandaloneProjects = [...result.standalone_projects].sort((a, b) =>
        naturalCompare(a.name, b.name)
      );
      setLocations(sortedLocations);
      setStandaloneProjects(sortedStandaloneProjects);
      setHasScanned(true);
      // Open all locations by default
      setOpenLocations(new Set(sortedLocations.map((_, idx) => idx)));

      // Auto-open first set that has projects
      let foundFirstSet = false;
      for (let locIdx = 0; locIdx < sortedLocations.length; locIdx++) {
        const loc = sortedLocations[locIdx];
        const sortedSets = [...loc.sets].sort((a, b) => {
          const aIsPresets = a.name.toLowerCase() === 'presets';
          const bIsPresets = b.name.toLowerCase() === 'presets';
          if (aIsPresets && !bIsPresets) return 1;
          if (!aIsPresets && bIsPresets) return -1;
          return 0;
        });
        for (const set of sortedSets) {
          if (set.projects.length > 0) {
            setOpenSets(new Set([`${locIdx}-${set.name}`]));
            setIsIndividualProjectsOpen(false);
            foundFirstSet = true;
            break;
          }
        }
        if (foundFirstSet) break;
      }

      // If no set with projects found, open Individual Projects if any exist
      if (!foundFirstSet && sortedStandaloneProjects.length > 0) {
        setIsIndividualProjectsOpen(true);
      }
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
                naturalCompare(a.name, b.name)
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
              naturalCompare(a.name, b.name)
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
    <main className="container" ref={pageRef}>
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
                {standaloneProjects.length} Individual Project{standaloneProjects.length > 1 ? 's' : ''}
              </h2>
              <div className={`sets-section ${isIndividualProjectsOpen ? 'open' : 'closed'}`}>
                <div className="sets-section-content">
                  <div className="projects-grid">
                    {[...standaloneProjects].sort((a, b) => naturalCompare(a.name, b.name)).map((project, projIdx) => (
                    <div
                      key={projIdx}
                      className="project-card clickable-project"
                      tabIndex={0}
                      onClick={() => {
                        startTransition(() => {
                          navigate(`/project?path=${encodeURIComponent(project.path)}&name=${encodeURIComponent(project.name)}`);
                        });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const setPath = project.path.substring(0, project.path.lastIndexOf('/'));
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          target: { kind: 'project', project, setPath, setName: 'Individual Projects' },
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'F2') {
                          e.preventDefault();
                          const setPath = project.path.substring(0, project.path.lastIndexOf('/'));
                          setRenamingProject({ project, setPath });
                        } else if (e.key === 'Delete') {
                          e.preventDefault();
                          setDeleteTarget({ project, setName: 'Individual Projects' });
                        } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          copyToClipboard(project.path, project.name);
                        } else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
                          const cards = Array.from(
                            e.currentTarget.parentElement?.querySelectorAll('.project-card') ?? []
                          ) as HTMLElement[];
                          const idx = cards.indexOf(e.currentTarget);
                          if (idx === -1) return;
                          let target: HTMLElement | undefined;
                          if (e.key === 'ArrowRight') target = cards[idx + 1] ?? cards[0];
                          else if (e.key === 'ArrowLeft') target = cards[idx - 1] ?? cards[cards.length - 1];
                          else {
                            const cols = cards.filter(c => c.offsetTop === cards[0].offsetTop).length;
                            if (e.key === 'ArrowDown') target = cards[idx + cols] ?? cards[cards.length - 1];
                            else target = cards[idx - cols] ?? cards[0];
                          }
                          e.preventDefault();
                          target?.focus();
                        }
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
                {locations.length} Location{locations.length > 1 ? 's' : ''}
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
                              {[...location.sets].sort((a, b) => {
                                const aIsPresets = a.name.toLowerCase() === 'presets';
                                const bIsPresets = b.name.toLowerCase() === 'presets';
                                if (aIsPresets && !bIsPresets) return 1;
                                if (!aIsPresets && bIsPresets) return -1;
                                return 0;
                              }).map((set, setIdx) => {
                                const setKey = `${locIdx}-${set.name}`;
                                const isSetOpen = openSets.has(setKey);
                                return (
                                <div key={setIdx} className="set-card" title={set.path}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    // Don't show set menu when clicking on a project card (handled by ProjectGrid)
                                    if ((e.target as HTMLElement).closest('.project-card')) return;
                                    setContextMenu({
                                      x: e.clientX,
                                      y: e.clientY,
                                      target: { kind: 'set', setPath: set.path, setName: set.name },
                                    });
                                  }}
                                >
                                  <div
                                    className="set-header clickable"
                                    onClick={() => {
                                      setOpenSets(prev => {
                                        const next = new Set(prev);
                                        if (next.has(setKey)) {
                                          next.delete(setKey);
                                        } else {
                                          next.add(setKey);
                                        }
                                        return next;
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
                                        {set.projects.length} Project{set.projects.length !== 1 ? 's' : ''}
                                      </span>
                                    </div>
                                  </div>

                                  {(set.projects.length > 0 || true) && (
                                    <div className={`sets-section ${isSetOpen ? 'open' : 'closed'}`}>
                                      <div className="sets-section-content">
                                        <div
                                          className="projects-grid"
                                          onContextMenu={(e) => {
                                            e.preventDefault();
                                            // Only show Set menu when clicking on grid background, not on a project card
                                            if ((e.target as HTMLElement).closest('.project-card')) return;
                                            setContextMenu({
                                              x: e.clientX,
                                              y: e.clientY,
                                              target: { kind: 'set', setPath: set.path, setName: set.name },
                                            });
                                          }}
                                          onDragOver={(e) => {
                                            if (draggedProject && draggedProject.sourceSetPath !== set.path) {
                                              e.preventDefault();
                                              e.dataTransfer.dropEffect = 'move';
                                            }
                                          }}
                                          onDrop={(e) => {
                                            if (!draggedProject || draggedProject.sourceSetPath === set.path) return;
                                            e.preventDefault();
                                            const sourceProjectPath = draggedProject.path;
                                            const sourceSetPath = draggedProject.sourceSetPath;
                                            setDraggedProject(null);
                                            (async () => {
                                              try {
                                                await invoke('move_project', { srcPath: sourceProjectPath, destSetPath: set.path });
                                                await rescanSet(sourceSetPath);
                                                await rescanSet(set.path);
                                              } catch (err) {
                                                alert(`Move failed: ${err}`);
                                              }
                                            })();
                                          }}
                                        >
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
                                          <ProjectGrid
                                            setPath={set.path}
                                            setName={set.name}
                                            projects={[...set.projects].sort((a, b) => naturalCompare(a.name, b.name))}
                                            onProjectClick={(p) => {
                                              startTransition(() => {
                                                navigate(`/project?path=${encodeURIComponent(p.path)}&name=${encodeURIComponent(p.name)}`);
                                              });
                                            }}
                                            onCreateNew={() => setCreateModalTarget({ setPath: set.path, setName: set.name })}
                                            onContextMenu={setContextMenu}
                                            draggedProject={draggedProject ? { path: draggedProject.path, sourceSetPath: draggedProject.sourceSetPath } : null}
                                            onDragStart={(p) => setDraggedProject({ path: p.path, name: p.name, sourceSetPath: set.path })}
                                            onDragEnd={() => setDraggedProject(null)}
                                            onDropOnSet={async (sourceProjectPath, sourceSetPath, destSetPath) => {
                                              setDraggedProject(null);
                                              try {
                                                await invoke('move_project', { srcPath: sourceProjectPath, destSetPath });
                                                await rescanSet(sourceSetPath);
                                                await rescanSet(destSetPath);
                                              } catch (err) {
                                                alert(`Move failed: ${err}`);
                                              }
                                            }}
                                            clipboard={clipboard}
                                            onCopy={(p) => copyToClipboard(p.path, p.name)}
                                            onPaste={async () => {
                                              if (!clipboard) return;
                                              try {
                                                await invoke('copy_project', { srcPath: clipboard.path, destSetPath: set.path });
                                                await rescanSet(set.path);
                                              } catch (err) {
                                                alert(`Paste failed: ${err}`);
                                              }
                                            }}
                                            onDeleteRequest={(p) => setDeleteTarget({ project: p, setName: set.name })}
                                            onRenameRequest={(p) => setRenamingProject({ project: p, setPath: set.path })}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                );
                              })}
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

      {contextMenu && (
        <ProjectContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={contextMenu.target}
          clipboard={clipboard}
          onCopy={() => {
            if (contextMenu.target.kind === 'project') {
              copyToClipboard(
                contextMenu.target.project.path,
                contextMenu.target.project.name,
              );
            }
          }}
          onRename={() => {
            if (contextMenu.target.kind === 'project') {
              setRenamingProject({ project: contextMenu.target.project, setPath: contextMenu.target.setPath });
            }
          }}
          onDelete={() => {
            if (contextMenu.target.kind === 'project') {
              setDeleteTarget({
                project: contextMenu.target.project,
                setName: contextMenu.target.setName,
              });
            }
          }}
          onOpenInFileManager={() => {
            if (contextMenu.target.kind === 'project') {
              invoke('open_in_file_manager', { path: contextMenu.target.project.path });
            }
          }}
          onPaste={async () => {
            if (!clipboard) return;
            const setPath = contextMenu.target.setPath;
            try {
              await invoke('copy_project', {
                srcPath: clipboard.path,
                destSetPath: setPath,
              });
              await rescanSet(setPath);
            } catch (err) {
              alert(`Paste failed: ${err}`);
            }
          }}
          onCreateNew={() => {
            if (contextMenu.target.kind === 'set') {
              setCreateModalTarget({
                setPath: contextMenu.target.setPath,
                setName: contextMenu.target.setName,
              });
            }
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {createModalTarget && (
        <CreateProjectModal
          setPath={createModalTarget.setPath}
          setName={createModalTarget.setName}
          existingNames={
            locations
              .flatMap((l) => l.sets)
              .find((s) => s.path === createModalTarget.setPath)?.projects.map((p) => p.name) ?? []
          }
          onConfirm={async (name) => {
            try {
              await invoke<string>('create_project', { setPath: createModalTarget.setPath, name });
              await rescanSet(createModalTarget.setPath);
            } catch (err) {
              alert(`Create failed: ${err}`);
            }
            setCreateModalTarget(null);
          }}
          onCancel={() => setCreateModalTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteProjectDialog
          projectName={deleteTarget.project.name}
          setName={deleteTarget.setName}
          onConfirm={async () => {
            try {
              await invoke('delete_project', { projectPath: deleteTarget.project.path });
              const setPath = deleteTarget.project.path.substring(
                0,
                deleteTarget.project.path.lastIndexOf('/')
              );
              await rescanSet(setPath);
            } catch (err) {
              alert(`Delete failed: ${err}`);
            }
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {renamingProject && (
        <RenameProjectModal
          projectName={renamingProject.project.name}
          onConfirm={async (newName) => {
            setRenamingProject(null);
            try {
              await invoke('rename_project', { projectPath: renamingProject.project.path, newName });
              await rescanSet(renamingProject.setPath);
            } catch (err) {
              alert(`Rename failed: ${err}`);
            }
          }}
          onCancel={() => setRenamingProject(null)}
        />
      )}

      <ScrollToTop />

      {copyToast && (
        <div className="copy-toast">
          <i className="fas fa-copy"></i> Copied "{copyToast}"
        </div>
      )}
    </main>
  );
}
