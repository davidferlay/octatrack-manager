import { createContext, useContext, useState, useEffect, ReactNode } from "react";

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

interface ProjectsContextType {
  locations: OctatrackLocation[];
  standaloneProjects: OctatrackProject[];
  hasScanned: boolean;
  openLocations: Set<number>;
  isIndividualProjectsOpen: boolean;
  isLocationsOpen: boolean;
  setLocations: (locations: OctatrackLocation[] | ((prev: OctatrackLocation[]) => OctatrackLocation[])) => void;
  setStandaloneProjects: (projects: OctatrackProject[] | ((prev: OctatrackProject[]) => OctatrackProject[])) => void;
  setHasScanned: (scanned: boolean) => void;
  setOpenLocations: (openLocs: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  setIsIndividualProjectsOpen: (open: boolean) => void;
  setIsLocationsOpen: (open: boolean) => void;
  clearAll: () => void;
}

const ProjectsContext = createContext<ProjectsContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = "octatrack_scanned_projects";

interface ProjectsProviderProps {
  children: ReactNode;
}

export function ProjectsProvider({ children }: ProjectsProviderProps) {
  // Initialize state from sessionStorage if available
  const [locations, setLocationsState] = useState<OctatrackLocation[]>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.locations || [];
      }
    } catch (error) {
      console.error("Error loading from sessionStorage:", error);
    }
    return [];
  });

  const [standaloneProjects, setStandaloneProjectsState] = useState<OctatrackProject[]>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.standaloneProjects || [];
      }
    } catch (error) {
      console.error("Error loading from sessionStorage:", error);
    }
    return [];
  });

  const [hasScanned, setHasScannedState] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.hasScanned || false;
      }
    } catch (error) {
      console.error("Error loading from sessionStorage:", error);
    }
    return false;
  });

  const [openLocations, setOpenLocationsState] = useState<Set<number>>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return new Set(parsed.openLocations || []);
      }
    } catch (error) {
      console.error("Error loading from sessionStorage:", error);
    }
    return new Set();
  });

  const [isIndividualProjectsOpen, setIsIndividualProjectsOpenState] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.isIndividualProjectsOpen ?? true;
      }
    } catch (error) {
      console.error("Error loading from sessionStorage:", error);
    }
    return true;
  });

  const [isLocationsOpen, setIsLocationsOpenState] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.isLocationsOpen ?? true;
      }
    } catch (error) {
      console.error("Error loading from sessionStorage:", error);
    }
    return true;
  });

  // Save to sessionStorage whenever state changes
  useEffect(() => {
    try {
      const data = {
        locations,
        standaloneProjects,
        hasScanned,
        openLocations: Array.from(openLocations),
        isIndividualProjectsOpen,
        isLocationsOpen,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Error saving to sessionStorage:", error);
    }
  }, [locations, standaloneProjects, hasScanned, openLocations, isIndividualProjectsOpen, isLocationsOpen]);

  const setLocations = (newLocations: OctatrackLocation[] | ((prev: OctatrackLocation[]) => OctatrackLocation[])) => {
    setLocationsState(newLocations);
  };

  const setStandaloneProjects = (projects: OctatrackProject[] | ((prev: OctatrackProject[]) => OctatrackProject[])) => {
    setStandaloneProjectsState(projects);
  };

  const setHasScanned = (scanned: boolean) => {
    setHasScannedState(scanned);
  };

  const setOpenLocations = (openLocs: Set<number> | ((prev: Set<number>) => Set<number>)) => {
    setOpenLocationsState(openLocs);
  };

  const setIsIndividualProjectsOpen = (open: boolean) => {
    setIsIndividualProjectsOpenState(open);
  };

  const setIsLocationsOpen = (open: boolean) => {
    setIsLocationsOpenState(open);
  };

  const clearAll = () => {
    setLocationsState([]);
    setStandaloneProjectsState([]);
    setHasScannedState(false);
    setOpenLocationsState(new Set());
    setIsIndividualProjectsOpenState(true);
    setIsLocationsOpenState(true);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  };

  const value: ProjectsContextType = {
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
    clearAll,
  };

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (context === undefined) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return context;
}
