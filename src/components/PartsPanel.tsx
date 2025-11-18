import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PartData } from '../context/ProjectsContext';
import { TrackBadge } from './TrackBadge';
import './PartsPanel.css';

interface PartsPanelProps {
  projectPath: string;
  bankId: string;
  bankName: string;
  partNames: string[];  // Array of 4 part names
  selectedTrack?: number;  // 0-7 for T1-T8, undefined = show all
}

type AudioPageType = 'SRC' | 'AMP' | 'LFO' | 'FX1' | 'FX2';
type MidiPageType = 'NOTE' | 'ARP' | 'LFO' | 'CTRL1' | 'CTRL2';
type LfoTabType = 'LFO1' | 'LFO2' | 'LFO3' | 'DESIGN';

export default function PartsPanel({ projectPath, bankId, bankName, partNames, selectedTrack }: PartsPanelProps) {
  const [partsData, setPartsData] = useState<PartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAudioPage, setActiveAudioPage] = useState<AudioPageType>('SRC');
  const [activeMidiPage, setActiveMidiPage] = useState<MidiPageType>('NOTE');
  const [activePartIndex, setActivePartIndex] = useState<number>(0);
  const [activeLfoTab, setActiveLfoTab] = useState<LfoTabType>('LFO1');

  // Determine if selected track is MIDI (tracks 8-15) or Audio (tracks 0-7)
  const isMidiTrack = selectedTrack !== undefined && selectedTrack >= 8;

  useEffect(() => {
    loadPartsData();
  }, [projectPath, bankId]);

  const loadPartsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await invoke<PartData[]>('load_parts_data', {
        path: projectPath,
        bankId: bankId
      });
      setPartsData(data);
    } catch (err) {
      console.error('Failed to load parts data:', err);
      setError(err as string);
    } finally {
      setLoading(false);
    }
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
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
      ? [part.amps[selectedTrack]]
      : part.amps;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((amp) => {
          // Get the machine type from the corresponding machine data
          const machine = part.machines[amp.track_id];
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

              <div className="parts-params-section">
                <div className="params-label">SETUP</div>
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
    const maxValue = 255;  // Custom LFO design values range from 0-255
    const stepCount = 16;

    // Convert data points to coordinates
    const points = envelopeData.map((value, index) => ({
      x: (index / (stepCount - 1)) * 100,
      y: 50 - ((value / maxValue) * 45)
    }));

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
          {envelopeData.map((value, index) => (
            <div key={index} className="lfo-step-indicator">
              <div className="lfo-step-dot"></div>
              <div className="lfo-step-value">{value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderLfoPage = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
      ? [part.midi_lfos[selectedTrack - 8]]
      : part.midi_lfos;

    return (
      <div className="parts-tracks">
        <div className="parts-lfo-container">
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

          {/* LFO Content */}
          <div className="parts-lfo-content">
            {tracksToShow.map((lfo) => {
              // Determine which LFO's parameters to show
              const lfoParams = activeLfoTab === 'LFO1' ? {
                speed: lfo.spd1,
                depth: lfo.dep1,
                param: lfo.lfo1_pmtr,
                wave: lfo.lfo1_wave,
                mult: lfo.lfo1_mult,
                trig: lfo.lfo1_trig,
              } : activeLfoTab === 'LFO2' ? {
                speed: lfo.spd2,
                depth: lfo.dep2,
                param: lfo.lfo2_pmtr,
                wave: lfo.lfo2_wave,
                mult: lfo.lfo2_mult,
                trig: lfo.lfo2_trig,
              } : activeLfoTab === 'LFO3' ? {
                speed: lfo.spd3,
                depth: lfo.dep3,
                param: lfo.lfo3_pmtr,
                wave: lfo.lfo3_wave,
                mult: lfo.lfo3_mult,
                trig: lfo.lfo3_trig,
              } : null;

              return (
                <div key={lfo.track_id} className="parts-track">
                  <div className="parts-track-header">
                    <TrackBadge trackId={lfo.track_id + 8} />
                    <span className="machine-type">MIDI</span>
                  </div>

                  {activeLfoTab === 'DESIGN' ? (
                    <div className="parts-params-section">
                      <div className="params-label">CUSTOM LFO DESIGN</div>
                      {lfo.custom_lfo_design && lfo.custom_lfo_design.length === 16 ? (
                        <div className="lfo-design-viz">
                          {lfo.custom_lfo_design.map((value, index) => {
                            const maxValue = 255;
                            const heightPercent = (value / maxValue) * 100;
                            return (
                              <div key={index} className="lfo-bar-container">
                                <div
                                  className="lfo-bar"
                                  style={{
                                    height: `${heightPercent}%`,
                                    minHeight: '2px'
                                  }}
                                  title={`Step ${index + 1}: ${value}`}
                                />
                                <div className="lfo-step-label">{index + 1}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="no-lfo-data">
                          No custom LFO design data available
                        </div>
                      )}
                    </div>
                  ) : lfoParams && (
                    <>
                      <div className="parts-params-section">
                        <div className="params-label">LFO MAIN</div>
                        <div className="params-grid">
                          <div className="param-item">
                            <span className="param-label">SPD</span>
                            <span className="param-value">{lfoParams.speed}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">DEP</span>
                            <span className="param-value">{lfoParams.depth}</span>
                          </div>
                        </div>
                      </div>

                      <div className="parts-params-section">
                        <div className="params-label">LFO SETUP 1</div>
                        <div className="params-grid">
                          <div className="param-item">
                            <span className="param-label">PMTR</span>
                            <span className="param-value">{lfoParams.param}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">WAVE</span>
                            <span className="param-value">{lfoParams.wave}</span>
                          </div>
                        </div>
                      </div>

                      <div className="parts-params-section">
                        <div className="params-label">LFO SETUP 2</div>
                        <div className="params-grid">
                          <div className="param-item">
                            <span className="param-label">MULT</span>
                            <span className="param-value">{lfoParams.mult}</span>
                          </div>
                          <div className="param-item">
                            <span className="param-label">TRIG</span>
                            <span className="param-value">{lfoParams.trig}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderCtrl1Page = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined
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
    const tracksToShow = selectedTrack !== undefined
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
    <div className="parts-panel">
      <div className="parts-panel-header">
        <h3>{bankName} - Parts</h3>
      </div>

      {/* Part Tabs */}
      <div className="parts-part-tabs">
        {partNames.map((partName, index) => (
          <button
            key={index}
            className={`parts-part-tab ${activePartIndex === index ? 'active' : ''}`}
            onClick={() => setActivePartIndex(index)}
          >
            {partName} ({index + 1})
          </button>
        ))}
      </div>

      {/* Page Tabs - Audio or MIDI based on selected track */}
      <div className="parts-page-tabs">
        {!isMidiTrack ? (
          <>
            <button
              className={`parts-tab ${activeAudioPage === 'SRC' ? 'active' : ''}`}
              onClick={() => setActiveAudioPage('SRC')}
            >
              SRC
            </button>
            <button
              className={`parts-tab ${activeAudioPage === 'AMP' ? 'active' : ''}`}
              onClick={() => setActiveAudioPage('AMP')}
            >
              AMP
            </button>
            <button
              className={`parts-tab ${activeAudioPage === 'LFO' ? 'active' : ''}`}
              onClick={() => setActiveAudioPage('LFO')}
            >
              LFO
            </button>
            <button
              className={`parts-tab ${activeAudioPage === 'FX1' ? 'active' : ''}`}
              onClick={() => setActiveAudioPage('FX1')}
            >
              FX1
            </button>
            <button
              className={`parts-tab ${activeAudioPage === 'FX2' ? 'active' : ''}`}
              onClick={() => setActiveAudioPage('FX2')}
            >
              FX2
            </button>
          </>
        ) : (
          <>
            <button
              className={`parts-tab ${activeMidiPage === 'NOTE' ? 'active' : ''}`}
              onClick={() => setActiveMidiPage('NOTE')}
            >
              NOTE
            </button>
            <button
              className={`parts-tab ${activeMidiPage === 'ARP' ? 'active' : ''}`}
              onClick={() => setActiveMidiPage('ARP')}
            >
              ARP
            </button>
            <button
              className={`parts-tab ${activeMidiPage === 'LFO' ? 'active' : ''}`}
              onClick={() => setActiveMidiPage('LFO')}
            >
              LFO
            </button>
            <button
              className={`parts-tab ${activeMidiPage === 'CTRL1' ? 'active' : ''}`}
              onClick={() => setActiveMidiPage('CTRL1')}
            >
              CTRL1
            </button>
            <button
              className={`parts-tab ${activeMidiPage === 'CTRL2' ? 'active' : ''}`}
              onClick={() => setActiveMidiPage('CTRL2')}
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
            {activeAudioPage === 'SRC' && renderSrcPage(activePart)}
            {activeAudioPage === 'AMP' && renderAmpPage(activePart)}
            {activeAudioPage === 'LFO' && renderLfoPage(activePart)}
            {activeAudioPage === 'FX1' && renderFx1Page(activePart)}
            {activeAudioPage === 'FX2' && renderFx2Page(activePart)}
          </>
        )}
        {activePart && isMidiTrack && (
          <>
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
