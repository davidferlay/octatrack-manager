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
import { CopyProgressModal } from "../components/CopyProgressModal";
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
    closedStandaloneGroups,
    setClosedStandaloneGroups,
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
  const [toast, setToast] = useState<{ message: string; icon: string; type?: 'warning' } | null>(null);
  const [copyProgress, setCopyProgress] = useState<{ transferId: string; label: string; command: string; commandArgs: Record<string, unknown>; setPath?: string; locationPath?: string } | null>(null);
  const [renamingSet, setRenamingSet] = useState<{ setPath: string; setName: string; locationPath: string } | null>(null);
  const [deleteSetTarget, setDeleteSetTarget] = useState<{ setPath: string; setName: string; locationPath: string } | null>(null);
  const [createSetTarget, setCreateSetTarget] = useState<{ locationPath: string; locationName: string } | null>(null);
  const pageRef = useRef<HTMLElement>(null);

  function copyToClipboard(path: string, name: string) {
    setClipboard({ kind: 'project', path, name });
    showToast(`Copied "${name}"`, 'fa-copy');
  }

  function copySetToClipboard(path: string, name: string) {
    setClipboard({ kind: 'set', path, name });
    showToast(`Copied set "${name}"`, 'fa-copy');
  }

  function showToast(message: string, icon: string) {
    setToast({ message, icon });
    setTimeout(() => setToast(null), 1500);
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
          {standaloneProjects.length > 0 && (() => {
            // Group standalone projects by parent directory
            const byParent = new Map<string, OctatrackProject[]>();
            for (const project of standaloneProjects) {
              const parentDir = project.path.substring(0, project.path.lastIndexOf('/'));
              const group = byParent.get(parentDir);
              if (group) group.push(project);
              else byParent.set(parentDir, [project]);
            }
            // Split: multi-project groups vs lone projects → "Other Locations"
            const multiGroups: [string, OctatrackProject[]][] = [];
            const loneProjects: OctatrackProject[] = [];
            for (const [dir, projects] of byParent) {
              if (projects.length > 1) multiGroups.push([dir, projects]);
              else loneProjects.push(projects[0]);
            }
            multiGroups.sort((a, b) => naturalCompare(a[0], b[0]));
            loneProjects.sort((a, b) => naturalCompare(a.name, b.name));

            const renderProjectCard = (project: OctatrackProject, key: string) => (
              <div
                key={key}
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
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    startTransition(() => {
                      navigate(`/project?path=${encodeURIComponent(project.path)}&name=${encodeURIComponent(project.name)}`);
                    });
                  } else if (e.key === 'F2') {
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
                      e.currentTarget.parentElement?.querySelectorAll('.project-card.clickable-project') ?? []
                    ) as HTMLElement[];
                    const idx = cards.indexOf(e.currentTarget);
                    if (idx === -1) return;
                    let target: HTMLElement | undefined;
                    const currentLeft = e.currentTarget.offsetLeft;
                    const currentTop = e.currentTarget.offsetTop;
                    if (e.key === 'ArrowRight') target = cards[idx + 1] ?? cards[0];
                    else if (e.key === 'ArrowLeft') target = cards[idx - 1] ?? cards[cards.length - 1];
                    else if (e.key === 'ArrowDown') {
                      const below = cards.filter(c => c.offsetTop > currentTop + 10);
                      if (below.length > 0) {
                        const nextRowTop = below[0].offsetTop;
                        const nextRow = below.filter(c => Math.abs(c.offsetTop - nextRowTop) < 10);
                        target = nextRow.reduce((best, c) => Math.abs(c.offsetLeft - currentLeft) < Math.abs(best.offsetLeft - currentLeft) ? c : best);
                      } else {
                        target = cards[cards.length - 1];
                      }
                    } else {
                      const above = cards.filter(c => c.offsetTop < currentTop - 10);
                      if (above.length > 0) {
                        const prevRowTop = above[above.length - 1].offsetTop;
                        const prevRow = above.filter(c => Math.abs(c.offsetTop - prevRowTop) < 10);
                        target = prevRow.reduce((best, c) => Math.abs(c.offsetLeft - currentLeft) < Math.abs(best.offsetLeft - currentLeft) ? c : best);
                      } else {
                        target = cards[0];
                      }
                    }
                    e.preventDefault();
                    target?.focus();
                  }
                }}
                title={`Click to view project details:\n${project.path}`}
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
            );

            const toggleGroup = (key: string) => {
              setClosedStandaloneGroups(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            };

            return (
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
                  {multiGroups.map(([dir, projects]) => {
                    const isOpen = !closedStandaloneGroups.has(dir);
                    return (
                    <div key={dir} className="standalone-group"
                      onContextMenu={(e) => {
                        if ((e.target as HTMLElement).closest('.project-card')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          target: { kind: 'standaloneGroup', locationPath: dir, locationName: dir.substring(dir.lastIndexOf('/') + 1) || dir },
                        });
                      }}
                    >
                      <div className="standalone-group-label clickable"
                        onClick={() => toggleGroup(dir)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            target: { kind: 'standaloneGroup', locationPath: dir, locationName: dir.substring(dir.lastIndexOf('/') + 1) || dir },
                          });
                        }}
                        title={dir}
                      >
                        {dir.substring(dir.lastIndexOf('/') + 1) || dir}
                        <span style={{ opacity: 0.5, marginLeft: '0.5rem', textTransform: 'none', fontFamily: 'inherit', letterSpacing: 0 }}>
                          — {projects.length} project{projects.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className={`standalone-group-content ${isOpen ? '' : 'closed'}`}>
                        <div className="standalone-group-content-inner">
                      <div className="projects-grid">
                        {[...projects].sort((a, b) => naturalCompare(a.name, b.name)).map((project) =>
                          renderProjectCard(project, project.path)
                        )}
                      </div>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  {loneProjects.length > 0 && (() => {
                    const isOpen = !closedStandaloneGroups.has('__other__');
                    return (
                    <div className="standalone-group">
                      <div className="standalone-group-label clickable" onClick={() => toggleGroup('__other__')}>
                        Other Locations
                        <span style={{ opacity: 0.5, marginLeft: '0.5rem', textTransform: 'none', fontFamily: 'inherit', letterSpacing: 0 }}>
                          — {loneProjects.length} project{loneProjects.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className={`standalone-group-content ${isOpen ? '' : 'closed'}`}>
                        <div className="standalone-group-content-inner">
                      <div className="projects-grid">
                        {loneProjects.map((project) =>
                          renderProjectCard(project, project.path)
                        )}
                      </div>
                        </div>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            );
          })()}

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
                      <div key={locIdx} className={`location-card location-type-${location.device_type.toLowerCase()}`}
                        onContextMenu={(e) => {
                          // Show location context menu on any location-card background area
                          if ((e.target as HTMLElement).closest('.set-card') || (e.target as HTMLElement).closest('.location-header')) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            target: { kind: 'location', locationPath: location.path, locationName: location.name },
                          });
                        }}
                      >
                        <div
                          className="location-header clickable"
                          onClick={() => toggleLocation(locIdx)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              target: { kind: 'location', locationPath: location.path, locationName: location.name },
                            });
                          }}
                        >
                          <div className="location-header-left">
                            <span className="collapse-indicator">{isOpen ? '▼' : '▶'}</span>
                            <h3>{location.name || "Untitled Location"}</h3>
                            <span className="location-path-inline">{location.path}</span>
                          </div>
                          <div className="location-header-right">
                            <button
                              className="location-add-set-btn"
                              title="Create new set"
                              aria-label={`New set in ${location.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCreateSetTarget({ locationPath: location.path, locationName: location.name });
                              }}
                            >
                              <i className="fas fa-plus"></i>
                            </button>
                            <span className="device-type">{getDeviceTypeLabel(location.device_type)}</span>
                            <span className="sets-count">{location.sets.length} Set{location.sets.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>

                        {location.sets.length > 0 && (
                          <div className={`sets-section ${isOpen ? 'open' : 'closed'}`}>
                            <div className="sets-section-content"
                              onContextMenu={(e) => {
                                // Show location context menu when clicking on background between set cards
                                if ((e.target as HTMLElement).closest('.set-card')) return;
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  target: { kind: 'location', locationPath: location.path, locationName: location.name },
                                });
                              }}
                            >
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
                                  onDragOver={(e) => {
                                    if (e.dataTransfer.types.includes('text/plain') &&
                                        (!draggedProject || draggedProject.sourceSetPath !== set.path)) {
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = 'move';
                                    }
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const raw = e.dataTransfer.getData('application/x-otm-project');
                                    const data = raw ? JSON.parse(raw) : draggedProject;
                                    if (!data || data.sourceSetPath === set.path) return;
                                    const sourceProjectPath = data.path;
                                    const sourceSetPath = data.sourceSetPath;
                                    setDraggedProject(null);
                                    (async () => {
                                      try {
                                        await invoke('move_project', { srcPath: sourceProjectPath, destSetPath: set.path });
                                        await rescanSet(sourceSetPath);
                                        await rescanSet(set.path);
                                      } catch (err) {
                                        setToast({ message: `Move failed: ${err}`, icon: 'fa-exclamation-triangle', type: 'warning' });
                                        setTimeout(() => setToast(null), 3000);
                                      }
                                    })();
                                  }}
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
                                            if (e.dataTransfer.types.includes('text/plain') &&
                                                (!draggedProject || draggedProject.sourceSetPath !== set.path)) {
                                              e.preventDefault();
                                              e.dataTransfer.dropEffect = 'move';
                                            }
                                          }}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const raw = e.dataTransfer.getData('application/x-otm-project');
                                            const data = raw ? JSON.parse(raw) : draggedProject;
                                            if (!data || data.sourceSetPath === set.path) return;
                                            const sourceProjectPath = data.path;
                                            const sourceSetPath = data.sourceSetPath;
                                            setDraggedProject(null);
                                            (async () => {
                                              try {
                                                await invoke('move_project', { srcPath: sourceProjectPath, destSetPath: set.path });
                                                await rescanSet(sourceSetPath);
                                                await rescanSet(set.path);
                                              } catch (err) {
                                                setToast({ message: `Move failed: ${err}`, icon: 'fa-exclamation-triangle', type: 'warning' });
                                                setTimeout(() => setToast(null), 3000);
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
                                                setToast({ message: `Move failed: ${err}`, icon: 'fa-exclamation-triangle', type: 'warning' });
                                                setTimeout(() => setToast(null), 3000);
                                              }
                                            }}
                                            clipboard={clipboard}
                                            onCopy={(p) => copyToClipboard(p.path, p.name)}
                                            onPaste={() => {
                                              if (!clipboard || clipboard.kind !== 'project') return;
                                              const transferId = crypto.randomUUID();
                                              setCopyProgress({
                                                transferId,
                                                label: `Copying project ${clipboard.name}...`,
                                                command: 'copy_project_with_progress',
                                                commandArgs: { srcPath: clipboard.path, destSetPath: set.path },
                                                setPath: set.path,
                                              });
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
          onCopySet={() => {
            if (contextMenu.target.kind === 'set') {
              copySetToClipboard(contextMenu.target.setPath, contextMenu.target.setName);
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
            } else if (contextMenu.target.kind === 'set') {
              invoke('open_in_file_manager', { path: contextMenu.target.setPath });
            } else if (contextMenu.target.kind === 'location') {
              invoke('open_in_file_manager', { path: contextMenu.target.locationPath });
            } else if (contextMenu.target.kind === 'standaloneGroup') {
              invoke('open_in_file_manager', { path: contextMenu.target.locationPath });
            }
          }}
          onPaste={async () => {
            if (!clipboard || clipboard.kind !== 'project' || contextMenu.target.kind !== 'set') return;
            const setPath = contextMenu.target.setPath;
            const transferId = crypto.randomUUID();
            setCopyProgress({
              transferId,
              label: `Copying project ${clipboard.name}...`,
              command: 'copy_project_with_progress',
              commandArgs: { srcPath: clipboard.path, destSetPath: setPath },
              setPath,
            });
          }}
          onPasteSet={() => {
            if (!clipboard || clipboard.kind !== 'set' || contextMenu.target.kind !== 'location') return;
            const locationPath = contextMenu.target.locationPath;
            const transferId = crypto.randomUUID();
            setCopyProgress({
              transferId,
              label: `Copying set ${clipboard.name}...`,
              command: 'copy_set',
              commandArgs: { srcPath: clipboard.path, destLocationPath: locationPath },
              locationPath,
            });
          }}
          onCreateNew={() => {
            if (contextMenu.target.kind === 'set') {
              setCreateModalTarget({
                setPath: contextMenu.target.setPath,
                setName: contextMenu.target.setName,
              });
            }
          }}
          onRenameSet={() => {
            if (contextMenu.target.kind === 'set') {
              const t = contextMenu.target;
              const locationPath = locations.find(l => l.sets.some(s => s.path === t.setPath))?.path ?? '';
              setRenamingSet({
                setPath: t.setPath,
                setName: t.setName,
                locationPath,
              });
            }
          }}
          onDeleteSet={() => {
            if (contextMenu.target.kind === 'set') {
              const t = contextMenu.target;
              const locationPath = locations.find(l => l.sets.some(s => s.path === t.setPath))?.path ?? '';
              setDeleteSetTarget({
                setPath: t.setPath,
                setName: t.setName,
                locationPath,
              });
            }
          }}
          onCreateSet={() => {
            if (contextMenu.target.kind === 'location') {
              setCreateSetTarget({
                locationPath: contextMenu.target.locationPath,
                locationName: contextMenu.target.locationName,
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

      {renamingSet && (
        <RenameProjectModal
          projectName={renamingSet.setName}
          existingNames={
            locations.find(l => l.path === renamingSet.locationPath)?.sets.map(s => s.name) ?? []
          }
          title="Rename Set"
          duplicateMessage={`A set named '${renamingSet.setName}' already exists`}
          buttonLabel="Rename"
          onConfirm={async (newName) => {
            setRenamingSet(null);
            try {
              const newPath = await invoke<string>('rename_set', { setPath: renamingSet.setPath, newName });
              setLocations((prev) =>
                prev.map((loc) => ({
                  ...loc,
                  sets: loc.sets.map((s) =>
                    s.path === renamingSet.setPath
                      ? { ...s, name: newName, path: newPath }
                      : s
                  ),
                }))
              );
              showToast(`Renamed set to "${newName}"`, 'fa-edit');
            } catch (err) {
              alert(`Rename set failed: ${err}`);
            }
          }}
          onCancel={() => setRenamingSet(null)}
        />
      )}

      {deleteSetTarget && (
        <DeleteProjectDialog
          projectName={deleteSetTarget.setName}
          setName={deleteSetTarget.locationPath.split('/').pop() ?? 'location'}
          title="Delete Set"
          message={<>Are you sure you want to delete set <strong>"{deleteSetTarget.setName}"</strong> and all its projects? This action cannot be undone.</>}
          onConfirm={async () => {
            try {
              await invoke('delete_set', { setPath: deleteSetTarget.setPath });
              setLocations((prev) =>
                prev.map((loc) => ({
                  ...loc,
                  sets: loc.sets.filter((s) => s.path !== deleteSetTarget.setPath),
                }))
              );
              showToast(`Deleted set "${deleteSetTarget.setName}"`, 'fa-trash');
            } catch (err) {
              alert(`Delete set failed: ${err}`);
            }
            setDeleteSetTarget(null);
          }}
          onCancel={() => setDeleteSetTarget(null)}
        />
      )}

      {createSetTarget && (
        <CreateProjectModal
          setPath={createSetTarget.locationPath}
          setName={createSetTarget.locationName}
          existingNames={
            locations.find(l => l.path === createSetTarget.locationPath)?.sets.map(s => s.name) ?? []
          }
          title="New Set"
          prompt={<>Create a new set in <strong>{createSetTarget.locationName}</strong>:</>}
          placeholder="Set name"
          duplicateMessage={`A set with this name already exists`}
          buttonLabel="Create"
          onConfirm={async (name) => {
            try {
              const newSetPath = await invoke<string>('create_set', { locationPath: createSetTarget.locationPath, name });
              const newSet = await invoke<OctatrackSet>('rescan_set', { setPath: newSetPath });
              setLocations((prev) =>
                prev.map((loc) =>
                  loc.path === createSetTarget.locationPath
                    ? { ...loc, sets: [...loc.sets, newSet] }
                    : loc
                )
              );
              showToast(`Created set "${name}"`, 'fa-plus');
            } catch (err) {
              alert(`Create set failed: ${err}`);
            }
            setCreateSetTarget(null);
          }}
          onCancel={() => setCreateSetTarget(null)}
        />
      )}

      <ScrollToTop />

      {copyProgress && (
        <CopyProgressModal
          transferId={copyProgress.transferId}
          label={copyProgress.label}
          command={copyProgress.command}
          commandArgs={copyProgress.commandArgs}
          onComplete={async (result) => {
            const cp = copyProgress;
            setCopyProgress(null);
            if (cp.setPath) {
              await rescanSet(cp.setPath);
              showToast(`Pasted successfully`, 'fa-paste');
            } else if (cp.locationPath) {
              // result is the new set path from copy_set
              try {
                const newSet = await invoke<OctatrackSet>('rescan_set', { setPath: result });
                setLocations((prev) =>
                  prev.map((loc) =>
                    loc.path === cp.locationPath
                      ? { ...loc, sets: [...loc.sets, newSet] }
                      : loc
                  )
                );
              } catch {
                await scanDevices();
              }
              showToast(`Set pasted successfully`, 'fa-paste');
            }
          }}
          onCancel={() => setCopyProgress(null)}
          onError={(err) => {
            setCopyProgress(null);
            alert(`Copy failed: ${err}`);
          }}
        />
      )}

      {toast && (
        <div className={`toast-notification ${toast.type || ''}`}>
          <i className={`fas ${toast.icon}`}></i> {toast.message}
        </div>
      )}
    </main>
  );
}
