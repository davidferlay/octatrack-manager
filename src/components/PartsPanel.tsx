import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PartData } from '../context/ProjectsContext';
import { formatTrackName } from '../utils/trackUtils';
import './PartsPanel.css';

interface PartsPanelProps {
  projectPath: string;
  bankId: string;
  bankName: string;
  partNames: string[];  // Array of 4 part names
  selectedTrack?: number;  // 0-7 for T1-T8, undefined = show all
}

type PageType = 'SRC' | 'AMP' | 'LFO';
type LfoTabType = 'LFO1' | 'LFO2' | 'LFO3' | 'DESIGN';

export default function PartsPanel({ projectPath, bankId, bankName, partNames, selectedTrack }: PartsPanelProps) {
  const [partsData, setPartsData] = useState<PartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<PageType>('SRC');
  const [activePartIndex, setActivePartIndex] = useState<number>(0);
  const [activeLfoTab, setActiveLfoTab] = useState<LfoTabType>('LFO1');

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

  const renderSrcPage = (part: PartData) => {
    const tracksToShow = selectedTrack !== undefined
      ? [part.machines[selectedTrack]]
      : part.machines;

    return (
      <div className="parts-tracks">
        {tracksToShow.map((machine) => (
          <div key={machine.track_id} className="parts-track">
            <div className="parts-track-header">
              <span className="track-label">{formatTrackName(machine.track_id)}</span>
              <span className="machine-type">{machine.machine_type}</span>
            </div>

            <div className="parts-params-section">
              <div className="params-label">MAIN</div>
              <div className="params-grid">
                {machine.machine_type === 'Thru' ? (
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

            {machine.machine_type !== 'Thru' && (
              <div className="parts-params-section">
                <div className="params-label">SETUP</div>
                <div className="params-grid">
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
                <span className="track-label">{formatTrackName(amp.track_id)}</span>
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
                    <span className="param-value">{amp.amp_setup_fx1}</span>
                  </div>
                  <div className="param-item">
                    <span className="param-label">FX2</span>
                    <span className="param-value">{amp.amp_setup_fx2}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLfoEnvelope = () => {
    // TODO: Replace with actual LFO design data from backend
    // For now, using mock data - 16 values representing custom LFO envelope
    const mockEnvelopeData = [
      64, 80, 100, 120, 127, 120, 100, 80,
      64, 40, 20, 10, 0, 10, 30, 50
    ];

    const maxValue = 127;
    const stepCount = 16;

    return (
      <div className="lfo-envelope-container">
        <div className="lfo-envelope-title">LFO DESIGN</div>
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

          {/* Draw the waveform */}
          <polyline
            className="lfo-envelope-line"
            points={mockEnvelopeData
              .map((value, index) => {
                const x = (index / (stepCount - 1)) * 100;
                const y = 50 - ((value / maxValue) * 45);
                return `${x},${y}`;
              })
              .join(' ')}
          />
        </svg>

        {/* Step indicators */}
        <div className="lfo-envelope-steps">
          {mockEnvelopeData.map((value, index) => (
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
                  <span className="track-label">{formatTrackName(lfo.track_id)}</span>
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
                        <span className="param-value">{lfoParams!.wave}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">MULT</span>
                        <span className="param-value">{lfoParams!.mult}</span>
                      </div>
                      <div className="param-item">
                        <span className="param-label">TRIG</span>
                        <span className="param-value">{lfoParams!.trig}</span>
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
                  renderLfoEnvelope()
                )}
              </div>
            );
          })}
        </div>
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

      {/* Content for selected part */}
      <div className="parts-content centered">
        {activePart && (
          <>
            {activePage === 'SRC' && renderSrcPage(activePart)}
            {activePage === 'AMP' && renderAmpPage(activePart)}
            {activePage === 'LFO' && renderLfoPage(activePart)}
          </>
        )}
      </div>

      {/* SRC/AMP/LFO Page Tabs */}
      <div className="parts-page-tabs">
        <button
          className={`parts-tab ${activePage === 'SRC' ? 'active' : ''}`}
          onClick={() => setActivePage('SRC')}
        >
          SRC
        </button>
        <button
          className={`parts-tab ${activePage === 'AMP' ? 'active' : ''}`}
          onClick={() => setActivePage('AMP')}
        >
          AMP
        </button>
        <button
          className={`parts-tab ${activePage === 'LFO' ? 'active' : ''}`}
          onClick={() => setActivePage('LFO')}
        >
          LFO
        </button>
      </div>
    </div>
  );
}
