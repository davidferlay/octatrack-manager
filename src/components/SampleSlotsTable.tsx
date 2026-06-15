import { useState, useRef, useEffect, useTransition, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
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
import { AudioPoolSidebar } from "./AudioPoolSidebar";

// Droppable slot row for dnd-kit (pointer-based, cross-platform)
function DroppableSlotRow({
  slotId,
  className,
  children,
  ...rest
}: {
  slotId: number;
  className?: string;
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${slotId}`,
    data: { type: 'slot', slotId },
  });
  return (
    <tr
      ref={setNodeRef}
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
}

interface MemorySettings {
  record_24bit: boolean;
  reserved_recorder_count: number;
  reserved_recorder_length: number;
  flex_ram_free_mb: number;
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
}

interface SampleSlotsTableProps {
  slots: SampleSlot[];
  slotPrefix: string; // "F" for Flex, "S" for Static
  tableType: 'flex' | 'static'; // Identify which table this is
  projectPath?: string | null; // Project path for tooltip display
  memorySettings?: MemorySettings; // Memory settings for Flex RAM capacity display
  isEditMode?: boolean; // Whether edit mode is active
  audioPoolPath?: string | null; // Path to AUDIO/ directory (null if not in a Set)
  onSlotsUpdated?: (updatedSlots: SampleSlot[]) => void; // Callback when slots are assigned
  onFlexRamUpdated?: (freeMb: number) => void; // Callback when flex RAM changes after assignment
}

type SortColumn = 'slot' | 'sample' | 'status' | 'source' | 'gain' | 'timestretch' | 'loop' | 'compatibility' | 'format' | 'bitdepth' | 'samplerate';
type SortDirection = 'asc' | 'desc';

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

export function SampleSlotsTable({ slots, slotPrefix, tableType, projectPath, memorySettings, isEditMode, audioPoolPath, onSlotsUpdated, onFlexRamUpdated }: SampleSlotsTableProps) {
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dndDragFiles, setDndDragFiles] = useState<string[]>([]);

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

  // Column sizing state (initialized from CSS values; inline style overrides CSS class widths)
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({
    slot: 80, sample: 200, compatibility: 100, status: 90,
    source: 100, gain: 80, timestretch: 140, loop: 120,
    format: 80, bitdepth: 60, samplerate: 70,
  });
  const resizingColRef = useRef<string | null>(null);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartSizeRef = useRef<number>(0);

  // Column order and drag-over state for column reorder
  const [columnOrder, setColumnOrder] = useState<string[]>(['slot', 'sample', 'compatibility', 'status', 'source', 'gain', 'timestretch', 'loop', 'format', 'bitdepth', 'samplerate']);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // Copy to clipboard state
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');

  // Audio Pool sidebar state
  const [showAudioPool, setShowAudioPool] = useState(false);
  const [dragOverSlotId, setDragOverSlotId] = useState<number | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

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

  // Core assignment logic — shared between HTML5 drop and dnd-kit drag end
  const doAssignFiles = useCallback(async (filePaths: string[], targetSlot: SampleSlot) => {
    if (!projectPath || filePaths.length === 0) return;

    setIsAssigning(true);
    const slotType = tableType === 'flex' ? 'FLEX' : 'STATIC';

    try {
      if (filePaths.length === 1) {
        const isEmptySlot = !targetSlot.path;
        const assignments: SlotAssignment[] = [{
          slot_index: targetSlot.slot_id,
          audio_path: buildRelativePath(filePaths[0]),
          set_defaults: isEmptySlot,
        }];
        const result = await invoke<AssignSamplesResult>("assign_samples_to_slots", {
          path: projectPath, slotType, assignments,
        });
        if (onSlotsUpdated && result.updated_slots.length > 0) onSlotsUpdated(result.updated_slots);
        if (onFlexRamUpdated && result.flex_ram_free_mb != null) onFlexRamUpdated(result.flex_ram_free_mb);
      } else {
        const assignments: SlotAssignment[] = [];
        let currentSlotId = targetSlot.slot_id;
        for (const filePath of filePaths) {
          while (currentSlotId <= 128) {
            const slot = slots.find(s => s.slot_id === currentSlotId);
            if (!slot || !slot.path) break;
            currentSlotId++;
          }
          if (currentSlotId > 128) break;
          assignments.push({
            slot_index: currentSlotId,
            audio_path: buildRelativePath(filePath),
            set_defaults: true,
          });
          currentSlotId++;
        }
        if (assignments.length > 0) {
          const result = await invoke<AssignSamplesResult>("assign_samples_to_slots", {
            path: projectPath, slotType, assignments,
          });
          if (onSlotsUpdated && result.updated_slots.length > 0) onSlotsUpdated(result.updated_slots);
          if (onFlexRamUpdated && result.flex_ram_free_mb != null) onFlexRamUpdated(result.flex_ram_free_mb);
        }
      }
    } catch (error) {
      console.error("Error assigning samples to slots:", error);
    } finally {
      setIsAssigning(false);
    }
  }, [projectPath, tableType, slots, buildRelativePath, onSlotsUpdated, onFlexRamUpdated]);

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
      const filePaths: string[] = dragData.files;
      if (!filePaths || filePaths.length === 0) return;
      await doAssignFiles(filePaths, targetSlot);
    } catch (error) {
      console.error("Error parsing drag data:", error);
    }
  }, [projectPath, doAssignFiles]);

  // dnd-kit drag end — used on macOS where HTML5 drag events don't work in WKWebView
  const handleDndDragEnd = useCallback(async (event: DragEndEvent) => {
    setDndDragFiles([]);
    const { active, over } = event;
    if (!over) return;
    const sourceData = active.data.current as { source?: string; files?: string[] } | undefined;
    const targetData = over.data.current as { type?: string; slotId?: number } | undefined;
    if (sourceData?.source !== 'audio-pool-sidebar' || targetData?.type !== 'slot') return;
    const filePaths = sourceData.files ?? [];
    const targetSlotId = targetData.slotId!;
    const targetSlot = slots.find(s => s.slot_id === targetSlotId);
    if (!targetSlot) return;
    await doAssignFiles(filePaths, targetSlot);
  }, [slots, doAssignFiles]);

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
    if (visibleColumns.source) headers.push('Source');
    if (visibleColumns.gain) headers.push('Gain');
    if (visibleColumns.timestretch) headers.push('Timestretch');
    if (visibleColumns.loop) headers.push('Loop');
    if (visibleColumns.format) headers.push('Format');
    if (visibleColumns.bitdepth) headers.push('Bit Depth');
    if (visibleColumns.samplerate) headers.push('Sample Rate');

    const rows = slotsData.map(slot => {
      const row: string[] = [];
      if (visibleColumns.slot) row.push(`${slotPrefix}${slot.slot_id}`);
      if (visibleColumns.sample) row.push(slot.path ? getFilename(slot.path) : '');
      if (visibleColumns.compatibility) row.push(slot.file_exists ? (slot.compatibility || '') : '');
      if (visibleColumns.status) row.push(slot.path ? (slot.file_exists ? 'Exists' : 'Missing') : '');
      if (visibleColumns.source) row.push(slot.source_location || '');
      if (visibleColumns.gain) row.push(slot.gain !== null && slot.gain !== undefined ? String(slot.gain) : '');
      if (visibleColumns.timestretch) row.push(slot.timestretch_mode || '');
      if (visibleColumns.loop) row.push(slot.loop_mode || '');
      if (visibleColumns.format) row.push(slot.file_format || '');
      if (visibleColumns.bitdepth) row.push(slot.bit_depth !== null && slot.bit_depth !== undefined ? String(slot.bit_depth) : '');
      if (visibleColumns.samplerate) row.push(slot.sample_rate !== null && slot.sample_rate !== undefined ? String(slot.sample_rate / 1000) : '');
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

  // Compute visible column IDs respecting current column order
  const visibleColIds = columnOrder.filter(id => visibleColumns[id as keyof typeof visibleColumns]);
  const totalTableWidth = visibleColIds.reduce((sum, id) => sum + (columnSizing[id] ?? 80), 0);

  // Check if any filter is active
  const hasActiveFilters = compatibilityFilter !== 'all' || statusFilter !== 'all' ||
    sourceFilter !== 'all' || gainFilter !== 'all' || timestretchFilter !== 'all' ||
    loopFilter !== 'all' || formatFilter !== 'all' || bitDepthFilter !== 'all' ||
    sampleRateFilter !== 'all';

  // Reset all filters
  const resetAllFilters = () => {
    setCompatibilityFilter('all');
    setStatusFilter('all');
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
      source: 'Source', gain: 'Gain', timestretch: 'Timestretch', loop: 'Loop',
      format: 'Format', bitdepth: 'Bit', samplerate: 'kHz',
    };
    const FILTERABLE = ['compatibility', 'status', 'source', 'gain', 'timestretch', 'loop', 'format', 'bitdepth', 'samplerate'];
    const hasFilter = FILTERABLE.includes(colId);
    const isFilterActive: boolean = ({
      compatibility: compatibilityFilter !== 'all',
      status: statusFilter !== 'all',
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
        style={{ position: 'relative', width: columnSizing[colId] ?? 80 }}
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
          <span className="sort-indicator" onClick={() => handleSort(colId as SortColumn)}>
            {sortColumn === colId && (sortDirection === 'asc' ? '▲' : '▼')}
          </span>
          <span onClick={() => handleSort(colId as SortColumn)} className="sortable-label">
            {COL_LABELS[colId] ?? colId}
          </span>
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
      default:
        return null;
    }
  }

  return (
    <DndContext
      sensors={dndSensors}
      onDragStart={(event) => {
        const data = event.active.data.current as { files?: string[] } | undefined;
        setDndDragFiles(data?.files ?? []);
      }}
      onDragEnd={handleDndDragEnd}
    >
    <div className={`samples-tab ${showAudioPool ? 'with-sidebar' : ''}`}>
      {showAudioPool && audioPoolPath && (
        <AudioPoolSidebar
          audioPoolPath={audioPoolPath}
          isEditMode={isEditMode ?? false}
          dndMode={true}
          toggleButton={
            <button
              className={`audio-pool-toggle-btn ${showAudioPool ? 'active' : ''}`}
              onClick={() => setShowAudioPool(!showAudioPool)}
              title="Hide Audio Pool"
            >
              <i className="fas fa-columns"></i>
            </button>
          }
        />
      )}
      <section className="samples-section">
        <div className="filter-results-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!showAudioPool && audioPoolPath && (
              <button
                className="audio-pool-toggle-btn"
                onClick={() => setShowAudioPool(true)}
                title="Show Audio Pool"
              >
                <i className="fas fa-columns"></i>
              </button>
            )}
            <span>{sortedSlots.length}/{slots.length} slots</span>
            {isAssigning && <span className="filter-badge" style={{ background: 'rgba(245, 158, 11, 0.3)' }}>Assigning...</span>}
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
              </div>
            )}
            </div>
          </div>
        </div>
        <div className="table-wrapper" ref={dropdownRef} style={{ overflowX: 'auto' }}>
          <table className="samples-table" style={{ width: totalTableWidth, minWidth: '100%' }}>
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
                className={dragOverSlotId === slot.slot_id ? 'drop-target-highlight' : ''}
                onDragEnter={handleSlotDragEnter}
                onDragOver={(e: React.DragEvent) => handleSlotDragOver(e, slot.slot_id)}
                onDragLeave={handleSlotDragLeave}
                onDrop={(e: React.DragEvent) => handleSlotDrop(e, slot)}
              >
                {visibleColIds.map(colId => renderColCell(colId, slot))}
              </DroppableSlotRow>
            ))}
          </tbody>
        </table>
        </div>
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
  );
}
