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

// Project detail types (matching ProjectDetail.tsx)
interface CurrentState {
  bank: number;
  bank_name: string;
  pattern: number;
  part: number;
  track: number;
  muted_tracks: number[];
  soloed_tracks: number[];
  midi_mode: number;
  track_othermode: number;
  audio_muted_tracks: number[];
  audio_cued_tracks: number[];
  midi_muted_tracks: number[];
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

interface MemorySettings {
  load_24bit_flex: boolean;
  dynamic_recorders: boolean;
  record_24bit: boolean;
  reserved_recorder_count: number;
  reserved_recorder_length: number;
}

interface SampleSlot {
  slot_id: number;
  slot_type: string;
  path: string | null;
  gain: number | null;
  loop_mode: string | null;
  timestretch_mode: string | null;
  source_location: string | null;
  file_exists: boolean;
  compatibility: string | null;
  file_format: string | null;
  bit_depth: number | null;
  sample_rate: number | null;
}

interface SampleSlots {
  static_slots: SampleSlot[];
  flex_slots: SampleSlot[];
}

export interface ProjectMetadata {
  name: string;
  tempo: number;
  time_signature: string;
  pattern_length: number;
  current_state: CurrentState;
  mixer_settings: MixerSettings;
  memory_settings: MemorySettings;
  sample_slots: SampleSlots;
  os_version: string;
}

interface TrigCounts {
  trigger: number;
  trigless: number;
  plock: number;
  oneshot: number;
  swing: number;
  slide: number;
  total: number;
}

interface PerTrackSettings {
  master_len: string;
  master_scale: string;
}

interface TrackSettings {
  start_silent: boolean;
  plays_free: boolean;
  trig_mode: string;
  trig_quant: string;
  oneshot_trk: boolean;
}

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
  step: number;
  trigger: boolean;
  trigless: boolean;
  plock: boolean;
  oneshot: boolean;
  swing: boolean;
  slide: boolean;
  recorder: boolean;
  trig_condition: string | null;
  trig_repeats: number;
  micro_timing: string | null;
  notes: number[];
  velocity: number | null;
  plock_count: number;
  sample_slot: number | null;
  audio_plocks: AudioParameterLocks | null;
  midi_plocks: MidiParameterLocks | null;
}

interface TrackInfo {
  track_id: number;
  track_type: string;
  swing_amount: number;
  per_track_len: number | null;
  per_track_scale: string | null;
  pattern_settings: TrackSettings;
  trig_counts: TrigCounts;
  steps: TrigStep[];
  default_note: number | null;
}

interface Pattern {
  id: number;
  name: string;
  length: number;
  part_assignment: number;
  scale_mode: string;
  master_scale: string;
  chain_mode: string;
  tempo_info: string | null;
  active_tracks: number;
  trig_counts: TrigCounts;
  per_track_settings: PerTrackSettings | null;
  has_swing: boolean;
  tracks: TrackInfo[];
}

interface Part {
  id: number;
  name: string;
  patterns: Pattern[];
}

export interface Bank {
  id: string;
  name: string;
  parts: Part[];
}

// Parts machine parameter interfaces
export interface MachineParamValues {
  // FLEX/STATIC parameters
  ptch: number | null;
  strt: number | null;
  len: number | null;
  rate: number | null;
  rtrg: number | null;
  rtim: number | null;
  // THRU parameters
  in_ab: number | null;
  vol_ab: number | null;
  in_cd: number | null;
  vol_cd: number | null;
}

export interface MachineSetupValues {
  // FLEX/STATIC setup parameters
  xloop: number | null;
  slic: number | null;
  len: number | null;
  rate: number | null;
  tstr: number | null;
  tsns: number | null;
}

export interface PartTrackMachine {
  track_id: number;
  machine_type: string;  // "Static", "Flex", "Thru", "Neighbor", "Pickup"
  machine_params: MachineParamValues;
  machine_setup: MachineSetupValues;
}

export interface PartTrackAmp {
  track_id: number;
  atk: number;
  hold: number;
  rel: number;
  vol: number;
  bal: number;
  f: number;
  // AMP SETUP parameters
  amp_setup_amp: number;         // Envelope type
  amp_setup_sync: number;        // Sync setting
  amp_setup_atck: number;        // Attack curve
  amp_setup_fx1: number;         // FX1 routing
  amp_setup_fx2: number;         // FX2 routing
}

