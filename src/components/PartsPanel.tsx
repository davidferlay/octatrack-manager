import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PartData } from '../context/ProjectsContext';
import './PartsPanel.css';

interface PartsPanelProps {
  projectPath: string;
  bankId: string;
  bankName: string;
  partNames: string[];  // Array of 4 part names
  selectedTrack?: number;  // 0-7 for T1-T8, undefined = show all
}

type PageType = 'SRC' | 'AMP';

export default function PartsPanel({ projectPath, bankId, bankName, partNames, selectedTrack }: PartsPanelProps) {
  const [partsData, setPartsData] = useState<PartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<PageType>('SRC');
  const [activePartIndex, setActivePartIndex] = useState<number>(0);

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
              <span className="track-label">T{machine.track_id + 1}</span>
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
                <span className="track-label">T{amp.track_id + 1}</span>
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
      <div className="parts-content">
        {activePart && (
          <>
            {activePage === 'SRC' && renderSrcPage(activePart)}
            {activePage === 'AMP' && renderAmpPage(activePart)}
          </>
        )}
      </div>

      {/* SRC/AMP Page Tabs */}
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
      </div>
    </div>
  );
}
