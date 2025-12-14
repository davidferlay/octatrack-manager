import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PartData, PartsDataResponse } from '../context/ProjectsContext';
import { TrackBadge } from './TrackBadge';
import { ALL_MIDI_TRACKS } from './TrackSelector';
import { WriteStatus, writeStatus } from '../types/writeStatus';
import { RotaryKnob } from './RotaryKnob';
import './PartsPanel.css';

interface PartsPanelProps {
  projectPath: string;
  bankId: string;
  bankName: string;
  partNames: string[];  // Array of 4 part names
  selectedTrack?: number;  // 0-7 for T1-T8, 8-15 for M1-M8, -1 for all audio, -2 for all MIDI, undefined = show all audio
  initialActivePart?: number;  // Optional initial active part index (0-3)
  isEditMode?: boolean;  // Global edit mode toggle
  sharedPageIndex?: number;  // Optional shared page index for unified tab selection across banks
  onSharedPageChange?: (index: number) => void;  // Optional callback for shared page change
  sharedLfoTab?: LfoTabType;  // Optional shared LFO tab for unified LFO tab selection across banks
  onSharedLfoTabChange?: (tab: LfoTabType) => void;  // Optional callback for shared LFO tab change
  onPartsChanged?: () => void;  // Optional callback when parts are saved (to invalidate cache)
  onWriteStatusChange?: (status: WriteStatus) => void;  // Optional callback to report write status to parent
}

type AudioPageType = 'ALL' | 'SRC' | 'AMP' | 'LFO' | 'FX1' | 'FX2';
type MidiPageType = 'ALL' | 'NOTE' | 'ARP' | 'LFO' | 'CTRL1' | 'CTRL2';
type LfoTabType = 'LFO1' | 'LFO2' | 'LFO3' | 'DESIGN';

