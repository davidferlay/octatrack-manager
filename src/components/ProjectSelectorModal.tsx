import { useEffect, useMemo, useRef, useState } from "react";
import "../App.css";
import { filterProjects } from "../utils/filterProjects";
import { useSearchShortcut } from "../hooks/useSearchShortcut";
import type { OctatrackLocation, OctatrackProject } from "../types/projectManagement";

/** Natural sort: "Project_2" < "Project_10". */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export type SelectorProject = OctatrackProject;
export type SelectorLocation = OctatrackLocation;

interface ProjectSelectorModalProps {
  title: string;
  /** Currently selected project path, highlighted in the grid. */
  value: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  currentProjectPath: string;
  currentProjectName: string;
  locations: SelectorLocation[];
  standaloneProjects: SelectorProject[];
  browsedProjects: { name: string; path: string }[];
  isManualBrowseOpen: boolean;
  setIsManualBrowseOpen: (open: boolean) => void;
  onRescan: () => void;
  onBrowse: () => void;
  isScanning: boolean;
  /** Omitted for the source pane: creating an empty project to read from is pointless. */
  onCreateProject?: (setPath: string, setName: string) => void;
  /**
   * Create a project somewhere of the user's choosing, unrelated to any Set
   * listed here. Offered as an action alongside Rescan / Browse; omitted (like
   * onCreateProject) when the picker cannot create anything.
   */
  onCreateElsewhere?: () => void;
}

