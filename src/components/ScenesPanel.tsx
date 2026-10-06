import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TrackBadge } from './TrackBadge';
import {
  fieldSpec, formatSpecValue, machineParamLabels, machineParamFields,
  AMP_PARAM_FIELDS, LFO_PARAM_FIELDS,
} from '../utils/partFieldSpecs';
import { getFxMainLabels, fxShortName, formatFxType } from '../utils/fxLabels';
import './ScenesPanel.css';

/** One audio track's locks in a scene, as the backend reports them. */
interface SceneTrackLocks {
  track_id: number;
  machine: (number | null)[];
  lfo: (number | null)[];
  amp: (number | null)[];
  fx1: (number | null)[];
  fx2: (number | null)[];
  xlv: number | null;
}

interface SceneData {
  scene_id: number;
  tracks: SceneTrackLocks[];
  locked_count: number;
}

interface ScenesResponse {
  scenes: SceneData[];
  scene_a: number;
  scene_b: number;
  machine_types: string[];
  fx1_types: number[];
  fx2_types: number[];
}

interface ScenesPanelProps {
  projectPath: string;
  bankId: string;
  bankName: string;
  partId: number;
  partNames: string[];
  onPartChange: (partId: number) => void;
}

/** One line of a scene: a parameter it holds, and what it holds it at. */
interface Lock {
  page: string;
  label: string;
  value: number;
  /** How the device would read that value, where the parameter is known. */
  reads: string;
}

const AMP_LABELS = ['ATK', 'HOLD', 'REL', 'VOL', 'BAL', 'XVOL'];
const LFO_LABELS = ['SPD1', 'SPD2', 'SPD3', 'DEP1', 'DEP2', 'DEP3'];

/**
 * Turns a track's six-position pages into the lines worth showing.
 *
 * Positions the scene leaves alone are dropped, and so are positions the track's own
 * machine or effect does not use - a scene can hold a byte there, but the device has
 * nothing to apply it to.
 */
function locksForTrack(
  track: SceneTrackLocks,
  machineType: string,
  fx1Type: number,
  fx2Type: number,
): Lock[] {
  const read = (field: string | null, value: number) => {
    const spec = field ? fieldSpec(field, machineType) : null;
    return spec ? formatSpecValue(value, spec) : String(value);
  };

  const fromPage = (
    page: (number | null)[],
    labels: (string | null)[],
    fields: (string | null)[],
    pageName: string,
  ): Lock[] => page.flatMap((value, i) => {
    const label = labels[i];
    if (value === null || !label) return [];
    return [{ page: pageName, label, value, reads: read(fields[i], value) }];
  });

  const fxFields = (slot: 'fx1' | 'fx2') =>
    [1, 2, 3, 4, 5, 6].map(n => `${slot}_param${n}`);

  return [
    ...fromPage(track.machine, machineParamLabels(machineType, true),
      machineParamFields(machineType), 'SRC'),
    ...fromPage(track.amp, AMP_LABELS, [...AMP_PARAM_FIELDS], 'AMP'),
    ...fromPage(track.lfo, LFO_LABELS, [...LFO_PARAM_FIELDS], 'LFO'),
    ...fromPage(track.fx1, getFxMainLabels(fx1Type), fxFields('fx1'),
      fxShortName(fx1Type, 'FX1')),
    ...fromPage(track.fx2, getFxMainLabels(fx2Type), fxFields('fx2'),
      fxShortName(fx2Type, 'FX2')),
    ...(track.xlv === null ? [] : [{
      page: 'XLV',
      label: 'XLV',
      value: track.xlv,
      // The crossfader level is a plain 0-127, and the device shows it as it is
      reads: String(track.xlv),
    }]),
  ];
}

/**
 * A Part's sixteen scenes: which parameters each one holds, and at what.
 *
 * A scene is a snapshot of parameter values that the crossfader morphs towards. It is
 * not a copy of the whole Part - it records only the parameters put into it, and every
 * other one carries on from the Part itself. That is why this reads as a list of locks
 * rather than as a second set of parameter pages.
 */