export interface PartTrackLfo {
  track_id: number;
  // MAIN LFO parameters
  spd1: number;                  // Speed of LFO 1
  spd2: number;                  // Speed of LFO 2
  spd3: number;                  // Speed of LFO 3
  dep1: number;                  // Depth of LFO 1
  dep2: number;                  // Depth of LFO 2
  dep3: number;                  // Depth of LFO 3
  // SETUP LFO parameters (Setup 1: Parameter Target & Wave)
  lfo1_pmtr: number;             // LFO 1 Parameter Target
  lfo2_pmtr: number;             // LFO 2 Parameter Target
  lfo3_pmtr: number;             // LFO 3 Parameter Target
  lfo1_wave: number;             // LFO 1 Waveform
  lfo2_wave: number;             // LFO 2 Waveform
  lfo3_wave: number;             // LFO 3 Waveform
  // SETUP LFO parameters (Setup 2: Multiplier & Trigger)
  lfo1_mult: number;             // LFO 1 Speed Multiplier
  lfo2_mult: number;             // LFO 2 Speed Multiplier
  lfo3_mult: number;             // LFO 3 Speed Multiplier
  lfo1_trig: number;             // LFO 1 Trigger Mode
  lfo2_trig: number;             // LFO 2 Trigger Mode
  lfo3_trig: number;             // LFO 3 Trigger Mode
}

export interface PartData {
  part_id: number;
  machines: PartTrackMachine[];
  amps: PartTrackAmp[];
  lfos: PartTrackLfo[];
}

interface CachedProjectData {
  metadata: ProjectMetadata;
  banks: Bank[];
  timestamp: number;
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
  // Project detail cache methods
  getCachedProject: (path: string) => CachedProjectData | null;
  setCachedProject: (path: string, metadata: ProjectMetadata, banks: Bank[]) => void;
  clearProjectCache: (path?: string) => void;
  clearAll: () => void;
}

const ProjectsContext = createContext<ProjectsContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = "octatrack_scanned_projects";
const PROJECT_CACHE_KEY = "octatrack_project_cache";

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

  // Project cache state
  const [projectCache, setProjectCache] = useState<Map<string, CachedProjectData>>(() => {
    try {
      const stored = sessionStorage.getItem(PROJECT_CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const cache = new Map<string, CachedProjectData>();
        Object.entries(parsed).forEach(([key, value]) => {
          cache.set(key, value as CachedProjectData);
        });
        return cache;
      }
    } catch (error) {
      console.error("Error loading project cache from sessionStorage:", error);
    }
    return new Map();
  });

  // Save projects list to sessionStorage whenever state changes
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

  // Save project cache to sessionStorage whenever it changes
  useEffect(() => {
    try {
      const cacheObject: Record<string, CachedProjectData> = {};
      projectCache.forEach((value, key) => {
        cacheObject[key] = value;
      });
      sessionStorage.setItem(PROJECT_CACHE_KEY, JSON.stringify(cacheObject));
    } catch (error) {
      console.error("Error saving project cache to sessionStorage:", error);
    }
  }, [projectCache]);

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

  // Project cache methods
  const getCachedProject = (path: string): CachedProjectData | null => {
    const cached = projectCache.get(path);
    if (cached) {
      // Optional: Check if cache is stale (e.g., older than 1 hour)
      // const cacheAge = Date.now() - cached.timestamp;
      // if (cacheAge > 3600000) return null; // 1 hour in milliseconds
      return cached;
    }
    return null;
  };

  const setCachedProject = (path: string, metadata: ProjectMetadata, banks: Bank[]) => {
    setProjectCache(prev => {
      const newCache = new Map(prev);
      newCache.set(path, {
        metadata,
        banks,
        timestamp: Date.now(),
      });
      return newCache;
    });
  };

  const clearProjectCache = (path?: string) => {
    if (path) {
      // Clear specific project cache
      setProjectCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(path);
        return newCache;
      });
    } else {
      // Clear all project cache
      setProjectCache(new Map());
      sessionStorage.removeItem(PROJECT_CACHE_KEY);
    }
  };

  const clearAll = () => {
    setLocationsState([]);
    setStandaloneProjectsState([]);
    setHasScannedState(false);
    setOpenLocationsState(new Set());
    setIsIndividualProjectsOpenState(true);
    setIsLocationsOpenState(true);
    setProjectCache(new Map());
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(PROJECT_CACHE_KEY);
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
    getCachedProject,
    setCachedProject,
    clearProjectCache,
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
