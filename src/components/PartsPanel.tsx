import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PartData, PartsDataResponse } from '../context/ProjectsContext';
import { TrackBadge } from './TrackBadge';
import { ALL_MIDI_TRACKS } from './TrackSelector';
import { WriteStatus, writeStatus } from '../types/writeStatus';
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
    track[field] = value;

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

  // Parameter value component - editable in edit mode, read-only in view mode
  const renderParamValue = (
    partId: number,
    section: keyof PartData,
    trackId: number,
    field: string,
    value: number,
    _formatter?: (val: number) => string  // Unused now, kept for API compatibility
  ) => {
    // Always render input, but style and behavior changes based on edit mode
    return (
      <input
        type="number"
        className={`param-value ${isEditMode ? 'editable' : ''}`}
        value={value}
        onChange={(e) => {
          if (!isEditMode) return;
          const newValue = parseInt(e.target.value, 10);
          if (!isNaN(newValue)) {
            updatePartParam(partId, section, trackId, field, newValue);
          }
        }}
        readOnly={!isEditMode}
        tabIndex={isEditMode ? 0 : -1}
        min={0}
        max={127}
      />
    );
  };

  const formatParamValue = (value: number | null): string => {
    if (value === null) return '-';
    return value.toString();
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

  const formatLfoWave = (value: number): string => {
    // LFO waveform types
    const waveforms = ['TRI', 'SIN', 'SQR', 'SAW', 'EXP', 'RSU', 'RSD', 'CUST'];
    return waveforms[value] || value.toString();
  };

  const formatLfoTrig = (value: number): string => {
    // LFO trigger modes
    const triggers = ['FREE', 'TRIG', 'HOLD', 'ONE', 'HALF', 'DOUBLE'];
    return triggers[value] || value.toString();
  };

  const formatLfoMult = (value: number): string => {
    // LFO multiplier values
    const multipliers = ['2048', '1024', '512', '256', '128', '64', '32', '16', '8', '4', '2', '1', '1/2', '1/4', '1/8', '1/16'];
    return multipliers[value] || value.toString();
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
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [part.machines[selectedTrack]]
      : part.machines;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((machine) => (
          <div key={machine.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={machine.track_id} />
              <span className="machine-type">{machine.machine_type}</span>
            </div>

            <div className="parts-params-section">
              <div className="params-label">MAIN</div>
              <div className="params-grid">
                {machine.machine_type === 'Thru' ? (
                  <>
                    {/* THRU MAIN parameters */}
                    <div className="param-item">
                      <span className="param-label">INAB</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.in_ab)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">VOL</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.vol_ab)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">INCD</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.in_cd)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">VOL</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.vol_cd)}</span>
                    </div>
                  </>
                ) : machine.machine_type === 'Neighbor' ? (
                  <>
                    {/* NEIGHBOR has no MAIN parameters */}
                  </>
                ) : machine.machine_type === 'Pickup' ? (
                  <>
                    {/* PICKUP MAIN parameters */}
                    <div className="param-item">
                      <span className="param-label">PITCH</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.ptch)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">DIR</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.dir)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">LEN</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.len)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">GAIN</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.gain)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">OP</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.op)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    {/* FLEX/STATIC MAIN parameters */}
                    <div className="param-item">
                      <span className="param-label">PTCH</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.ptch)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">STRT</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.strt)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">LEN</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.len)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">RATE</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.rate)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">RTRG</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.rtrg)}</span>
                    </div>
                    <div className="param-item">
                      <span className="param-label">RTIM</span>
                      <span className="param-value">{formatParamValue(machine.machine_params.rtim)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {machine.machine_type !== 'Thru' && machine.machine_type !== 'Neighbor' && (
              <div className="parts-params-section">
                <div className="params-label">SETUP</div>
                <div className="params-grid">
                  {machine.machine_type === 'Pickup' ? (
                    <>
                      {/* PICKUP SETUP parameters */}
                      <div className="param-item">
                        <span className="param-label">TSTR</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.tstr)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TSNS</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.tsns)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* FLEX/STATIC SETUP parameters */}
                      <div className="param-item">
                        <span className="param-label">LOOP</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.xloop)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SLIC</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.slic)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">LEN</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.len)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">RATE</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.rate)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TSTR</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.tstr)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TSNS</span>
                        <span className="param-value">{formatParamValue(machine.machine_setup.tsns)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
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
                <div className="params-label">MAIN</div>
                <div className="params-grid">
                  <div className="param-item">
                    <span className="param-label">ATK</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'atk', amp.atk)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">HOLD</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'hold', amp.hold)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">REL</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'rel', amp.rel)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">VOL</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'vol', amp.vol)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">BAL</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'bal', amp.bal)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">F</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'f', amp.f)}
                  </div>
                </div>
              </div>

              <div className="parts-params-section">
                <div className="params-label">SETUP</div>
                <div className="params-grid">
                  <div className="param-item">
                    <span className="param-label">AMP</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'amp_setup_amp', amp.amp_setup_amp)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">SYNC</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'amp_setup_sync', amp.amp_setup_sync)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">ATCK</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'amp_setup_atck', amp.amp_setup_atck)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">FX1</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'amp_setup_fx1', amp.amp_setup_fx1, formatFxEnvTrig)}
                  </div>
                  <div className="param-item">
                    <span className="param-label">FX2</span>
                    {renderParamValue(activePart.part_id, 'amps', amp.track_id, 'amp_setup_fx2', amp.amp_setup_fx2, formatFxEnvTrig)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLfoEnvelope = (customLfoDesign: number[]) => {
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

    return (
      <div className="lfo-envelope-container">
        <svg className="lfo-envelope-svg" viewBox="0 0 100 60" preserveAspectRatio="none">
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

          {/* Draw the smooth waveform */}
          <path
            className="lfo-envelope-line"
            d={createSmoothPath(points)}
          />
        </svg>

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
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [part.lfos[selectedTrack]]
      : part.lfos;

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
            const machine = part.machines[lfo.track_id];
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

            return (
              <div key={lfo.track_id} className="parts-track">
                <div className="parts-track-header">
                  <TrackBadge trackId={lfo.track_id} />
                  <span className="machine-type">{machineType}</span>
                </div>

                {activeLfoTab !== 'DESIGN' ? (
                  <div className="parts-params-section">
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{lfoParams!.pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(lfoParams!.wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(lfoParams!.mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(lfoParams!.trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{lfoParams!.spd}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{lfoParams!.dep}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  renderLfoEnvelope(lfo.custom_lfo_design)
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFx1Page = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [part.fxs[selectedTrack]]
      : part.fxs;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((fx) => {
          const machine = part.machines[fx.track_id];
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
                <div className="params-label">FX1 - {formatFxType(fx.fx1_type)}</div>
                <div className="params-grid">
                  {mainLabels.map((label, index) => {
                    if (!label) return null; // Skip empty labels
                    return (
                      <div key={index} className="param-item">
                        <span className="param-label">{label}</span>
                        <span className="param-value">{mainValues[index]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="parts-params-section">
                <div className="params-label">SETUP</div>
                <div className="params-grid">
                  {setupLabels.map((label, index) => {
                    if (!label) return null; // Skip empty labels
                    return (
                      <div key={index} className="param-item">
                        <span className="param-label">{label}</span>
                        <span className="param-value">{setupValues[index]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderFx2Page = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [part.fxs[selectedTrack]]
      : part.fxs;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((fx) => {
          const machine = part.machines[fx.track_id];
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
                <div className="params-label">FX2 - {formatFxType(fx.fx2_type)}</div>
                <div className="params-grid">
                  {mainLabels.map((label, index) => {
                    if (!label) return null; // Skip empty labels
                    return (
                      <div key={index} className="param-item">
                        <span className="param-label">{label}</span>
                        <span className="param-value">{mainValues[index]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="parts-params-section">
                <div className="params-label">SETUP</div>
                <div className="params-grid">
                  {setupLabels.map((label, index) => {
                    if (!label) return null; // Skip empty labels
                    return (
                      <div key={index} className="param-item">
                        <span className="param-label">{label}</span>
                        <span className="param-value">{setupValues[index]}</span>
                      </div>
                    );
                  })}
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
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [part.midi_notes[selectedTrack - 8]]
      : part.midi_notes;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_note) => (
          <div key={midi_note.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_note.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-label">NOTE MAIN</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">NOTE</span>
                  <span className="param-value">{midi_note.note}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">VEL</span>
                  <span className="param-value">{midi_note.vel}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">LEN</span>
                  <span className="param-value">{midi_note.len}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">NOT2</span>
                  <span className="param-value">{midi_note.not2}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">NOT3</span>
                  <span className="param-value">{midi_note.not3}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">NOT4</span>
                  <span className="param-value">{midi_note.not4}</span>
                </div>
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-label">NOTE SETUP</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">CHAN</span>
                  <span className="param-value">{midi_note.chan}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">BANK</span>
                  <span className="param-value">{midi_note.bank}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">PROG</span>
                  <span className="param-value">{midi_note.prog}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">SBNK</span>
                  <span className="param-value">{midi_note.sbnk}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderArpPage = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [part.midi_arps[selectedTrack - 8]]
      : part.midi_arps;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_arp) => (
          <div key={midi_arp.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_arp.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-label">ARP MAIN</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">TRAN</span>
                  <span className="param-value">{midi_arp.tran}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">LEG</span>
                  <span className="param-value">{midi_arp.leg}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">MODE</span>
                  <span className="param-value">{midi_arp.mode}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">SPD</span>
                  <span className="param-value">{midi_arp.spd}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">RNGE</span>
                  <span className="param-value">{midi_arp.rnge}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">NLEN</span>
                  <span className="param-value">{midi_arp.nlen}</span>
                </div>
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-label">ARP SETUP</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">LEN</span>
                  <span className="param-value">{midi_arp.len}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">KEY</span>
                  <span className="param-value">{midi_arp.key}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderMidiLfoPage = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [part.midi_lfos[selectedTrack - 8]]
      : part.midi_lfos;

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

            return (
              <div key={lfo.track_id} className="parts-track">
                <div className="parts-track-header">
                  <TrackBadge trackId={lfo.track_id + 8} />
                  <span className="machine-type">MIDI</span>
                </div>

                {activeLfoTab !== 'DESIGN' ? (
                  <div className="parts-params-section">
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{lfoParams!.pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(lfoParams!.wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(lfoParams!.mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(lfoParams!.trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{lfoParams!.spd}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{lfoParams!.dep}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  renderLfoEnvelope(lfo.custom_lfo_design)
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCtrl1Page = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [part.midi_ctrl1s[selectedTrack - 8]]
      : part.midi_ctrl1s;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_ctrl1) => (
          <div key={midi_ctrl1.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_ctrl1.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-label">CTRL1 MAIN</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">PB</span>
                  <span className="param-value">{midi_ctrl1.pb}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">AT</span>
                  <span className="param-value">{midi_ctrl1.at}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC1</span>
                  <span className="param-value">{midi_ctrl1.cc1}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC2</span>
                  <span className="param-value">{midi_ctrl1.cc2}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC3</span>
                  <span className="param-value">{midi_ctrl1.cc3}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC4</span>
                  <span className="param-value">{midi_ctrl1.cc4}</span>
                </div>
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-label">CTRL1 SETUP</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">CC1#</span>
                  <span className="param-value">{midi_ctrl1.cc1_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC2#</span>
                  <span className="param-value">{midi_ctrl1.cc2_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC3#</span>
                  <span className="param-value">{midi_ctrl1.cc3_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC4#</span>
                  <span className="param-value">{midi_ctrl1.cc4_num}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCtrl2Page = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [part.midi_ctrl2s[selectedTrack - 8]]
      : part.midi_ctrl2s;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((midi_ctrl2) => (
          <div key={midi_ctrl2.track_id} className="parts-track">
            <div className="parts-track-header">
              <TrackBadge trackId={midi_ctrl2.track_id + 8} />
              <span className="machine-type">MIDI</span>
            </div>

            <div className="parts-params-section">
              <div className="params-label">CTRL2 MAIN</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">CC5</span>
                  <span className="param-value">{midi_ctrl2.cc5}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC6</span>
                  <span className="param-value">{midi_ctrl2.cc6}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC7</span>
                  <span className="param-value">{midi_ctrl2.cc7}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC8</span>
                  <span className="param-value">{midi_ctrl2.cc8}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC9</span>
                  <span className="param-value">{midi_ctrl2.cc9}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC10</span>
                  <span className="param-value">{midi_ctrl2.cc10}</span>
                </div>
              </div>
            </div>

            <div className="parts-params-section">
              <div className="params-label">CTRL2 SETUP</div>
              <div className="params-grid">
                <div className="param-item">
                  <span className="param-label">CC5#</span>
                  <span className="param-value">{midi_ctrl2.cc5_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC6#</span>
                  <span className="param-value">{midi_ctrl2.cc6_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC7#</span>
                  <span className="param-value">{midi_ctrl2.cc7_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC8#</span>
                  <span className="param-value">{midi_ctrl2.cc8_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC9#</span>
                  <span className="param-value">{midi_ctrl2.cc9_num}</span>
                </div>
                <div className="param-item">
                  <span className="param-label">CC10#</span>
                  <span className="param-value">{midi_ctrl2.cc10_num}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render all Audio pages - same style as individual tabs with MAIN/SETUP side by side
  const renderAllAudioPages = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 0 && selectedTrack <= 7
      ? [selectedTrack]
      : [0, 1, 2, 3, 4, 5, 6, 7];

    return (
      <div className="parts-tracks">
        {tracksToShow.map((trackIdx) => {
          const machine = part.machines[trackIdx];
          const amp = part.amps[trackIdx];
          const lfo = part.lfos[trackIdx];
          const fx = part.fxs[trackIdx];
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

              {/* SRC Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">SRC</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      {machineType === 'Thru' ? (
                        <>
                          <div className="param-item">
                            <span className="param-label">INAB</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.in_ab)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">VOL</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.vol_ab)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">INCD</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.in_cd)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">VOL</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.vol_cd)}</span>
                          </div>
                        </>
                      ) : machineType === 'Neighbor' ? (
                        <div className="params-empty-message">
                          Neighbor machine uses audio from adjacent track
                        </div>
                      ) : machineType === 'Pickup' ? (
                        <>
                          <div className="param-item">
                            <span className="param-label">PITCH</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.ptch)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">DIR</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.dir)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">LEN</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.len)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">GAIN</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.gain)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">OP</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.op)}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="param-item">
                            <span className="param-label">PTCH</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.ptch)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">STRT</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.strt)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">LEN</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.len)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">RATE</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.rate)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">RTRG</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.rtrg)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">RTIM</span>
                            <span className="param-value">{formatParamValue(machine.machine_params.rtim)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      {machineType === 'Thru' ? (
                        <div className="params-empty-message">Thru machine has no setup parameters</div>
                      ) : machineType === 'Neighbor' ? (
                        <div className="params-empty-message">Neighbor machine has no setup parameters</div>
                      ) : machineType === 'Pickup' ? (
                        <>
                          <div className="param-item">
                            <span className="param-label">TSTR</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.tstr)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">TSNS</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.tsns)}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="param-item">
                            <span className="param-label">LOOP</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.xloop)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">SLIC</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.slic)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">LEN</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.len)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">RATE</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.rate)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">TSTR</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.tstr)}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">TSNS</span>
                            <span className="param-value">{formatParamValue(machine.machine_setup.tsns)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* AMP Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">AMP</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">ATK</span>
                        <span className="param-value">{amp.atk}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">HOLD</span>
                        <span className="param-value">{amp.hold}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">REL</span>
                        <span className="param-value">{amp.rel}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">VOL</span>
                        <span className="param-value">{amp.vol}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">BAL</span>
                        <span className="param-value">{amp.bal}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">F</span>
                        <span className="param-value">{amp.f}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">AMP</span>
                        <span className="param-value">{amp.amp_setup_amp}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SYNC</span>
                        <span className="param-value">{amp.amp_setup_sync}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">ATCK</span>
                        <span className="param-value">{amp.amp_setup_atck}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">FX1</span>
                        <span className="param-value">{formatFxEnvTrig(amp.amp_setup_fx1)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">FX2</span>
                        <span className="param-value">{formatFxEnvTrig(amp.amp_setup_fx2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LFO Section - 2x2 grid: LFO1|LFO2 top, LFO3|DESIGN bottom */}
              <div className="parts-params-section">
                <div className="params-label">LFO</div>
                <div className="params-grid-2x2">
                  <div className="params-column">
                    <div className="params-column-label">LFO1</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{lfo.lfo1_pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(lfo.lfo1_wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(lfo.lfo1_mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(lfo.lfo1_trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{lfo.spd1}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{lfo.dep1}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">LFO2</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{lfo.lfo2_pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(lfo.lfo2_wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(lfo.lfo2_mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(lfo.lfo2_trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{lfo.spd2}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{lfo.dep2}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">LFO3</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{lfo.lfo3_pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(lfo.lfo3_wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(lfo.lfo3_mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(lfo.lfo3_trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{lfo.spd3}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{lfo.dep3}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">DESIGN</div>
                    {renderLfoEnvelope(lfo.custom_lfo_design)}
                  </div>
                </div>
              </div>

              {/* FX1 Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">FX1 - {formatFxType(fx.fx1_type)}</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      {fx1MainLabels.some(label => label) ? (
                        fx1MainLabels.map((label, index) => {
                          if (!label) return null;
                          return (
                            <div key={index} className="param-item">
                              <span className="param-label">{label}</span>
                              <span className="param-value">{fx1MainValues[index]}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="params-empty-message">No effect assigned to FX1 slot</div>
                      )}
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      {fx1SetupLabels.some(label => label) ? (
                        fx1SetupLabels.map((label, index) => {
                          if (!label) return null;
                          return (
                            <div key={index} className="param-item">
                              <span className="param-label">{label}</span>
                              <span className="param-value">{fx1SetupValues[index]}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="params-empty-message">No setup parameters for this effect</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* FX2 Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">FX2 - {formatFxType(fx.fx2_type)}</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      {fx2MainLabels.some(label => label) ? (
                        fx2MainLabels.map((label, index) => {
                          if (!label) return null;
                          return (
                            <div key={index} className="param-item">
                              <span className="param-label">{label}</span>
                              <span className="param-value">{fx2MainValues[index]}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="params-empty-message">No effect assigned to FX2 slot</div>
                      )}
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      {fx2SetupLabels.some(label => label) ? (
                        fx2SetupLabels.map((label, index) => {
                          if (!label) return null;
                          return (
                            <div key={index} className="param-item">
                              <span className="param-label">{label}</span>
                              <span className="param-value">{fx2SetupValues[index]}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="params-empty-message">No setup parameters for this effect</div>
                      )}
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

  // Render all MIDI pages - same style as individual tabs with MAIN/SETUP side by side
  const renderAllMidiPages = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined && selectedTrack >= 8
      ? [selectedTrack - 8]
      : [0, 1, 2, 3, 4, 5, 6, 7];

    return (
      <div className="parts-tracks">
        {tracksToShow.map((trackIdx) => {
          const midi_note = part.midi_notes[trackIdx];
          const midi_arp = part.midi_arps[trackIdx];
          const midi_lfo = part.midi_lfos[trackIdx];
          const midi_ctrl1 = part.midi_ctrl1s[trackIdx];
          const midi_ctrl2 = part.midi_ctrl2s[trackIdx];

          return (
            <div key={trackIdx} className="parts-track parts-track-wide">
              <div className="parts-track-header">
                <TrackBadge trackId={trackIdx + 8} />
                <span className="machine-type">MIDI</span>
              </div>

              {/* NOTE Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">NOTE</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">NOTE</span>
                        <span className="param-value">{midi_note.note}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">VEL</span>
                        <span className="param-value">{midi_note.vel}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">LEN</span>
                        <span className="param-value">{midi_note.len}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">NOT2</span>
                        <span className="param-value">{midi_note.not2}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">NOT3</span>
                        <span className="param-value">{midi_note.not3}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">NOT4</span>
                        <span className="param-value">{midi_note.not4}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">CHAN</span>
                        <span className="param-value">{midi_note.chan}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">BANK</span>
                        <span className="param-value">{midi_note.bank}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">PROG</span>
                        <span className="param-value">{midi_note.prog}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SBNK</span>
                        <span className="param-value">{midi_note.sbnk}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ARP Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">ARP</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">TRAN</span>
                        <span className="param-value">{midi_arp.tran}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">LEG</span>
                        <span className="param-value">{midi_arp.leg}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MODE</span>
                        <span className="param-value">{midi_arp.mode}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{midi_arp.spd}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">RNGE</span>
                        <span className="param-value">{midi_arp.rnge}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">NLEN</span>
                        <span className="param-value">{midi_arp.nlen}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">LEN</span>
                        <span className="param-value">{midi_arp.len}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">KEY</span>
                        <span className="param-value">{midi_arp.key}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LFO Section - 2x2 grid: LFO1|LFO2 top, LFO3|DESIGN bottom */}
              <div className="parts-params-section">
                <div className="params-label">LFO</div>
                <div className="params-grid-2x2">
                  <div className="params-column">
                    <div className="params-column-label">LFO1</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{midi_lfo.lfo1_pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(midi_lfo.lfo1_wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(midi_lfo.lfo1_mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(midi_lfo.lfo1_trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{midi_lfo.spd1}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{midi_lfo.dep1}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">LFO2</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{midi_lfo.lfo2_pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(midi_lfo.lfo2_wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(midi_lfo.lfo2_mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(midi_lfo.lfo2_trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{midi_lfo.spd2}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{midi_lfo.dep2}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">LFO3</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PMTR</span>
                        <span className="param-value">{midi_lfo.lfo3_pmtr}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">WAVE</span>
                        <span className="param-value">{formatLfoWave(midi_lfo.lfo3_wave)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{formatLfoMult(midi_lfo.lfo3_mult)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{formatLfoTrig(midi_lfo.lfo3_trig)}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">SPD</span>
                        <span className="param-value">{midi_lfo.spd3}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">DEP</span>
                        <span className="param-value">{midi_lfo.dep3}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">DESIGN</div>
                    {renderLfoEnvelope(midi_lfo.custom_lfo_design)}
                  </div>
                </div>
              </div>

              {/* CTRL1 Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">CTRL1</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">PB</span>
                        <span className="param-value">{midi_ctrl1.pb}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">AT</span>
                        <span className="param-value">{midi_ctrl1.at}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC1</span>
                        <span className="param-value">{midi_ctrl1.cc1}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC2</span>
                        <span className="param-value">{midi_ctrl1.cc2}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC3</span>
                        <span className="param-value">{midi_ctrl1.cc3}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC4</span>
                        <span className="param-value">{midi_ctrl1.cc4}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">CC1#</span>
                        <span className="param-value">{midi_ctrl1.cc1_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC2#</span>
                        <span className="param-value">{midi_ctrl1.cc2_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC3#</span>
                        <span className="param-value">{midi_ctrl1.cc3_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC4#</span>
                        <span className="param-value">{midi_ctrl1.cc4_num}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* CTRL2 Section - MAIN | SETUP */}
              <div className="parts-params-section">
                <div className="params-label">CTRL2</div>
                <div className="params-dual-layout">
                  <div className="params-column">
                    <div className="params-column-label">MAIN</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">CC5</span>
                        <span className="param-value">{midi_ctrl2.cc5}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC6</span>
                        <span className="param-value">{midi_ctrl2.cc6}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC7</span>
                        <span className="param-value">{midi_ctrl2.cc7}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC8</span>
                        <span className="param-value">{midi_ctrl2.cc8}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC9</span>
                        <span className="param-value">{midi_ctrl2.cc9}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC10</span>
                        <span className="param-value">{midi_ctrl2.cc10}</span>
                      </div>
                    </div>
                  </div>
                  <div className="params-column">
                    <div className="params-column-label">SETUP</div>
                    <div className="params-grid">
                      <div className="param-item">
                        <span className="param-label">CC5#</span>
                        <span className="param-value">{midi_ctrl2.cc5_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC6#</span>
                        <span className="param-value">{midi_ctrl2.cc6_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC7#</span>
                        <span className="param-value">{midi_ctrl2.cc7_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC8#</span>
                        <span className="param-value">{midi_ctrl2.cc8_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC9#</span>
                        <span className="param-value">{midi_ctrl2.cc9_num}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">CC10#</span>
                        <span className="param-value">{midi_ctrl2.cc10_num}</span>
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
                ? 'No saved backup available for this part'
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
