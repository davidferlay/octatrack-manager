import { useState, useEffect, useTransition, useCallback, useRef, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectMetadata, Bank, PartsDataResponse } from "../context/ProjectsContext";
import { BankSelector, ALL_BANKS, formatBankName } from "../components/BankSelector";
import { TrackSelector, ALL_AUDIO_TRACKS, ALL_MIDI_TRACKS } from "../components/TrackSelector";
import { PatternSelector, ALL_PATTERNS } from "../components/PatternSelector";
import { SampleSlotsTable } from "../components/SampleSlotsTable";
import PartsPanel from "../components/PartsPanel";
import ToolsPanel from "../components/ToolsPanel";
import { OverwriteModal } from "../components/OverwriteModal";
import { TransferProgressPanel } from "../components/TransferProgressPanel";
import { useAudioPoolTransfer } from "../hooks/useAudioPoolTransfer";
import { WriteStatus, IDLE_STATUS } from "../types/writeStatus";
import { TrackBadge } from "../components/TrackBadge";
import { ScrollToTop } from "../components/ScrollToTop";
import { Version } from "../components/Version";
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
  recorder_oneshot: boolean; // Recorder trig is one-shot (audio only)
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

type TabType = "overview" | "parts" | "patterns" | "tracks" | "static-slots" | "flex-slots" | "tools";

// Helper function to calculate the display denominator for length fraction
function getLengthDenominator(length: number): number {
  if (length <= 16) return 16;
  if (length <= 32) return 32;
  if (length <= 48) return 48;
  return 64;
}

