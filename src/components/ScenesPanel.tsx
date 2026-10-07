import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TrackBadge } from './TrackBadge';
import { WriteStatus, writeStatus } from '../types/writeStatus';
import {
  FieldSpec, fieldSpec, formatSpecValue, parseSpecValue, clampToSpec, stepInSpec,
  machineParamLabels, machineParamFields, AMP_PARAM_FIELDS, LFO_PARAM_FIELDS,
  SCENE_XVOL_SPEC, SCENE_XLV_SPEC,
} from '../utils/partFieldSpecs';
import { getFxMainLabels, fxShortName, formatFxType } from '../utils/fxLabels';
import { useWheelStep } from '../utils/wheelStep';
import './ScenesPanel.css';

/** The five parameter pages a scene can hold. The crossfader level sits beside them. */
type PageKey = 'machine' | 'lfo' | 'amp' | 'fx1' | 'fx2';

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
  isEditMode?: boolean;
  onPartChange: (partId: number) => void;
  onWriteStatusChange?: (status: WriteStatus) => void;
}

/** One position of one page on one track: what it is, and what the scene holds there. */
interface Slot {
  page: PageKey | 'xlv';
  pageName: string;
  label: string;
  spec: FieldSpec;
  index: number;
  value: number | null;
}

const AMP_LABELS = ['ATK', 'HOLD', 'REL', 'VOL', 'BAL', 'XVOL'];
const LFO_LABELS = ['SPD1', 'SPD2', 'SPD3', 'DEP1', 'DEP2', 'DEP3'];

/**
 * Every position this track could hold, in page order.
 *
 * Positions the track's own machine or effect does not use are left out entirely: a
 * scene can store a byte there, but the device has nothing to apply it to, so offering
 * one would invite setting something that does nothing.
 */
function slotsForTrack(
  track: SceneTrackLocks,
  machineType: string,
  fx1Type: number,
  fx2Type: number,
): Slot[] {
  const specFor = (field: string | null): FieldSpec | null => {
    // XVOL has no Parts spec on purpose - only a scene can set it - so it brings its own
    if (field === 'xvol') return SCENE_XVOL_SPEC;
    return field ? fieldSpec(field, machineType) : null;
  };

  const page = (
    key: PageKey,
    pageName: string,
    labels: (string | null)[],
    fields: (string | null)[],
  ): Slot[] => track[key].flatMap((value, index) => {
    const label = labels[index];
    const spec = specFor(fields[index]);
    if (!label || !spec) return [];
    return [{ page: key, pageName, label, spec, index, value }];
  });

  const fxFields = (slot: 'fx1' | 'fx2') => [1, 2, 3, 4, 5, 6].map(n => `${slot}_param${n}`);

  return [
    ...page('machine', 'SRC', machineParamLabels(machineType, true),
      machineParamFields(machineType)),
    ...page('amp', 'AMP', AMP_LABELS, [...AMP_PARAM_FIELDS]),
    ...page('lfo', 'LFO', LFO_LABELS, [...LFO_PARAM_FIELDS]),
    ...page('fx1', fxShortName(fx1Type, 'FX1'), getFxMainLabels(fx1Type), fxFields('fx1')),
    ...page('fx2', fxShortName(fx2Type, 'FX2'), getFxMainLabels(fx2Type), fxFields('fx2')),
    {
      page: 'xlv', pageName: 'XLV', label: 'XLV', spec: SCENE_XLV_SPEC,
      index: 0, value: track.xlv,
    },
  ];
}

/** The same tracks with nothing held, for emptying a scene. */
function emptyTracks(tracks: SceneTrackLocks[]): SceneTrackLocks[] {
  const six = () => [null, null, null, null, null, null];
  return tracks.map(t => ({
    track_id: t.track_id,
    machine: six(), lfo: six(), amp: six(), fx1: six(), fx2: six(), xlv: null,
  }));
}

function countLocks(tracks: SceneTrackLocks[]): number {
  return tracks.reduce((total, t) => total
    + [t.machine, t.lfo, t.amp, t.fx1, t.fx2]
      .reduce((n, page) => n + page.filter(v => v !== null).length, 0)
    + (t.xlv === null ? 0 : 1), 0);
}

/** A scene's value for one position: typed, or stepped with the wheel. */
function SceneValue({ slot, onChange, editable }: {
  slot: Slot;
  onChange: (value: number) => void;
  editable: boolean;
}) {
  const value = slot.value as number;
  const wheelRef = useWheelStep(
    editable ? (by: 1 | -1) => onChange(stepInSpec(value, by, slot.spec)) : null,
  );
  return (
    <span ref={wheelRef} className="scene-value-wrap">
      <input
        type="text"
        className={`param-value scene-value ${editable ? 'editable' : ''}`}
        value={formatSpecValue(value, slot.spec)}
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
        onChange={e => {
          if (!editable) return;
          const raw = parseSpecValue(e.target.value, slot.spec);
          if (raw !== null) onChange(clampToSpec(raw, slot.spec));
        }}
      />
    </span>
  );
}

/**
 * A Part's sixteen scenes: which parameters each one holds, and at what.
 *
 * A scene is a snapshot of parameter values that the crossfader morphs towards. It is
 * not a copy of the whole Part - it records only the parameters put into it, and every
 * other one carries on from the Part itself. That is why this reads as a list of what a
 * scene holds rather than as a second set of parameter pages.
 */
