import { useState, useRef, useEffect, useTransition, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useTablePreferences } from "../context/TablePreferencesContext";
import type { SlotUsageEntry } from "../context/ProjectsContext";
import { AudioPoolSidebar } from "./AudioPoolSidebar";
import { formatFileSize } from "./AudioFileTable";
import { useAudioPreview, shouldAutoPreview, scrubTarget, volumeStep, isAudioFile } from '../hooks/useAudioPreview';
import { SamplePlayerBar } from './SamplePlayerBar';

// Droppable slot row for dnd-kit (pointer-based, cross-platform)
function DroppableSlotRow({
  slotId,
  className,
  disabled,
  children,
  ...rest
}: {
  slotId: number;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${slotId}`,
    data: { type: 'slot', slotId },
    disabled,
  });
  return (
    <tr
      ref={setNodeRef}
      data-slot-id={slotId}
      className={`${className || ''} ${isOver ? 'drop-target-highlight' : ''}`.trim()}
      {...rest}
    >
      {children}
    </tr>
  );
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
  compatibility: string | null; // "compatible", "wrong_rate", "incompatible", "unknown"
  file_format: string | null; // "WAV", "AIFF", etc.
  bit_depth: number | null; // 16, 24, etc.
  sample_rate: number | null; // 44100, 48000, etc.
  ot_size_bytes?: number | null; // PCM data size as the OT measures it
  attributes_at_default?: boolean; // audio-editor attributes equal OT defaults (reset is a no-op)
}

interface MemorySettings {
  record_24bit: boolean;
  reserved_recorder_count: number;
  reserved_recorder_length: number;
  flex_ram_free_mb: number;       // truncated MiB (for display)
  flex_ram_free_bytes?: number;   // exact free bytes (for drop validation)
}

interface SlotAssignment {
  slot_index: number;
  audio_path: string;
  set_defaults: boolean;
}

interface AssignSamplesResult {
  assigned_count: number;
  updated_slots: SampleSlot[];
  flex_ram_free_mb: number | null;
  flex_ram_free_bytes?: number | null;
}

interface SampleSlotsTableProps {
  slots: SampleSlot[];
  slotPrefix: string; // "F" for Flex, "S" for Static
  tableType: 'flex' | 'static'; // Identify which table this is
  projectPath?: string | null; // Project path for tooltip display
  projectName?: string | null; // Project name (for navigating back from the Audio Pool page)
  memorySettings?: MemorySettings; // Memory settings for Flex RAM capacity display
  isEditMode?: boolean; // Whether edit mode is active
  audioPoolPath?: string | null; // Path to AUDIO/ directory (null if not in a Set)
  onSlotsUpdated?: (updatedSlots: SampleSlot[]) => void; // Callback when slots are assigned
  onFlexRamUpdated?: (freeMb: number, freeBytes?: number | null) => void; // Callback when flex RAM changes after assignment
  onImportToAudioPool?: (paths: string[], destPath: string) => void; // Callback to import files to audio pool (uses parent's transfer hook)
  onImportToProject?: (sourcePaths: string[]) => Promise<string[]>; // Copy files into the project dir via the transfer pane; resolves with dest paths
  sidebarRefreshTrigger?: number; // Increment to trigger sidebar refresh from parent
  onPoolFixed?: () => void; // Pool files converted in place — project slot paths may have changed
  onOpenFixProjectSamples?: () => void; // Health glyph clicked — parent should open Tools > Fix Project Samples
  // Transfers panel toggle (rendered in the toolbar so it stays visible on slot tabs)
  transfersOpen?: boolean;
  transferCount?: number;
  transfersActive?: boolean;
  transfersSucceeded?: boolean;
  transfersFailed?: boolean;
  onToggleTransfers?: () => void;
  // Fired when a dnd-kit drag starts/ends so the parent can suppress Escape-to-leave mid-drag.
  onDragStateChange?: (active: boolean) => void;
  // Per-slot usage lists (indexed by 0-based slot id); undefined while still computing.
  slotUsage?: SlotUsageEntry[][];
}

type SortColumn = 'slot' | 'sample' | 'status' | 'used' | 'source' | 'gain' | 'timestretch' | 'loop' | 'compatibility' | 'format' | 'bitdepth' | 'samplerate' | 'size';
type SortDirection = 'asc' | 'desc';

const BANK_LETTERS = 'ABCDEFGHIJKLMNOP';

// A slot "has a [SAMPLE] block" in the project file when it references a sample or carries any
// slot-tied attribute. Truly-empty slots (never assigned, no stored attributes) have all null.
function slotHasBlock(s: SampleSlot): boolean {
  return !!s.path || s.gain != null || s.loop_mode != null || s.timestretch_mode != null;
}

// Helper function to extract filename from path
function getFilename(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/); // Split by both forward and backward slashes
  return parts[parts.length - 1] || '';
}

// Helper function to extract directory path (without filename)
function getDirectoryPath(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/); // Split by both forward and backward slashes
  parts.pop(); // Remove filename
  return parts.join('/') + '/';
}

// Collapse '.' and '..' segments into a clean absolute path. The asset protocol
// returns 403 for any path containing '..' (traversal protection) and does not
// resolve it like the OS does, so sample paths (stored as ../AUDIO/...) must be
// normalized before convertFileSrc.
export function normalizePath(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return (isAbs ? '/' : '') + out.join('/');
}

// Helper function to extract Set-relative path (SetName/ProjectName/)
function getSetRelativePath(projectPath: string | null): string {
  if (!projectPath) return '';
  const parts = projectPath.split(/[\\/]/).filter(p => p); // Split and remove empty parts
  // Get last two parts: SetName/ProjectName
  if (parts.length >= 2) {
    return parts.slice(-2).join('/') + '/';
  } else if (parts.length === 1) {
    return parts[0] + '/';
  }
  return projectPath;
}

export function SampleSlotsTable({ slots, slotPrefix, tableType, projectPath, projectName, memorySettings, isEditMode, audioPoolPath, onSlotsUpdated, onFlexRamUpdated, onImportToAudioPool, onImportToProject, sidebarRefreshTrigger, onPoolFixed, onOpenFixProjectSamples, transfersOpen, transferCount, transfersActive, transfersSucceeded, transfersFailed, onToggleTransfers, onDragStateChange, slotUsage }: SampleSlotsTableProps) {
  const navigate = useNavigate();
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dndDragFiles, setDndDragFiles] = useState<string[]>([]);
  const [viewModeToast, setViewModeToast] = useState(false);
  // Transient notice for drop validation feedback (skipped files, RAM limits, etc.)
  const [notice, setNotice] = useState<{ message: string; kind: 'warning' | 'info' } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((message: string, kind: 'warning' | 'info' = 'warning') => {
    setNotice({ message, kind });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  // Right-click context menu on slot rows
  const [slotMenu, setSlotMenu] = useState<{ x: number; y: number; slot: SampleSlot } | null>(null);
  // Row selection (same interaction model as the Audio Pool tables)
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [lastClickedSlotId, setLastClickedSlotId] = useState<number | null>(null);
  // Bumped to clear the Audio Pool pane's selection (slot and pane selections are exclusive).
  const [clearSidebarToken, setClearSidebarToken] = useState(0);
  // Which pane keyboard arrows act on. Forced to 'slots' whenever the sidebar is hidden.
  const [activePane, setActivePane] = useState<'slots' | 'pool'>('slots');

  const player = useAudioPreview();
  const [activePlayable, setActivePlayable] = useState(false);

  // Drive preview from a clicked slot row or a pool file. Slot paths are stored
  // relative to the project dir (e.g. ../AUDIO/x.wav); pool paths are already
  // absolute. convertFileSrc needs an absolute path, so resolve relative ones.
  const resolveSlotPath = useCallback((path: string | null) => {
    const isAbsolute = !!path && (path.startsWith('/') || /^[A-Za-z]:/.test(path));
    const joined = !path ? null : isAbsolute ? path : (projectPath ? `${projectPath}/${path}` : null);
    return joined ? normalizePath(joined) : null;
  }, [projectPath]);

  const previewCandidate = useCallback((path: string | null, name: string, selectionSize: number, fileExists: boolean = true) => {
    const resolved = resolveSlotPath(path);
    // Only preview real audio files that exist on disk; non-audio, empty, or missing-file
    // selections reset the bar to idle and are never read/decoded (a huge non-audio file
    // can't freeze the UI, and a missing file can't error mid-read).
    const playable = !!resolved && isAudioFile(resolved) && fileExists;
    setActivePlayable(playable);
    if (!playable) { player.reset(); return; }
    if (shouldAutoPreview(player.autoPreview, selectionSize, playable)) {
      player.play(resolved, name);
    } else {
      player.load(resolved, name);
    }
  }, [player, resolveSlotPath]);

  // Explicit playback (double-click or context-menu Play) — plays regardless of the
  // Auto-preview toggle.
  const slotIsPlayable = useCallback((slot: SampleSlot) => {
    const resolved = resolveSlotPath(slot.path ?? null);
    return !!resolved && isAudioFile(resolved) && slot.file_exists;
  }, [resolveSlotPath]);

  const playSlot = useCallback((slot: SampleSlot) => {
    if (!slotIsPlayable(slot)) return;
    setActivePlayable(true);
    player.play(resolveSlotPath(slot.path ?? null)!, getFilename(slot.path ?? null));
  }, [slotIsPlayable, resolveSlotPath, player]);

  // Keyboard up/down over the slot list: move the cursor, single-select, preview.
  // Depends on sortedSlots, defined further down, so read it lazily via a ref.
  const sortedSlotsRef = useRef<SampleSlot[]>([]);
  const moveSlotSelection = useCallback((delta: number) => {
    const list = sortedSlotsRef.current;
    if (list.length === 0) return;
    const curIdx = lastClickedSlotId != null ? list.findIndex(s => s.slot_id === lastClickedSlotId) : -1;
    const base = curIdx < 0 ? (delta > 0 ? -1 : 0) : curIdx;
    const next = Math.min(list.length - 1, Math.max(0, base + delta));
    const slot = list[next];
    if (!slot) return;
    setClearSidebarToken(t => t + 1);
    setSelectedSlots(new Set([slot.slot_id]));
    setLastClickedSlotId(slot.slot_id);
    previewCandidate(slot.path ?? null, getFilename(slot.path ?? null), 1, slot.file_exists);
  }, [lastClickedSlotId, previewCandidate]);

  // Keep the cursor row visible after keyboard navigation. block:'nearest' is a no-op
  // when the row is already on screen, so mouse clicks do not cause jarring scrolls.
  useEffect(() => {
    if (lastClickedSlotId == null) return;
    document.querySelector('.slots-table tr.cursor')?.scrollIntoView({ block: 'nearest' });
  }, [lastClickedSlotId]);

  const { flexPreferences, staticPreferences, setFlexPreferences, setStaticPreferences } = useTablePreferences();

  // Get the preferences for this table type
  const prefs = tableType === 'flex' ? flexPreferences : staticPreferences;
  const setPrefs = tableType === 'flex' ? setFlexPreferences : setStaticPreferences;

  const [sortColumn, setSortColumn] = useState<SortColumn>(prefs.sortColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>(prefs.sortDirection);

  // Filter state
  const [searchText, setSearchText] = useState(prefs.searchText);
  const [compatibilityFilter, setCompatibilityFilter] = useState<string>(prefs.compatibilityFilter);
  const [statusFilter, setStatusFilter] = useState<string>(prefs.statusFilter);
  const [hideEmpty, setHideEmpty] = useState(prefs.hideEmpty);
  const [hideEmptyVisual, setHideEmptyVisual] = useState(prefs.hideEmpty); // Immediate visual state for toggle
  const [isPending, startTransition] = useTransition();
  const [usageFilter, setUsageFilter] = useState<string>(prefs.usageFilter);
  const [sourceFilter, setSourceFilter] = useState<string>(prefs.sourceFilter);
  const [gainFilter, setGainFilter] = useState<string>(prefs.gainFilter);
  const [timestretchFilter, setTimestretchFilter] = useState<string>(prefs.timestretchFilter);
  const [loopFilter, setLoopFilter] = useState<string>(prefs.loopFilter);
  const [formatFilter, setFormatFilter] = useState<string>(prefs.formatFilter);
  const [bitDepthFilter, setBitDepthFilter] = useState<string>(prefs.bitDepthFilter);
  const [sampleRateFilter, setSampleRateFilter] = useState<string>(prefs.sampleRateFilter);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState(prefs.visibleColumns);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  // Column sizing state (initialized to fit header labels + sort indicator + filter icon)
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({
    slot: 80, sample: 200, compatibility: 120, status: 100,
    // wide enough for both usage badges (green + gray) on one line
    used: 150,
    source: 110, gain: 85, timestretch: 140, loop: 100,
    format: 100, bitdepth: 80, samplerate: 80, size: 95,
  });
  const resizingColRef = useRef<string | null>(null);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartSizeRef = useRef<number>(0);

  // Column order and drag-over state for column reorder
  const [columnOrder, setColumnOrder] = useState<string[]>(['slot', 'sample', 'compatibility', 'status', 'used', 'source', 'gain', 'timestretch', 'loop', 'format', 'bitdepth', 'samplerate', 'size']);

  // Where this slot is used across the project (machine assignments + sample locks)
  const usageEntries = useCallback(
    (slot: SampleSlot): SlotUsageEntry[] => slotUsage?.[slot.slot_id - 1] ?? [],
    [slotUsage]
  );
  // Popover listing a slot's usages, anchored at the clicked badge and scoped
  // to the badge's kind (audible usages vs never-trigged references)
  const [usagePopover, setUsagePopover] = useState<{ x: number; y: number; slot: SampleSlot; scope: 'audible' | 'referenced' } | null>(null);
  useEffect(() => {
    if (!usagePopover) return;
    const close = () => setUsagePopover(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUsagePopover(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [usagePopover]);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // Copy to clipboard state
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');

  // Audio Pool sidebar state
  const [showAudioPool, setShowAudioPool] = useState(false);
  const savedColumnsRef = useRef<typeof visibleColumns | null>(null);

  // When the sidebar opens, stash current columns and show only essentials;
  // when it closes, restore the stashed set.
  const toggleAudioPool = (open: boolean) => {
    if (open && !showAudioPool) {
      savedColumnsRef.current = { ...visibleColumns };
      setVisibleColumns({
        slot: true, sample: true, compatibility: true, status: true, used: false,
        source: false, gain: false, timestretch: false, loop: false,
        format: false, bitdepth: false, samplerate: false, size: false,
      });
    } else if (!open && showAudioPool && savedColumnsRef.current) {
      setVisibleColumns(savedColumnsRef.current);
      savedColumnsRef.current = null;
    }
    setShowAudioPool(open);
  };
  const [dragOverSlotId, setDragOverSlotId] = useState<number | null>(null);
  // Internal busy flag (kept for guarding async ops; no longer surfaced as a badge —
  // the transfers progress pane provides feedback instead).
  const [, setIsAssigning] = useState(false);

  // OS drag & drop state (from system file manager)
  const [osDragOverSlotId, setOsDragOverSlotId] = useState<number | null>(null);
  const [osDragOverSidebar, setOsDragOverSidebar] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  // Refs for stable access inside the OS drag async listener
  const slotsRef = useRef(slots);
  const projectPathRef = useRef(projectPath);
  const audioPoolPathRef = useRef(audioPoolPath);
  const onImportToAudioPoolRef = useRef(onImportToAudioPool);
  const onImportToProjectRef = useRef(onImportToProject);
  const sidebarCurrentPathRef = useRef<string | null>(null);
  // Tracks the current OS drag target so the 'drop' handler doesn't need elementFromPoint
  const osDragTargetRef = useRef<{ slotId: number | null; sidebar: boolean }>({ slotId: null, sidebar: false });
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { projectPathRef.current = projectPath; }, [projectPath]);
  useEffect(() => { audioPoolPathRef.current = audioPoolPath; }, [audioPoolPath]);
  useEffect(() => { onImportToAudioPoolRef.current = onImportToAudioPool; }, [onImportToAudioPool]);
  useEffect(() => { onImportToProjectRef.current = onImportToProject; }, [onImportToProject]);

  // When parent increments sidebarRefreshTrigger, refresh the sidebar file list
  useEffect(() => {
    if (sidebarRefreshTrigger) {
      setSidebarRefreshKey(k => k + 1);
    }
  }, [sidebarRefreshTrigger]);

  // Build a relative path from the audio pool file path to the project directory
  const buildRelativePath = useCallback((audioFilePath: string): string => {
    if (!audioPoolPath) return audioFilePath;
    // Audio Pool files are referenced as ../AUDIO/subdir/file.wav
    // The audioPoolPath ends at the AUDIO directory root
    const audioPoolRoot = audioPoolPath;
    if (audioFilePath.startsWith(audioPoolRoot)) {
      const relativePart = audioFilePath.slice(audioPoolRoot.length).replace(/^[/\\]/, '');
      return `../AUDIO/${relativePart}`;
    }
    // Fallback: just use the filename
    const parts = audioFilePath.split(/[\\/]/);
    return parts[parts.length - 1] || audioFilePath;
  }, [audioPoolPath]);

  // Core assignment logic — shared by all slot-drop/assign entry points. Validates the drop:
  // assigns what fits (single → exact target, multiple → consecutive empty slots), blocks
  // files that would exceed Flex RAM, and warns about skipped/incompatible files.
  const doAssignFiles = useCallback(async (filePaths: string[], targetSlot: SampleSlot) => {
    if (!isEditMode) {
      setViewModeToast(true);
      setTimeout(() => setViewModeToast(false), 2500);
      return;
    }
    if (!projectPath || filePaths.length === 0) return;

    setIsAssigning(true);
    const slotTypeU = tableType === 'flex' ? 'FLEX' : 'STATIC';

    try {
      // Inspect dropped files for OT size + compatibility (best-effort validation inputs).
      const checks: Record<string, { ot_size_bytes: number; compatibility: string }> = {};
      try {
        const results = await invoke<{ path: string; ot_size_bytes: number; compatibility: string }[]>(
          'inspect_audio_files', { paths: filePaths });
        if (Array.isArray(results)) for (const r of results) checks[r.path] = r;
      } catch { /* proceed without size/compat info */ }

      // Flex RAM budget in bytes (Static slots stream from card → no RAM limit). Uses the
      // exact free bytes (not the truncated MiB display value) so a sample that just fits isn't
      // falsely blocked; falls back to the MiB value if the exact figure is unavailable.
      const freeBytes = tableType === 'flex' && memorySettings
        ? (memorySettings.flex_ram_free_bytes ?? Math.floor(memorySettings.flex_ram_free_mb * 1024 * 1024))
        : Infinity;

      const assignments: SlotAssignment[] = [];
      let netBytes = 0;
      let incompatCount = 0;
      let skippedNoSlot = 0;
      let blockedRam = 0;

      if (filePaths.length === 1) {
        const f = filePaths[0];
        const size = checks[f]?.ot_size_bytes ?? 0;
        // Replacing a filled slot frees its current sample, so use the net delta.
        const delta = size - (targetSlot.ot_size_bytes ?? 0);
        if (delta > freeBytes) {
          blockedRam = 1;
        } else {
          assignments.push({ slot_index: targetSlot.slot_id, audio_path: buildRelativePath(f), set_defaults: !targetSlot.path });
          if (checks[f] && checks[f].compatibility !== 'compatible') incompatCount++;
        }
      } else {
        let currentSlotId = targetSlot.slot_id;
        for (let i = 0; i < filePaths.length; i++) {
          const f = filePaths[i];
          while (currentSlotId <= 128) {
            const slot = slots.find(s => s.slot_id === currentSlotId);
            if (!slot || !slot.path) break;
            currentSlotId++;
          }
          if (currentSlotId > 128) { skippedNoSlot = filePaths.length - i; break; }
          const size = checks[f]?.ot_size_bytes ?? 0;
          if (netBytes + size > freeBytes) { blockedRam = filePaths.length - i; break; }
          assignments.push({ slot_index: currentSlotId, audio_path: buildRelativePath(f), set_defaults: true });
          netBytes += size;
          if (checks[f] && checks[f].compatibility !== 'compatible') incompatCount++;
          currentSlotId++;
        }
      }

      if (assignments.length > 0) {
        const result = await invoke<AssignSamplesResult>("assign_samples_to_slots", {
          path: projectPath, slotType: slotTypeU, assignments,
        });
        if (onSlotsUpdated && result.updated_slots.length > 0) onSlotsUpdated(result.updated_slots);
        if (onFlexRamUpdated && result.flex_ram_free_mb != null) onFlexRamUpdated(result.flex_ram_free_mb, result.flex_ram_free_bytes);
      }

      // Surface validation feedback.
      const warns: string[] = [];
      if (skippedNoSlot > 0) warns.push(`${skippedNoSlot} skipped (not enough empty slots)`);
      if (blockedRam > 0) warns.push(`${blockedRam} skipped (not enough Flex RAM)`);
      if (incompatCount > 0) warns.push(`${incompatCount} not OT-compatible (may play incorrectly)`);
      if (warns.length > 0) {
        const prefix = assignments.length > 0 ? `Assigned ${assignments.length}. ` : 'Nothing assigned. ';
        showNotice(prefix + warns.join('; '));
      }
    } catch (error) {
      console.error("Error assigning samples to slots:", error);
    } finally {
      setIsAssigning(false);
    }
  }, [isEditMode, projectPath, tableType, slots, memorySettings, buildRelativePath, onSlotsUpdated, onFlexRamUpdated, showNotice]);

  // Live ref so the mount-time OS drag-drop listener can call the latest doAssignFiles.
  const doAssignFilesRef = useRef(doAssignFiles);
  useEffect(() => { doAssignFilesRef.current = doAssignFiles; });

  // Assign files to the first empty slot (context-menu action from the Audio Pool pane).
  const assignToFirstEmpty = useCallback((paths: string[]) => {
    const firstEmpty = slots.find(s => !s.path);
    if (!firstEmpty) {
      setViewModeToast(false);
      return;
    }
    doAssignFiles(paths, firstEmpty);
  }, [slots, doAssignFiles]);

  // Assign files starting at the currently-selected slot (cursor, else lowest selected id).
  const assignToSelected = useCallback((paths: string[]) => {
    const targetId = lastClickedSlotId != null && selectedSlots.has(lastClickedSlotId)
      ? lastClickedSlotId
      : Math.min(...Array.from(selectedSlots));
    const target = slots.find(s => s.slot_id === targetId);
    if (target) doAssignFiles(paths, target);
  }, [slots, selectedSlots, lastClickedSlotId, doAssignFiles]);

  const slotType = tableType === 'flex' ? 'FLEX' : 'STATIC';

  // Clear the sample assigned to a slot (slot becomes empty).
  // The slots a context-menu action targets: the whole selection when the right-clicked
  // slot is part of a multi-selection, otherwise just that slot.
  const menuTargetSlots = useCallback((slot: SampleSlot): SampleSlot[] => {
    if (selectedSlots.size > 1 && selectedSlots.has(slot.slot_id)) {
      return slots.filter(s => selectedSlots.has(s.slot_id));
    }
    return [slot];
  }, [selectedSlots, slots]);

  // Clear the sample from every given slot that has one, keeping the slot's attributes
  // (only the PATH is blanked). One batched write.
  const clearSlots = useCallback(async (targets: SampleSlot[]) => {
    if (!isEditMode || !projectPath) return;
    const ids = targets.filter(s => s.path).map(s => s.slot_id);
    if (ids.length === 0) return;
    setIsAssigning(true);
    try {
      const result = await invoke<AssignSamplesResult>("clear_sample_keep_attributes", {
        path: projectPath, slotType, slotIndices: ids,
      });
      if (onSlotsUpdated && result.updated_slots.length > 0) onSlotsUpdated(result.updated_slots);
      if (onFlexRamUpdated && result.flex_ram_free_mb != null) onFlexRamUpdated(result.flex_ram_free_mb, result.flex_ram_free_bytes);
    } catch (error) {
      console.error("Error clearing sample slot(s):", error);
    } finally {
      setIsAssigning(false);
    }
  }, [isEditMode, projectPath, slotType, onSlotsUpdated, onFlexRamUpdated]);

  // Delete the entire [SAMPLE] block for every target slot that has one, returning it to the
  // hardware's fully-empty state (no sample, attributes back to OT defaults). For slots still
  // referencing a sample, first back up + delete the sibling .ot so it can't re-impose attributes
  // if that audio is assigned again later. Works even on already-cleared slots (blank PATH but a
  // lingering block) — the block is dropped regardless.
  const clearAndResetSlots = useCallback(async (targets: SampleSlot[]) => {
    if (!isEditMode || !projectPath) return;
    const blocks = targets.filter(slotHasBlock);
    const ids = blocks.map(s => s.slot_id);
    if (ids.length === 0) return;
    const filledIds = blocks.filter(s => s.path).map(s => s.slot_id);
    setIsAssigning(true);
    try {
      if (filledIds.length > 0) {
        await invoke("reset_slot_attributes", { path: projectPath, slotType, slotIndices: filledIds });
      }
      const result = await invoke<AssignSamplesResult>("clear_sample_slots", {
        path: projectPath, slotType, slotIndices: ids,
      });
      if (onSlotsUpdated && result.updated_slots.length > 0) onSlotsUpdated(result.updated_slots);
      if (onFlexRamUpdated && result.flex_ram_free_mb != null) onFlexRamUpdated(result.flex_ram_free_mb, result.flex_ram_free_bytes);
    } catch (error) {
      console.error("Error deleting sample slot block(s):", error);
    } finally {
      setIsAssigning(false);
    }
  }, [isEditMode, projectPath, slotType, onSlotsUpdated, onFlexRamUpdated]);

  // Reset the given slots' audio-editor attributes to OT defaults. Attributes are tied to the
  // slot (not the audio file), so this also applies to empty slots; the backend additionally
  // deletes any sibling .ot file (after backing it up). Keeps each sample assigned.
  const resetSlotsAttributes = useCallback(async (targets: SampleSlot[]) => {
    if (!isEditMode || !projectPath) return;
    const slotIndices = targets.map(s => s.slot_id);
    if (slotIndices.length === 0) return;
    setIsAssigning(true);
    try {
      const result = await invoke<AssignSamplesResult>("reset_slot_attributes", {
        path: projectPath, slotType, slotIndices,
      });
      if (onSlotsUpdated && result.updated_slots.length > 0) onSlotsUpdated(result.updated_slots);
      if (onFlexRamUpdated && result.flex_ram_free_mb != null) onFlexRamUpdated(result.flex_ram_free_mb, result.flex_ram_free_bytes);
    } catch (error) {
      console.error("Error resetting slot attribute(s):", error);
    } finally {
      setIsAssigning(false);
    }
  }, [isEditMode, projectPath, slotType, onSlotsUpdated, onFlexRamUpdated]);

  // Delete-key behavior, per selected slot: a slot with a sample is cleared (keeping its
  // attributes); a slot without a sample has its attributes reset. So pressing Delete twice
  // first removes the sample, then clears the attributes.
  const handleDeleteKey = useCallback(async () => {
    const sel = slots.filter(s => selectedSlots.has(s.slot_id));
    const filled = sel.filter(s => s.path);
    const empty = sel.filter(s => !s.path);
    if (filled.length > 0) await clearSlots(filled);
    if (empty.length > 0) await resetSlotsAttributes(empty);
  }, [slots, selectedSlots, clearSlots, resetSlotsAttributes]);

  // Copy source files into the project dir, then assign (with validation) from `targetSlot`.
  const importPathsToSlot = useCallback(async (sourcePaths: string[], targetSlot: SampleSlot) => {
    if (!isEditMode || !projectPath || sourcePaths.length === 0) return;
    // Prefer the transfer pipeline (opens the progress pane); fall back to a direct copy.
    const destPaths = onImportToProject
      ? await onImportToProject(sourcePaths)
      : await invoke<string[]>('copy_audio_files_to_project', { sourcePaths, destinationDir: projectPath });
    if (!destPaths || destPaths.length === 0) return;
    await doAssignFiles(destPaths, targetSlot);
  }, [isEditMode, projectPath, onImportToProject, doAssignFiles]);

  // Import one or more audio files from the system and assign them starting at the slot.
  const importFilesToSlot = useCallback(async (slot: SampleSlot) => {
    if (!isEditMode) return;
    const selected = await openFileDialog({
      multiple: true,
      filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await importPathsToSlot(paths, slot);
  }, [isEditMode, importPathsToSlot]);

  // Import a directory of audio files; each file fills a consecutive empty slot from the target.
  const importDirectoryToSlot = useCallback(async (slot: SampleSlot) => {
    if (!isEditMode) return;
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    const files = await invoke<string[]>('list_audio_files_recursive', { path: selected });
    if (files.length === 0) return;
    await importPathsToSlot(files, slot);
  }, [isEditMode, importPathsToSlot]);

  // Convert a single incompatible slot's file to Octatrack format in place (context-menu action).
  const [convertingSlotIds, setConvertingSlotIds] = useState<Set<number>>(new Set());
  const convertSlotFileInline = useCallback(async (slot: SampleSlot) => {
    if (!slot.path || !projectPath) return;
    const isAbsolute = slot.path.startsWith('/') || /^[A-Za-z]:/.test(slot.path);
    const absolutePath = normalizePath(isAbsolute ? slot.path : `${projectPath}/${slot.path}`);
    setConvertingSlotIds(prev => new Set(prev).add(slot.slot_id));
    try {
      const result = await invoke<{ outcomes: { old_path: string; new_path: string | null; error: string | null }[] }>('fix_project_samples', {
        projectPath,
        filePaths: [absolutePath],
        transferId: `ctx-fix-slot-${Date.now()}`,
      });
      const failed = result.outcomes.find(o => o.error);
      if (failed) {
        showNotice(`Could not convert: ${failed.error}`, 'warning');
      } else {
        showNotice('Converted to Octatrack format', 'info');
        onPoolFixed?.();
      }
    } catch (err) {
      showNotice(`Error converting: ${err}`, 'warning');
    } finally {
      setConvertingSlotIds(prev => {
        const next = new Set(prev);
        next.delete(slot.slot_id);
        return next;
      });
    }
  }, [projectPath, onPoolFixed, showNotice]);

  // Navigate to the full Audio Pool page for this Set, remembering where we came from.
  const openAudioPoolPage = useCallback(() => {
    if (!audioPoolPath) return;
    const setName = audioPoolPath.replace(/[/\\]AUDIO[/\\]?$/i, '').split(/[/\\]/).pop() || 'Audio Pool';
    const params = new URLSearchParams({
      path: audioPoolPath,
      name: setName,
      fromTab: tableType === 'flex' ? 'flex-slots' : 'static-slots',
    });
    if (projectPath) params.set('fromPath', projectPath);
    if (projectName) params.set('fromName', projectName);
    navigate(`/audio-pool?${params.toString()}`);
  }, [audioPoolPath, navigate, tableType, projectPath, projectName]);

  // Import audio files from the system into the Audio Pool (current sidebar dir).
  const importToPool = useCallback((paths: string[], destDir: string) => {
    if (onImportToAudioPool) onImportToAudioPool(paths, destDir);
  }, [onImportToAudioPool]);

  // Close the slot context menu on outside click / Escape
  useEffect(() => {
    if (!slotMenu) return;
    const close = () => setSlotMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSlotMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [slotMenu]);

  // Focus stays on the slots when there is no Audio Pool pane to move to.
  useEffect(() => { if (!showAudioPool) setActivePane('slots'); }, [showAudioPool]);

  // Keyboard shortcuts. Player controls (Space, Ctrl+arrows) work regardless of pane;
  // 'a' toggles the pane; Delete clears slots; Left/Right switch panes; Up/Down move
  // the slot cursor when the slots pane is active (the sidebar handles its own up/down).
  // Ignored while typing in a field or with a context menu open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (slotMenu) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = !!t && (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable);

      // Space: play/pause. Skip when a button/select/link/field is focused so it does not double-fire.
      if (e.key === ' ' && !typing) {
        if (tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'A') { e.preventDefault(); player.togglePlay(); }
        return;
      }
      // Shift+Enter: toggle Auto-preview.
      if (e.key === 'Enter' && e.shiftKey && !typing) { e.preventDefault(); player.setAutoPreview(!player.autoPreview); return; }
      // Shift+L: toggle Loop.
      if ((e.key === 'L' || e.key === 'l') && e.shiftKey && !typing) { e.preventDefault(); player.setLoop(!player.loop); return; }
      // Ctrl/Cmd + arrows: scrub the playhead / adjust volume.
      if ((e.ctrlKey || e.metaKey) && !typing) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(scrubTarget(player.currentTime, player.duration, -1)); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(scrubTarget(player.currentTime, player.duration, 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); player.setVolume(volumeStep(player.volume, 1)); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); player.setVolume(volumeStep(player.volume, -1)); return; }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // any other modifier combo is not ours
      if (typing) return;

      if ((e.key === 'a' || e.key === 'A') && audioPoolPath) { e.preventDefault(); toggleAudioPool(!showAudioPool); return; }
      if ((e.key === 't' || e.key === 'T') && onToggleTransfers) { e.preventDefault(); onToggleTransfers(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && isEditMode && selectedSlots.size > 0) { e.preventDefault(); handleDeleteKey(); return; }

      // Left/Right switch the focused pane (pool sits on the left, slots on the right).
      if (e.key === 'ArrowLeft') { if (showAudioPool) { e.preventDefault(); setActivePane('pool'); } return; }
      if (e.key === 'ArrowRight') { if (showAudioPool) { e.preventDefault(); setActivePane('slots'); } return; }

      // Up/Down move the slot cursor only when the slots pane is active.
      const poolActive = showAudioPool && activePane === 'pool';
      if (!poolActive) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSlotSelection(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveSlotSelection(-1); return; }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [audioPoolPath, showAudioPool, isEditMode, selectedSlots, slotMenu, handleDeleteKey, player, activePane, moveSlotSelection, onToggleTransfers]);

  // Expand any dragged/dropped directories into their (recursive) audio files so the
  // copy/assign flows never choke on a folder. Plain audio files pass through unchanged.
  const expandPaths = useCallback(async (paths: string[]): Promise<string[]> => {
    try {
      const out = await invoke<string[]>('expand_audio_paths', { paths });
      return Array.isArray(out) ? out : paths;
    } catch {
      return paths;
    }
  }, []);

  // Handle drop on a slot row (HTML5 drag — works on Linux; macOS uses dnd-kit via handleDndDragEnd)
  const handleSlotDrop = useCallback(async (e: React.DragEvent, targetSlot: SampleSlot) => {
    e.preventDefault();
    setDragOverSlotId(null);
    if (!projectPath) return;
    try {
      const jsonData = e.dataTransfer.getData("application/json");
      if (!jsonData) return;
      const dragData = JSON.parse(jsonData);
      if (dragData.source !== "audio-pool-sidebar") return;
      const rawPaths: string[] = dragData.files;
      if (!rawPaths || rawPaths.length === 0) return;
      const filePaths = await expandPaths(rawPaths);
      if (filePaths.length === 0) return;
      await doAssignFiles(filePaths, targetSlot);
    } catch (error) {
      console.error("Error parsing drag data:", error);
    }
  }, [projectPath, doAssignFiles, expandPaths]);

  // dnd-kit drag end — used on macOS where HTML5 drag events don't work in WKWebView
  const handleDndDragEnd = useCallback(async (event: DragEndEvent) => {
    setDndDragFiles([]);
    onDragStateChange?.(false);
    const { active, over } = event;
    if (!over) return;
    const sourceData = active.data.current as { source?: string; files?: string[] } | undefined;
    const targetData = over.data.current as { type?: string; slotId?: number } | undefined;
    if (sourceData?.source !== 'audio-pool-sidebar' || targetData?.type !== 'slot') return;
    const targetSlotId = targetData.slotId!;
    const targetSlot = slots.find(s => s.slot_id === targetSlotId);
    if (!targetSlot) return;
    const filePaths = await expandPaths(sourceData.files ?? []);
    if (filePaths.length === 0) return;
    await doAssignFiles(filePaths, targetSlot);
  }, [slots, doAssignFiles, expandPaths, onDragStateChange]);

  const handleSlotDragOver = useCallback((e: React.DragEvent, slotId: number) => {
    // Always prevent default to avoid text selection during drag
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverSlotId(slotId);
  }, []);

  const handleSlotDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleSlotDragLeave = useCallback(() => {
    setDragOverSlotId(null);
  }, []);

  // Save preferences whenever they change
  useEffect(() => {
    setPrefs({
      sortColumn,
      sortDirection,
      searchText,
      compatibilityFilter,
      statusFilter,
      hideEmpty,
      usageFilter,
      sourceFilter,
      gainFilter,
      timestretchFilter,
      loopFilter,
      formatFilter,
      bitDepthFilter,
      sampleRateFilter,
      visibleColumns,
    });
  }, [
    sortColumn,
    sortDirection,
    searchText,
    compatibilityFilter,
    statusFilter,
    hideEmpty,
    usageFilter,
    sourceFilter,
    gainFilter,
    timestretchFilter,
    loopFilter,
    formatFilter,
    bitDepthFilter,
    sampleRateFilter,
    visibleColumns,
    setPrefs,
  ]);

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Persist/restore the pane state + scroll position so a round-trip to the Audio Pool
  // page returns the user exactly where they were (session-scoped, per project + tab).
  const restoredViewRef = useRef(false);
  useEffect(() => {
    if (restoredViewRef.current || !projectPath) return;
    const wantPane = sessionStorage.getItem(`slotsPane:${projectPath}:${tableType}`) === '1';
    if (wantPane && !audioPoolPath) return; // wait until the pool path is known
    restoredViewRef.current = true;
    if (wantPane && audioPoolPath) toggleAudioPool(true);
    const sc = sessionStorage.getItem(`slotsScroll:${projectPath}:${tableType}`);
    if (sc != null) {
      const top = Number(sc);
      requestAnimationFrame(() => { if (dropdownRef.current) dropdownRef.current.scrollTop = top; });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPoolPath, projectPath, tableType]);
  useEffect(() => {
    if (projectPath && restoredViewRef.current) {
      sessionStorage.setItem(`slotsPane:${projectPath}:${tableType}`, showAudioPool ? '1' : '0');
    }
  }, [showAudioPool, projectPath, tableType]);

  // Handle dropdown toggle with position calculation
  const handleDropdownToggle = (dropdownName: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (openDropdown === dropdownName) {
      setOpenDropdown(null);
      setDropdownPosition(null);
    } else {
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.right - 120, // Align right edge of dropdown with button
      });
      setOpenDropdown(dropdownName);
    }
  };

  // Close dropdown helper
  const closeDropdown = () => {
    setOpenDropdown(null);
    setDropdownPosition(null);
  };

  // Click outside to close dropdown
  useEffect(() => {
    if (!openDropdown) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      // Check if click is inside a filter dropdown (rendered via portal)
      const isInsideDropdown = target.closest('.filter-dropdown');
      // Check if click is inside a filter button
      const isInsideFilterButton = target.closest('.filter-icon');

      if (!isInsideDropdown && !isInsideFilterButton) {
        setOpenDropdown(null);
        setDropdownPosition(null);
      }
    }
    // Use setTimeout to avoid closing immediately on the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [openDropdown]);

  // Close column menu when clicking outside
  useEffect(() => {
    function handleColumnMenuClickOutside(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    document.addEventListener('mousedown', handleColumnMenuClickOutside);
    return () => document.removeEventListener('mousedown', handleColumnMenuClickOutside);
  }, []);

  // OS drag & drop from system file manager (Phase 5: slot rows, Phase 6: sidebar).
  // Active in both modes: pool imports work read-only, slot drops warn unless in Edit mode.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onDragDropEvent(async (event) => {
        // Tauri v2 reports DragDrop `position` in physical px on Windows/Linux but in
        // logical (CSS) px on macOS. elementFromPoint wants CSS px, so only divide by
        // the device scale off-macOS. ponytail: pinned to Tauri 2.x macOS behavior.
        const isMac = navigator.userAgent.includes('Macintosh');
        const scale = isMac ? 1 : (window.devicePixelRatio || 1);

        if (event.payload.type === 'over') {
          const x = event.payload.position.x / scale;
          const y = event.payload.position.y / scale;
          const el = document.elementFromPoint(x, y);
          if (el?.closest('.sidebar-os-drop-zone')) {
            osDragTargetRef.current = { slotId: null, sidebar: true };
            setOsDragOverSidebar(true);
            setOsDragOverSlotId(null);
          } else {
            setOsDragOverSidebar(false);
            const row = el?.closest('[data-slot-id]');
            if (row) {
              const id = parseInt(row.getAttribute('data-slot-id') ?? '', 10);
              const slotId = isNaN(id) ? null : id;
              osDragTargetRef.current = { slotId, sidebar: false };
              setOsDragOverSlotId(slotId);
            } else {
              osDragTargetRef.current = { slotId: null, sidebar: false };
              setOsDragOverSlotId(null);
            }
          }
        } else if (event.payload.type === 'leave') {
          osDragTargetRef.current = { slotId: null, sidebar: false };
          setOsDragOverSlotId(null);
          setOsDragOverSidebar(false);
        } else if (event.payload.type === 'drop') {
          const droppedPaths = event.payload.paths;
          // Use the target tracked during 'over' events — elementFromPoint is
          // unreliable at drop time because the OS takes control of the cursor
          const { slotId: targetSlotId, sidebar: targetIsSidebar } = osDragTargetRef.current;
          osDragTargetRef.current = { slotId: null, sidebar: false };

          setOsDragOverSlotId(null);
          setOsDragOverSidebar(false);

          if (!droppedPaths || droppedPaths.length === 0) return;

          // Expand dropped folders into their (recursive) audio files — copy/assign can't
          // handle directories ("Use copy_files_with_overwrite for directories").
          let paths = droppedPaths;
          try {
            const out = await invoke<string[]>('expand_audio_paths', { paths: droppedPaths });
            if (Array.isArray(out)) paths = out;
          } catch { /* fall back to the raw paths */ }
          if (paths.length === 0) {
            showNotice('No supported audio files in the dropped items.');
            return;
          }

          const curProjectPath = projectPathRef.current;
          const curAudioPoolPath = audioPoolPathRef.current;

          if (targetIsSidebar && curAudioPoolPath) {
            // Phase 6: drop on Audio Pool sidebar — import to currently browsed dir
            const destDir = sidebarCurrentPathRef.current ?? curAudioPoolPath;
            if (onImportToAudioPoolRef.current) {
              // Use parent's transfer hook for progress tracking and overwrite handling
              onImportToAudioPoolRef.current(paths, destDir);
              // sidebarRefreshKey will be incremented via sidebarRefreshTrigger from parent's onComplete
            } else {
              // Fallback: simple copy + local refresh
              try {
                await invoke('copy_audio_files', {
                  sourcePaths: paths,
                  destinationDir: destDir,
                  overwrite: false,
                });
                setSidebarRefreshKey(k => k + 1);
              } catch (err) {
                console.error('OS sidebar drop failed:', err);
              }
            }
          } else if (targetSlotId != null) {
            // Slot assignment requires Edit mode — warn and bail otherwise.
            if (!isEditMode) {
              setViewModeToast(true);
              setTimeout(() => setViewModeToast(false), 2500);
              return;
            }
            // Phase 5: drop on a slot row — copy to project dir, then assign (validated).
            if (curProjectPath) {
              const targetSlot = slotsRef.current.find(s => s.slot_id === targetSlotId);
              if (!targetSlot) return;
              try {
                // Route through the transfer pane when available so progress is visible.
                const destPaths = onImportToProjectRef.current
                  ? await onImportToProjectRef.current(paths)
                  : await invoke<string[]>('copy_audio_files_to_project', {
                      sourcePaths: paths,
                      destinationDir: curProjectPath,
                    });
                if (!destPaths || destPaths.length === 0) return;
                await doAssignFilesRef.current(destPaths, targetSlot);
              } catch (err) {
                console.error('OS slot drop failed:', err);
              }
            }
          }
        }
      }).then(fn => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });
    }).catch(() => { /* Tauri runtime unavailable — OS drag-drop disabled */ });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isEditMode, tableType]);

  // Toggle column visibility
  const toggleColumn = (column: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  // Column resize handler — tracks mouse movement until mouseup
  function startResize(e: React.MouseEvent, colId: string) {
    e.preventDefault();
    e.stopPropagation();
    resizingColRef.current = colId;
    resizeStartXRef.current = e.clientX;
    resizeStartSizeRef.current = columnSizing[colId] ?? 80;
    function onMove(me: MouseEvent) {
      if (!resizingColRef.current) return;
      const newSize = Math.max(30, resizeStartSizeRef.current + me.clientX - resizeStartXRef.current);
      setColumnSizing(prev => ({ ...prev, [resizingColRef.current!]: newSize }));
    }
    function onUp() {
      resizingColRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleColDragStart(e: React.DragEvent, colId: string) {
    e.dataTransfer.setData('text/plain', colId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleColDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColId(colId);
  }
  function handleColDrop(e: React.DragEvent, targetColId: string) {
    e.preventDefault();
    setDragOverColId(null);
    const srcColId = e.dataTransfer.getData('text/plain');
    if (!srcColId || srcColId === targetColId) return;
    setColumnOrder(prev => {
      const next = [...prev];
      const from = next.indexOf(srcColId);
      const to = next.indexOf(targetColId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, srcColId);
      return next;
    });
  }
  function handleColDragLeave() {
    setDragOverColId(null);
  }

  // Copy table data to clipboard in TSV format (for Excel/Google Sheets)
  const copyTableToClipboard = async (slotsData: SampleSlot[]) => {
    const headers: string[] = [];
    if (visibleColumns.slot) headers.push('Slot');
    if (visibleColumns.sample) headers.push('Sample');
    if (visibleColumns.compatibility) headers.push('Compatibility');
    if (visibleColumns.status) headers.push('Status');
    if (visibleColumns.used) headers.push('Usage');
    if (visibleColumns.source) headers.push('Source');
    if (visibleColumns.gain) headers.push('Gain');
    if (visibleColumns.timestretch) headers.push('Timestretch');
    if (visibleColumns.loop) headers.push('Loop');
    if (visibleColumns.format) headers.push('Format');
    if (visibleColumns.bitdepth) headers.push('Bit Depth');
    if (visibleColumns.samplerate) headers.push('Sample Rate');
    if (visibleColumns.size) headers.push('Size');

    const rows = slotsData.map(slot => {
      const row: string[] = [];
      if (visibleColumns.slot) row.push(`${slotPrefix}${slot.slot_id}`);
      if (visibleColumns.sample) row.push(slot.path ? getFilename(slot.path) : '');
      if (visibleColumns.compatibility) row.push(slot.file_exists ? (slot.compatibility || '') : '');
      if (visibleColumns.status) row.push(slot.path ? (slot.file_exists ? 'Exists' : 'Missing') : '');
      // "audible/total" (e.g. "2/5" = played in 2 places, 3 more never-trigged references)
      if (visibleColumns.used) {
        const entries = usageEntries(slot);
        row.push(`${entries.filter(e => e.audible).length}/${entries.length}`);
      }
      if (visibleColumns.source) row.push(slot.source_location || '');
      if (visibleColumns.gain) row.push(slot.gain !== null && slot.gain !== undefined ? String(slot.gain) : '');
      if (visibleColumns.timestretch) row.push(slot.timestretch_mode || '');
      if (visibleColumns.loop) row.push(slot.loop_mode || '');
      if (visibleColumns.format) row.push(slot.file_format || '');
      if (visibleColumns.bitdepth) row.push(slot.bit_depth !== null && slot.bit_depth !== undefined ? String(slot.bit_depth) : '');
      if (visibleColumns.samplerate) row.push(slot.sample_rate !== null && slot.sample_rate !== undefined ? String(slot.sample_rate / 1000) : '');
      if (visibleColumns.size) row.push(slot.ot_size_bytes ? formatFileSize(slot.ot_size_bytes) : '');
      return row.join('\t');
    });

    const tsv = [headers.join('\t'), ...rows].join('\n');

    try {
      await navigator.clipboard.writeText(tsv);
      setCopyFeedback('copied');
      setTimeout(() => setCopyFeedback('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  // Helper functions to get unique values
  const getUniqueSources = () => {
    const sources = new Set<string>();
    slots.forEach(slot => {
      if (slot.source_location) {
        sources.add(slot.source_location);
      }
    });
    return Array.from(sources).sort();
  };

  const getUniqueGains = () => {
    const gains = new Set<number>();
    slots.forEach(slot => {
      if (slot.gain !== null && slot.gain !== undefined) {
        gains.add(slot.gain);
      }
    });
    return Array.from(gains).sort((a, b) => a - b);
  };

  const getUniqueTimestretches = () => {
    const modes = new Set<string>();
    slots.forEach(slot => {
      if (slot.timestretch_mode) {
        modes.add(slot.timestretch_mode);
      }
    });
    return Array.from(modes).sort();
  };

  const getUniqueLoopModes = () => {
    const modes = new Set<string>();
    slots.forEach(slot => {
      if (slot.loop_mode) {
        modes.add(slot.loop_mode);
      }
    });
    return Array.from(modes).sort();
  };

  const getUniqueFormats = () => {
    const formats = new Set<string>();
    slots.forEach(slot => {
      if (slot.file_format) {
        formats.add(slot.file_format);
      }
    });
    return Array.from(formats).sort();
  };

  const getUniqueBitDepths = () => {
    const bitDepths = new Set<number>();
    slots.forEach(slot => {
      if (slot.bit_depth !== null && slot.bit_depth !== undefined) {
        bitDepths.add(slot.bit_depth);
      }
    });
    return Array.from(bitDepths).sort((a, b) => a - b);
  };

  const getUniqueSampleRates = () => {
    const sampleRates = new Set<number>();
    slots.forEach(slot => {
      if (slot.sample_rate !== null && slot.sample_rate !== undefined) {
        sampleRates.add(slot.sample_rate);
      }
    });
    return Array.from(sampleRates).sort((a, b) => a - b);
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const filterSlots = (slotsToFilter: SampleSlot[]) => {
    return slotsToFilter.filter((slot) => {
      // Filter by empty slots
      if (hideEmpty && !slot.path) {
        return false;
      }

      // Filter by search text
      if (searchText) {
        const filename = getFilename(slot.path);
        if (!filename.toLowerCase().includes(searchText.toLowerCase())) {
          return false;
        }
      }

      // Filter by compatibility
      if (compatibilityFilter !== 'all') {
        if (slot.compatibility !== compatibilityFilter) {
          return false;
        }
      }

      // Filter by status
      if (statusFilter === 'exists' && !slot.file_exists) {
        return false;
      }
      if (statusFilter === 'missing' && slot.file_exists) {
        return false;
      }

      // Filter by usage: used = audibly played somewhere; referenced = has at
      // least one non-audible reference (machine assignment without trigs),
      // audible usage elsewhere doesn't disqualify it; unused = none.
      if (usageFilter !== 'all') {
        const entries = usageEntries(slot);
        const audibleCount = entries.filter(e => e.audible).length;
        if (usageFilter === 'used' && audibleCount === 0) return false;
        if (usageFilter === 'referenced' && audibleCount === entries.length) return false;
        if (usageFilter === 'unused' && entries.length > 0) return false;
      }

      // Filter by source
      if (sourceFilter !== 'all') {
        if (slot.source_location !== sourceFilter) {
          return false;
        }
      }

      // Filter by gain
      if (gainFilter !== 'all') {
        const gainValue = slot.gain?.toString();
        if (gainValue !== gainFilter) {
          return false;
        }
      }

      // Filter by timestretch
      if (timestretchFilter !== 'all') {
        if (slot.timestretch_mode !== timestretchFilter) {
          return false;
        }
      }

      // Filter by loop mode
      if (loopFilter !== 'all') {
        if (slot.loop_mode !== loopFilter) {
          return false;
        }
      }

      // Filter by format
      if (formatFilter !== 'all') {
        if (slot.file_format !== formatFilter) {
          return false;
        }
      }

      // Filter by bit depth
      if (bitDepthFilter !== 'all') {
        const bitDepthValue = slot.bit_depth?.toString();
        if (bitDepthValue !== bitDepthFilter) {
          return false;
        }
      }

      // Filter by sample rate
      if (sampleRateFilter !== 'all') {
        const sampleRateValue = slot.sample_rate?.toString();
        if (sampleRateValue !== sampleRateFilter) {
          return false;
        }
      }

      return true;
    });
  };

  const sortSlots = (slotsToSort: SampleSlot[]) => {
    return [...slotsToSort].sort((a, b) => {
      let compareA: any;
      let compareB: any;

      switch (sortColumn) {
        case 'slot':
          compareA = a.slot_id;
          compareB = b.slot_id;
          break;
        case 'sample':
          compareA = getFilename(a.path);
          compareB = getFilename(b.path);
          break;
        case 'status':
          compareA = a.file_exists ? 1 : 0;
          compareB = b.file_exists ? 1 : 0;
          break;
        case 'used':
          // Audible usages dominate, references break ties
          compareA = usageEntries(a).filter(e => e.audible).length * 1000 + usageEntries(a).length;
          compareB = usageEntries(b).filter(e => e.audible).length * 1000 + usageEntries(b).length;
          break;
        case 'source':
          compareA = a.source_location || '';
          compareB = b.source_location || '';
          break;
        case 'gain':
          compareA = a.gain ?? -1;
          compareB = b.gain ?? -1;
          break;
        case 'timestretch':
          compareA = a.timestretch_mode || '';
          compareB = b.timestretch_mode || '';
          break;
        case 'loop':
          compareA = a.loop_mode || '';
          compareB = b.loop_mode || '';
          break;
        case 'compatibility':
          // Sort order: compatible > wrong_rate > unknown > incompatible > null
          const compatOrder: Record<string, number> = {
            'compatible': 4,
            'wrong_rate': 3,
            'unknown': 2,
            'incompatible': 1
          };
          compareA = a.compatibility ? (compatOrder[a.compatibility] ?? 0) : 0;
          compareB = b.compatibility ? (compatOrder[b.compatibility] ?? 0) : 0;
          break;
        case 'format':
          compareA = a.file_format || '';
          compareB = b.file_format || '';
          break;
        case 'bitdepth':
          compareA = a.bit_depth ?? -1;
          compareB = b.bit_depth ?? -1;
          break;
        case 'samplerate':
          compareA = a.sample_rate ?? -1;
          compareB = b.sample_rate ?? -1;
          break;
        case 'size':
          compareA = a.ot_size_bytes ?? -1;
          compareB = b.ot_size_bytes ?? -1;
          break;
        default:
          return 0;
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const filteredSlots = filterSlots(slots);
  const sortedSlots = sortSlots(filteredSlots);
  sortedSlotsRef.current = sortedSlots; // keep the keyboard-nav ref in sync with the visible order

  // Row selection: single click selects, Ctrl/Cmd toggles, Shift extends a range (visible order).
  function handleSlotClick(e: React.MouseEvent, slotId: number) {
    setActivePane('slots'); // clicking a slot moves keyboard focus to the slots pane
    setClearSidebarToken(t => t + 1); // selecting a slot clears the Audio Pool pane selection
    const index = sortedSlots.findIndex(s => s.slot_id === slotId);
    if (e.shiftKey && lastClickedSlotId != null) {
      const lastIndex = sortedSlots.findIndex(s => s.slot_id === lastClickedSlotId);
      if (lastIndex !== -1 && index !== -1) {
        const next = new Set(selectedSlots);
        const [a, b] = [Math.min(lastIndex, index), Math.max(lastIndex, index)];
        for (let i = a; i <= b; i++) next.add(sortedSlots[i].slot_id);
        setSelectedSlots(next);
      }
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedSlots);
      if (next.has(slotId)) next.delete(slotId); else next.add(slotId);
      setSelectedSlots(next);
      setLastClickedSlotId(slotId);
    } else {
      setSelectedSlots(new Set([slotId]));
      setLastClickedSlotId(slotId);
    }

    const clicked = sortedSlots.find(s => s.slot_id === slotId);
    const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
    previewCandidate(clicked?.path ?? null, getFilename(clicked?.path ?? null), hasModifier ? 2 : 1, clicked?.file_exists ?? true);
  }

  // Compute visible column IDs respecting current column order
  const visibleColIds = columnOrder.filter(id => visibleColumns[id as keyof typeof visibleColumns]);

  // Check if any filter is active
  const hasActiveFilters = compatibilityFilter !== 'all' || statusFilter !== 'all' ||
    usageFilter !== 'all' ||
    sourceFilter !== 'all' || gainFilter !== 'all' || timestretchFilter !== 'all' ||
    loopFilter !== 'all' || formatFilter !== 'all' || bitDepthFilter !== 'all' ||
    sampleRateFilter !== 'all';

  // Reset all filters
  const resetAllFilters = () => {
    setCompatibilityFilter('all');
    setStatusFilter('all');
    setUsageFilter('all');
    setSourceFilter('all');
    setGainFilter('all');
    setTimestretchFilter('all');
    setLoopFilter('all');
    setFormatFilter('all');
    setBitDepthFilter('all');
    setSampleRateFilter('all');
  };

  function renderColHeader(colId: string) {
    const COL_LABELS: Record<string, string> = {
      slot: 'Slot', sample: 'Sample', compatibility: 'Compat', status: 'Status',
      used: 'Usage',
      source: 'Source', gain: 'Gain', timestretch: 'Timestretch', loop: 'Loop',
      format: 'Format', bitdepth: 'Bit', samplerate: 'kHz', size: 'Size',
    };
    const FILTERABLE = ['compatibility', 'status', 'used', 'source', 'gain', 'timestretch', 'loop', 'format', 'bitdepth', 'samplerate'];
    const hasFilter = FILTERABLE.includes(colId);
    const isFilterActive: boolean = ({
      compatibility: compatibilityFilter !== 'all',
      status: statusFilter !== 'all',
      used: usageFilter !== 'all',
      source: sourceFilter !== 'all',
      gain: gainFilter !== 'all',
      timestretch: timestretchFilter !== 'all',
      loop: loopFilter !== 'all',
      format: formatFilter !== 'all',
      bitdepth: bitDepthFilter !== 'all',
      samplerate: sampleRateFilter !== 'all',
    } as Record<string, boolean>)[colId] ?? false;

    function renderDropdownOptions() {
      switch (colId) {
        case 'compatibility': return (
          <>
            <label className="dropdown-option"><input type="radio" name="compatibility" checked={compatibilityFilter === 'all'} onChange={() => { setCompatibilityFilter('all'); closeDropdown(); }} /><span>All</span></label>
            <label className="dropdown-option"><input type="radio" name="compatibility" checked={compatibilityFilter === 'compatible'} onChange={() => { setCompatibilityFilter('compatible'); closeDropdown(); }} /><span>Compatible :)</span></label>
            <label className="dropdown-option"><input type="radio" name="compatibility" checked={compatibilityFilter === 'wrong_rate'} onChange={() => { setCompatibilityFilter('wrong_rate'); closeDropdown(); }} /><span>Wrong Rate :|</span></label>
            <label className="dropdown-option"><input type="radio" name="compatibility" checked={compatibilityFilter === 'incompatible'} onChange={() => { setCompatibilityFilter('incompatible'); closeDropdown(); }} /><span>Incompatible :(</span></label>
            <label className="dropdown-option"><input type="radio" name="compatibility" checked={compatibilityFilter === 'unknown'} onChange={() => { setCompatibilityFilter('unknown'); closeDropdown(); }} /><span>Unknown ??</span></label>
          </>
        );
        case 'status': return (
          <>
            <label className="dropdown-option"><input type="radio" name="status" checked={statusFilter === 'all'} onChange={() => { setStatusFilter('all'); closeDropdown(); }} /><span>All</span></label>
            <label className="dropdown-option"><input type="radio" name="status" checked={statusFilter === 'exists'} onChange={() => { setStatusFilter('exists'); closeDropdown(); }} /><span>File Exists</span></label>
            <label className="dropdown-option"><input type="radio" name="status" checked={statusFilter === 'missing'} onChange={() => { setStatusFilter('missing'); closeDropdown(); }} /><span>File Missing</span></label>
          </>
        );
        case 'used': return (
          <>
            <label className="dropdown-option"><input type="radio" name="used" checked={usageFilter === 'all'} onChange={() => { setUsageFilter('all'); closeDropdown(); }} /><span>All</span></label>
            <label className="dropdown-option"><input type="radio" name="used" checked={usageFilter === 'used'} onChange={() => { setUsageFilter('used'); closeDropdown(); }} /><span>Used (plays)</span></label>
            <label className="dropdown-option"><input type="radio" name="used" checked={usageFilter === 'referenced'} onChange={() => { setUsageFilter('referenced'); closeDropdown(); }} /><span>Referenced, not triggered</span></label>
            <label className="dropdown-option"><input type="radio" name="used" checked={usageFilter === 'unused'} onChange={() => { setUsageFilter('unused'); closeDropdown(); }} /><span>Unused</span></label>
          </>
        );
        case 'source': return (
          <>
            <label className="dropdown-option"><input type="radio" name="source" checked={sourceFilter === 'all'} onChange={() => { setSourceFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueSources().map((source) => (
              <label key={source} className="dropdown-option"><input type="radio" name="source" checked={sourceFilter === source} onChange={() => { setSourceFilter(source); closeDropdown(); }} /><span>{source}</span></label>
            ))}
          </>
        );
        case 'gain': return (
          <>
            <label className="dropdown-option"><input type="radio" name="gain" checked={gainFilter === 'all'} onChange={() => { setGainFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueGains().map((gain) => (
              <label key={gain} className="dropdown-option"><input type="radio" name="gain" checked={gainFilter === gain.toString()} onChange={() => { setGainFilter(gain.toString()); closeDropdown(); }} /><span>{gain}</span></label>
            ))}
          </>
        );
        case 'timestretch': return (
          <>
            <label className="dropdown-option"><input type="radio" name="timestretch" checked={timestretchFilter === 'all'} onChange={() => { setTimestretchFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueTimestretches().map((mode) => (
              <label key={mode} className="dropdown-option"><input type="radio" name="timestretch" checked={timestretchFilter === mode} onChange={() => { setTimestretchFilter(mode); closeDropdown(); }} /><span>{mode}</span></label>
            ))}
          </>
        );
        case 'loop': return (
          <>
            <label className="dropdown-option"><input type="radio" name="loop" checked={loopFilter === 'all'} onChange={() => { setLoopFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueLoopModes().map((mode) => (
              <label key={mode} className="dropdown-option"><input type="radio" name="loop" checked={loopFilter === mode} onChange={() => { setLoopFilter(mode); closeDropdown(); }} /><span>{mode}</span></label>
            ))}
          </>
        );
        case 'format': return (
          <>
            <label className="dropdown-option"><input type="radio" name="format" checked={formatFilter === 'all'} onChange={() => { setFormatFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueFormats().map((format) => (
              <label key={format} className="dropdown-option"><input type="radio" name="format" checked={formatFilter === format} onChange={() => { setFormatFilter(format); closeDropdown(); }} /><span>{format}</span></label>
            ))}
          </>
        );
        case 'bitdepth': return (
          <>
            <label className="dropdown-option"><input type="radio" name="bitdepth" checked={bitDepthFilter === 'all'} onChange={() => { setBitDepthFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueBitDepths().map((bitDepth) => (
              <label key={bitDepth} className="dropdown-option"><input type="radio" name="bitdepth" checked={bitDepthFilter === bitDepth.toString()} onChange={() => { setBitDepthFilter(bitDepth.toString()); closeDropdown(); }} /><span>{bitDepth}</span></label>
            ))}
          </>
        );
        case 'samplerate': return (
          <>
            <label className="dropdown-option"><input type="radio" name="samplerate" checked={sampleRateFilter === 'all'} onChange={() => { setSampleRateFilter('all'); closeDropdown(); }} /><span>All</span></label>
            {getUniqueSampleRates().map((sampleRate) => (
              <label key={sampleRate} className="dropdown-option"><input type="radio" name="samplerate" checked={sampleRateFilter === sampleRate.toString()} onChange={() => { setSampleRateFilter(sampleRate.toString()); closeDropdown(); }} /><span>{(sampleRate / 1000).toFixed(1)} kHz</span></label>
            ))}
          </>
        );
        default: return null;
      }
    }

    return (
      <th
        key={colId}
        className={`filterable-header col-${colId}${dragOverColId === colId ? ' col-drag-over' : ''}`}
        style={{
          position: 'relative',
          minWidth: 50,
          // "sample" column has no explicit width — it auto-fills remaining space
          // in the fixed-layout table. All other columns use their sizing value.
          ...(colId !== 'sample' ? { width: showAudioPool
            ? ({ slot: 65, compatibility: 95, status: 85 }[colId] ?? 80)
            : (columnSizing[colId] ?? 80)
          } : {}),
        }}
        onDragOver={(e) => handleColDragOver(e, colId)}
        onDrop={(e) => handleColDrop(e, colId)}
        onDragLeave={handleColDragLeave}
      >
        <div
          className="header-content"
          draggable
          onDragStart={(e) => handleColDragStart(e, colId)}
          style={{ cursor: 'grab' }}
        >
          <span onClick={() => handleSort(colId as SortColumn)} className="sortable-label">
            {COL_LABELS[colId] ?? colId}
          </span>
          {sortColumn === colId && (
            <span className="sort-indicator" onClick={() => handleSort(colId as SortColumn)}>
              {sortDirection === 'asc' ? '▲' : '▼'}
            </span>
          )}
          {hasFilter && (
            <button
              className={`filter-icon ${openDropdown === colId || isFilterActive ? 'active' : ''}`}
              onClick={(e) => handleDropdownToggle(colId, e)}
            >
              ⋮
            </button>
          )}
        </div>
        {hasFilter && openDropdown === colId && dropdownPosition && createPortal(
          <div className="filter-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
            <div className="dropdown-options">
              {renderDropdownOptions()}
            </div>
          </div>,
          document.body
        )}
        <div className="col-resize-handle" onMouseDown={(e) => startResize(e, colId)} onClick={(e) => e.stopPropagation()} />
      </th>
    );
  }

  function renderColCell(colId: string, slot: SampleSlot) {
    switch (colId) {
      case 'slot':
        return <td key={colId} className="col-slot">{slotPrefix}{slot.slot_id}</td>;
      case 'sample':
        return (
          <td key={colId} className="col-sample" title={slot.path ? getFilename(slot.path) : undefined}>
            {slot.path ? getFilename(slot.path) : <em>Empty</em>}
          </td>
        );
      case 'compatibility':
        return (
          <td key={colId} className="compatibility-cell col-compatibility">
            {slot.file_exists && slot.compatibility === 'compatible' && <span className="compat-badge compat-compatible" title="Compatible (WAV/AIFF, 16/24-bit, 44.1kHz)">:)</span>}
            {slot.file_exists && slot.compatibility === 'wrong_rate' && <span className="compat-badge compat-wrong-rate" title="Wrong sample rate (plays at wrong speed)">:|</span>}
            {slot.file_exists && slot.compatibility === 'incompatible' && <span className="compat-badge compat-incompatible" title="Incompatible bit depth)">:(</span>}
            {slot.file_exists && slot.compatibility === 'unknown' && <span className="compat-badge compat-unknown" title="Unrecognized format (not WAV or AIFF)">??</span>}
          </td>
        );
      case 'status':
        return (
          <td key={colId} className="status-cell col-status">
            {slot.path && (
              <span
                className={`file-status-badge ${slot.file_exists ? 'file-exists' : 'file-missing'}`}
                title={slot.file_exists ? 'File exists on disk' : 'File is missing from disk'}
              >
                {slot.file_exists ? '✓' : '✗'}
              </span>
            )}
          </td>
        );
      case 'used': {
        const entries = usageEntries(slot);
        const audibleCount = entries.filter(e => e.audible).length;
        const referencedCount = entries.length - audibleCount;
        const openPopover = (scope: 'audible' | 'referenced') => (e: React.MouseEvent) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setUsagePopover({ x: rect.left, y: rect.bottom + 4, slot, scope });
        };
        return (
          <td key={colId} className="col-used">
            {audibleCount > 0 && (
              <button
                className="usage-badge"
                title={`Played in ${audibleCount} place${audibleCount > 1 ? 's' : ''} - click for details`}
                onClick={openPopover('audible')}
              >
                ✓ {audibleCount}
              </button>
            )}
            {referencedCount > 0 && (
              <button
                className="usage-badge referenced"
                title={`Referenced in ${referencedCount} place${referencedCount > 1 ? 's' : ''} but not triggered - click for details`}
                onClick={openPopover('referenced')}
              >
                ○ {referencedCount}
              </button>
            )}
            {entries.length === 0 && (slotUsage ? (
              <span className="usage-none" title="Not referenced anywhere in this project">—</span>
            ) : (
              <span className="usage-none" title="Computing usage…">…</span>
            ))}
          </td>
        );
      }
      case 'source':
        return <td key={colId} className="col-source" title={slot.source_location === 'Project' ? getSetRelativePath(projectPath ?? null) : getDirectoryPath(slot.path)}>{slot.source_location || '-'}</td>;
      case 'gain':
        return <td key={colId} className="col-gain">{slot.gain !== null && slot.gain !== undefined ? slot.gain : '-'}</td>;
      case 'timestretch':
        return <td key={colId} className="col-timestretch">{slot.timestretch_mode || '-'}</td>;
      case 'loop':
        return <td key={colId} className="col-loop">{slot.loop_mode || '-'}</td>;
      case 'format':
        return <td key={colId} className="col-format">{slot.file_format || '-'}</td>;
      case 'bitdepth':
        return <td key={colId} className="col-bitdepth">{slot.bit_depth !== null && slot.bit_depth !== undefined ? slot.bit_depth : '-'}</td>;
      case 'samplerate':
        return <td key={colId} className="col-samplerate">{slot.sample_rate !== null && slot.sample_rate !== undefined ? (slot.sample_rate / 1000).toFixed(1) : '-'}</td>;
      case 'size':
        return <td key={colId} className="col-size">{slot.ot_size_bytes ? formatFileSize(slot.ot_size_bytes) : '-'}</td>;
      default:
        return null;
    }
  }

  return (
    <>
    <DndContext
      sensors={dndSensors}
      onDragStart={(event) => {
        const data = event.active.data.current as { files?: string[] } | undefined;
        setDndDragFiles(data?.files ?? []);
        onDragStateChange?.(true);
      }}
      onDragEnd={handleDndDragEnd}
      onDragCancel={() => { setDndDragFiles([]); setDragOverSlotId(null); onDragStateChange?.(false); }}
    >
    <div className={`samples-tab ${showAudioPool ? 'with-sidebar' : ''}`}>
      {showAudioPool && audioPoolPath && (
        <div className={`sidebar-os-drop-zone${osDragOverSidebar ? ' os-drag-over' : ''}`}>
          <AudioPoolSidebar
            audioPoolPath={audioPoolPath}
            isEditMode={isEditMode ?? false}
            dndMode={true}
            refreshKey={sidebarRefreshKey}
            clearSelectionToken={clearSidebarToken}
            active={activePane === 'pool'}
            onSelect={() => { setActivePane('pool'); setSelectedSlots(new Set()); setLastClickedSlotId(null); }}
            onCurrentPathChange={(path) => { sidebarCurrentPathRef.current = path; }}
            onImport={importToPool}
            onAssignToFirstEmpty={assignToFirstEmpty}
            hasEmptySlot={slots.some(s => !s.path)}
            onAssignToSelected={assignToSelected}
            hasSelectedSlot={selectedSlots.size > 0}
            onOpenAudioPoolPage={openAudioPoolPage}
            onPoolFixed={onPoolFixed}
            persistKey={projectPath ? `sidebar:${projectPath}:${tableType}` : undefined}
            onActiveFile={(path, name, size) => previewCandidate(path, name, size)}
            onPlayFile={(path, name) => {
              if (!isAudioFile(path)) return;
              setActivePlayable(true);
              player.play(path, name);
            }}
            toggleButton={
              <button
                className={`audio-pool-toggle-btn ${showAudioPool ? 'active' : ''}`}
                onClick={() => toggleAudioPool(!showAudioPool)}
                title="Hide Audio Pool (A)"
              >
                <i className="fas fa-columns"></i>
              </button>
            }
          />
        </div>
      )}
      <section className="samples-section">
        <div className="filter-results-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!showAudioPool && audioPoolPath && (
              <button
                className="audio-pool-toggle-btn"
                onClick={() => toggleAudioPool(true)}
                title={isEditMode ? "Show Audio Pool (A)" : "Show Audio Pool (read-only - toggle Edit mode to assign samples) (A)"}
              >
                <i className="fas fa-columns"></i>
              </button>
            )}
            <span>{sortedSlots.length}/{slots.length} slots</span>
            {memorySettings && (
              <span className="ram-info" title="Flex RAM available for sample loading">
                {showAudioPool ? 'FREE:' : 'FREE MEM:'} {memorySettings.flex_ram_free_mb >= 10
                  ? memorySettings.flex_ram_free_mb.toFixed(1)
                  : memorySettings.flex_ram_free_mb.toFixed(2)} MB
              </span>
            )}
            {compatibilityFilter !== 'all' && <span className="filter-badge">Compat: {compatibilityFilter}</span>}
            {statusFilter !== 'all' && <span className="filter-badge">Status: {statusFilter}</span>}
            {sourceFilter !== 'all' && <span className="filter-badge">Source: {sourceFilter}</span>}
            {gainFilter !== 'all' && <span className="filter-badge">Gain: {gainFilter}</span>}
            {timestretchFilter !== 'all' && <span className="filter-badge">Timestretch: {timestretchFilter}</span>}
            {loopFilter !== 'all' && <span className="filter-badge">Loop: {loopFilter}</span>}
            {formatFilter !== 'all' && <span className="filter-badge">Format: {formatFilter}</span>}
            {bitDepthFilter !== 'all' && <span className="filter-badge">Bit: {bitDepthFilter}</span>}
            {sampleRateFilter !== 'all' && <span className="filter-badge">kHz: {Number(sampleRateFilter) / 1000}</span>}
            {hasActiveFilters && (
              <button
                className="reset-filters-btn"
                onClick={resetAllFilters}
                title="Reset all filters"
              >
                ✕ Reset
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {!showAudioPool && (() => {
              const incompatibleCount = slots.filter(
                s => s.path && s.file_exists && s.compatibility && s.compatibility !== 'compatible'
              ).length;
              return incompatibleCount > 0 ? (
                <button
                  className="pool-health-glyph warning"
                  title={`${incompatibleCount} incompatible audio file${incompatibleCount !== 1 ? 's' : ''} found - click to fix`}
                  onClick={() => onOpenFixProjectSamples?.()}
                >
                  <i className="fas fa-wrench"></i>
                  {incompatibleCount}
                </button>
              ) : (
                <span className="pool-health-glyph ok" title="All referenced samples of this type are compatible with Octatrack">
                  <i className="fas fa-check-circle"></i>
                </span>
              );
            })()}
            <div className="header-search-container">
              <input
                type="text"
                placeholder="Search..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="header-search-input"
              />
              {searchText && (
                <button
                  className="header-search-clear"
                  onClick={() => setSearchText('')}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            <label className={`toggle-switch ${isPending ? 'pending' : ''}`} title="Hide slots with no sample assigned">
              <span className="toggle-label">Hide empty</span>
              <div className="toggle-slider-container">
                <input
                  type="checkbox"
                  checked={hideEmptyVisual}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    // Update visual state immediately for smooth toggle animation
                    setHideEmptyVisual(newValue);
                    // Update actual filter state in a transition for smooth UI
                    startTransition(() => {
                      setHideEmpty(newValue);
                    });
                  }}
                />
                <span className="toggle-slider"></span>
              </div>
            </label>
            {onToggleTransfers && (
              <button
                className={`copy-table-btn ${transfersOpen ? 'active' : ''} ${transfersActive ? 'has-activity' : ''}`}
                onClick={onToggleTransfers}
                title={transfersOpen ? 'Hide transfers' : 'Show transfers'}
              >
                <i className="fas fa-exchange-alt"></i>
                {transferCount ? (
                  <span className={`badge ${transfersSucceeded ? 'badge-success' : ''} ${transfersFailed ? 'badge-error' : ''}`}>{transferCount}</span>
                ) : null}
              </button>
            )}
            <button
              className={`copy-table-btn ${copyFeedback === 'copied' ? 'copied' : ''}`}
              onClick={() => copyTableToClipboard(sortedSlots)}
              title="Copy table to clipboard (for Excel/Google Sheets)"
            >
              {copyFeedback === 'copied' ? '✓' : '⧉'}
            </button>
            <div className="column-visibility-control" ref={columnMenuRef}>
            <button
              className="column-visibility-btn"
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              title="Show/Hide Columns"
            >
              ☰
            </button>
            {showColumnMenu && (
              <div className="column-visibility-menu">
                <div className="column-visibility-header">Show/Hide Columns</div>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.slot}
                    onChange={() => toggleColumn('slot')}
                  />
                  <span>Slot</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.sample}
                    onChange={() => toggleColumn('sample')}
                  />
                  <span>Sample</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.compatibility}
                    onChange={() => toggleColumn('compatibility')}
                  />
                  <span>Compatibility</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.status}
                    onChange={() => toggleColumn('status')}
                  />
                  <span>Status</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.used}
                    onChange={() => toggleColumn('used')}
                  />
                  <span>Usage</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.source}
                    onChange={() => toggleColumn('source')}
                  />
                  <span>Source</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.gain}
                    onChange={() => toggleColumn('gain')}
                  />
                  <span>Gain</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.timestretch}
                    onChange={() => toggleColumn('timestretch')}
                  />
                  <span>Timestretch</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.loop}
                    onChange={() => toggleColumn('loop')}
                  />
                  <span>Loop</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.format}
                    onChange={() => toggleColumn('format')}
                  />
                  <span>Format</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.bitdepth}
                    onChange={() => toggleColumn('bitdepth')}
                  />
                  <span>Bit Depth</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.samplerate}
                    onChange={() => toggleColumn('samplerate')}
                  />
                  <span>Sample Rate</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.size}
                    onChange={() => toggleColumn('size')}
                  />
                  <span>Size</span>
                </label>
              </div>
            )}
            </div>
          </div>
        </div>
        <div
          className="table-wrapper"
          ref={dropdownRef}
          style={{ overflowX: 'auto' }}
          onScroll={(e) => {
            if (projectPath) sessionStorage.setItem(`slotsScroll:${projectPath}:${tableType}`, String((e.currentTarget as HTMLElement).scrollTop));
          }}
        >
          <table className="samples-table slots-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                {visibleColIds.map(colId => renderColHeader(colId))}
              </tr>
            </thead>
          <tbody>
            {sortedSlots.map((slot) => (
              <DroppableSlotRow
                key={slot.slot_id}
                slotId={slot.slot_id}
                className={`${selectedSlots.has(slot.slot_id) ? 'selected' : ''} ${lastClickedSlotId === slot.slot_id ? 'cursor' : ''} ${isEditMode && (dragOverSlotId === slot.slot_id || osDragOverSlotId === slot.slot_id) ? 'drop-target-highlight' : ''}`.trim()}
                onClick={(e: React.MouseEvent) => handleSlotClick(e, slot.slot_id)}
                onDoubleClick={() => playSlot(slot)}
                onDragEnter={handleSlotDragEnter}
                onDragOver={(e: React.DragEvent) => handleSlotDragOver(e, slot.slot_id)}
                onDragLeave={handleSlotDragLeave}
                onDrop={(e: React.DragEvent) => handleSlotDrop(e, slot)}
                onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setSlotMenu({ x: e.clientX, y: e.clientY, slot }); }}
              >
                {visibleColIds.map(colId => renderColCell(colId, slot))}
              </DroppableSlotRow>
            ))}
          </tbody>
        </table>
        </div>
        <SamplePlayerBar player={player} playable={activePlayable} compact={showAudioPool} />
      </section>
    </div>
      <DragOverlay dropAnimation={null}>
        {dndDragFiles.length > 0 ? (
          <div style={{
            background: 'rgba(255, 102, 0, 0.9)',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '0.8rem',
            fontFamily: "'Courier New', monospace",
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            {dndDragFiles.length === 1
              ? dndDragFiles[0].split(/[\\/]/).pop()
              : `${dndDragFiles.length} files`}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
    {viewModeToast && (
      <div className="toast-notification tip">
        <i className="fas fa-lightbulb"></i> Toggle Edit mode to assign samples to slots
      </div>
    )}
    {notice && (
      <div className={`toast-notification ${notice.kind}`}>
        <i className={`fas ${notice.kind === 'warning' ? 'fa-exclamation-triangle' : 'fa-circle-info'}`}></i> {notice.message}
      </div>
    )}
    {usagePopover && createPortal(
      <div
        className="usage-popover"
        style={{ position: 'fixed', top: usagePopover.y, left: usagePopover.x }}
        onClick={(e) => e.stopPropagation()}
      >
        {(() => {
          // Each badge opens its own scope: the green badge lists audible
          // usages, the gray one lists never-trigged references.
          const scoped = usageEntries(usagePopover.slot).filter(
            (e) => e.audible === (usagePopover.scope === 'audible')
          );
          return (
            <>
              <div className="usage-popover-header">
                {usagePopover.scope === 'audible'
                  ? `${slotPrefix}${usagePopover.slot.slot_id} played in ${scoped.length} place${scoped.length > 1 ? 's' : ''}`
                  : `${slotPrefix}${usagePopover.slot.slot_id} referenced in ${scoped.length} place${scoped.length > 1 ? 's' : ''} but not triggered`}
              </div>
              <div className="usage-popover-list">
                {scoped.map((entry, idx) => (
                  <div key={idx} className="usage-popover-entry">
                    {entry.kind === 'machine'
                      ? `Bank ${BANK_LETTERS[entry.bank] ?? '?'} · Part ${(entry.part ?? 0) + 1} · T${entry.track + 1} · Machine`
                      : `Bank ${BANK_LETTERS[entry.bank] ?? '?'} · Pattern ${(entry.pattern ?? 0) + 1} · T${entry.track + 1} · Step ${(entry.step ?? 0) + 1} · Lock`}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>,
      document.body
    )}
    {slotMenu && (
      <div
        className="context-menu"
        style={{ position: 'fixed', top: slotMenu.y, left: slotMenu.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="context-menu-item"
          disabled={!slotIsPlayable(slotMenu.slot)}
          title={slotMenu.slot.path && !slotMenu.slot.file_exists ? 'File not found' : undefined}
          onClick={() => { playSlot(slotMenu.slot); setSlotMenu(null); }}
        >
          <i className="fas fa-play"></i> Play
        </button>
        <div className="context-menu-separator"></div>
        <button
          className="context-menu-item"
          disabled={!isEditMode || !slotHasBlock(slotMenu.slot)}
          title={!isEditMode ? 'Toggle Edit mode to modify slots' : undefined}
          onClick={() => { clearAndResetSlots(menuTargetSlots(slotMenu.slot)); setSlotMenu(null); }}
        >
          <i className="fas fa-trash"></i> {selectedSlots.size > 1 && selectedSlots.has(slotMenu.slot.slot_id) ? 'Clear samples & reset attributes' : 'Clear sample & reset attributes'}
        </button>
        <button
          className="context-menu-item"
          disabled={!isEditMode || !slotMenu.slot.path}
          title={!isEditMode ? 'Toggle Edit mode to modify slots' : undefined}
          onClick={() => { clearSlots(menuTargetSlots(slotMenu.slot)); setSlotMenu(null); }}
        >
          <i className="fas fa-eraser"></i> {selectedSlots.size > 1 && selectedSlots.has(slotMenu.slot.slot_id) ? 'Clear sample assignments' : 'Clear sample assignment'}
        </button>
        <button
          className="context-menu-item"
          disabled={!isEditMode || slotMenu.slot.attributes_at_default}
          title={!isEditMode ? 'Toggle Edit mode to modify slots' : (slotMenu.slot.attributes_at_default ? 'Attributes already at defaults' : undefined)}
          onClick={() => { resetSlotsAttributes(menuTargetSlots(slotMenu.slot)); setSlotMenu(null); }}
        >
          <i className="fas fa-rotate-left"></i> Reset attributes to defaults
        </button>
        <button
          className="context-menu-item"
          disabled={!isEditMode || !slotMenu.slot.path || !slotMenu.slot.file_exists || slotMenu.slot.compatibility === 'compatible' || convertingSlotIds.has(slotMenu.slot.slot_id)}
          title={!isEditMode ? 'Toggle Edit mode to modify slots' : undefined}
          onClick={() => { convertSlotFileInline(slotMenu.slot); setSlotMenu(null); }}
        >
          <i className="fas fa-wrench"></i> Convert to Octatrack format
        </button>
        <div className="context-menu-separator"></div>
        <button
          className="context-menu-item"
          disabled={!isEditMode}
          title={!isEditMode ? 'Toggle Edit mode to modify slots' : undefined}
          onClick={() => { importFilesToSlot(slotMenu.slot); setSlotMenu(null); }}
        >
          <i className="fas fa-file-audio"></i> Import audio file(s) from system…
        </button>
        <button
          className="context-menu-item"
          disabled={!isEditMode}
          title={!isEditMode ? 'Toggle Edit mode to modify slots' : undefined}
          onClick={() => { importDirectoryToSlot(slotMenu.slot); setSlotMenu(null); }}
        >
          <i className="fas fa-folder"></i> Import audio directory from system…
        </button>
        <div className="context-menu-separator"></div>
        <button
          className="context-menu-item"
          disabled={!slotMenu.slot.path || !slotMenu.slot.file_exists}
          title={slotMenu.slot.path && !slotMenu.slot.file_exists ? 'File not found' : undefined}
          onClick={() => {
            if (projectPath && slotMenu.slot.path) {
              invoke('reveal_in_file_manager', { path: `${projectPath}/${slotMenu.slot.path}` });
            }
            setSlotMenu(null);
          }}
        >
          <i className="fas fa-folder-open"></i> Open in file explorer
        </button>
        <button
          className="context-menu-item"
          disabled={!slotMenu.slot.path}
          onClick={() => {
            if (projectPath && slotMenu.slot.path) {
              navigator.clipboard.writeText(`${projectPath}/${slotMenu.slot.path}`);
            }
            setSlotMenu(null);
          }}
        >
          <i className="fas fa-copy"></i> Copy path to clipboard
        </button>
      </div>
    )}
    </>
  );
}