export default function PartsPanel({
  projectPath,
  bankId,
  bankName,
  partNames,
  selectedTrack,
  initialActivePart,
  isEditMode = false,
  sharedPageIndex,
  onSharedPageChange,
  sharedLfoTab,
  onSharedLfoTabChange,
  onPartsChanged,
  onWriteStatusChange
}: PartsPanelProps) {
  const [partsData, setPartsData] = useState<PartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Unified page index: -1=ALL, 0=SRC/NOTE, 1=AMP/ARP, 2=LFO, 3=FX1/CTRL1, 4=FX2/CTRL2
  const [localPageIndex, setLocalPageIndex] = useState<number>(-1);
  const [activePartIndex, setActivePartIndex] = useState<number>(initialActivePart ?? 0);
  const [localLfoTab, setLocalLfoTab] = useState<LfoTabType>('LFO1');

  // Editing state - always editable (like Octatrack behavior)
  // modifiedPartIds tracks which parts have been edited (and auto-saved to parts.unsaved)
  const [isCommitting, setIsCommitting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [modifiedPartIds, setModifiedPartIds] = useState<Set<number>>(new Set());
  // Bank-level state flags from the file (persisted across app restarts)
  // partsEditedBitmask is kept in sync but we use modifiedPartIds for UI logic
  const [, setPartsEditedBitmask] = useState<number>(0);
  const [partsSavedState, setPartsSavedState] = useState<number[]>([0, 0, 0, 0]);

  // Ref for tracking LFO drawing state
  const lfoDrawingRef = useRef<{ isDrawing: boolean; partId: number; section: 'lfos' | 'midi_lfos'; trackId: number } | null>(null);

  // Use shared page index if provided (All banks mode), otherwise use local state
  const activePageIndex = sharedPageIndex !== undefined ? sharedPageIndex : localPageIndex;
  const setActivePageIndex = onSharedPageChange !== undefined ? onSharedPageChange : setLocalPageIndex;

  // Use shared LFO tab if provided (All banks mode), otherwise use local state
  const activeLfoTab = sharedLfoTab !== undefined ? sharedLfoTab : localLfoTab;
  const setActiveLfoTab = onSharedLfoTabChange !== undefined ? onSharedLfoTabChange : setLocalLfoTab;

  // Determine if selected track is MIDI (tracks 8-15 or ALL_MIDI_TRACKS) or Audio (tracks 0-7 or ALL_AUDIO_TRACKS)
  const isMidiTrack = selectedTrack !== undefined && (selectedTrack >= 8 || selectedTrack === ALL_MIDI_TRACKS);

  // Derive the actual page type based on whether we're viewing Audio or MIDI tracks
  const activeAudioPage: AudioPageType = activePageIndex === -1 ? 'ALL' : (['SRC', 'AMP', 'LFO', 'FX1', 'FX2'][activePageIndex] as AudioPageType);
  const activeMidiPage: MidiPageType = activePageIndex === -1 ? 'ALL' : (['NOTE', 'ARP', 'LFO', 'CTRL1', 'CTRL2'][activePageIndex] as MidiPageType);

  // Always use partsData directly - we edit in place and auto-save
  const activePartsData = partsData;

  useEffect(() => {
    loadPartsData();
  }, [projectPath, bankId]);

  const loadPartsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await invoke<PartsDataResponse>('load_parts_data', {
        path: projectPath,
        bankId: bankId
      });
      setPartsData(response.parts);
      setPartsEditedBitmask(response.parts_edited_bitmask);
      setPartsSavedState(response.parts_saved_state);
      // Initialize modifiedPartIds from the bitmask (for parts edited before app opened)
      const editedParts = new Set<number>();
      for (let i = 0; i < 4; i++) {
        if ((response.parts_edited_bitmask & (1 << i)) !== 0) {
          editedParts.add(i);
        }
      }
      setModifiedPartIds(editedParts);
    } catch (err) {
      console.error('Failed to load parts data:', err);
      setError(err as string);
    } finally {
      setLoading(false);
    }
  };

  // Commit part: copy parts.unsaved to parts.saved (like Octatrack's "SAVE" command)
  const commitPart = useCallback(async (partIndex: number) => {
    const partName = partNames[partIndex] || `Part ${partIndex + 1}`;
    try {
      setIsCommitting(true);
      onWriteStatusChange?.(writeStatus.writing(`Saving part ${partName}...`));
      console.log('[PartsPanel] Committing part:', partIndex);
      await invoke('commit_part', {
        path: projectPath,
        bankId: bankId,
        partId: partIndex
      });

      // Remove from modified set after successful commit
      setModifiedPartIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(partIndex);
        return newSet;
      });

      // Update local state: part now has valid saved state, edited flag is cleared
      setPartsSavedState(prev => {
        const newState = [...prev];
        newState[partIndex] = 1;
        return newState;
      });
      setPartsEditedBitmask(prev => prev & ~(1 << partIndex));

      onWriteStatusChange?.(writeStatus.success(`Part ${partName} saved`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);

      // Notify parent to invalidate cache
      if (onPartsChanged) {
        onPartsChanged();
      }
    } catch (err) {
      console.error('Failed to commit part:', err);
      setError(`Failed to save: ${err}`);
      onWriteStatusChange?.(writeStatus.error(`Failed to save part ${partName}`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    } finally {
      setIsCommitting(false);
    }
  }, [projectPath, bankId, partNames, onPartsChanged, onWriteStatusChange]);

  // Commit all parts: copy all parts.unsaved to parts.saved (like Octatrack's "SAVE ALL" command)
  const commitAllParts = useCallback(async () => {
    if (modifiedPartIds.size === 0) return;

    try {
      setIsCommitting(true);
      onWriteStatusChange?.(writeStatus.writing('Saving all parts...'));
      console.log('[PartsPanel] Committing all parts');
      await invoke('commit_all_parts', {
        path: projectPath,
        bankId: bankId
      });

      // Clear all modified indicators
      setModifiedPartIds(new Set());

      // Update local state: all parts now have valid saved state, all edited flags cleared
      setPartsSavedState([1, 1, 1, 1]);
      setPartsEditedBitmask(0);

      onWriteStatusChange?.(writeStatus.success('All parts saved'));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);

      // Notify parent to invalidate cache
      if (onPartsChanged) {
        onPartsChanged();
      }
    } catch (err) {
      console.error('Failed to commit all parts:', err);
      setError(`Failed to save all: ${err}`);
      onWriteStatusChange?.(writeStatus.error('Failed to save all'));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    } finally {
      setIsCommitting(false);
    }
  }, [projectPath, bankId, modifiedPartIds.size, onPartsChanged, onWriteStatusChange]);

  // Reload part: copy parts.saved back to parts.unsaved (like Octatrack's "RELOAD" command)
  // Only available if the part has valid saved state AND has been edited
  const reloadPart = useCallback(async (partIndex: number) => {
    const partName = partNames[partIndex] || `Part ${partIndex + 1}`;
    try {
      setIsReloading(true);
      onWriteStatusChange?.(writeStatus.writing(`Reloading part ${partName}...`));
      console.log('[PartsPanel] Reloading part:', partIndex);
      const reloadedPart = await invoke<PartData>('reload_part', {
        path: projectPath,
        bankId: bankId,
        partId: partIndex
      });

      // Update local state with reloaded data
      setPartsData(prev => {
        const newData = [...prev];
        newData[partIndex] = reloadedPart;
        return newData;
      });

      // Remove from modified set after successful reload
      setModifiedPartIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(partIndex);
        return newSet;
      });

      // Update local state: edited flag is cleared for this part
      setPartsEditedBitmask(prev => prev & ~(1 << partIndex));

      onWriteStatusChange?.(writeStatus.success(`Part ${partName} reloaded`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);

      // Notify parent to invalidate cache
      if (onPartsChanged) {
        onPartsChanged();
      }
    } catch (err) {
      console.error('Failed to reload part:', err);
      setError(`Failed to reload: ${err}`);
      onWriteStatusChange?.(writeStatus.error(`Failed to reload part ${partName}`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    } finally {
      setIsReloading(false);
    }
  }, [projectPath, bankId, partNames, onPartsChanged, onWriteStatusChange]);


  // Generic function to update a parameter value and auto-save to parts.unsaved
  const updatePartParam = useCallback(<T extends keyof PartData>(
    partId: number,
    section: T,
    trackId: number,
    field: string,
    value: number
  ) => {
    // Build the updated part data synchronously from current state
    const partIndex = partsData.findIndex(p => p.part_id === partId);
    if (partIndex === -1) {
      console.error('[PartsPanel] Part not found:', partId);
      return;
    }

    // Deep clone and update the part
    const updatedPart = JSON.parse(JSON.stringify(partsData[partIndex])) as PartData;
    const sectionArray = updatedPart[section] as unknown[];
    const track = sectionArray[trackId] as Record<string, unknown> | undefined;
    if (!track) {
      console.error('[PartsPanel] Track not found:', trackId);
      return;
    }
    // Support nested field paths (e.g., "machine_params.ptch")
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      const parentObj = track[parent] as Record<string, unknown> | undefined;
      if (parentObj) {
        parentObj[child] = value;
      }
    } else {
      track[field] = value;
    }

    // Update local state
    setPartsData(prev => {
      const newData = [...prev];
      newData[partIndex] = updatedPart;
      return newData;
    });

    // Track which part was modified (shows * indicator)
    setModifiedPartIds(prev => new Set([...prev, partId]));

    // Auto-save to backend (parts.unsaved)
    console.log('[PartsPanel] Auto-saving part', partId, 'field', field, '=', value);
    onWriteStatusChange?.(writeStatus.writing());
    invoke('save_parts', {
      path: projectPath,
      bankId: bankId,
      partsData: [updatedPart]
    }).then(() => {
      console.log('[PartsPanel] Auto-saved part', partId, 'to parts.unsaved');
      const partName = partNames[partId] || `Part ${partId + 1}`;
      onWriteStatusChange?.(writeStatus.success(`Part ${partName} saved as *`));
      // Reset to idle after a short delay
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);
    }).catch(err => {
      console.error('Failed to auto-save part:', err);
      onWriteStatusChange?.(writeStatus.error('Auto-save failed'));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    });
  }, [projectPath, bankId, partsData, onWriteStatusChange]);

  // Update a single point in the LFO design array (local state only, no save)
  const updateLfoDesignLocal = useCallback((
    partId: number,
    section: 'lfos' | 'midi_lfos',
    trackId: number,
    stepIndex: number,
    value: number
  ) => {
    setPartsData(prev => {
      const partIndex = prev.findIndex(p => p.part_id === partId);
      if (partIndex === -1) return prev;

      const updatedPart = JSON.parse(JSON.stringify(prev[partIndex])) as PartData;
      const sectionArray = updatedPart[section] as unknown[];
      const track = sectionArray[trackId] as Record<string, unknown> | undefined;
      if (!track || !track.custom_lfo_design) return prev;

      const lfoDesign = track.custom_lfo_design as number[];
      lfoDesign[stepIndex] = value;

      const newData = [...prev];
      newData[partIndex] = updatedPart;
      return newData;
    });

    // Track which part was modified (shows * indicator)
    setModifiedPartIds(prev => new Set([...prev, partId]));
  }, []);

  // Save LFO design to backend (called on mouse release)
  const saveLfoDesign = useCallback((partId: number) => {
    const partIndex = partsData.findIndex(p => p.part_id === partId);
    if (partIndex === -1) {
      console.error('[PartsPanel] Part not found:', partId);
      return;
    }

    const partToSave = partsData[partIndex];
    onWriteStatusChange?.(writeStatus.writing());
    invoke('save_parts', {
      path: projectPath,
      bankId: bankId,
      partsData: [partToSave]
    }).then(() => {
      const partName = partNames[partId] || `Part ${partId + 1}`;
      onWriteStatusChange?.(writeStatus.success(`Part ${partName} saved as *`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);
    }).catch(err => {
      console.error('Failed to save LFO design:', err);
      onWriteStatusChange?.(writeStatus.error('Save failed'));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    });
  }, [projectPath, bankId, partsData, onWriteStatusChange]);

  // Parameter value component - editable in edit mode, read-only in view mode
  // Update a param locally without saving to backend (for knob dragging)
  const updatePartParamLocal = useCallback(<T extends keyof PartData>(
    partId: number,
    section: T,
    trackId: number,
    field: string,
    value: number
  ) => {
    setPartsData(prev => {
      const partIndex = prev.findIndex(p => p.part_id === partId);
      if (partIndex === -1) return prev;

      const updatedPart = JSON.parse(JSON.stringify(prev[partIndex])) as PartData;
      const sectionArray = updatedPart[section] as unknown[];
      const track = sectionArray[trackId] as Record<string, unknown> | undefined;
      if (!track) return prev;

      // Support nested field paths (e.g., "machine_params.ptch")
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        const parentObj = track[parent] as Record<string, unknown> | undefined;
        if (parentObj) {
          parentObj[child] = value;
        }
      } else {
        track[field] = value;
      }

      const newData = [...prev];
      newData[partIndex] = updatedPart;
      return newData;
    });

    // Track which part was modified (shows * indicator)
    setModifiedPartIds(prev => new Set([...prev, partId]));
  }, []);

  // Save part to backend (called on mouse release from knob)
  const savePart = useCallback((partId: number) => {
    const partIndex = partsData.findIndex(p => p.part_id === partId);
    if (partIndex === -1) {
      console.error('[PartsPanel] Part not found:', partId);
      return;
    }

    const partToSave = partsData[partIndex];
    onWriteStatusChange?.(writeStatus.writing());
    invoke('save_parts', {
      path: projectPath,
      bankId: bankId,
      partsData: [partToSave]
    }).then(() => {
      const partName = partNames[partId] || `Part ${partId + 1}`;
      onWriteStatusChange?.(writeStatus.success(`Part ${partName} saved as *`));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);
    }).catch(err => {
      console.error('Failed to save part:', err);
      onWriteStatusChange?.(writeStatus.error('Save failed'));
      setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
    });
  }, [projectPath, bankId, partsData, partNames, onWriteStatusChange]);

  // Render param with rotary knob for All view
  const renderParamWithKnob = (
    partId: number,
    section: keyof PartData,
    trackId: number,
    field: string,
    value: number | null,
    label: string,
    formatter?: (value: number) => string,
    key?: string | number
  ) => {
    const displayValue = value ?? 0;
    const formattedValue = formatter ? formatter(displayValue) : displayValue.toString();

    return (
      <div className="param-item" key={key}>
        <span className="param-label">{label}</span>
        <RotaryKnob
          value={displayValue}
          min={0}
          max={127}
          size={38}
          onChange={isEditMode ? (newValue) => {
            updatePartParamLocal(partId, section, trackId, field, newValue);
          } : undefined}
          onChangeEnd={isEditMode ? () => {
            savePart(partId);
          } : undefined}
          disabled={!isEditMode}
        />
        <input
          type="text"
          className={`param-value ${isEditMode ? 'editable' : ''}`}
          value={formattedValue}
          onChange={(e) => {
            if (!isEditMode || formatter) return; // Don't allow editing formatted values
            const newValue = parseInt(e.target.value, 10);
            if (!isNaN(newValue)) {
              updatePartParam(partId, section, trackId, field, newValue);
            }
          }}
          onBlur={() => {
            if (isEditMode) {
              savePart(partId);
            }
          }}
          readOnly={!isEditMode || !!formatter}
          tabIndex={isEditMode && !formatter ? 0 : -1}
          min={0}
          max={127}
        />
      </div>
    );
  };

  const formatFxEnvTrig = (value: number): string => {
    // AMP SETUP FX1/FX2 envelope trigger modes (affects FILTER and LO-FI effects)
    // Manual page 59: Controls how envelope affects multi mode filter or amplitude modulator
    switch (value) {
      case 0: return 'ANLG'; // Envelope starts from current level
      case 1: return 'RTRG'; // Envelope starts from zero on sample trig
      case 2: return 'R+T';  // Envelope starts from zero on sample/trigless trig
      case 3: return 'TTRG'; // Envelope starts from current level on sample/trigless trig
      default: return value.toString();
    }
  };

  const formatFxType = (value: number): string => {
    // FX effect types for Octatrack (from ot-tools-io documentation)
    const fxTypes: { [key: number]: string } = {
      0: 'OFF',
      4: 'FILTER',
      5: 'SPATIALIZER',
      8: 'DELAY',
      12: 'EQ',
      13: 'DJ EQ',
      16: 'PHASER',
      17: 'FLANGER',
      18: 'CHORUS',
      19: 'COMB FILTER',
      20: 'PLATE REVERB',
      21: 'SPRING REVERB',
      22: 'DARK REVERB',
      24: 'COMPRESSOR',
      28: 'LO-FI', // B.11 LO-FI COLLECTION
    };
    return fxTypes[value] || `FX ${value}`;
  };

  const getFxMainLabels = (fxType: number): string[] => {
    // Returns array of 6 MAIN parameter labels for given FX type
    const mainMappings: { [key: number]: string[] } = {
      0: ['', '', '', '', '', ''], // OFF - no params
      4: ['BASE', 'WIDTH', 'Q', 'DEPTH', 'ATK', 'DEC'], // FILTER
      5: ['INP', 'DPTH', 'WDTH', 'HP', 'LP', 'SEND'], // SPATIALIZER
      8: ['TIME', 'FB', 'VOL', 'BASE', 'WDTH', 'SEND'], // DELAY
      12: ['FRQ1', 'GN1', 'Q1', 'FRQ2', 'GN2', 'Q2'], // EQ
      13: ['LS F', 'HS F', 'LOWG', 'MIDG', 'HI G', ''], // DJ EQ
      16: ['CNTR', 'DEP', 'SPD', 'FB', 'WID', 'MIX'], // PHASER
      17: ['DEL', 'DEP', 'SPD', 'FB', 'WID', 'MIX'], // FLANGER
      18: ['DEL', 'DEP', 'SPD', 'FB', 'WID', 'MIX'], // CHORUS
      19: ['PTCH', 'TUNE', 'LP', 'FB', 'MIX', ''], // COMB FILTER
      20: ['TIME', 'DAMP', 'GATE', 'HP', 'LP', 'MIX'], // PLATE REVERB
      21: ['TIME', 'HP', 'LP', 'MIX', '', ''], // SPRING REVERB
      22: ['TIME', 'SHVG', 'SHVF', 'HP', 'LP', 'MIX'], // DARK REVERB
      24: ['ATK', 'REL', 'THRS', 'RAT', 'GAIN', 'MIX'], // COMPRESSOR
      28: ['DIST', 'AMF', 'SRR', 'BRR', 'AMD', ''], // LO-FI COLLECTION (B.11)
    };
    return mainMappings[fxType] || ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  };

  const getFxSetupLabels = (fxType: number): string[] => {
    // Returns array of 6 SETUP parameter labels for given FX type
    // Reference: Octatrack User Manual Appendix B (pages 122-136)
    const setupMappings: { [key: number]: string[] } = {
      0: ['', '', '', '', '', ''], // B.1 NONE - no setup params
      4: ['HP', 'LP', 'ENV', 'HOLD', 'Q', 'DIST'], // B.2 12/24DB MULTI MODE FILTER
      5: ['PHSE', 'M/S', 'MG', 'SG', '', ''], // B.8 SPATIALIZER
      8: ['X', 'TAPE', 'DIR', 'SYNC', 'LOCK', 'PASS'], // B.12 ECHO FREEZE DELAY
      12: ['TYP1', 'TYP2', '', '', '', ''], // B.3 2-BAND PARAMETRIC EQ
      13: ['', '', '', '', '', ''], // B.4 DJ STYLE KILL EQ - no setup params
      16: ['NUM', '', '', '', '', ''], // B.5 2-10 STAGE PHASER
      17: ['', '', '', '', '', ''], // B.6 FLANGER - no setup params
      18: ['TAPS', 'FBLP', '', '', '', ''], // B.7 2-10 TAP CHORUS
      19: ['', '', '', '', '', ''], // B.9 COMB FILTER - no setup params
      20: ['GVOL', 'BAL', 'MONO', 'MIXF', '', ''], // B.13 GATEBOX PLATE REVERB
      21: ['TYPE', 'BAL', '', '', '', ''], // B.14 SPRING REVERB
      22: ['PRE', 'BAL', 'MONO', 'MIXF', '', ''], // B.15 DARK REVERB
      24: ['RMS', '', '', '', '', ''], // B.10 DYNAMIX COMPRESSOR
      28: ['AMPH', '', '', '', '', ''], // B.11 LO-FI COLLECTION
    };
    return setupMappings[fxType] || ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  };

  const renderSrcPage = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [activePart.machines[selectedTrack]]
      : activePart.machines;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((machine) => (
          <div key={machine.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={machine.track_id} />
              <span className="machine-type">{machine.machine_type}</span>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">MAIN</div>
              <div className="params-grid">
                {machine.machine_type === 'Thru' ? (
                  <>
                    {/* THRU MAIN parameters */}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.in_ab', machine.machine_params.in_ab, 'INAB')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.vol_ab', machine.machine_params.vol_ab, 'VOL')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.in_cd', machine.machine_params.in_cd, 'INCD')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.vol_cd', machine.machine_params.vol_cd, 'VOL')}
                  </>
                ) : machine.machine_type === 'Neighbor' ? (
                  <div className="params-empty-message">-</div>
                ) : machine.machine_type === 'Pickup' ? (
                  <>
                    {/* PICKUP MAIN parameters */}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.ptch', machine.machine_params.ptch, 'PITCH')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.dir', machine.machine_params.dir, 'DIR')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.len', machine.machine_params.len, 'LEN')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.gain', machine.machine_params.gain, 'GAIN')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.op', machine.machine_params.op, 'OP')}
                  </>
                ) : (
                  <>
                    {/* FLEX/STATIC MAIN parameters */}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.ptch', machine.machine_params.ptch, 'PTCH')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.strt', machine.machine_params.strt, 'STRT')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.len', machine.machine_params.len, 'LEN')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.rate', machine.machine_params.rate, 'RATE')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.rtrg', machine.machine_params.rtrg, 'RTRG')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_params.rtim', machine.machine_params.rtim, 'RTIM')}
                  </>
                )}
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">SETUP</div>
              <div className="params-grid">
                {machine.machine_type === 'Thru' || machine.machine_type === 'Neighbor' ? (
                  <div className="params-empty-message">-</div>
                ) : machine.machine_type === 'Pickup' ? (
                  <>
                    {/* PICKUP SETUP parameters */}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.tstr', machine.machine_setup.tstr, 'TSTR')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.tsns', machine.machine_setup.tsns, 'TSNS')}
                  </>
                ) : (
                  <>
                    {/* FLEX/STATIC SETUP parameters */}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.xloop', machine.machine_setup.xloop, 'LOOP')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.slic', machine.machine_setup.slic, 'SLIC')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.len', machine.machine_setup.len, 'LEN')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.rate', machine.machine_setup.rate, 'RATE')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.tstr', machine.machine_setup.tstr, 'TSTR')}
                    {renderParamWithKnob(activePart.part_id, 'machines', machine.track_id, 'machine_setup.tsns', machine.machine_setup.tsns, 'TSNS')}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderAmpPage = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [activePart.amps[selectedTrack]]
      : activePart.amps;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((amp) => {
          // Get the machine type from the corresponding machine data
          const machine = activePart.machines[amp.track_id];
          const machineType = machine.machine_type;

          return (
            <div key={amp.track_id} className="parts-track">
              <div className="parts-track-header">
                <TrackBadge trackId={amp.track_id} />
                <span className="machine-type">{machineType}</span>
              </div>

              <div className="parts-params-section">
                <div className="params-column-label">MAIN</div>
                <div className="params-grid">
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'atk', amp.atk, 'ATK')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'hold', amp.hold, 'HOLD')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'rel', amp.rel, 'REL')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'vol', amp.vol, 'VOL')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'bal', amp.bal, 'BAL')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'f', amp.f, 'F')}
                </div>
              </div>

              <div className="parts-params-section">
                <div className="params-column-label">SETUP</div>
                <div className="params-grid">
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'amp_setup_amp', amp.amp_setup_amp, 'AMP')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'amp_setup_sync', amp.amp_setup_sync, 'SYNC')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'amp_setup_atck', amp.amp_setup_atck, 'ATCK')}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'amp_setup_fx1', amp.amp_setup_fx1, 'FX1', formatFxEnvTrig)}
                  {renderParamWithKnob(activePart.part_id, 'amps', amp.track_id, 'amp_setup_fx2', amp.amp_setup_fx2, 'FX2', formatFxEnvTrig)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLfoEnvelope = (
    customLfoDesign: number[],
    partId?: number,
    section?: 'lfos' | 'midi_lfos',
    trackId?: number
  ) => {
    // Validate custom LFO design data
    if (!customLfoDesign || customLfoDesign.length !== 16) {
      return (
        <div className="lfo-envelope-container">
          <div className="param-value" style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>
            No custom LFO design data available
          </div>
        </div>
      );
    }

    const envelopeData = customLfoDesign;
    const stepCount = 16;
    const canDraw = isEditMode && partId !== undefined && section !== undefined && trackId !== undefined;

    // Convert data points to coordinates
    // Octatrack stores LFO values using a special encoding:
    // - 0-127 (unsigned) → 0 to +127 (signed, above center line)
    // - 128-255 (unsigned) → -128 to -1 (signed, below center line)
    const centerY = 30;  // Center of viewBox (0-60)
    const rangeY = 29;   // Use almost full height with 1px padding top/bottom

    const points = envelopeData.map((value, index) => {
      const signedValue = value <= 127 ? value : value - 256;  // Convert to signed: -128 to +127
      return {
        x: (index / (stepCount - 1)) * 100,
        y: centerY - ((signedValue / 128) * rangeY)  // Map to y-coord: -128→y=59, 0→y=30, +127→y=1
      };
    });

    // Create smooth curve path using cardinal spline with softer interpolation
    const createSmoothPath = (points: { x: number; y: number }[]) => {
      if (points.length < 2) return '';

      const tension = 0.25; // Reduced tension for softer knee, closer match to actual values
      let path = `M ${points[0].x} ${points[0].y}`;

      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;

        const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
        const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
        const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
        const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }

      return path;
    };

    // Convert mouse position to step index and value
    const handleMouseDraw = (e: React.MouseEvent<SVGSVGElement>) => {
      if (!canDraw) return;

      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();

      // Get mouse position relative to SVG
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert to viewBox coordinates (0-100 for x, 0-60 for y)
      const viewBoxX = (mouseX / rect.width) * 100;
      const viewBoxY = (mouseY / rect.height) * 60;

      // Calculate step index (0-15)
      const stepIndex = Math.round((viewBoxX / 100) * (stepCount - 1));
      const clampedStepIndex = Math.max(0, Math.min(15, stepIndex));

      // Convert viewBox Y to signed value (-128 to +127)
      // y=1 → +127, y=30 → 0, y=59 → -128
      const signedValue = Math.round(((centerY - viewBoxY) / rangeY) * 128);
      const clampedSignedValue = Math.max(-128, Math.min(127, signedValue));

      // Convert signed to unsigned (Octatrack format)
      // 0-127 stays as is, -128 to -1 becomes 128-255
      const unsignedValue = clampedSignedValue >= 0 ? clampedSignedValue : clampedSignedValue + 256;

      // Update local state only (no save during drawing)
      updateLfoDesignLocal(partId!, section!, trackId!, clampedStepIndex, unsignedValue);
    };

    const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
      if (!canDraw) return;
      e.preventDefault(); // Prevent text selection while dragging
      lfoDrawingRef.current = { isDrawing: true, partId: partId!, section: section!, trackId: trackId! };
      handleMouseDraw(e);
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
      if (!lfoDrawingRef.current?.isDrawing) return;
      handleMouseDraw(e);
    };

    const handleMouseUp = () => {
      if (lfoDrawingRef.current) {
        // Save on mouse release
        saveLfoDesign(lfoDrawingRef.current.partId);
        lfoDrawingRef.current = null;
      }
    };

    const handleMouseLeave = () => {
      if (lfoDrawingRef.current) {
        // Save when mouse leaves while drawing
        saveLfoDesign(lfoDrawingRef.current.partId);
        lfoDrawingRef.current = null;
      }
    };

    return (
      <div className="lfo-envelope-container">
        <div className="lfo-envelope-wrapper">
          <svg
            className={`lfo-envelope-svg ${canDraw ? 'lfo-envelope-editable' : ''}`}
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            onMouseDown={canDraw ? handleMouseDown : undefined}
            onMouseMove={canDraw ? handleMouseMove : undefined}
            onMouseUp={canDraw ? handleMouseUp : undefined}
            onMouseLeave={canDraw ? handleMouseLeave : undefined}
          >
            <defs>
              <linearGradient id="lfoGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{ stopColor: '#4ac8ff', stopOpacity: 1 }} />
                <stop offset="50%" style={{ stopColor: '#7b68ee', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#ff6b9d', stopOpacity: 1 }} />
              </linearGradient>
            </defs>

            {/* Draw vertical grid lines for each step */}
            {Array.from({ length: stepCount }).map((_, index) => (
              <line
                key={`grid-${index}`}
                className="lfo-envelope-grid"
                x1={(index / (stepCount - 1)) * 100}
                y1="5"
                x2={(index / (stepCount - 1)) * 100}
                y2="50"
              />
            ))}

            {/* Draw center line when in edit mode */}
            {canDraw && (
              <line
                className="lfo-envelope-center"
                x1="0"
                y1={centerY}
                x2="100"
                y2={centerY}
              />
            )}

            {/* Draw the smooth waveform */}
            <path
              className="lfo-envelope-line"
              d={createSmoothPath(points)}
            />
          </svg>

          {/* Render points as HTML elements to avoid SVG distortion */}
          {canDraw && (
            <div className="lfo-envelope-points-overlay">
              {points.map((point, index) => (
                <div
                  key={`point-${index}`}
                  className="lfo-envelope-point"
                  style={{
                    left: `${point.x}%`,
                    top: `${(point.y / 60) * 100}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Step indicators */}
        <div className="lfo-envelope-steps">
          {envelopeData.map((value, index) => {
            // Convert unsigned byte to signed value for display
            const signedValue = value <= 127 ? value : value - 256;
            return (
              <div key={index} className="lfo-step-indicator">
                <div className="lfo-step-dot"></div>
                <div className="lfo-step-value">{signedValue}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderLfoPage = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [activePart.lfos[selectedTrack]]
      : activePart.lfos;

    // Get field names based on active LFO tab
    const getLfoFieldNames = () => {
      if (activeLfoTab === 'LFO1') return { pmtr: 'lfo1_pmtr', wave: 'lfo1_wave', mult: 'lfo1_mult', trig: 'lfo1_trig', spd: 'spd1', dep: 'dep1' };
      if (activeLfoTab === 'LFO2') return { pmtr: 'lfo2_pmtr', wave: 'lfo2_wave', mult: 'lfo2_mult', trig: 'lfo2_trig', spd: 'spd2', dep: 'dep2' };
      if (activeLfoTab === 'LFO3') return { pmtr: 'lfo3_pmtr', wave: 'lfo3_wave', mult: 'lfo3_mult', trig: 'lfo3_trig', spd: 'spd3', dep: 'dep3' };
      return null;
    };

    return (
      <div className="parts-lfo-layout">
        {/* LFO Vertical Sidebar */}
        <div className="parts-lfo-sidebar">
          <button
            className={`parts-tab ${activeLfoTab === 'LFO1' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('LFO1')}
          >
            LFO 1
          </button>
          <button
            className={`parts-tab ${activeLfoTab === 'LFO2' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('LFO2')}
          >
            LFO 2
          </button>
          <button
            className={`parts-tab ${activeLfoTab === 'LFO3' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('LFO3')}
          >
            LFO 3
          </button>
          <button
            className={`parts-tab ${activeLfoTab === 'DESIGN' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('DESIGN')}
          >
            DESIGN
          </button>
        </div>

        <div className="parts-tracks" style={{ flex: 1 }}>
          {tracksToShow.map((lfo) => {
            // Get the machine type from the corresponding machine data
            const machine = activePart.machines[lfo.track_id];
            const machineType = machine.machine_type;

            // Determine which LFO's parameters to show
            const lfoParams = activeLfoTab === 'LFO1' ? {
              pmtr: lfo.lfo1_pmtr,
              wave: lfo.lfo1_wave,
              mult: lfo.lfo1_mult,
              trig: lfo.lfo1_trig,
              spd: lfo.spd1,
              dep: lfo.dep1,
            } : activeLfoTab === 'LFO2' ? {
              pmtr: lfo.lfo2_pmtr,
              wave: lfo.lfo2_wave,
              mult: lfo.lfo2_mult,
              trig: lfo.lfo2_trig,
              spd: lfo.spd2,
              dep: lfo.dep2,
            } : activeLfoTab === 'LFO3' ? {
              pmtr: lfo.lfo3_pmtr,
              wave: lfo.lfo3_wave,
              mult: lfo.lfo3_mult,
              trig: lfo.lfo3_trig,
              spd: lfo.spd3,
              dep: lfo.dep3,
            } : null;

            const fieldNames = getLfoFieldNames();

            return (
              <div key={lfo.track_id} className="parts-track">
                <div className="parts-track-header">
                  <TrackBadge trackId={lfo.track_id} />
                  <span className="machine-type">{machineType}</span>
                </div>

                {activeLfoTab !== 'DESIGN' && lfoParams && fieldNames ? (
                  <div className="parts-params-section">
                    <div className="params-grid">
                      {renderParamWithKnob(activePart.part_id, 'lfos', lfo.track_id, fieldNames.pmtr, lfoParams.pmtr, 'PMTR')}
                      {renderParamWithKnob(activePart.part_id, 'lfos', lfo.track_id, fieldNames.wave, lfoParams.wave, 'WAVE')}
                      {renderParamWithKnob(activePart.part_id, 'lfos', lfo.track_id, fieldNames.mult, lfoParams.mult, 'MULT')}
                      {renderParamWithKnob(activePart.part_id, 'lfos', lfo.track_id, fieldNames.trig, lfoParams.trig, 'TRIG')}
                      {renderParamWithKnob(activePart.part_id, 'lfos', lfo.track_id, fieldNames.spd, lfoParams.spd, 'SPD')}
                      {renderParamWithKnob(activePart.part_id, 'lfos', lfo.track_id, fieldNames.dep, lfoParams.dep, 'DEP')}
                    </div>
                  </div>
                ) : (
                  renderLfoEnvelope(lfo.custom_lfo_design, activePart.part_id, 'lfos', lfo.track_id)
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFx1Page = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [activePart.fxs[selectedTrack]]
      : activePart.fxs;

    const mainFieldNames = ['fx1_param1', 'fx1_param2', 'fx1_param3', 'fx1_param4', 'fx1_param5', 'fx1_param6'];
    const setupFieldNames = ['fx1_setup1', 'fx1_setup2', 'fx1_setup3', 'fx1_setup4', 'fx1_setup5', 'fx1_setup6'];

    return (
      <div className="parts-tracks">
        {tracksToShow.map((fx) => {
          const machine = activePart.machines[fx.track_id];
          const machineType = machine.machine_type;
          const mainLabels = getFxMainLabels(fx.fx1_type);
          const setupLabels = getFxSetupLabels(fx.fx1_type);
          const mainValues = [fx.fx1_param1, fx.fx1_param2, fx.fx1_param3, fx.fx1_param4, fx.fx1_param5, fx.fx1_param6];
          const setupValues = [fx.fx1_setup1, fx.fx1_setup2, fx.fx1_setup3, fx.fx1_setup4, fx.fx1_setup5, fx.fx1_setup6];

          return (
            <div key={fx.track_id} className="parts-track">
              <div className="parts-track-header">
                <TrackBadge trackId={fx.track_id} />
                <span className="machine-type">{machineType}</span>
              </div>

              <div className="parts-params-section">
                <div className="params-column-label">MAIN - {formatFxType(fx.fx1_type)}</div>
                <div className="params-grid">
                  {mainLabels.some(label => label) ? (
                    mainLabels.map((label, index) => {
                      if (!label) return null; // Skip empty labels
                      return renderParamWithKnob(activePart.part_id, 'fxs', fx.track_id, mainFieldNames[index], mainValues[index], label);
                    })
                  ) : (
                    <div className="params-empty-message">-</div>
                  )}
                </div>
              </div>

              <div className="parts-params-section">
                <div className="params-column-label">SETUP</div>
                <div className="params-grid">
                  {setupLabels.some(label => label) ? (
                    setupLabels.map((label, index) => {
                      if (!label) return null; // Skip empty labels
                      return renderParamWithKnob(activePart.part_id, 'fxs', fx.track_id, setupFieldNames[index], setupValues[index], label);
                    })
                  ) : (
                    <div className="params-empty-message">-</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderFx2Page = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [activePart.fxs[selectedTrack]]
      : activePart.fxs;

    const mainFieldNames = ['fx2_param1', 'fx2_param2', 'fx2_param3', 'fx2_param4', 'fx2_param5', 'fx2_param6'];
    const setupFieldNames = ['fx2_setup1', 'fx2_setup2', 'fx2_setup3', 'fx2_setup4', 'fx2_setup5', 'fx2_setup6'];

    return (
      <div className="parts-tracks">
        {tracksToShow.map((fx) => {
          const machine = activePart.machines[fx.track_id];
          const machineType = machine.machine_type;
          const mainLabels = getFxMainLabels(fx.fx2_type);
          const setupLabels = getFxSetupLabels(fx.fx2_type);
          const mainValues = [fx.fx2_param1, fx.fx2_param2, fx.fx2_param3, fx.fx2_param4, fx.fx2_param5, fx.fx2_param6];
          const setupValues = [fx.fx2_setup1, fx.fx2_setup2, fx.fx2_setup3, fx.fx2_setup4, fx.fx2_setup5, fx.fx2_setup6];

          return (
            <div key={fx.track_id} className="parts-track">
              <div className="parts-track-header">
                <TrackBadge trackId={fx.track_id} />
                <span className="machine-type">{machineType}</span>
              </div>

              <div className="parts-params-section">
                <div className="params-column-label">MAIN - {formatFxType(fx.fx2_type)}</div>
                <div className="params-grid">
                  {mainLabels.some(label => label) ? (
                    mainLabels.map((label, index) => {
                      if (!label) return null; // Skip empty labels
                      return renderParamWithKnob(activePart.part_id, 'fxs', fx.track_id, mainFieldNames[index], mainValues[index], label);
                    })
                  ) : (
                    <div className="params-empty-message">-</div>
                  )}
                </div>
              </div>

              <div className="parts-params-section">
                <div className="params-column-label">SETUP</div>
                <div className="params-grid">
                  {setupLabels.some(label => label) ? (
                    setupLabels.map((label, index) => {
                      if (!label) return null; // Skip empty labels
                      return renderParamWithKnob(activePart.part_id, 'fxs', fx.track_id, setupFieldNames[index], setupValues[index], label);
                    })
                  ) : (
                    <div className="params-empty-message">-</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // MIDI Track Rendering Functions
  const renderNotePage = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [activePart.midi_notes[selectedTrack - 8]]
      : activePart.midi_notes;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_note) => (
          <div key={midi_note.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_note.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">MAIN</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'note', midi_note.note, 'NOTE')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'vel', midi_note.vel, 'VEL')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'len', midi_note.len, 'LEN')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'not2', midi_note.not2, 'NOT2')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'not3', midi_note.not3, 'NOT3')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'not4', midi_note.not4, 'NOT4')}
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">SETUP</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'chan', midi_note.chan, 'CHAN')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'bank', midi_note.bank, 'BANK')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'prog', midi_note.prog, 'PROG')}
                {renderParamWithKnob(activePart.part_id, 'midi_notes', midi_note.track_id, 'sbnk', midi_note.sbnk, 'SBNK')}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderArpPage = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [activePart.midi_arps[selectedTrack - 8]]
      : activePart.midi_arps;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_arp) => (
          <div key={midi_arp.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_arp.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">MAIN</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'tran', midi_arp.tran, 'TRAN')}
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'leg', midi_arp.leg, 'LEG')}
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'mode', midi_arp.mode, 'MODE')}
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'spd', midi_arp.spd, 'SPD')}
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'rnge', midi_arp.rnge, 'RNGE')}
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'nlen', midi_arp.nlen, 'NLEN')}
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">SETUP</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'len', midi_arp.len, 'LEN')}
                {renderParamWithKnob(activePart.part_id, 'midi_arps', midi_arp.track_id, 'key', midi_arp.key, 'KEY')}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderMidiLfoPage = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [activePart.midi_lfos[selectedTrack - 8]]
      : activePart.midi_lfos;

    return (
      <div className="parts-lfo-layout">
        {/* LFO Vertical Sidebar */}
        <div className="parts-lfo-sidebar">
          <button
            className={`parts-tab ${activeLfoTab === 'LFO1' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('LFO1')}
          >
            LFO 1
          </button>
          <button
            className={`parts-tab ${activeLfoTab === 'LFO2' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('LFO2')}
          >
            LFO 2
          </button>
          <button
            className={`parts-tab ${activeLfoTab === 'LFO3' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('LFO3')}
          >
            LFO 3
          </button>
          <button
            className={`parts-tab ${activeLfoTab === 'DESIGN' ? 'active' : ''}`}
            onClick={() => setActiveLfoTab('DESIGN')}
          >
            DESIGN
          </button>
        </div>

        <div className="parts-tracks" style={{ flex: 1 }}>
          {tracksToShow.map((lfo) => {
            // Determine which LFO's parameters and field names to show
            const lfoData = activeLfoTab === 'LFO1' ? {
              pmtr: lfo.lfo1_pmtr, pmtrField: 'lfo1_pmtr',
              wave: lfo.lfo1_wave, waveField: 'lfo1_wave',
              mult: lfo.lfo1_mult, multField: 'lfo1_mult',
              trig: lfo.lfo1_trig, trigField: 'lfo1_trig',
              spd: lfo.spd1, spdField: 'spd1',
              dep: lfo.dep1, depField: 'dep1',
            } : activeLfoTab === 'LFO2' ? {
              pmtr: lfo.lfo2_pmtr, pmtrField: 'lfo2_pmtr',
              wave: lfo.lfo2_wave, waveField: 'lfo2_wave',
              mult: lfo.lfo2_mult, multField: 'lfo2_mult',
              trig: lfo.lfo2_trig, trigField: 'lfo2_trig',
              spd: lfo.spd2, spdField: 'spd2',
              dep: lfo.dep2, depField: 'dep2',
            } : activeLfoTab === 'LFO3' ? {
              pmtr: lfo.lfo3_pmtr, pmtrField: 'lfo3_pmtr',
              wave: lfo.lfo3_wave, waveField: 'lfo3_wave',
              mult: lfo.lfo3_mult, multField: 'lfo3_mult',
              trig: lfo.lfo3_trig, trigField: 'lfo3_trig',
              spd: lfo.spd3, spdField: 'spd3',
              dep: lfo.dep3, depField: 'dep3',
            } : null;

            return (
              <div key={lfo.track_id} className="parts-track">
                <div className="parts-track-header">
                  <TrackBadge trackId={lfo.track_id + 8} />
                  <span className="machine-type">MIDI</span>
                </div>

                {activeLfoTab !== 'DESIGN' ? (
                  <div className="parts-params-section">
                    <div className="params-grid">
                      {renderParamWithKnob(activePart.part_id, 'midi_lfos', lfo.track_id, lfoData!.pmtrField, lfoData!.pmtr, 'PMTR')}
                      {renderParamWithKnob(activePart.part_id, 'midi_lfos', lfo.track_id, lfoData!.waveField, lfoData!.wave, 'WAVE')}
                      {renderParamWithKnob(activePart.part_id, 'midi_lfos', lfo.track_id, lfoData!.multField, lfoData!.mult, 'MULT')}
                      {renderParamWithKnob(activePart.part_id, 'midi_lfos', lfo.track_id, lfoData!.trigField, lfoData!.trig, 'TRIG')}
                      {renderParamWithKnob(activePart.part_id, 'midi_lfos', lfo.track_id, lfoData!.spdField, lfoData!.spd, 'SPD')}
                      {renderParamWithKnob(activePart.part_id, 'midi_lfos', lfo.track_id, lfoData!.depField, lfoData!.dep, 'DEP')}
                    </div>
                  </div>
                ) : (
                  renderLfoEnvelope(lfo.custom_lfo_design, activePart.part_id, 'midi_lfos', lfo.track_id)
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCtrl1Page = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [activePart.midi_ctrl1s[selectedTrack - 8]]
      : activePart.midi_ctrl1s;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_ctrl1) => (
          <div key={midi_ctrl1.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_ctrl1.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">MAIN</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'pb', midi_ctrl1.pb, 'PB')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'at', midi_ctrl1.at, 'AT')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc1', midi_ctrl1.cc1, 'CC1')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc2', midi_ctrl1.cc2, 'CC2')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc3', midi_ctrl1.cc3, 'CC3')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc4', midi_ctrl1.cc4, 'CC4')}
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">SETUP</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc1_num', midi_ctrl1.cc1_num, 'CC1#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc2_num', midi_ctrl1.cc2_num, 'CC2#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc3_num', midi_ctrl1.cc3_num, 'CC3#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', midi_ctrl1.track_id, 'cc4_num', midi_ctrl1.cc4_num, 'CC4#')}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCtrl2Page = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [activePart.midi_ctrl2s[selectedTrack - 8]]
      : activePart.midi_ctrl2s;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_ctrl2) => (
          <div key={midi_ctrl2.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_ctrl2.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">MAIN</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc5', midi_ctrl2.cc5, 'CC5')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc6', midi_ctrl2.cc6, 'CC6')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc7', midi_ctrl2.cc7, 'CC7')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc8', midi_ctrl2.cc8, 'CC8')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc9', midi_ctrl2.cc9, 'CC9')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc10', midi_ctrl2.cc10, 'CC10')}
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-column-label">SETUP</div>
              <div className="params-grid">
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc5_num', midi_ctrl2.cc5_num, 'CC5#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc6_num', midi_ctrl2.cc6_num, 'CC6#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc7_num', midi_ctrl2.cc7_num, 'CC7#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc8_num', midi_ctrl2.cc8_num, 'CC8#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc9_num', midi_ctrl2.cc9_num, 'CC9#')}
                {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', midi_ctrl2.track_id, 'cc10_num', midi_ctrl2.cc10_num, 'CC10#')}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render all Audio pages - same style as individual tabs with MAIN/SETUP side by side
  const renderAllAudioPages = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [selectedTrack]
      : [0, 1, 2, 3, 4, 5, 6, 7];

    return (
      <div className="parts-tracks full-width">
        {tracksToShow.map((trackIdx) => {
          const machine = activePart.machines[trackIdx];
          const amp = activePart.amps[trackIdx];
          const lfo = activePart.lfos[trackIdx];
          const fx = activePart.fxs[trackIdx];
          const machineType = machine.machine_type;
          const fx1MainLabels = getFxMainLabels(fx.fx1_type);
          const fx2MainLabels = getFxMainLabels(fx.fx2_type);
          const fx1SetupLabels = getFxSetupLabels(fx.fx1_type);
          const fx2SetupLabels = getFxSetupLabels(fx.fx2_type);
          const fx1MainValues = [fx.fx1_param1, fx.fx1_param2, fx.fx1_param3, fx.fx1_param4, fx.fx1_param5, fx.fx1_param6];
          const fx2MainValues = [fx.fx2_param1, fx.fx2_param2, fx.fx2_param3, fx.fx2_param4, fx.fx2_param5, fx.fx2_param6];
          const fx1SetupValues = [fx.fx1_setup1, fx.fx1_setup2, fx.fx1_setup3, fx.fx1_setup4, fx.fx1_setup5, fx.fx1_setup6];
          const fx2SetupValues = [fx.fx2_setup1, fx.fx2_setup2, fx.fx2_setup3, fx.fx2_setup4, fx.fx2_setup5, fx.fx2_setup6];

          return (
            <div key={trackIdx} className="parts-track parts-track-wide">
              <div className="parts-track-header">
                <TrackBadge trackId={trackIdx} />
                <span className="machine-type">{machineType}</span>
              </div>

              {/* Row 1: SRC, AMP, LFO1, LFO2 */}
              <div className="parts-all-row">
                {/* SRC Section */}
                <div className="parts-all-section">
                  <div className="params-label">SRC</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {machineType === 'Thru' ? (
                          <>
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.in_ab', machine.machine_params.in_ab, 'INAB')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.vol_ab', machine.machine_params.vol_ab, 'VOL')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.in_cd', machine.machine_params.in_cd, 'INCD')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.vol_cd', machine.machine_params.vol_cd, 'VOL')}
                          </>
                        ) : machineType === 'Neighbor' ? (
                          <div className="params-empty-message">-</div>
                        ) : machineType === 'Pickup' ? (
                          <>
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.ptch', machine.machine_params.ptch, 'PITCH')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.dir', machine.machine_params.dir, 'DIR')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.len', machine.machine_params.len, 'LEN')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.gain', machine.machine_params.gain, 'GAIN')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.op', machine.machine_params.op, 'OP')}
                          </>
                        ) : (
                          <>
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.ptch', machine.machine_params.ptch, 'PTCH')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.strt', machine.machine_params.strt, 'STRT')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.len', machine.machine_params.len, 'LEN')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.rate', machine.machine_params.rate, 'RATE')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.rtrg', machine.machine_params.rtrg, 'RTRG')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_params.rtim', machine.machine_params.rtim, 'RTIM')}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {machineType === 'Thru' || machineType === 'Neighbor' ? (
                          <div className="params-empty-message">-</div>
                        ) : machineType === 'Pickup' ? (
                          <>
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.tstr', machine.machine_setup.tstr, 'TSTR')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.tsns', machine.machine_setup.tsns, 'TSNS')}
                          </>
                        ) : (
                          <>
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.xloop', machine.machine_setup.xloop, 'LOOP')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.slic', machine.machine_setup.slic, 'SLIC')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.len', machine.machine_setup.len, 'LEN')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.rate', machine.machine_setup.rate, 'RATE')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.tstr', machine.machine_setup.tstr, 'TSTR')}
                            {renderParamWithKnob(activePart.part_id, 'machines', trackIdx, 'machine_setup.tsns', machine.machine_setup.tsns, 'TSNS')}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* AMP Section */}
                <div className="parts-all-section">
                  <div className="params-label">AMP</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'atk', amp.atk, 'ATK')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'hold', amp.hold, 'HOLD')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'rel', amp.rel, 'REL')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'vol', amp.vol, 'VOL')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'bal', amp.bal, 'BAL')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'f', amp.f, 'F')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'amp_setup_amp', amp.amp_setup_amp, 'AMP')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'amp_setup_sync', amp.amp_setup_sync, 'SYNC')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'amp_setup_atck', amp.amp_setup_atck, 'ATCK')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'amp_setup_fx1', amp.amp_setup_fx1, 'FX1')}
                        {renderParamWithKnob(activePart.part_id, 'amps', trackIdx, 'amp_setup_fx2', amp.amp_setup_fx2, 'FX2')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* LFO1 Section */}
                <div className="parts-all-section">
                  <div className="params-label">LFO1</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo1_pmtr', lfo.lfo1_pmtr, 'PMTR')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo1_wave', lfo.lfo1_wave, 'WAVE')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo1_mult', lfo.lfo1_mult, 'MULT')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo1_trig', lfo.lfo1_trig, 'TRIG')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'spd1', lfo.spd1, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'dep1', lfo.dep1, 'DEP')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        <div className="params-empty-message">-</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* LFO2 Section */}
                <div className="parts-all-section">
                  <div className="params-label">LFO2</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo2_pmtr', lfo.lfo2_pmtr, 'PMTR')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo2_wave', lfo.lfo2_wave, 'WAVE')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo2_mult', lfo.lfo2_mult, 'MULT')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo2_trig', lfo.lfo2_trig, 'TRIG')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'spd2', lfo.spd2, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'dep2', lfo.dep2, 'DEP')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        <div className="params-empty-message">-</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: LFO3, DESIGN, FX1, FX2 */}
              <div className="parts-all-row">
                {/* LFO3 Section */}
                <div className="parts-all-section">
                  <div className="params-label">LFO3</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo3_pmtr', lfo.lfo3_pmtr, 'PMTR')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo3_wave', lfo.lfo3_wave, 'WAVE')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo3_mult', lfo.lfo3_mult, 'MULT')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'lfo3_trig', lfo.lfo3_trig, 'TRIG')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'spd3', lfo.spd3, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'lfos', trackIdx, 'dep3', lfo.dep3, 'DEP')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        <div className="params-empty-message">-</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* DESIGN Section */}
                <div className="parts-all-section">
                  <div className="params-label">DESIGN</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      {renderLfoEnvelope(lfo.custom_lfo_design, activePart.part_id, 'lfos', trackIdx)}
                    </div>
                  </div>
                </div>

                {/* FX1 Section */}
                <div className="parts-all-section">
                  <div className="params-label">FX1 - {formatFxType(fx.fx1_type)}</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {fx1MainLabels.some(label => label) ? (
                          fx1MainLabels.map((label, index) => {
                            if (!label) return null;
                            const fieldName = `fx1_param${index + 1}`;
                            return renderParamWithKnob(activePart.part_id, 'fxs', trackIdx, fieldName, fx1MainValues[index], label, undefined, index);
                          })
                        ) : (
                          <div className="params-empty-message">-</div>
                        )}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {fx1SetupLabels.some(label => label) ? (
                          fx1SetupLabels.map((label, index) => {
                            if (!label) return null;
                            const fieldName = `fx1_setup${index + 1}`;
                            return renderParamWithKnob(activePart.part_id, 'fxs', trackIdx, fieldName, fx1SetupValues[index], label, undefined, index);
                          })
                        ) : (
                          <div className="params-empty-message">-</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* FX2 Section */}
                <div className="parts-all-section">
                  <div className="params-label">FX2 - {formatFxType(fx.fx2_type)}</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {fx2MainLabels.some(label => label) ? (
                          fx2MainLabels.map((label, index) => {
                            if (!label) return null;
                            const fieldName = `fx2_param${index + 1}`;
                            return renderParamWithKnob(activePart.part_id, 'fxs', trackIdx, fieldName, fx2MainValues[index], label, undefined, index);
                          })
                        ) : (
                          <div className="params-empty-message">-</div>
                        )}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {fx2SetupLabels.some(label => label) ? (
                          fx2SetupLabels.map((label, index) => {
                            if (!label) return null;
                            const fieldName = `fx2_setup${index + 1}`;
                            return renderParamWithKnob(activePart.part_id, 'fxs', trackIdx, fieldName, fx2SetupValues[index], label, undefined, index);
                          })
                        ) : (
                          <div className="params-empty-message">-</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Render all MIDI pages - 2-row layout matching Audio tracks
  const renderAllMidiPages = (part: PartData) => {
    // Always use activePartsData to show current state
    const activePart = activePartsData.find(p => p.part_id === part.part_id) || part;
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [selectedTrack - 8]
      : [0, 1, 2, 3, 4, 5, 6, 7];

    return (
      <div className="parts-tracks full-width">
        {tracksToShow.map((trackIdx) => {
          const midi_note = activePart.midi_notes[trackIdx];
          const midi_arp = activePart.midi_arps[trackIdx];
          const midi_lfo = activePart.midi_lfos[trackIdx];
          const midi_ctrl1 = activePart.midi_ctrl1s[trackIdx];
          const midi_ctrl2 = activePart.midi_ctrl2s[trackIdx];

          return (
            <div key={trackIdx} className="parts-track parts-track-wide">
              <div className="parts-track-header">
                <TrackBadge trackId={trackIdx + 8} />
                <span className="machine-type">MIDI</span>
              </div>

              {/* Row 1: NOTE, ARP, LFO1, LFO2 */}
              <div className="parts-all-row">
                {/* NOTE Section */}
                <div className="parts-all-section">
                  <div className="params-label">NOTE</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'note', midi_note.note, 'NOTE')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'vel', midi_note.vel, 'VEL')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'len', midi_note.len, 'LEN')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'not2', midi_note.not2, 'NOT2')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'not3', midi_note.not3, 'NOT3')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'not4', midi_note.not4, 'NOT4')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'chan', midi_note.chan, 'CHAN')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'bank', midi_note.bank, 'BANK')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'prog', midi_note.prog, 'PROG')}
                        {renderParamWithKnob(activePart.part_id, 'midi_notes', trackIdx, 'sbnk', midi_note.sbnk, 'SBNK')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ARP Section */}
                <div className="parts-all-section">
                  <div className="params-label">ARP</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'tran', midi_arp.tran, 'TRAN')}
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'leg', midi_arp.leg, 'LEG')}
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'mode', midi_arp.mode, 'MODE')}
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'spd', midi_arp.spd, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'rnge', midi_arp.rnge, 'RNGE')}
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'nlen', midi_arp.nlen, 'NLEN')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'len', midi_arp.len, 'LEN')}
                        {renderParamWithKnob(activePart.part_id, 'midi_arps', trackIdx, 'key', midi_arp.key, 'KEY')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* LFO1 Section */}
                <div className="parts-all-section">
                  <div className="params-label">LFO1</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo1_pmtr', midi_lfo.lfo1_pmtr, 'PMTR')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo1_wave', midi_lfo.lfo1_wave, 'WAVE')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo1_mult', midi_lfo.lfo1_mult, 'MULT')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo1_trig', midi_lfo.lfo1_trig, 'TRIG')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'spd1', midi_lfo.spd1, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'dep1', midi_lfo.dep1, 'DEP')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        <div className="params-empty-message">-</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* LFO2 Section */}
                <div className="parts-all-section">
                  <div className="params-label">LFO2</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo2_pmtr', midi_lfo.lfo2_pmtr, 'PMTR')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo2_wave', midi_lfo.lfo2_wave, 'WAVE')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo2_mult', midi_lfo.lfo2_mult, 'MULT')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo2_trig', midi_lfo.lfo2_trig, 'TRIG')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'spd2', midi_lfo.spd2, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'dep2', midi_lfo.dep2, 'DEP')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        <div className="params-empty-message">-</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: LFO3, DESIGN, CTRL1, CTRL2 */}
              <div className="parts-all-row">
                {/* LFO3 Section */}
                <div className="parts-all-section">
                  <div className="params-label">LFO3</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo3_pmtr', midi_lfo.lfo3_pmtr, 'PMTR')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo3_wave', midi_lfo.lfo3_wave, 'WAVE')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo3_mult', midi_lfo.lfo3_mult, 'MULT')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'lfo3_trig', midi_lfo.lfo3_trig, 'TRIG')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'spd3', midi_lfo.spd3, 'SPD')}
                        {renderParamWithKnob(activePart.part_id, 'midi_lfos', trackIdx, 'dep3', midi_lfo.dep3, 'DEP')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        <div className="params-empty-message">-</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* DESIGN Section */}
                <div className="parts-all-section">
                  <div className="params-label">DESIGN</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      {renderLfoEnvelope(midi_lfo.custom_lfo_design, activePart.part_id, 'midi_lfos', trackIdx)}
                    </div>
                  </div>
                </div>

                {/* CTRL1 Section */}
                <div className="parts-all-section">
                  <div className="params-label">CTRL1</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'pb', midi_ctrl1.pb, 'PB')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'at', midi_ctrl1.at, 'AT')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc1', midi_ctrl1.cc1, 'CC1')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc2', midi_ctrl1.cc2, 'CC2')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc3', midi_ctrl1.cc3, 'CC3')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc4', midi_ctrl1.cc4, 'CC4')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc1_num', midi_ctrl1.cc1_num, 'CC1#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc2_num', midi_ctrl1.cc2_num, 'CC2#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc3_num', midi_ctrl1.cc3_num, 'CC3#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl1s', trackIdx, 'cc4_num', midi_ctrl1.cc4_num, 'CC4#')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* CTRL2 Section */}
                <div className="parts-all-section">
                  <div className="params-label">CTRL2</div>
                  <div className="params-vertical-layout">
                    <div className="params-subsection">
                      <div className="params-column-label">MAIN</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc5', midi_ctrl2.cc5, 'CC5')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc6', midi_ctrl2.cc6, 'CC6')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc7', midi_ctrl2.cc7, 'CC7')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc8', midi_ctrl2.cc8, 'CC8')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc9', midi_ctrl2.cc9, 'CC9')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc10', midi_ctrl2.cc10, 'CC10')}
                      </div>
                    </div>
                    <div className="params-subsection">
                      <div className="params-column-label">SETUP</div>
                      <div className="params-grid">
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc5_num', midi_ctrl2.cc5_num, 'CC5#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc6_num', midi_ctrl2.cc6_num, 'CC6#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc7_num', midi_ctrl2.cc7_num, 'CC7#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc8_num', midi_ctrl2.cc8_num, 'CC8#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc9_num', midi_ctrl2.cc9_num, 'CC9#')}
                        {renderParamWithKnob(activePart.part_id, 'midi_ctrl2s', trackIdx, 'cc10_num', midi_ctrl2.cc10_num, 'CC10#')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return <div className="parts-panel-loading">Loading Parts data...</div>;
  }

  if (error) {
    return <div className="parts-panel-error">Error loading Parts: {error}</div>;
  }

  if (partsData.length === 0) {
    return <div className="parts-panel-empty">No Parts data available</div>;
  }

  const activePart = partsData[activePartIndex];

  return (
    <div className={`bank-card ${modifiedPartIds.size > 0 ? 'edit-mode' : ''}`}>
      <div className="bank-card-header">
        <div className="bank-card-header-left">
          <h3>{bankName} - Parts</h3>
        </div>
        <div className={`parts-edit-controls ${isEditMode ? 'visible' : 'hidden'}`}>
          {/* Reload: restore active part from parts.saved (requires valid saved state AND unsaved changes) */}
          <button
            className="cancel-button"
            onClick={() => reloadPart(activePartIndex)}
            disabled={isReloading || isCommitting || !modifiedPartIds.has(activePartIndex) || partsSavedState[activePartIndex] !== 1}
            title={
              partsSavedState[activePartIndex] !== 1
                ? 'No saved state yet: Save part first!'
                : modifiedPartIds.has(activePartIndex)
                  ? `Reload part ${partNames[activePartIndex]} from saved state`
                  : 'No changes to reload'
            }
          >
            Reload
          </button>
          {/* Save: commit active part from parts.unsaved to parts.saved */}
          <button
            className="save-button"
            onClick={() => commitPart(activePartIndex)}
            disabled={isCommitting || isReloading || !modifiedPartIds.has(activePartIndex)}
            title={modifiedPartIds.has(activePartIndex) ? `Save part ${partNames[activePartIndex]}` : 'No changes to save'}
          >
            Save
          </button>
          {/* Save All: commit all modified parts */}
          <button
            className="save-button"
            onClick={commitAllParts}
            disabled={isCommitting || isReloading || modifiedPartIds.size === 0}
            title={modifiedPartIds.size > 0 ? `Save all ${modifiedPartIds.size} modified parts` : 'No changes to save'}
          >
            Save All
          </button>
        </div>
        <div className="parts-part-tabs">
          {partNames.map((partName, index) => (
            <button
              key={index}
              className={`parts-part-tab ${activePartIndex === index ? 'active' : ''} ${modifiedPartIds.has(index) ? 'modified' : ''}`}
              onClick={() => setActivePartIndex(index)}
            >
              {partName} ({index + 1})<span className={`unsaved-indicator ${modifiedPartIds.has(index) ? 'visible' : ''}`}>*</span>
            </button>
          ))}
        </div>
      </div>

      {/* Page Tabs - Audio or MIDI based on selected track */}
      <div className="parts-page-tabs">
        {!isMidiTrack ? (
          <>
            <button
              className={`parts-tab ${activePageIndex === -1 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(-1)}
            >
              All
            </button>
            <button
              className={`parts-tab ${activePageIndex === 0 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(0)}
            >
              SRC
            </button>
            <button
              className={`parts-tab ${activePageIndex === 1 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(1)}
            >
              AMP
            </button>
            <button
              className={`parts-tab ${activePageIndex === 2 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(2)}
            >
              LFO
            </button>
            <button
              className={`parts-tab ${activePageIndex === 3 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(3)}
            >
              FX1
            </button>
            <button
              className={`parts-tab ${activePageIndex === 4 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(4)}
            >
              FX2
            </button>
          </>
        ) : (
          <>
            <button
              className={`parts-tab ${activePageIndex === -1 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(-1)}
            >
              All
            </button>
            <button
              className={`parts-tab ${activePageIndex === 0 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(0)}
            >
              NOTE
            </button>
            <button
              className={`parts-tab ${activePageIndex === 1 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(1)}
            >
              ARP
            </button>
            <button
              className={`parts-tab ${activePageIndex === 2 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(2)}
            >
              LFO
            </button>
            <button
              className={`parts-tab ${activePageIndex === 3 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(3)}
            >
              CTRL1
            </button>
            <button
              className={`parts-tab ${activePageIndex === 4 ? 'active' : ''}`}
              onClick={() => setActivePageIndex(4)}
            >
              CTRL2
            </button>
          </>
        )}
      </div>

      {/* Content for selected part */}
      <div className="parts-content centered">
        {activePart && !isMidiTrack && (
          <>
            {activeAudioPage === 'ALL' && renderAllAudioPages(activePart)}
            {activeAudioPage === 'SRC' && renderSrcPage(activePart)}
            {activeAudioPage === 'AMP' && renderAmpPage(activePart)}
            {activeAudioPage === 'LFO' && renderLfoPage(activePart)}
            {activeAudioPage === 'FX1' && renderFx1Page(activePart)}
            {activeAudioPage === 'FX2' && renderFx2Page(activePart)}
          </>
        )}
        {activePart && isMidiTrack && (
          <>
            {activeMidiPage === 'ALL' && renderAllMidiPages(activePart)}
            {activeMidiPage === 'NOTE' && renderNotePage(activePart)}
            {activeMidiPage === 'ARP' && renderArpPage(activePart)}
            {activeMidiPage === 'LFO' && renderMidiLfoPage(activePart)}
            {activeMidiPage === 'CTRL1' && renderCtrl1Page(activePart)}
            {activeMidiPage === 'CTRL2' && renderCtrl2Page(activePart)}
          </>
        )}
      </div>
    </div>
  );
}