export function ScenesPanel({
  projectPath, bankId, bankName, partId, partNames, isEditMode = false,
  onPartChange, onWriteStatusChange,
}: ScenesPanelProps) {
  const [data, setData] = useState<ScenesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [clipboard, setClipboard] = useState<{ from: number; tracks: SceneTrackLocks[] } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    invoke<ScenesResponse>('load_scenes', { path: projectPath, bankId, partId })
      .then(response => { if (current) setData(response); })
      .catch(err => { if (current) setError(String(err)); });
    return () => { current = false; };
  }, [projectPath, bankId, partId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  /**
   * Writes a whole scene.
   *
   * One call covers everything a scene needs - changing a value, taking a parameter out,
   * putting one in, pasting another scene over this one, emptying it - because they
   * differ only in what is sent. The device records "not held" as a value of its own,
   * so there is nothing special about removing one.
   */
  const writeScene = useCallback((sceneId: number, tracks: SceneTrackLocks[]) => {
    setData(prev => prev && {
      ...prev,
      scenes: prev.scenes.map(s => s.scene_id === sceneId
        ? { ...s, tracks, locked_count: countLocks(tracks) }
        : s),
    });

    if (saveTimer.current) clearTimeout(saveTimer.current);
    onWriteStatusChange?.(writeStatus.writing());
    saveTimer.current = setTimeout(() => {
      invoke('save_scene', { path: projectPath, bankId, partId, sceneId, tracks })
        .then(() => {
          onWriteStatusChange?.(writeStatus.success(`Scene ${sceneId + 1} saved`));
          setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 2000);
        })
        .catch(err => {
          console.error('Failed to save the scene:', err);
          onWriteStatusChange?.(writeStatus.error('Could not save the scene'));
          setTimeout(() => onWriteStatusChange?.(writeStatus.idle()), 3000);
        });
      saveTimer.current = null;
    }, 400);
  }, [projectPath, bankId, partId, onWriteStatusChange]);

  const scene = data?.scenes[selected];

  const setSlot = useCallback((trackId: number, slot: Slot, value: number | null) => {
    if (!scene) return;
    const tracks = scene.tracks.map(t => {
      if (t.track_id !== trackId) return t;
      if (slot.page === 'xlv') return { ...t, xlv: value };
      const page = [...t[slot.page]];
      page[slot.index] = value;
      return { ...t, [slot.page]: page };
    });
    writeScene(scene.scene_id, tracks);
  }, [scene, writeScene]);

  const tracks = useMemo(() => {
    if (!data || !scene) return [];
    return scene.tracks
      .map(track => {
        const slots = slotsForTrack(
          track,
          data.machine_types[track.track_id],
          data.fx1_types[track.track_id],
          data.fx2_types[track.track_id],
        );
        return {
          track,
          held: slots.filter(s => s.value !== null).length,
          shown: showAll ? slots : slots.filter(s => s.value !== null),
        };
      })
      .filter(entry => entry.shown.length > 0);
  }, [data, scene, showAll]);

  if (error) {
    return <div className="scenes-panel-error">Could not read the scenes: {error}</div>;
  }
  if (!data || !scene) {
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
            {scene.locked_count
              ? `${scene.locked_count} parameter${scene.locked_count === 1 ? '' : 's'}`
              : 'Nothing held'}
          </span>

          <div className="scene-actions">
            <label
              className="scene-show-all"
              title="Show every parameter this scene could hold, not only the ones it does"
            >
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
              />
              Show everything
            </label>
            {isEditMode && (
              <>
                <button
                  className="scene-action"
                  onClick={() => setClipboard({ from: selected, tracks: scene.tracks })}
                  title="Take a copy of this scene"
                >
                  Copy
                </button>
                <button
                  className="scene-action"
                  disabled={!clipboard}
                  onClick={() => clipboard && writeScene(selected, clipboard.tracks)}
                  title={clipboard
                    ? `Put scene ${clipboard.from + 1} here, replacing what this one holds`
                    : 'Copy a scene first'}
                >
                  Paste
                </button>
                <button
                  className="scene-action danger"
                  disabled={scene.locked_count === 0}
                  onClick={() => writeScene(selected, emptyTracks(scene.tracks))}
                  title="Empty this scene, so the crossfader leaves everything as the Part sets it"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {tracks.length === 0 ? (
          <div className="scene-empty-message">
            This scene holds no parameters. Moving the crossfader towards it leaves
            everything as the Part sets it.
            {isEditMode ? ' Turn on "Show everything" to put something into it.' : ''}
          </div>
        ) : (
          <div className="scene-tracks">
            {tracks.map(({ track, shown, held }) => (
              <div className="scene-track" key={track.track_id}>
                <div className="scene-track-head">
                  <TrackBadge trackId={track.track_id} />
                  <span className="scene-track-machine">
                    {data.machine_types[track.track_id]}
                  </span>
                  <span className="scene-track-count">{held}</span>
                </div>
                <table className="scene-locks">
                  <tbody>
                    {shown.map(slot => (
                      <tr
                        key={`${slot.page}-${slot.index}`}
                        className={slot.value === null ? 'unheld' : ''}
                      >
                        <td className="scene-lock-page">{slot.pageName}</td>
                        <td className="scene-lock-label">{slot.label}</td>
                        <td className="scene-lock-value">
                          {slot.value === null ? (
                            <button
                              className="scene-add"
                              disabled={!isEditMode}
                              onClick={() => setSlot(track.track_id, slot, slot.spec.default)}
                              title={isEditMode
                                ? 'Put this parameter into the scene, at its default'
                                : 'Turn on Edit mode to change what a scene holds'}
                            >
                              -
                            </button>
                          ) : (
                            <SceneValue
                              slot={slot}
                              editable={isEditMode}
                              onChange={value => setSlot(track.track_id, slot, value)}
                            />
                          )}
                        </td>
                        <td className="scene-lock-clear">
                          {isEditMode && slot.value !== null && (
                            <button
                              className="scene-clear-one"
                              onClick={() => setSlot(track.track_id, slot, null)}
                              title="Take this parameter out of the scene"
                            >
                              x
                            </button>
                          )}
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