export function ScenesPanel({
  projectPath, bankId, bankName, partId, partNames, onPartChange,
}: ScenesPanelProps) {
  const [data, setData] = useState<ScenesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    invoke<ScenesResponse>('load_scenes', { path: projectPath, bankId, partId })
      .then(response => { if (current) setData(response); })
      .catch(err => { if (current) setError(String(err)); });
    return () => { current = false; };
  }, [projectPath, bankId, partId]);

  const scene = data?.scenes[selected];

  /** Only the tracks this scene actually touches, so an empty one is not eight headings. */
  const tracks = useMemo(() => {
    if (!data || !scene) return [];
    return scene.tracks
      .map(track => ({
        track,
        locks: locksForTrack(
          track,
          data.machine_types[track.track_id],
          data.fx1_types[track.track_id],
          data.fx2_types[track.track_id],
        ),
      }))
      .filter(entry => entry.locks.length > 0);
  }, [data, scene]);

  if (error) {
    return <div className="scenes-panel-error">Could not read the scenes: {error}</div>;
  }
  if (!data) {
    return <div className="scenes-panel-loading">Reading scenes...</div>;
  }

  const endLabel = (id: number) => [
    id === data.scene_a ? 'A' : null,
    id === data.scene_b ? 'B' : null,
  ].filter(Boolean).join('/');

  return (
    <div className="scenes-panel">
      <div className="scenes-header">
        <span className="scenes-title">{bankName} - Scenes</span>
        <div className="parts-part-tabs">
          {partNames.map((name, index) => (
            <button
              key={index}
              className={`parts-part-tab ${partId === index ? 'active' : ''}`}
              onClick={() => { onPartChange(index); setSelected(0); }}
            >
              {name} ({index + 1})
            </button>
          ))}
        </div>
      </div>

      <div className="scenes-grid">
        {data.scenes.map(s => {
          const end = endLabel(s.scene_id);
          return (
            <button
              key={s.scene_id}
              className={[
                'scene-card',
                selected === s.scene_id ? 'active' : '',
                s.locked_count === 0 ? 'empty' : '',
                end ? 'crossfader-end' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setSelected(s.scene_id)}
              title={[
                `Scene ${s.scene_id + 1}`,
                s.locked_count === 0
                  ? 'Holds nothing, so the crossfader has nothing to morph towards here'
                  : `Holds ${s.locked_count} parameter${s.locked_count === 1 ? '' : 's'}`,
                end === 'A/B' ? 'Both ends of the crossfader' : end
                  ? `The crossfader's ${end} end` : null,
              ].filter(Boolean).join('\n')}
            >
              <span className="scene-number">{s.scene_id + 1}</span>
              {end && <span className="scene-end">{end}</span>}
              <span className="scene-count">{s.locked_count || '-'}</span>
            </button>
          );
        })}
      </div>

      <div className="scene-detail">
        <div className="scene-detail-head">
          <span className="scene-detail-title">Scene {selected + 1}</span>
          <span className="scene-detail-sub">
            {scene?.locked_count
              ? `${scene.locked_count} parameter${scene.locked_count === 1 ? '' : 's'}`
              : 'Nothing held'}
          </span>
        </div>

        {tracks.length === 0 ? (
          <div className="scene-empty-message">
            This scene holds no parameters. Moving the crossfader towards it leaves
            everything as the Part sets it.
          </div>
        ) : (
          <div className="scene-tracks">
            {tracks.map(({ track, locks }) => (
              <div className="scene-track" key={track.track_id}>
                <div className="scene-track-head">
                  <TrackBadge trackId={track.track_id} />
                  <span className="scene-track-machine">
                    {data.machine_types[track.track_id]}
                  </span>
                  <span className="scene-track-count">{locks.length}</span>
                </div>
                <table className="scene-locks">
                  <tbody>
                    {locks.map((lock, i) => (
                      <tr key={`${lock.page}-${lock.label}-${i}`}>
                        <td className="scene-lock-page">{lock.page}</td>
                        <td className="scene-lock-label">{lock.label}</td>
                        <td
                          className="scene-lock-value"
                          title={lock.reads === String(lock.value)
                            ? undefined
                            : `Stored as ${lock.value}`}
                        >
                          {lock.reads}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="scenes-crossfader">
        <span>
          The crossfader morphs between scene {data.scene_a + 1} and scene {data.scene_b + 1}
          {data.scene_a === data.scene_b
            ? ' - both of its ends are the same scene, so moving it changes nothing'
            : ''}
        </span>
        <span className="scenes-crossfader-fx">
          {data.fx1_types.map((fx, i) => (
            <span key={i} className="scenes-fx-chip" title={`T${i + 1}: ${formatFxType(fx)}`}>
              T{i + 1} {fxShortName(fx, 'FX1')}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