// Every step indicator shown in the pattern grid, in display order. Shared by the
// global filter chips, the per-pattern legend, and the show/hide logic.
const INDICATOR_DEFS: { key: string; label: string; glyph: ReactNode }[] = [
  { key: 'trigger', label: 'Trigger', glyph: <span className="indicator-trigger"><i className="fas fa-circle"></i></span> },
  { key: 'oneshot', label: 'One-Shot', glyph: <span className="indicator-oneshot"><i className="fas fa-circle"></i></span> },
  { key: 'trigless', label: 'Trigless', glyph: <span className="indicator-trigless"><i className="fas fa-circle"></i></span> },
  { key: 'lock', label: 'Lock', glyph: <span className="indicator-lock"><i className="far fa-circle"></i></span> },
  { key: 'plock', label: 'P-Lock', glyph: <span className="indicator-plock">P</span> },
  { key: 'swing', label: 'Swing', glyph: <span className="indicator-swing"><svg viewBox="0 0 20 14" width="14" height="11"><path d="M1 7 C4 1 7 1 10 7 C13 13 16 13 19 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg></span> },
  { key: 'slide', label: 'Slide', glyph: <span className="indicator-slide">~</span> },
  { key: 'recorder', label: 'Recorder', glyph: <span className="indicator-recorder">R</span> },
  { key: 'recorder-oneshot', label: 'One-Shot Rec', glyph: <span className="indicator-recorder-oneshot">R</span> },
  { key: 'condition', label: 'Condition', glyph: <span className="indicator-condition">%</span> },
  { key: 'repeats', label: 'Repeats', glyph: <span className="indicator-repeats">X</span> },
  { key: 'timing', label: 'Micro-timing', glyph: <span className="indicator-timing">µ</span> },
  { key: 'note', label: 'MIDI Note/Chord', glyph: <span className="indicator-note">C4</span> },
  { key: 'velocity', label: 'Volume', glyph: <span className="indicator-velocity">V</span> },
  { key: 'sample', label: 'Sample', glyph: <span className="indicator-sample">S</span> },
];

const HIDDEN_INDICATORS_KEY = 'otm.patterns.hiddenIndicators';

function loadHiddenIndicators(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_INDICATORS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function ProjectDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = searchParams.get("path");
  const projectName = searchParams.get("name");

  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedBankIndices, setLoadedBankIndices] = useState<Set<number>>(new Set());
  const [failedBankIndices, setFailedBankIndices] = useState<Map<number, string>>(new Map()); // bank index -> error message
  const [allBanksLoaded, setAllBanksLoaded] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!titleMenu) return;
    const close = () => setTitleMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTitleMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [titleMenu]);
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    // Honor a ?tab= param so the Audio Pool page can return to the originating tab.
    const t = searchParams.get("tab");
    const valid: TabType[] = ["overview", "parts", "patterns", "tracks", "static-slots", "flex-slots", "tools"];
    return (valid as string[]).includes(t ?? "") ? (t as TabType) : "overview";
  });
  const [selectedBankIndex, setSelectedBankIndex] = useState<number>(0);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0); // Default to track 0, will be set to active track
  const [selectedPatternIndex, setSelectedPatternIndex] = useState<number>(0); // Default to pattern 0, will be set to active pattern
  const [selectedStepNumber, setSelectedStepNumber] = useState<number | null>(null); // Selected step number (synchronized across all patterns)
  // Indicator visibility filters: global (persisted) and per pattern card (session-only,
  // keyed "bank-pattern-track"). An indicator renders only if hidden in neither.
  const [hiddenIndicators, setHiddenIndicators] = useState<string[]>(loadHiddenIndicators);
  const [cardHiddenIndicators, setCardHiddenIndicators] = useState<Record<string, string[]>>({});
  const toggleGlobalIndicator = (key: string) => {
    setHiddenIndicators((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem(HIDDEN_INDICATORS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const toggleCardIndicator = (cardKey: string, key: string) => {
    setCardHiddenIndicators((prev) => {
      const current = prev[cardKey] ?? [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, [cardKey]: next };
    });
  };

  // Keyboard navigation through pattern steps once a step is selected:
  // Left/Right and Tab/Shift+Tab move by one step, Up/Down by a page row (16),
  // Escape deselects. In single-pattern view, moving horizontally past the
  // first/last step switches to the previous/next pattern.
  useEffect(() => {
    if (activeTab !== 'patterns' || selectedStepNumber === null) return;
    const patternLength = (patternIdx: number): number => {
      const bankIdx = selectedBankIndex === ALL_BANKS
        ? Array.from(loadedBankIndices).sort((a, b) => a - b)[0] ?? -1
        : selectedBankIndex;
      return banks[bankIdx]?.parts[0]?.patterns[patternIdx]?.length ?? 64;
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { setSelectedStepNumber(null); return; }
      let delta: number;
      switch (e.key) {
        case 'ArrowRight': delta = 1; break;
        case 'ArrowLeft': delta = -1; break;
        case 'ArrowDown': delta = 16; break;
        case 'ArrowUp': delta = -16; break;
        case 'Tab': delta = e.shiftKey ? -1 : 1; break;
        default: return;
      }
      e.preventDefault();
      const singlePattern = selectedPatternIndex !== ALL_PATTERNS;
      const length = singlePattern ? patternLength(selectedPatternIndex) : 64;
      const next = selectedStepNumber + delta;
      if (next >= 0 && next < length) {
        setSelectedStepNumber(next);
        return;
      }
      // Only single-step horizontal moves cross pattern boundaries.
      if (!singlePattern || Math.abs(delta) !== 1) return;
      if (next >= length && selectedPatternIndex < 15) {
        setSelectedPatternIndex(selectedPatternIndex + 1);
        setSelectedStepNumber(0);
      } else if (next < 0 && selectedPatternIndex > 0) {
        const prevPattern = selectedPatternIndex - 1;
        setSelectedPatternIndex(prevPattern);
        setSelectedStepNumber(patternLength(prevPattern) - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeTab, selectedStepNumber, selectedPatternIndex, selectedBankIndex, banks, loadedBankIndices]);
  const [sharedPartsPageIndex, setSharedPartsPageIndex] = useState<number>(-1); // Shared page index for Parts panels (persists across bank changes), -1 = ALL
  const [sharedPartsLfoTab, setSharedPartsLfoTab] = useState<'LFO1' | 'LFO2' | 'LFO3' | 'DESIGN'>('LFO1'); // Shared LFO tab for Parts panels (persists across bank changes)
  const [sharedPartsActivePartIndex, setSharedPartsActivePartIndex] = useState<number | undefined>(undefined); // Active part index (persists across bank changes)

  // Pattern display settings
  const [hideEmptyPatterns, setHideEmptyPatterns] = useState<boolean>(false); // Hide patterns with no trigs
  const [hideEmptyPatternsVisual, setHideEmptyPatternsVisual] = useState<boolean>(false); // Immediate visual state for toggle
  const [showTrackSettings, setShowTrackSettings] = useState<boolean>(false); // Show track settings in patterns tab
  const [showTrackSettingsVisual, setShowTrackSettingsVisual] = useState<boolean>(false); // Immediate visual state for toggle
  const [isPending, startTransition] = useTransition(); // For smooth UI updates
  const [isSpinning, setIsSpinning] = useState<boolean>(false); // For refresh button animation
  const [partsWriteStatus, setPartsWriteStatus] = useState<WriteStatus>(IDLE_STATUS); // Parts write status
  const [lastStatusMessage, setLastStatusMessage] = useState<string>(''); // Keep last message for fade-out
  const [isEditMode, setIsEditMode] = useState<boolean>(false); // Global edit mode toggle
  const [showBankWarning, setShowBankWarning] = useState<boolean>(false); // Show failed banks warning
  const [showBankWarningModal, setShowBankWarningModal] = useState<boolean>(false); // Show modal with details
  const [isTitleTruncated, setIsTitleTruncated] = useState<boolean>(false); // Track if project title is truncated
  const titleRef = useRef<HTMLHeadingElement>(null); // Ref for project title h1
  const [audioTrackMachineTypes, setAudioTrackMachineTypes] = useState<Record<number, string>>({}); // Track index (0-7) -> machine type
  const memorySaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Debounce timer for memory settings save
  const [reserveLengthShaking, setReserveLengthShaking] = useState(false); // Shake animation for invalid reserve length
  const [audioPoolPath, setAudioPoolPath] = useState<string | null>(null); // Path to AUDIO/ directory (for sidebar)
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0); // Incremented to trigger sidebar refresh after import

  // Remember edit mode per project across navigation (e.g. round-trip to the Audio Pool page)
  useEffect(() => {
    if (projectPath && sessionStorage.getItem(`projEdit:${projectPath}`) === '1') setIsEditMode(true);
  }, [projectPath]);
  useEffect(() => {
    if (projectPath) sessionStorage.setItem(`projEdit:${projectPath}`, isEditMode ? '1' : '0');
  }, [isEditMode, projectPath]);

  // Transfer resize state
  const [transferPaneHeight, setTransferPaneHeight] = useState(200);
  const [isResizingTransfer, setIsResizingTransfer] = useState(false);
  const transferResizeStartY = useRef(0);
  const transferResizeStartHeight = useRef(0);

  // Audio transfer hook for sidebar OS drop imports
  const {
    transfers,
    isTransferQueueOpen,
    setIsTransferQueueOpen,
    overwriteModal,
    copyFilesToPool,
    cancelTransfer,
    clearAllTransfers,
    clearFinishedTransfers,
    handleOverwrite,
    handleOverwriteAll,
    handleSkip,
    handleSkipAll,
    handleCancelImport,
  } = useAudioPoolTransfer({
    onComplete: () => setSidebarRefreshTrigger(t => t + 1),
  });

  // Copy files into the project directory through the transfer pipeline (so the progress
  // pane opens automatically), resolving with the resulting destination paths for slot assignment.
  const importToProjectWithProgress = useCallback((sourcePaths: string[]) => {
    return new Promise<string[]>((resolve) => {
      if (!projectPath) { resolve([]); return; }
      copyFilesToPool(sourcePaths, projectPath, undefined, (destPaths) => resolve(destPaths));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Handle transfer pane resize
  useEffect(() => {
    if (!isResizingTransfer) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = transferResizeStartY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(500, transferResizeStartHeight.current + deltaY));
      setTransferPaneHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingTransfer(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingTransfer]);

  const handleTransferResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    transferResizeStartY.current = e.clientY;
    transferResizeStartHeight.current = transferPaneHeight;
    setIsResizingTransfer(true);
  };

  // Computed values for transfer panel badge
  const activeTransfersCount = transfers.filter(t => t.status === "copying" || t.status === "pending").length;
  const hasTransfers = transfers.length > 0;
  const allTransfersSucceeded = hasTransfers && activeTransfersCount === 0 && transfers.every(t => t.status === "completed");
  const hasFailedTransfers = transfers.some(t => t.status === "failed");

  // Wrapper to capture last message before going idle (for fade-out effect)
  const handleWriteStatusChange = useCallback((status: WriteStatus) => {
    if (status.state !== 'idle' && status.message) {
      setLastStatusMessage(status.message);
    } else if (status.state !== 'idle') {
      // Set default messages
      if (status.state === 'writing') setLastStatusMessage('Saving...');
      else if (status.state === 'success') setLastStatusMessage('Saved');
      else if (status.state === 'error') setLastStatusMessage('Error');
    }
    setPartsWriteStatus(status);
  }, []);

  // Toggle edit mode (backup bank file and project.work on entering edit mode)
  const toggleEditMode = useCallback(async () => {
    if (!isEditMode && projectPath) {
      const bankFile = `bank${String(selectedBankIndex + 1).padStart(2, '0')}.work`;
      try {
        await invoke("backup_project_files", {
          projectPath,
          files: [bankFile, "project.work"],
          label: "edit_mode",
        });
      } catch (err) {
        console.error("Backup failed:", err);
      }
    }
    setIsEditMode(prev => !prev);
  }, [isEditMode, projectPath, selectedBankIndex]);

  // Leaving to the projects list resets edit mode (unlike the Audio Pool round-trip, which keeps it).
  const leaveToProjectList = useCallback(() => {
    if (projectPath) sessionStorage.removeItem(`projEdit:${projectPath}`);
    navigate('/');
  }, [navigate, projectPath]);

  // Compute max reserve length in seconds for the given recorder count and format
  const getMaxReserveLength = useCallback((count: number, record24bit: boolean): number => {
    if (count === 0) return 0;
    const bps = record24bit ? 3 : 2;
    return Math.floor(89_652_480 / (count * 44100 * 2 * bps));
  }, []);

  // Handle memory setting changes with debounced save
  const handleMemorySettingChange = useCallback((field: string, value: boolean | number) => {
    if (!metadata || !projectPath) return;

    const currentSettings = metadata.memory_settings;
    const updatedSettings = { ...currentSettings, [field]: value };

    // When reserve recordings changes to 0, reserve length has no effect
    // When recorder count or format changes, clamp reserve length to new max
    if (field === 'reserved_recorder_count' || field === 'record_24bit') {
      const count = field === 'reserved_recorder_count' ? (value as number) : currentSettings.reserved_recorder_count;
      const is24bit = field === 'record_24bit' ? (value as boolean) : currentSettings.record_24bit;
      const maxLen = getMaxReserveLength(count, is24bit);
      if (updatedSettings.reserved_recorder_length > maxLen) {
        updatedSettings.reserved_recorder_length = maxLen;
      }
    }

    // Update metadata state immediately for responsive UI
    setMetadata(prev => {
      if (!prev) return prev;
      return { ...prev, memory_settings: updatedSettings };
    });

    // Debounced save
    if (memorySaveDebounceRef.current) {
      clearTimeout(memorySaveDebounceRef.current);
    }

    handleWriteStatusChange({ state: 'writing', message: 'Saving memory settings...' });

    memorySaveDebounceRef.current = setTimeout(() => {
      // Read latest metadata at save time
      setMetadata(currentMeta => {
        if (!currentMeta) return currentMeta;
        const settingsToSave = currentMeta.memory_settings;

        invoke<number>('save_memory_settings', {
          path: projectPath,
          settings: settingsToSave,
        }).then((flexRamFreeMb) => {
          // Update flex_ram_free_mb with the recomputed value from backend. The exact byte
          // figure isn't returned here, so clear it — the drop budget falls back to the fresh
          // (conservative) MiB value until the next full project reload.
          setMetadata(m => {
            if (!m) return m;
            return { ...m, memory_settings: { ...m.memory_settings, flex_ram_free_mb: flexRamFreeMb, flex_ram_free_bytes: undefined } };
          });
          handleWriteStatusChange({ state: 'success', message: 'Memory settings saved' });
          setTimeout(() => handleWriteStatusChange({ state: 'idle' }), 2000);
        }).catch(err => {
          console.error('Failed to save memory settings:', err);
          handleWriteStatusChange({ state: 'error', message: 'Failed to save memory settings' });
          setTimeout(() => handleWriteStatusChange({ state: 'idle' }), 3000);
        });

        return currentMeta;
      });

      memorySaveDebounceRef.current = null;
    }, 500);
  }, [metadata, projectPath, getMaxReserveLength, handleWriteStatusChange]);

  // Refresh metadata + reload all banks in-place (without unmounting the UI)
  const refreshProjectData = useCallback(async () => {
    if (!projectPath) return;
    try {
      // Reload metadata
      const projectMetadata = await invoke<ProjectMetadata>("load_project_metadata", { path: projectPath });
      setMetadata(projectMetadata);

      // Reload all banks in-place
      const existingBankIndices = await invoke<number[]>("get_existing_banks", { path: projectPath });
      const reloadPromises = existingBankIndices.map(async (bankIndex) => {
        try {
          const bank = await invoke<Bank | null>("load_single_bank", { path: projectPath, bankIndex });
          if (bank) {
            setBanks(prev => {
              const newBanks = [...prev];
              newBanks[bankIndex] = bank;
              return newBanks;
            });
          }
        } catch (err) {
          console.error(`Failed to reload bank ${bankIndex}:`, err);
        }
      });
      await Promise.all(reloadPromises);
    } catch (err) {
      console.error("Failed to refresh project data:", err);
    }
  }, [projectPath]);

  // Reload a specific bank (used after copy operations in Tools panel)
  const reloadBank = useCallback(async (bankIndex: number) => {
    if (!projectPath) return;
    try {
      const bank = await invoke<Bank | null>("load_single_bank", {
        path: projectPath,
        bankIndex
      });
      if (bank) {
        setBanks(prev => {
          const newBanks = [...prev];
          newBanks[bankIndex] = bank;
          return newBanks;
        });
      }
    } catch (err) {
      console.error(`Failed to reload bank ${bankIndex}:`, err);
    }
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;

    loadProjectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Show bank warning when failed banks are detected, auto-hide after 90 seconds
  useEffect(() => {
    if (failedBankIndices.size > 0) {
      setShowBankWarning(true);
      const timer = setTimeout(() => setShowBankWarning(false), 90000);
      return () => clearTimeout(timer);
    }
  }, [failedBankIndices.size]);

  // Hide bank warning when save status indicator appears
  useEffect(() => {
    if (partsWriteStatus.state !== 'idle') {
      setShowBankWarning(false);
    }
  }, [partsWriteStatus.state]);

  // Track whether an HTML5 drag is in progress so Escape cancels the drag
  // (native behavior) instead of navigating back to the project list.
  const isDraggingRef = useRef(false);
  useEffect(() => {
    const start = () => { isDraggingRef.current = true; };
    const end = () => { isDraggingRef.current = false; };
    document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end);
    document.addEventListener('drop', end);
    return () => {
      document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end);
      document.removeEventListener('drop', end);
    };
  }, []);

  // Load machine types for the selected bank's active part
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't handle shortcuts when a modal/dialog is open
      if (document.querySelector('.modal-overlay')) return;

      const target = e.target as HTMLElement;
      const tag = target?.tagName;

      // For 'e'/'E' (edit toggle): allow even when SELECT, checkbox, or numeric-only input is focused
      // Only block when in a real text input (search bars, text areas, contenteditable)
      if (e.key === 'e' || e.key === 'E') {
        const isTextInput = tag === 'TEXTAREA' ||
          (tag === 'INPUT' && !['checkbox', 'radio'].includes((target as HTMLInputElement).type) &&
           !(target as HTMLElement).classList.contains('compact-input'));
        if (tag === 'SELECT' || !isTextInput) {
          if (!isLoading) toggleEditMode();
        }
        return;
      }

      // For all other shortcuts: don't handle when typing in an input/textarea/select
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        // Mid-drag Escape cancels the drag (handled natively); don't leave the project.
        if (isDraggingRef.current) return;
        leaveToProjectList();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [leaveToProjectList, isLoading, toggleEditMode]);

  useEffect(() => {
    if (!projectPath || selectedBankIndex < 0 || selectedBankIndex >= 16) {
      setAudioTrackMachineTypes({});
      return;
    }
    if (!loadedBankIndices.has(selectedBankIndex)) return;
    const bank = banks[selectedBankIndex];
    if (!bank) return;

    const loadMachineTypes = async () => {
      try {
        const response = await invoke<PartsDataResponse>('load_parts_data', {
          path: projectPath,
          bankId: bank.id
        });
        const activePartIndex = sharedPartsActivePartIndex ?? metadata?.current_state.part ?? 0;
        const partData = response.parts[activePartIndex];
        if (partData?.machines) {
          const types: Record<number, string> = {};
          for (const m of partData.machines) {
            types[m.track_id] = m.machine_type;
          }
          setAudioTrackMachineTypes(types);
        }
      } catch {
        setAudioTrackMachineTypes({});
      }
    };
    loadMachineTypes();
  }, [projectPath, selectedBankIndex, banks, loadedBankIndices, sharedPartsActivePartIndex, metadata?.current_state.part]);

  // Detect if project title is truncated (for conditional fade effect)
  useEffect(() => {
    const checkTruncation = () => {
      if (titleRef.current) {
        const isTruncated = titleRef.current.scrollWidth > titleRef.current.clientWidth;
        setIsTitleTruncated(isTruncated);
      }
    };
    checkTruncation();
    window.addEventListener('resize', checkTruncation);
    return () => window.removeEventListener('resize', checkTruncation);
  }, [projectName]);

  async function loadProjectData() {
    setIsLoading(true);
    setLoadedBankIndices(new Set());
    setFailedBankIndices(new Map());
    setAllBanksLoaded(false);
    setError(null);
    try {
      // Step 1: Load metadata first (fast) - this enables Overview tab immediately
      setLoadingStatus("Reading project metadata...");
      const projectMetadata = await invoke<ProjectMetadata>("load_project_metadata", { path: projectPath });

      setMetadata(projectMetadata);
      const activeBankIndex = projectMetadata.current_state.bank;
      // Set the selected bank to the currently active bank
      setSelectedBankIndex(activeBankIndex);
      // Set the selected track to the currently active track
      setSelectedTrackIndex(projectMetadata.current_state.track);
      // Set the selected pattern to the currently active pattern
      setSelectedPatternIndex(projectMetadata.current_state.pattern);

      // Step 2: Show UI immediately with metadata loaded
      setIsLoading(false);

      // Step 2b: Check audio pool status (async, non-blocking)
      invoke<{ exists: boolean; path: string | null; set_path: string | null }>("get_audio_pool_status", { projectPath })
        .then(status => {
          setAudioPoolPath(status.exists ? status.path : null);
        })
        .catch(() => {
          setAudioPoolPath(null);
        });

      // Step 3: Get list of existing bank files (skip non-existent banks early)
      const existingBankIndices = await invoke<number[]>("get_existing_banks", { path: projectPath });
      const existingBanksSet = new Set(existingBankIndices);

      // Mark non-existent banks as "loaded" immediately (nothing to load)
      const nonExistentIndices = Array.from({ length: 16 }, (_, i) => i).filter(i => !existingBanksSet.has(i));
      if (nonExistentIndices.length > 0) {
        setLoadedBankIndices(new Set(nonExistentIndices));
      }

      // Step 4: Load only the active bank first (fast) - enables Parts/Patterns/Tracks for active bank
      setLoadingStatus("Loading active bank...");
      const activeBank = await invoke<Bank | null>("load_single_bank", {
        path: projectPath,
        bankIndex: activeBankIndex
      });

      if (activeBank) {
        // Initialize banks array with just the active bank
        const initialBanks: Bank[] = [];
        initialBanks[activeBankIndex] = activeBank;
        setBanks(initialBanks);
        setLoadedBankIndices(prev => new Set([...prev, activeBankIndex]));
      }

      // Step 5: Load remaining existing banks in parallel with dynamic concurrency
      setLoadingStatus("Loading remaining banks...");
      const remainingIndices = existingBankIndices.filter(i => i !== activeBankIndex);

      // Get system resources to determine optimal concurrency
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      const concurrency = Math.max(2, Math.min(resources.recommended_concurrency, 4)); // Between 2 and 4 (conservative for UI)

      // Helper to load a single bank
      const loadBank = async (bankIndex: number): Promise<{ bankIndex: number; bank: Bank | null; error?: string }> => {
        try {
          const bank = await invoke<Bank | null>("load_single_bank", {
            path: projectPath,
            bankIndex
          });
          return { bankIndex, bank };
        } catch (err) {
          console.error(`Failed to load bank ${bankIndex}:`, err);
          return { bankIndex, bank: null, error: String(err) };
        }
      };

      // Helper to yield to the main thread for UI responsiveness
      const yieldToMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

      // Process banks with controlled concurrency
      for (let i = 0; i < remainingIndices.length; i += concurrency) {
        const batch = remainingIndices.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(loadBank));

        // Update state progressively after each batch using startTransition for smooth UI
        const batchLoaded = batchResults.filter((r): r is { bankIndex: number; bank: Bank } => r.bank !== null);
        const batchFailed = batchResults.filter(r => r.bank === null && r.error);

        // Always mark all attempted banks as loaded (even if they failed/returned null)
        // This prevents "(loading...)" state from persisting forever for failed banks
        startTransition(() => {
          if (batchLoaded.length > 0) {
            setBanks(prev => {
              const newBanks = [...prev];
              for (const { bankIndex, bank } of batchLoaded) {
                newBanks[bankIndex] = bank;
              }
              return newBanks;
            });
          }
          setLoadedBankIndices(prev => {
            const newSet = new Set(prev);
            for (const { bankIndex } of batchResults) {
              newSet.add(bankIndex);
            }
            return newSet;
          });
          // Track failed banks for user-friendly error display
          if (batchFailed.length > 0) {
            setFailedBankIndices(prev => {
              const newMap = new Map(prev);
              for (const { bankIndex, error } of batchFailed) {
                newMap.set(bankIndex, error || 'Unknown error');
              }
              return newMap;
            });
          }
        });

        // Yield to main thread between batches to keep UI responsive
        await yieldToMain();
      }

      setAllBanksLoaded(true);
      setLoadingStatus("");
    } catch (err) {
      console.error("Error loading project data:", err);
      setError(String(err));
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
    // Trigger spin animation
    setIsSpinning(true);
    setTimeout(() => setIsSpinning(false), 600);
    loadProjectData();
  };

  return (
    <main className="container">
      <div className="project-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1' }}>
          <button onClick={leaveToProjectList} className="back-button" title="Back to projects (Esc)">
            ← Back
          </button>
          <h1 ref={titleRef} className={isTitleTruncated ? 'truncated' : ''} title={projectPath || ''} style={{ cursor: 'pointer' }}
            onClick={() => {
              if (projectPath) {
                navigator.clipboard.writeText(projectPath);
                setToast("Path copied!");
                setTimeout(() => setToast(null), 1500);
              }
            }}
            onContextMenu={(e) => { e.preventDefault(); setTitleMenu({ x: e.clientX, y: e.clientY }); }}
          >{projectName}</h1>
          {titleMenu && (
            <div className="context-menu" style={{ position: 'fixed', top: titleMenu.y, left: titleMenu.x }} onClick={(e) => e.stopPropagation()}>
              <button className="context-menu-item" disabled={!projectPath}
                onClick={() => { if (projectPath) invoke('reveal_in_file_manager', { path: projectPath }); setTitleMenu(null); }}
              >
                <i className="fas fa-folder-open"></i> Open in file explorer
              </button>
              <button className="context-menu-item" disabled={!projectPath}
                onClick={() => {
                  if (projectPath) {
                    navigator.clipboard.writeText(projectPath);
                    setToast("Path copied!");
                    setTimeout(() => setToast(null), 1500);
                  }
                  setTitleMenu(null);
                }}
              >
                <i className="fas fa-copy"></i> Copy path to clipboard
              </button>
            </div>
          )}
          {/* View/Edit mode toggle - hidden during loading */}
          {!isLoading && (
            <div className="mode-toggle" onClick={toggleEditMode} title="Toggle View/Edit mode (E)">
              <span className={`mode-toggle-btn ${!isEditMode ? 'active' : ''}`}>
                View
              </span>
              <span className={`mode-toggle-btn ${isEditMode ? 'active' : ''}`}>
                Edit
              </span>
            </div>
          )}
          {/* Status indicator area - shows either save status or bank warning */}
          <div className="status-indicator-area">
            <span className={`save-status-indicator ${partsWriteStatus.state}`}>
              {partsWriteStatus.state === 'writing' && (partsWriteStatus.message || 'Saving...')}
              {partsWriteStatus.state === 'success' && (partsWriteStatus.message || 'Saved')}
              {partsWriteStatus.state === 'error' && (partsWriteStatus.message || 'Error')}
              {partsWriteStatus.state === 'idle' && lastStatusMessage}
            </span>
            {/* Failed banks warning indicator - only shown when save status is idle */}
            {showBankWarning && failedBankIndices.size > 0 && partsWriteStatus.state === 'idle' && (
              <span
                className="bank-warning-indicator"
                onClick={() => setShowBankWarningModal(true)}
                title="Click for details"
              >
                <i className="fas fa-exclamation-triangle"></i> Unsupported banks
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!isLoading && !error && metadata && (
            <div className="header-tabs">
              <button
                className={`header-tab ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button
                className={`header-tab ${activeTab === "parts" ? "active" : ""}`}
                onClick={() => setActiveTab("parts")}
              >
                Parts
              </button>
              <button
                className={`header-tab ${activeTab === "patterns" ? "active" : ""}`}
                onClick={() => setActiveTab("patterns")}
              >
                Patterns
              </button>
              <button
                className={`header-tab ${activeTab === "flex-slots" ? "active" : ""}`}
                onClick={() => setActiveTab("flex-slots")}
              >
                Flex ({metadata.sample_slots.flex_slots.filter(slot => slot.path).length})
              </button>
              <button
                className={`header-tab ${activeTab === "static-slots" ? "active" : ""}`}
                onClick={() => setActiveTab("static-slots")}
              >
                Static ({metadata.sample_slots.static_slots.filter(slot => slot.path).length})
              </button>
              <button
                className={`header-tab ${activeTab === "tools" ? "active" : ""}`}
                onClick={() => setActiveTab("tools")}
              >
                Tools
              </button>
            </div>
          )}
          <button
            onClick={handleRefresh}
            className={`toolbar-button ${isSpinning ? 'refreshing' : ''}`}
            disabled={isLoading}
            title="Refresh project"
          >
            <i className="fas fa-sync-alt"></i>
          </button>
          <Version />
        </div>
      </div>

      {isLoading && (
        <div className="loading-section">
          <div className="loading-spinner"></div>
          <p>Loading project data...</p>
          <p className="loading-status">{loadingStatus}</p>
        </div>
      )}

      {error && (
        <div className="error-section">
          <p>Error loading project: {error}</p>
        </div>
      )}

      {/* Modal for failed banks details */}
      {showBankWarningModal && (
        <div className="modal-overlay" onClick={() => setShowBankWarningModal(false)}>
          <div className="modal-content warning-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-exclamation-triangle"></i> Some banks could not be loaded</h3>
              <button className="modal-close" onClick={() => setShowBankWarningModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>
                <strong>Failed banks: </strong>
                {Array.from(failedBankIndices.entries()).map(([idx]) =>
                  String.fromCharCode(65 + idx)
                ).join(', ')}
              </p>
              <p>
                These banks may be from an older Octatrack OS version with an incompatible file format.
              </p>
              <p>
                <strong>To fix:</strong> Open the project on your Octatrack and re-save the affected banks.
                This will update them to the current file format.
              </p>
            </div>
          </div>
        </div>
      )}

      {!isLoading && !error && metadata && (
        <div className="project-content">
          <div className="tab-content">
            {activeTab === "overview" && (
              <div className="overview-tab">
                <div className="overview-grid">
                  {/* Project Info */}
                  <section className="overview-section">
                    <h2>Project Info</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Tempo</span>
                        <span className="compact-value">{metadata.tempo.toFixed(1)} BPM</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Time Sig</span>
                        <span className="compact-value">{metadata.time_signature}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">OS</span>
                        <span className="compact-value">{metadata.os_version}</span>
                      </div>
                    </div>
                  </section>

                  {/* Current State */}
                  <section className="overview-section">
                    <h2>Current State</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Bank</span>
                        <span className="compact-value">{metadata.current_state.bank_name}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Pattern</span>
                        <span className="compact-value">{metadata.current_state.pattern + 1}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Part</span>
                        <span className="compact-value">{metadata.current_state.part + 1}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Mode</span>
                        <span className="compact-value">{metadata.current_state.midi_mode === 0 ? "Audio" : "MIDI"}</span>
                      </div>
                    </div>
                  </section>

                  {/* Memory Settings */}
                  <section className="overview-section">
                    <h2>Memory</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Flex Format</span>
                        {isEditMode ? (
                          <select
                            className="compact-select"
                            value={metadata.memory_settings.load_24bit_flex ? "true" : "false"}
                            onChange={(e) => handleMemorySettingChange('load_24bit_flex', e.target.value === "true")}
                          >
                            <option value="false">16-bit</option>
                            <option value="true">24-bit</option>
                          </select>
                        ) : (
                          <span className="compact-value">{metadata.memory_settings.load_24bit_flex ? "24-bit" : "16-bit"}</span>
                        )}
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Dynamic Recorders</span>
                        {isEditMode ? (
                          <select
                            className="compact-select"
                            value={metadata.memory_settings.dynamic_recorders ? "true" : "false"}
                            onChange={(e) => handleMemorySettingChange('dynamic_recorders', e.target.value === "true")}
                          >
                            <option value="false">No</option>
                            <option value="true">Yes</option>
                          </select>
                        ) : (
                          <span className="compact-value">{metadata.memory_settings.dynamic_recorders ? "Yes" : "No"}</span>
                        )}
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Recorder Format</span>
                        {isEditMode ? (
                          <select
                            className="compact-select"
                            value={metadata.memory_settings.record_24bit ? "true" : "false"}
                            onChange={(e) => handleMemorySettingChange('record_24bit', e.target.value === "true")}
                          >
                            <option value="false">16-bit</option>
                            <option value="true">24-bit</option>
                          </select>
                        ) : (
                          <span className="compact-value">{metadata.memory_settings.record_24bit ? "24-bit" : "16-bit"}</span>
                        )}
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Reserve Recordings</span>
                        {isEditMode ? (
                          <select
                            className="compact-select"
                            value={String(metadata.memory_settings.reserved_recorder_count)}
                            onChange={(e) => handleMemorySettingChange('reserved_recorder_count', Number(e.target.value))}
                          >
                            <option value="0">None</option>
                            <option value="1">R1</option>
                            <option value="2">R1-R2</option>
                            <option value="3">R1-R3</option>
                            <option value="4">R1-R4</option>
                            <option value="5">R1-R5</option>
                            <option value="6">R1-R6</option>
                            <option value="7">R1-R7</option>
                            <option value="8">R1-R8</option>
                          </select>
                        ) : (
                          <span className="compact-value">{metadata.memory_settings.reserved_recorder_count === 0 ? "None" : metadata.memory_settings.reserved_recorder_count === 1 ? "R1" : `R1-R${metadata.memory_settings.reserved_recorder_count}`}</span>
                        )}
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Reserve Length</span>
                        {isEditMode ? (
                          <span className="compact-input-with-suffix">
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="0"
                              className={`compact-input${reserveLengthShaking ? ' shake' : ''}`}
                              value={metadata.memory_settings.reserved_recorder_length === 0 ? '' : String(metadata.memory_settings.reserved_recorder_length)}
                              size={Math.max(1, String(metadata.memory_settings.reserved_recorder_length || '').length)}
                              disabled={metadata.memory_settings.reserved_recorder_count === 0}
                            onKeyDown={(e) => {
                              // Only allow digits, Backspace, Delete, Tab, arrows, Home, End
                              if (!/^[0-9]$/.test(e.key) && !['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                                e.preventDefault();
                              }
                            }}
                            onChange={(e) => {
                              const text = e.target.value.replace(/[^0-9]/g, '');
                              const raw = text === '' ? 0 : parseInt(text, 10);
                              const max = getMaxReserveLength(metadata.memory_settings.reserved_recorder_count, metadata.memory_settings.record_24bit);
                              if (raw > max) {
                                setReserveLengthShaking(false);
                                requestAnimationFrame(() => setReserveLengthShaking(true));
                                setTimeout(() => setReserveLengthShaking(false), 400);
                              }
                              const val = Math.min(max, raw);
                              if (val !== metadata.memory_settings.reserved_recorder_length) {
                                handleMemorySettingChange('reserved_recorder_length', val);
                              }
                            }}
                            onBlur={() => {
                              // Ensure 0 is committed on blur if field was emptied
                              if (metadata.memory_settings.reserved_recorder_length !== 0) return;
                              handleMemorySettingChange('reserved_recorder_length', 0);
                            }}
                          />
                          <span className="compact-input-suffix">s</span>
                          </span>
                        ) : (
                          <span className="compact-value">{metadata.memory_settings.reserved_recorder_length} s</span>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Audio Mode State */}
                  <section className="overview-section">
                    <h2>Audio Mode</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Track</span>
                        <span className="compact-value">
                          <TrackBadge trackId={metadata.current_state.midi_mode === 0 ? metadata.current_state.track : metadata.current_state.track_othermode} />
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Muted</span>
                        <span className="compact-value">
                          {metadata.current_state.audio_muted_tracks.length > 0
                            ? metadata.current_state.audio_muted_tracks.map((t: number, idx: number) => (
                                <TrackBadge key={`audio-muted-${idx}`} trackId={t} />
                              ))
                            : "—"}
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Cued</span>
                        <span className="compact-value">
                          {metadata.current_state.audio_cued_tracks.length > 0
                            ? metadata.current_state.audio_cued_tracks.map((t: number, idx: number) => (
                                <TrackBadge key={`audio-cued-${idx}`} trackId={t} />
                              ))
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* MIDI Mode State */}
                  <section className="overview-section">
                    <h2>MIDI Mode</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Track</span>
                        <span className="compact-value">
                          <TrackBadge trackId={(metadata.current_state.midi_mode === 1 ? metadata.current_state.track : metadata.current_state.track_othermode) + 8} />
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Muted</span>
                        <span className="compact-value">
                          {metadata.current_state.midi_muted_tracks.length > 0
                            ? metadata.current_state.midi_muted_tracks.map((t: number, idx: number) => (
                                <TrackBadge key={`midi-muted-${idx}`} trackId={t + 8} />
                              ))
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* MIDI Sync */}
                  {metadata.midi_settings && (
                  <section className="overview-section">
                    <h2>MIDI Sync</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Clock TX</span>
                        <span className="compact-value">{metadata.midi_settings.clock_send ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Clock RX</span>
                        <span className="compact-value">{metadata.midi_settings.clock_receive ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Trans TX</span>
                        <span className="compact-value">{metadata.midi_settings.transport_send ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Trans RX</span>
                        <span className="compact-value">{metadata.midi_settings.transport_receive ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">PC TX</span>
                        <span className="compact-value">
                          {metadata.midi_settings.prog_change_send
                            ? (metadata.midi_settings.prog_change_send_channel === -1 ? 'Auto' : `Ch ${metadata.midi_settings.prog_change_send_channel}`)
                            : "Off"}
                        </span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">PC RX</span>
                        <span className="compact-value">
                          {metadata.midi_settings.prog_change_receive
                            ? (metadata.midi_settings.prog_change_receive_channel === -1 ? 'Auto' : `Ch ${metadata.midi_settings.prog_change_receive_channel}`)
                            : "Off"}
                        </span>
                      </div>
                    </div>
                  </section>
                  )}

                  {/* MIDI Channels */}
                  {metadata.midi_settings && (
                  <section className="overview-section">
                    <h2>MIDI Channels</h2>
                    <div className="compact-grid">
                      {metadata.midi_settings.trig_channels.map((ch, idx) => (
                        <div key={idx} className="compact-item">
                          <span className="compact-label">T{idx + 1}</span>
                          <span className="compact-value">{ch === -1 ? 'Off' : ch}</span>
                        </div>
                      ))}
                      <div className="compact-item">
                        <span className="compact-label">Auto</span>
                        <span className="compact-value">{metadata.midi_settings.auto_channel === -1 ? 'Off' : metadata.midi_settings.auto_channel}</span>
                      </div>
                    </div>
                  </section>
                  )}

                  {/* Mixer Settings */}
                  <section className="overview-section">
                    <h2>Mixer</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Gain AB</span>
                        <span className="compact-value">{metadata.mixer_settings.gain_ab}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Gain CD</span>
                        <span className="compact-value">{metadata.mixer_settings.gain_cd}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Dir AB</span>
                        <span className="compact-value">{metadata.mixer_settings.dir_ab}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Dir CD</span>
                        <span className="compact-value">{metadata.mixer_settings.dir_cd}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Phones</span>
                        <span className="compact-value">{metadata.mixer_settings.phones_mix}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Main</span>
                        <span className="compact-value">{metadata.mixer_settings.main_level}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Cue</span>
                        <span className="compact-value">{metadata.mixer_settings.cue_level}</span>
                      </div>
                    </div>
                  </section>

                  {/* Metronome Settings */}
                  {metadata.metronome_settings && (
                  <section className="overview-section">
                    <h2>Metronome</h2>
                    <div className="compact-grid">
                      <div className="compact-item">
                        <span className="compact-label">Enabled</span>
                        <span className="compact-value">{metadata.metronome_settings.enabled ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Main Vol</span>
                        <span className="compact-value">{metadata.metronome_settings.main_volume}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Cue Vol</span>
                        <span className="compact-value">{metadata.metronome_settings.cue_volume}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Pitch</span>
                        <span className="compact-value">{metadata.metronome_settings.pitch}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Tonal</span>
                        <span className="compact-value">{metadata.metronome_settings.tonal ? "Yes" : "No"}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Preroll</span>
                        <span className="compact-value">{metadata.metronome_settings.preroll}</span>
                      </div>
                      <div className="compact-item">
                        <span className="compact-label">Time Sig</span>
                        <span className="compact-value">{metadata.metronome_settings.time_signature_numerator}/{metadata.metronome_settings.time_signature_denominator}</span>
                      </div>
                    </div>
                  </section>
                  )}
                </div>
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
                    loadedBankIndices={loadedBankIndices}
                    failedBankIndices={failedBankIndices}
                    allBanksLoaded={allBanksLoaded}
                  />

                  <TrackSelector
                    id="parts-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                    audioTrackMachineTypes={audioTrackMachineTypes}
                  />
                </div>

                {loadedBankIndices.size === 0 ? (
                  <div className="loading-section">
                    <div className="loading-spinner"></div>
                    <p>Loading banks...</p>
                  </div>
                ) : (
                <div className="bank-cards">
                  {(() => {
                    // Determine which banks to display (only show loaded banks)
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? Array.from(loadedBankIndices).sort((a, b) => a - b)
                      : loadedBankIndices.has(selectedBankIndex) ? [selectedBankIndex] : [];

                    return banksToDisplay.map((bankIndex) => {
                      const bank = banks[bankIndex];
                      if (!bank) return null;

                      // Determine selected track for PartsPanel
                      let trackForParts: number | undefined;
                      if (selectedTrackIndex === ALL_AUDIO_TRACKS) {
                        trackForParts = ALL_AUDIO_TRACKS; // Show all audio tracks
                      } else if (selectedTrackIndex === ALL_MIDI_TRACKS) {
                        trackForParts = ALL_MIDI_TRACKS; // Show all MIDI tracks
                      } else if (selectedTrackIndex >= 0 && selectedTrackIndex < 8) {
                        trackForParts = selectedTrackIndex; // Show specific audio track
                      } else if (selectedTrackIndex >= 8 && selectedTrackIndex < 16) {
                        trackForParts = selectedTrackIndex; // Show specific MIDI track
                      } else {
                        trackForParts = undefined; // Default to all audio tracks
                      }

                      // Get part names from bank
                      const partNames = bank.parts.map(part => part.name);

                      // Pass initial active part only for the current bank from project state
                      const initialPart = bankIndex === metadata?.current_state.bank ? metadata?.current_state.part : undefined;

                      return (
                        <PartsPanel
                          key={`bank-parts-${bankIndex}`}
                          projectPath={projectPath || ''}
                          bankId={bank.id}
                          bankName={formatBankName(bank.name, bankIndex)}
                          partNames={partNames}
                          selectedTrack={trackForParts}
                          initialActivePart={initialPart}
                          isEditMode={isEditMode}
                          sharedPageIndex={sharedPartsPageIndex}
                          onSharedPageChange={setSharedPartsPageIndex}
                          sharedLfoTab={sharedPartsLfoTab}
                          onSharedLfoTabChange={setSharedPartsLfoTab}
                          sharedActivePartIndex={sharedPartsActivePartIndex}
                          onSharedActivePartChange={setSharedPartsActivePartIndex}
                          onWriteStatusChange={handleWriteStatusChange}
                        />
                      );
                    });
                  })()}
                </div>
                )}
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
                    loadedBankIndices={loadedBankIndices}
                    failedBankIndices={failedBankIndices}
                    allBanksLoaded={allBanksLoaded}
                  />

                  <label className={`toggle-switch ${isPending ? 'pending' : ''}`}>
                    <span className="toggle-label">Hide empty</span>
                    <div className="toggle-slider-container">
                      <input
                        type="checkbox"
                        checked={hideEmptyPatternsVisual}
                        onChange={(e) => {
                          const newValue = e.target.checked;
                          // Update visual state immediately for smooth toggle animation
                          setHideEmptyPatternsVisual(newValue);
                          // Update actual filter state in a transition for smooth UI
                          startTransition(() => {
                            setHideEmptyPatterns(newValue);
                          });
                        }}
                      />
                      <span className="toggle-slider"></span>
                    </div>
                  </label>

                  <label className={`toggle-switch ${isPending ? 'pending' : ''}`}>
                    <span className="toggle-label">Track settings</span>
                    <div className="toggle-slider-container">
                      <input
                        type="checkbox"
                        checked={showTrackSettingsVisual}
                        onChange={(e) => {
                          const newValue = e.target.checked;
                          setShowTrackSettingsVisual(newValue);
                          startTransition(() => {
                            setShowTrackSettings(newValue);
                          });
                        }}
                      />
                      <span className="toggle-slider"></span>
                    </div>
                  </label>

                  <TrackSelector
                    id="patterns-track-select"
                    value={selectedTrackIndex}
                    onChange={setSelectedTrackIndex}
                    currentTrack={metadata?.current_state.track}
                    audioTrackMachineTypes={audioTrackMachineTypes}
                  />
                </div>

                {/* Global indicator filter: toggles apply to every pattern. Legend
                    badges on each pattern card refine this per pattern. */}
                <div className="indicator-filters">
                  <span className="indicator-filters-label">Show:</span>
                  {INDICATOR_DEFS.map((def) => (
                    <button
                      key={def.key}
                      type="button"
                      className={`indicator-filter-chip${hiddenIndicators.includes(def.key) ? ' off' : ''}`}
                      title={`Show or hide ${def.label} indicators in all patterns`}
                      onClick={() => toggleGlobalIndicator(def.key)}
                    >
                      {def.glyph} {def.label}
                    </button>
                  ))}
                </div>

                {loadedBankIndices.size === 0 ? (
                  <div className="loading-section">
                    <div className="loading-spinner"></div>
                    <p>Loading banks...</p>
                  </div>
                ) : (
                <div className="bank-cards">
                  {(() => {
                    // Determine which banks to display (only show loaded banks)
                    const banksToDisplay = selectedBankIndex === ALL_BANKS
                      ? Array.from(loadedBankIndices).sort((a, b) => a - b)
                      : loadedBankIndices.has(selectedBankIndex) ? [selectedBankIndex] : [];

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
                          {/* Track Settings Section */}
                          {showTrackSettings && (() => {
                            // Get pattern 0 for track settings (they're the same across patterns)
                            const pattern0 = bank.parts[0]?.patterns[0];
                            if (!pattern0) return null;

                            // Determine which tracks to display
                            let tracksForSettings: number[];
                            if (selectedTrackIndex === ALL_AUDIO_TRACKS) {
                              tracksForSettings = [0, 1, 2, 3, 4, 5, 6, 7];
                            } else if (selectedTrackIndex === ALL_MIDI_TRACKS) {
                              tracksForSettings = [8, 9, 10, 11, 12, 13, 14, 15];
                            } else {
                              tracksForSettings = [selectedTrackIndex];
                            }

                            return tracksForSettings.map((trackIndex) => {
                              const trackData = pattern0.tracks[trackIndex];
                              return (
                                <div key={`track-settings-${bankIndex}-${trackIndex}`} className="track-settings-card">
                                  <div className="track-settings-header">
                                    <span className="track-settings-title">Track Settings</span>
                                    <TrackBadge trackId={trackData.track_id} />
                                  </div>
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
                              );
                            });
                          })()}
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

                                  // Check if pattern/track has any trigs
                                  const hasAnyTrigs = trackData.steps.slice(0, pattern.length).some(
                                    (step: TrigStep) => step.trigger || step.trigless || step.oneshot || step.plock || step.recorder
                                  );

                                  // Skip empty patterns if hideEmptyPatterns is enabled
                                  if (hideEmptyPatterns && !hasAnyTrigs) {
                                    return null;
                                  }

                                  return (
                                <div key={`pattern-${patternIndex}-track-${trackIndex}`} className="pattern-card">
                            <div className="pattern-header">
                              <span className="pattern-name">{pattern.name}</span>
                              <span className="pattern-part" title={
                                (() => {
                                  const partName = bank.parts[pattern.part_assignment]?.name;
                                  const partNum = pattern.part_assignment + 1;
                                  const label = partName ? `Part ${partNum}: ${partName}` : `Part ${partNum}`;
                                  return `This pattern uses ${label}`;
                                })()
                              }>→ Part {pattern.part_assignment + 1}</span>
                              <TrackBadge trackId={trackData.track_id} />
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

                                  // Effective indicator visibility for this pattern card:
                                  // hidden globally (filter chips) or via this card's legend.
                                  const cardKey = `${bankIndex}-${patternIndex}-${trackIndex}`;
                                  const cardHidden = cardHiddenIndicators[cardKey] ?? [];
                                  const show = (key: string) => !hiddenIndicators.includes(key) && !cardHidden.includes(key);

                                  steps.forEach((step) => {
                                    // One-shot and lock (plock-mask) trigs stand on their own,
                                    // without a trigger/trigless bit.
                                    const hasTrig = step.trigger || step.trigless || step.oneshot || step.plock;
                                    if (!hasTrig && !step.recorder) return; // Only track indicators for steps with trigs

                                    const allNotes = getStepNotes(step, trackData);
                                    if (step.trigger && !(trackData.track_type === "MIDI" && allNotes.length > 0)) usedIndicators.add('trigger');
                                    if (step.trigless) usedIndicators.add('trigless');
                                    if (step.plock) usedIndicators.add('lock');
                                    if (step.plock_count > 0) usedIndicators.add('plock');
                                    if (step.oneshot) usedIndicators.add('oneshot');
                                    if (step.swing) usedIndicators.add('swing');
                                    if (step.slide) usedIndicators.add('slide');
                                    if (step.recorder && !step.recorder_oneshot) usedIndicators.add('recorder');
                                    if (step.recorder_oneshot) usedIndicators.add('recorder-oneshot');
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
                                          const hasTrig = step.trigger || step.trigless || step.oneshot || step.plock;
                                          const trigTypes = [];
                                          if (step.trigger) trigTypes.push('trigger');
                                          if (step.trigless) trigTypes.push('trigless');
                                          if (step.plock) trigTypes.push('lock');
                                          if (step.oneshot) trigTypes.push('oneshot');
                                          if (step.swing) trigTypes.push('swing');
                                          if (step.slide) trigTypes.push('slide');
                                          if (step.recorder && !step.recorder_oneshot) trigTypes.push('recorder');
                                          if (step.recorder_oneshot) trigTypes.push('recorder-oneshot');

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
                                    if (step.velocity !== null) tooltipParts.push(`${trackData.track_type === "MIDI" ? "Velocity" : "Volume"}: ${step.velocity}`);
                                    if (step.plock_count > 0) tooltipParts.push(`P-Locks: ${step.plock_count}`);
                                    if (step.sample_slot !== null) tooltipParts.push(`Sample: ${step.sample_slot}`);

                                    // Check if step has any data to display (p-locks, velocity, sample, notes, etc.)
                                    // For MIDI tracks, only show notes if there's a trigger (otherwise it's just showing default note on empty steps)
                                    const hasData = hasTrig || step.plock_count > 0 || step.velocity !== null ||
                                                    step.sample_slot !== null || (allNotes.length > 0 && (hasTrig || trackData.track_type !== "MIDI")) ||
                                                    step.trig_condition || step.trig_repeats > 0 || step.micro_timing ||
                                                    step.swing || step.slide || step.oneshot || step.recorder || step.recorder_oneshot;

                                    return (
                                      <div
                                        key={step.step}
                                        className={`pattern-step ${hasTrig ? 'has-trig' : ''} ${trigTypes.join(' ')} ${selectedStepNumber === step.step ? 'selected' : ''}`}
                                        title={tooltipParts.join('\n')}
                                        onClick={() => setSelectedStepNumber(step.step)}
                                        style={{ cursor: 'pointer' }}
                                      >
                                        <div className="step-number">{step.step + 1}</div>
                                        {hasData && (
                                          <div className="step-indicators">
                                            {/* 1. Trig indicators first */}
                                            {show('trigger') && step.trigger && !(trackData.track_type === "MIDI" && allNotes.length > 0) && <span className="indicator-trigger"><i className="fas fa-circle"></i></span>}
                                            {show('oneshot') && step.oneshot && <span className="indicator-oneshot"><i className="fas fa-circle"></i></span>}
                                            {show('trigless') && step.trigless && <span className="indicator-trigless"><i className="fas fa-circle"></i></span>}
                                            {show('lock') && step.plock && <span className="indicator-lock"><i className="far fa-circle"></i></span>}

                                            {/* 2. MIDI Notes */}
                                            {show('note') && allNotes.length > 0 && (hasTrig || trackData.track_type !== "MIDI") && (
                                              <div className="note-indicator-wrapper">
                                                {allNotes.map((note, idx) => (
                                                  <span key={idx} className={`indicator-note ${chordName ? 'indicator-chord' : ''}`}>
                                                    {noteName(note)}
                                                  </span>
                                                ))}
                                              </div>
                                            )}

                                            {/* 3. P-lock count */}
                                            {show('plock') && step.plock_count === 1 && <span className="indicator-plock">P</span>}
                                            {show('plock') && step.plock_count > 1 && <span className="indicator-plock-count">{step.plock_count}P</span>}

                                            {/* 4. Other indicators */}
                                            {show('slide') && step.slide && <span className="indicator-slide">~</span>}
                                            {show('recorder') && step.recorder && !step.recorder_oneshot && <span className="indicator-recorder">R</span>}
                                            {show('recorder-oneshot') && step.recorder_oneshot && <span className="indicator-recorder-oneshot">R</span>}
                                            {show('condition') && step.trig_condition && <span className="indicator-condition">%</span>}
                                            {show('repeats') && step.trig_repeats > 0 && <span className="indicator-repeats">X</span>}
                                            {show('timing') && step.micro_timing && <span className="indicator-timing">µ</span>}
                                            {show('velocity') && step.velocity !== null && <span className="indicator-velocity">V</span>}
                                            {show('sample') && step.sample_slot !== null && <span className="indicator-sample">S</span>}

                                            {/* 5. Swing last */}
                                            {show('swing') && step.swing && <span className="indicator-swing"><svg viewBox="0 0 20 14" width="13" height="11"><path d="M1 7 C4 1 7 1 10 7 C13 13 16 13 19 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg></span>}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Legend: only indicators actually used and not globally
                                    hidden. Clicking a badge hides/shows that indicator for
                                    this pattern card only. */}
                                {usedIndicators.size > 0 && (
                                  <div className="pattern-grid-legend">
                                    {INDICATOR_DEFS
                                      .filter((def) => usedIndicators.has(def.key) && !hiddenIndicators.includes(def.key))
                                      .map((def) => (
                                        <button
                                          key={def.key}
                                          type="button"
                                          className={`legend-item${cardHidden.includes(def.key) ? ' off' : ''}`}
                                          title={`Show or hide ${def.label} indicators in this pattern`}
                                          onClick={() => toggleCardIndicator(cardKey, def.key)}
                                        >
                                          {def.glyph} {def.key === 'velocity' && trackData.track_type === "MIDI" ? 'Velocity' : def.label}
                                        </button>
                                      ))}
                                  </div>
                                )}

                                {/* Parameter Details Panel */}
                                {selectedStepNumber !== null && (() => {
                                  // Find the step data for this specific pattern/track
                                  const selectedStep = trackData.steps.find(s => s.step === selectedStepNumber);
                                  if (!selectedStep) return null;

                                  return (
                                  <div className="parameter-details-panel">
                                    <div className="parameter-panel-header">
                                      <h4>Step {selectedStep.step + 1} details</h4>
                                      <button onClick={() => setSelectedStepNumber(null)} className="close-button">×</button>
                                    </div>
                                    <div className="parameter-panel-content">
                                      <div className="param-grid">
                                        {/* Trig Information - only show if there's a trig */}
                                        {selectedStep.trigger && <div className="param-item"><span>Trig Type:</span> Trigger</div>}
                                        {selectedStep.trigless && <div className="param-item"><span>Trig Type:</span> Trigless</div>}
                                        {selectedStep.plock && <div className="param-item"><span>Trig Type:</span> Trigless Lock</div>}
                                        {selectedStep.oneshot && <div className="param-item"><span>One-Shot:</span> Yes</div>}
                                        {selectedStep.swing && <div className="param-item"><span>Swing:</span> Yes</div>}
                                        {selectedStep.slide && <div className="param-item"><span>Slide:</span> Yes</div>}
                                        {selectedStep.recorder && <div className="param-item"><span>Recorder Trig:</span> {selectedStep.recorder_oneshot ? 'Yes (One-Shot)' : 'Yes'}</div>}
                                        {selectedStep.trig_condition && <div className="param-item"><span>Condition:</span> {selectedStep.trig_condition}</div>}
                                        {selectedStep.trig_repeats > 0 && <div className="param-item"><span>Repeats:</span> {selectedStep.trig_repeats + 1}x</div>}
                                        {selectedStep.micro_timing && <div className="param-item"><span>Micro-timing:</span> {selectedStep.micro_timing}</div>}
                                        {selectedStep.velocity !== null && <div className="param-item"><span>{trackData.track_type === "MIDI" ? "VEL (Velocity)" : "VOL (Volume)"}:</span> {selectedStep.velocity}</div>}
                                        {(() => {
                                          // A sample p-lock overrides the slot for this step; otherwise a
                                          // normal trig plays the track's part-assigned sample slot.
                                          const slot = selectedStep.sample_slot ?? (selectedStep.trigger ? trackData.assigned_sample_slot : null);
                                          return trackData.track_type !== "MIDI" && slot !== null
                                            ? <div className="param-item"><span>Sample Slot:</span> {slot}</div>
                                            : null;
                                        })()}

                                        {/* Audio P-Locks: Machine Parameters */}
                                        {selectedStep.audio_plocks?.machine?.param1 != null && <div className="param-item"><span>PTCH (Pitch):</span> {selectedStep.audio_plocks?.machine?.param1}</div>}
                                        {selectedStep.audio_plocks?.machine?.param2 != null && (() => {
                                          // In slice mode, STRT selects a slice: the 0-127 range always
                                          // addresses the max 64 slices, 2 per slice, regardless of the
                                          // sample's actual slice count (verified with 4/32/64-slice
                                          // test patterns): slice = value / 2 + 1.
                                          // ponytail: skipped when the step sample-locks another slot,
                                          // whose slice mode we don't know here.
                                          const strt = selectedStep.audio_plocks!.machine!.param2!;
                                          const sliceMode = trackData.slice_count != null && selectedStep.sample_slot === null;
                                          return sliceMode
                                            ? <div className="param-item"><span>STRT (Slice):</span> {Math.floor(strt / 2) + 1}</div>
                                            : <div className="param-item"><span>STRT (Start):</span> {strt}</div>;
                                        })()}
                                        {selectedStep.audio_plocks?.machine?.param3 != null && <div className="param-item"><span>LEN (Length):</span> {selectedStep.audio_plocks?.machine?.param3}</div>}
                                        {selectedStep.audio_plocks?.machine?.param4 != null && <div className="param-item"><span>RATE (Rate):</span> {selectedStep.audio_plocks?.machine?.param4}</div>}
                                        {selectedStep.audio_plocks?.machine?.param5 != null && <div className="param-item"><span>RTRG (Retrigs):</span> {selectedStep.audio_plocks?.machine?.param5}</div>}
                                        {selectedStep.audio_plocks?.machine?.param6 != null && <div className="param-item"><span>RTIM (Retrig Time):</span> {selectedStep.audio_plocks?.machine?.param6}</div>}

                                        {/* Audio P-Locks: LFO Parameters */}
                                        {selectedStep.audio_plocks?.lfo?.spd1 != null && <div className="param-item"><span>LFO1 Speed:</span> {selectedStep.audio_plocks?.lfo?.spd1}</div>}
                                        {selectedStep.audio_plocks?.lfo?.spd2 != null && <div className="param-item"><span>LFO2 Speed:</span> {selectedStep.audio_plocks?.lfo?.spd2}</div>}
                                        {selectedStep.audio_plocks?.lfo?.spd3 != null && <div className="param-item"><span>LFO3 Speed:</span> {selectedStep.audio_plocks?.lfo?.spd3}</div>}
                                        {selectedStep.audio_plocks?.lfo?.dep1 != null && <div className="param-item"><span>LFO1 Depth:</span> {selectedStep.audio_plocks?.lfo?.dep1}</div>}
                                        {selectedStep.audio_plocks?.lfo?.dep2 != null && <div className="param-item"><span>LFO2 Depth:</span> {selectedStep.audio_plocks?.lfo?.dep2}</div>}
                                        {selectedStep.audio_plocks?.lfo?.dep3 != null && <div className="param-item"><span>LFO3 Depth:</span> {selectedStep.audio_plocks?.lfo?.dep3}</div>}

                                        {/* Audio P-Locks: Amp Parameters */}
                                        {selectedStep.audio_plocks?.amp?.atk != null && <div className="param-item"><span>ATK (Attack):</span> {selectedStep.audio_plocks?.amp?.atk}</div>}
                                        {selectedStep.audio_plocks?.amp?.hold != null && <div className="param-item"><span>HOLD (Hold):</span> {selectedStep.audio_plocks?.amp?.hold}</div>}
                                        {selectedStep.audio_plocks?.amp?.rel != null && <div className="param-item"><span>REL (Release):</span> {selectedStep.audio_plocks?.amp?.rel}</div>}
                                                                                {selectedStep.audio_plocks?.amp?.bal != null && <div className="param-item"><span>BAL (Balance):</span> {selectedStep.audio_plocks?.amp?.bal}</div>}
                                        {selectedStep.audio_plocks?.amp?.f != null && <div className="param-item"><span>FILT (Filter):</span> {selectedStep.audio_plocks?.amp?.f}</div>}


                                        {/* MIDI track parameters */}
                                        {trackData.track_type === "MIDI" && (() => {
                                          const allNotes = getStepNotes(selectedStep, trackData);
                                          return (
                                            <>
                                              {allNotes.map((note, idx) => {
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
                                            </>
                                          );
                                        })()}
                                                                                {selectedStep.midi_plocks?.midi?.len != null && <div className="param-item"><span>LEN (Length):</span> {selectedStep.midi_plocks?.midi?.len}</div>}

                                        {/* MIDI P-Locks: LFO Parameters */}
                                        {selectedStep.midi_plocks?.lfo?.spd1 != null && <div className="param-item"><span>LFO1 Speed:</span> {selectedStep.midi_plocks?.lfo?.spd1}</div>}
                                        {selectedStep.midi_plocks?.lfo?.spd2 != null && <div className="param-item"><span>LFO2 Speed:</span> {selectedStep.midi_plocks?.lfo?.spd2}</div>}
                                        {selectedStep.midi_plocks?.lfo?.spd3 != null && <div className="param-item"><span>LFO3 Speed:</span> {selectedStep.midi_plocks?.lfo?.spd3}</div>}
                                        {selectedStep.midi_plocks?.lfo?.dep1 != null && <div className="param-item"><span>LFO1 Depth:</span> {selectedStep.midi_plocks?.lfo?.dep1}</div>}
                                        {selectedStep.midi_plocks?.lfo?.dep2 != null && <div className="param-item"><span>LFO2 Depth:</span> {selectedStep.midi_plocks?.lfo?.dep2}</div>}
                                        {selectedStep.midi_plocks?.lfo?.dep3 != null && <div className="param-item"><span>LFO3 Depth:</span> {selectedStep.midi_plocks?.lfo?.dep3}</div>}
                                      </div>
                                    </div>
                                  </div>
                                  );
                                })()}
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
      </div>
                )}
    </div>
  )}

            {activeTab === "flex-slots" && (
              <SampleSlotsTable
                slots={metadata.sample_slots.flex_slots}
                slotPrefix="F"
                tableType="flex"
                projectPath={projectPath}
                projectName={projectName}
                memorySettings={metadata.memory_settings}
                isEditMode={isEditMode}
                audioPoolPath={audioPoolPath}
                onSlotsUpdated={(updatedSlots) => {
                  // Merge updated slots into metadata
                  setMetadata(prev => {
                    if (!prev) return prev;
                    const newFlexSlots = [...prev.sample_slots.flex_slots];
                    for (const updated of updatedSlots) {
                      const idx = newFlexSlots.findIndex(s => s.slot_id === updated.slot_id);
                      if (idx >= 0) {
                        newFlexSlots[idx] = updated;
                      }
                    }
                    return {
                      ...prev,
                      sample_slots: {
                        ...prev.sample_slots,
                        flex_slots: newFlexSlots,
                      },
                    };
                  });
                }}
                onFlexRamUpdated={(freeMb, freeBytes) => {
                  setMetadata(prev => {
                    if (!prev) return prev;
                    return { ...prev, memory_settings: { ...prev.memory_settings, flex_ram_free_mb: freeMb, flex_ram_free_bytes: freeBytes ?? undefined } };
                  });
                }}
                onImportToAudioPool={(paths, destPath) => {
                  setIsTransferQueueOpen(true);
                  copyFilesToPool(paths, destPath);
                }}
                onImportToProject={importToProjectWithProgress}
                sidebarRefreshTrigger={sidebarRefreshTrigger}
                transfersOpen={isTransferQueueOpen}
                transferCount={transfers.length}
                transfersActive={activeTransfersCount > 0}
                transfersSucceeded={allTransfersSucceeded}
                transfersFailed={hasFailedTransfers}
                onToggleTransfers={() => setIsTransferQueueOpen(!isTransferQueueOpen)}
                onDragStateChange={(active) => { isDraggingRef.current = active; }}
              />
            )}

            {activeTab === "static-slots" && (
              <SampleSlotsTable
                slots={metadata.sample_slots.static_slots}
                slotPrefix="S"
                tableType="static"
                projectPath={projectPath}
                projectName={projectName}
                isEditMode={isEditMode}
                audioPoolPath={audioPoolPath}
                onSlotsUpdated={(updatedSlots) => {
                  // Merge updated slots into metadata
                  setMetadata(prev => {
                    if (!prev) return prev;
                    const newStaticSlots = [...prev.sample_slots.static_slots];
                    for (const updated of updatedSlots) {
                      const idx = newStaticSlots.findIndex(s => s.slot_id === updated.slot_id);
                      if (idx >= 0) {
                        newStaticSlots[idx] = updated;
                      }
                    }
                    return {
                      ...prev,
                      sample_slots: {
                        ...prev.sample_slots,
                        static_slots: newStaticSlots,
                      },
                    };
                  });
                }}
                onImportToAudioPool={(paths, destPath) => {
                  setIsTransferQueueOpen(true);
                  copyFilesToPool(paths, destPath);
                }}
                onImportToProject={importToProjectWithProgress}
                sidebarRefreshTrigger={sidebarRefreshTrigger}
                transfersOpen={isTransferQueueOpen}
                transferCount={transfers.length}
                transfersActive={activeTransfersCount > 0}
                transfersSucceeded={allTransfersSucceeded}
                transfersFailed={hasFailedTransfers}
                onToggleTransfers={() => setIsTransferQueueOpen(!isTransferQueueOpen)}
                onDragStateChange={(active) => { isDraggingRef.current = active; }}
              />
            )}

            {activeTab === "tools" && projectPath && (
              <ToolsPanel
                projectPath={projectPath}
                projectName={projectName || ""}
                banks={banks}
                loadedBankIndices={loadedBankIndices}
                onBankUpdated={reloadBank}
                onProjectRefresh={refreshProjectData}
              />
            )}

          </div>
        </div>
      )}
      <ScrollToTop />
      {toast && (
        <div className="toast-notification">
          <i className="fas fa-check"></i> {toast}
        </div>
      )}

      {/* Transfer progress panel for audio pool imports (bottom overlay) */}
      <TransferProgressPanel
        transfers={transfers}
        isOpen={isTransferQueueOpen}
        onClose={() => setIsTransferQueueOpen(false)}
        onCancelTransfer={cancelTransfer}
        onClearFinished={clearFinishedTransfers}
        onClearAll={clearAllTransfers}
        height={transferPaneHeight}
        onResizeStart={handleTransferResizeStart}
        className="transfer-queue-overlay"
      />

      {/* Overwrite confirmation modal for audio pool imports */}
      <OverwriteModal
        isOpen={overwriteModal.isOpen}
        fileName={overwriteModal.fileName}
        remainingFiles={overwriteModal.pendingFiles.slice(overwriteModal.currentIndex)}
        onOverwrite={handleOverwrite}
        onOverwriteAll={handleOverwriteAll}
        onSkip={handleSkip}
        onSkipAll={handleSkipAll}
        onCancel={handleCancelImport}
      />
    </main>
  );
}

export default ProjectDetail;