/** The project picker shared by the Tools source and destination panes. */
export function ProjectSelectorModal({
  title,
  value,
  onSelect,
  onClose,
  currentProjectPath,
  currentProjectName,
  locations,
  standaloneProjects,
  browsedProjects,
  isManualBrowseOpen,
  setIsManualBrowseOpen,
  onRescan,
  onBrowse,
  isScanning,
  onCreateProject,
  onCreateElsewhere,
}: ProjectSelectorModalProps) {
  // Open on whatever is most relevant: the set holding the current project if it
  // lives in one, otherwise the locations list, or the individual projects when
  // there are no locations at all.
  const initial = (() => {
    for (let locIdx = 0; locIdx < locations.length; locIdx++) {
      for (const set of locations[locIdx].sets) {
        if (set.projects.some((p) => p.path === currentProjectPath)) {
          return {
            sets: new Set([`${locIdx}-${set.name}`]),
            locs: new Set([locIdx]),
            individual: false,
            locationsOpen: true,
          };
        }
      }
    }
    return {
      sets: new Set<string>(),
      locs: new Set<number>(),
      individual: locations.length === 0,
      locationsOpen: locations.length > 0,
    };
  })();

  const [openSetsInModal, setOpenSetsInModal] = useState<Set<string>>(initial.sets);
  const [openLocationsInModal, setOpenLocationsInModal] = useState<Set<number>>(initial.locs);
  const [isIndividualProjectsOpenInModal, setIsIndividualProjectsOpenInModal] = useState<boolean>(initial.individual);
  const [isLocationsOpenInModal, setIsLocationsOpenInModal] = useState<boolean>(initial.locationsOpen);

  const [search, setSearch] = useState<string>("");
  const searchActive = search.trim().length > 0;
  // Not autofocused: the picker is a list to look at first, and typing into it
  // should be a deliberate act. Ctrl/Cmd+F focuses it, as everywhere else.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchInputRef, () => setSearch(''));
  const needle = search.trim().toLowerCase();

  // Same matching rule as the home page: project names only, so a Set shows up
  // because something inside it matched.
  const filtered = useMemo(
    () => filterProjects(locations, standaloneProjects, search),
    [locations, standaloneProjects, search],
  );
  const shownLocations = filtered.locations;
  const shownStandalone = filtered.standaloneProjects;
  const shownBrowsed = useMemo(
    () => (needle ? browsedProjects.filter((p) => p.name.toLowerCase().includes(needle)) : browsedProjects),
    [browsedProjects, needle],
  );
  const currentMatches = !needle || currentProjectName.toLowerCase().includes(needle);
  const nothingMatches = searchActive && !currentMatches
    && shownLocations.length === 0 && shownStandalone.length === 0
    && shownBrowsed.filter((p) => p.path !== currentProjectPath).length === 0;

  // Expand the groups while a search is running, and put the shape back when it
  // ends - the headers stay clickable throughout, unlike forcing them open.
  const preSearch = useRef<{ sets: Set<string>; locs: Set<number>; individual: boolean; locationsOpen: boolean } | null>(null);
  useEffect(() => {
    if (searchActive) {
      if (preSearch.current) return;
      preSearch.current = {
        sets: openSetsInModal,
        locs: openLocationsInModal,
        individual: isIndividualProjectsOpenInModal,
        locationsOpen: isLocationsOpenInModal,
      };
      setOpenLocationsInModal(new Set(locations.map((_, i) => i)));
      setOpenSetsInModal(new Set(locations.flatMap((loc, i) => loc.sets.map((set) => `${i}-${set.name}`))));
      setIsIndividualProjectsOpenInModal(true);
      setIsLocationsOpenInModal(true);
    } else if (preSearch.current) {
      const before = preSearch.current;
      preSearch.current = null;
      setOpenSetsInModal(before.sets);
      setOpenLocationsInModal(before.locs);
      setIsIndividualProjectsOpenInModal(before.individual);
      setIsLocationsOpenInModal(before.locationsOpen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, locations]);

  return (
      <div className="modal-overlay" onClick={() => onClose()}>
        <div className="modal-content project-selector-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>{title}</h3>
            <div className="project-selector-search">
              <div className="header-search-container">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search projects..."
                  aria-label="Search projects"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="header-search-input"
                />
                {search && (
                  <button
                    className="header-search-clear"
                    onClick={() => setSearch('')}
                    title="Clear search"
                  >×</button>
                )}
              </div>
            </div>
            <button className="modal-close" onClick={() => onClose()}>×</button>
          </div>
          <div className="modal-body project-selector-body">
            {nothingMatches && (
              <div className="no-matches">
                <i className="fas fa-search no-matches-icon"></i>
                <p className="no-matches-title">
                  No projects match <span className="no-matches-term">{search}</span>
                </p>
                <button className="scan-button browse-button" onClick={() => setSearch('')}>
                  Clear search
                </button>
              </div>
            )}

            {/* Header row with Current Project, Manual Browse, and Actions */}
            <div className="project-selector-header-row">
              <div className="project-selector-left-group">
                {currentMatches && (
                  <div className="project-selector-section project-selector-current">
                    <h4>Current Project</h4>
                    <div className="projects-grid">
                      <div
                        className={`project-card project-selector-card ${value === currentProjectPath ? 'selected' : ''}`}
                        onClick={() => onSelect(currentProjectPath)}
                        title={currentProjectPath}
                      >
                        <div className="project-name">{currentProjectName}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="project-selector-section project-selector-actions-section">
                <h4>Actions</h4>
                <div className="project-selector-actions">
                  <button
                    onClick={onRescan}
                    disabled={isScanning}
                    className="scan-button browse-button"
                  >
                    {isScanning ? "Scanning..." : "Rescan for Projects"}
                  </button>
                  <button
                    onClick={onBrowse}
                    className="scan-button browse-button"
                  >
                    Browse...
                  </button>
                  {onCreateElsewhere && (
                    <button
                      onClick={onCreateElsewhere}
                      className="scan-button browse-button"
                      title="Create a project in a folder you choose, outside the Sets listed here"
                    >
                      New Project...
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Manual Browse: every project found under the browsed folder,
                in a collapsible full-width section below the header */}
            {shownBrowsed.some(p => p.path !== currentProjectPath) && (() => {
              const browseCards = shownBrowsed.filter(p => p.path !== currentProjectPath);
              return (
              <div className="project-selector-section project-selector-manual">
                <h4
                  className="clickable"
                  onClick={() => setIsManualBrowseOpen(!isManualBrowseOpen)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                >
                  <span className="collapse-indicator">{isManualBrowseOpen ? '▼' : '▶'}</span>
                  Manual Browse - {browseCards.length} Project{browseCards.length !== 1 ? 's' : ''}
                </h4>
                <div className={`sets-section ${isManualBrowseOpen ? 'open' : 'closed'}`}>
                  <div className="sets-section-content">
                    <div className="projects-grid">
                      {browseCards.map((p) => (
                        <div
                          key={p.path}
                          className={`project-card project-selector-card ${value === p.path ? 'selected' : ''}`}
                          onClick={() => onSelect(p.path)}
                          title={p.path}
                        >
                          <div className="project-name">{p.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              );
            })()}

            {/* Individual Projects (collapsible, grouped by parent dir) */}
            {shownStandalone.some(p => p.path !== currentProjectPath && p.has_project_file) && (() => {
              const filteredStandalone = shownStandalone.filter(p => p.path !== currentProjectPath && p.has_project_file);
              // Group by parent directory
              const byParent = new Map<string, SelectorProject[]>();
              for (const project of filteredStandalone) {
                const parentDir = project.path.substring(0, project.path.lastIndexOf('/'));
                const group = byParent.get(parentDir);
                if (group) group.push(project);
                else byParent.set(parentDir, [project]);
              }
              const multiGroups: [string, SelectorProject[]][] = [];
              const loneProjects: SelectorProject[] = [];
              for (const [dir, projects] of byParent) {
                if (projects.length > 1) multiGroups.push([dir, projects]);
                else loneProjects.push(projects[0]);
              }
              multiGroups.sort((a, b) => naturalCompare(a[0], b[0]));
              loneProjects.sort((a, b) => naturalCompare(a.name, b.name));

              const renderSelectorCard = (project: SelectorProject) => (
                <div
                  key={project.path}
                  className={`project-card project-selector-card ${value === project.path ? 'selected' : ''}`}
                  onClick={() => onSelect(project.path)}
                  title={project.path}
                >
                  <div className="project-name">{project.name}</div>
                </div>
              );

              return (
              <div className="project-selector-section">
                <h4
                  className="clickable"
                  onClick={() => setIsIndividualProjectsOpenInModal(!isIndividualProjectsOpenInModal)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                >
                  <span className="collapse-indicator">{isIndividualProjectsOpenInModal ? '▼' : '▶'}</span>
                  {filteredStandalone.length} Individual Project{filteredStandalone.length !== 1 ? 's' : ''}
                </h4>
                <div className={`sets-section ${isIndividualProjectsOpenInModal ? 'open' : 'closed'}`}>
                  <div className="sets-section-content">
                    {multiGroups.map(([dir, projects]) => (
                      <div key={dir} className="standalone-group">
                        <div className="standalone-group-label" title={dir}>
                          {dir.substring(dir.lastIndexOf('/') + 1) || dir}
                          <span style={{ opacity: 0.5, marginLeft: '0.5rem', textTransform: 'none', fontFamily: 'inherit', letterSpacing: 0 }}>
                            - {projects.length} project{projects.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="projects-grid">
                          {[...projects].sort((a, b) => naturalCompare(a.name, b.name)).map(renderSelectorCard)}
                        </div>
                      </div>
                    ))}
                    {loneProjects.length > 0 && (
                      <div className="standalone-group">
                        <div className="standalone-group-label">
                          Other Locations
                          <span style={{ opacity: 0.5, marginLeft: '0.5rem', textTransform: 'none', fontFamily: 'inherit', letterSpacing: 0 }}>
                            - {loneProjects.length} project{loneProjects.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="projects-grid">
                          {loneProjects.map(renderSelectorCard)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
            })()}

            {/* Locations (collapsible, each containing sets) */}
            {shownLocations.filter(loc => loc.sets.some(set => set.projects.some(p => p.path !== currentProjectPath && p.has_project_file))).length > 0 && (
              <div className="project-selector-section">
                <h4
                  className="clickable"
                  onClick={() => setIsLocationsOpenInModal(!isLocationsOpenInModal)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                >
                  <span className="collapse-indicator">{isLocationsOpenInModal ? '▼' : '▶'}</span>
                  {shownLocations.filter(loc => loc.sets.some(set => set.projects.some(p => p.path !== currentProjectPath && p.has_project_file))).length} Location{shownLocations.filter(loc => loc.sets.some(set => set.projects.some(p => p.path !== currentProjectPath && p.has_project_file))).length !== 1 ? 's' : ''}
                </h4>
                <div className={`sets-section ${isLocationsOpenInModal ? 'open' : 'closed'}`}>
                  <div className="sets-section-content">
            {shownLocations.map((location) => {
              // Index in the unfiltered list: a search drops locations, and keying
              // the open state on the filtered position would move it around.
              const locIdx = locations.findIndex(l => l.path === location.path);
              const hasValidProjects = location.sets.some(set => set.projects.some(p => p.path !== currentProjectPath && p.has_project_file));
              if (!hasValidProjects) return null;
              const isLocationOpen = openLocationsInModal.has(locIdx);
              return (
                <div key={locIdx} className="project-selector-location">
                  <div className={`location-card location-type-${location.device_type.toLowerCase()}`}>
                    <div
                      className="location-header clickable"
                      onClick={() => {
                        setOpenLocationsInModal(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(locIdx)) {
                            newSet.delete(locIdx);
                          } else {
                            newSet.add(locIdx);
                          }
                          return newSet;
                        });
                      }}
                    >
                      <div className="location-header-left">
                        <span className="collapse-indicator">{isLocationOpen ? '▼' : '▶'}</span>
                        <h3>{location.name}</h3>
                        <span className="location-path-inline">{location.path}</span>
                      </div>
                      <div className="location-header-right">
                        <span className="device-type">
                          {location.device_type === 'CompactFlash' ? 'CF Card' :
                           location.device_type === 'LocalCopy' ? 'Local Copy' :
                           location.device_type === 'Usb' ? 'USB' : location.device_type}
                        </span>
                        <span className="sets-count">{location.sets.filter(set => set.projects.some(p => p.path !== currentProjectPath && p.has_project_file)).length} Set{location.sets.filter(set => set.projects.some(p => p.path !== currentProjectPath && p.has_project_file)).length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>

                    <div className={`sets-section ${isLocationOpen ? 'open' : 'closed'}`}>
                      <div className="sets-section-content">
                        {[...location.sets].sort((a, b) => {
                          const aIsPresets = a.name.toLowerCase() === 'presets';
                          const bIsPresets = b.name.toLowerCase() === 'presets';
                          if (aIsPresets && !bIsPresets) return 1;
                          if (!aIsPresets && bIsPresets) return -1;
                          return naturalCompare(a.name, b.name);
                        }).map((set, setIdx) => {
                          const validProjects = set.projects.filter(p => p.path !== currentProjectPath && p.has_project_file);
                          if (validProjects.length === 0) return null;
                          const setKey = `${locIdx}-${set.name}`;
                          const isSetOpen = openSetsInModal.has(setKey);
                          return (
                            <div key={setIdx} className="set-card" title={set.path}>
                              <div
                                className="set-header clickable"
                                onClick={() => {
                                  setOpenSetsInModal(prev => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(setKey)) {
                                      newSet.delete(setKey);
                                    } else {
                                      newSet.add(setKey);
                                    }
                                    return newSet;
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
                                    {validProjects.length} Project{validProjects.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              </div>
                              <div className={`sets-section ${isSetOpen ? 'open' : 'closed'}`}>
                                <div className="sets-section-content">
                                  <div className="projects-grid">
                                    {[...validProjects].sort((a, b) => naturalCompare(a.name, b.name)).map((project, projIdx) => (
                                      <div
                                        key={projIdx}
                                        className={`project-card project-selector-card ${value === project.path ? 'selected' : ''}`}
                                        onClick={() => onSelect(project.path)}
                                        title={project.path}
                                      >
                                        <div className="project-name">{project.name}</div>
                                      </div>
                                    ))}
                                    {onCreateProject && (
                                      <div
                                        className="project-card new-project-card"
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`New project in ${set.name}`}
                                        onClick={() => onCreateProject(set.path, set.name)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') onCreateProject(set.path, set.name) }}
                                      >
                                        <div className="new-project-icon">+</div>
                                        <div className="new-project-label">New Project</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
  );
}

export default ProjectSelectorModal;
