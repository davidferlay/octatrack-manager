import { useMemo } from 'react';
import { useWheelStep } from '../utils/wheelStep';
import { TrackBadge } from './TrackBadge';
import { formatSpecValue } from '../utils/partFieldSpecs';
import { fieldHelp, helpTitle } from '../utils/partFieldHelp';
import { AssignmentRow, ScenesResponse, sceneAssignments } from './sceneModel';
import { SceneValue } from './SceneValue';

/**
 * The two ways of reading a whole Part's scenes rather than one of them.
 *
 * The editor answers "what does this scene hold". These answer the questions it
 * cannot: which scenes touch the same parameter, and what changes between any two -
 * including the two the crossfader sits between, which is what a fader move does.
 */

/** A dash where a scene does not hold the parameter, as the device leaves it alone. */
const NOT_HELD = '-';

/**
 * A cell nothing holds.
 *
 * Outside Edit mode it is still drawn at the size of the button it becomes, or every
 * row would change height on the way into Edit mode and the table would jump.
 */
function NotHeld({ editable, onAdd }: { editable: boolean; onAdd: () => void }) {
  return (
    <button
      className="scene-add"
      disabled={!editable}
      onClick={onAdd}
      title={editable
        ? 'Put this parameter into that scene, at its default'
        : 'That scene leaves this as the Part sets it'}
    >
      {NOT_HELD}
    </button>
  );
}

/**
 * One scene's value for one parameter, with the same two operations the scene list
 * gives it: a dash to put it in, and a cross to take it out again.
 *
 * The cross only appears under the pointer: these views show a great many cells at
 * once, and a cross on every one of them would be all anybody saw.
 */
function Cell({ row, scene, editable, onSet }: {
  row: AssignmentRow;
  scene: number;
  editable: boolean;
  onSet: SetAssignment;
}) {
  const value = row.values[scene];
  if (value === null) {
    return <NotHeld editable={editable} onAdd={() => onSet(row, scene, row.spec.default)} />;
  }
  return (
    <span className="scene-cell">
      <SceneValue
        slot={{ spec: row.spec, value }}
        editable={editable}
        onChange={next => onSet(row, scene, next)}
      />
      {editable && (
        <button
          className="scene-clear-one"
          onClick={() => onSet(row, scene, null)}
          title={`Take ${row.label} out of scene ${scene + 1}`}
          aria-label={`Take ${row.label} out of scene ${scene + 1}`}
        >
          &times;
        </button>
      )}
    </span>
  );
}

/** The tooltip the Parts page would give this parameter, so naming stays consistent. */
function rowTitle(row: AssignmentRow, data: ScenesResponse): string | undefined {
  return helpTitle(row.label, fieldHelp(row.field, data.machine_types[row.trackId], {
    label: row.label,
    fxType: row.page === 'fx1'
      ? data.fx1_types[row.trackId]
      : row.page === 'fx2' ? data.fx2_types[row.trackId] : undefined,
  }));
}

/** The track and parameter half of a row, which both views put on the left. */
function RowHead({ row }: { row: AssignmentRow }) {
  return (
    <>
      <td className="scene-row-track"><TrackBadge trackId={row.trackId} /></td>
      <td className="scene-row-page">{row.pageName}</td>
      <td className="scene-row-label">{row.label}</td>
    </>
  );
}

/** How a view changes one parameter of one scene. Null takes it out of the scene. */
export type SetAssignment = (
  row: AssignmentRow, sceneId: number, value: number | null,
) => void;

/**
 * Every assigned parameter of the Part against all sixteen scenes.
 *
 * One row per parameter rather than per scene, because the question it answers is
 * "which scenes touch this" - a scene-per-row table is the editor, already there.
 *
 * The scene is chosen in the grid above, as everywhere else, so the headings here are
 * plain labels rather than a second set of buttons that do the same thing.
 */
export function SceneMatrix({ data, selected, editable, showAll, onSet, onSceneChange }: {
  data: ScenesResponse;
  selected: number;
  /** Values can be changed in place, as they can in the scene list. */
  editable: boolean;
  /** Every position a scene could reach for, not only the ones some scene holds. */
  showAll: boolean;
  onSet: SetAssignment;
  onSceneChange: (sceneId: number) => void;
}) {
  // The headings choose a scene and step with the wheel, as the grid above does
  const headWheelRef = useWheelStep(
    (by: 1 | -1) => onSceneChange(Math.min(15, Math.max(0, selected + by))),
    null,
  );
  const rows = useMemo(() => sceneAssignments(data, showAll), [data, showAll]);

  if (rows.length === 0) {
    return (
      <div className="scene-empty-message">
        No scene in this Part holds anything, so there is nothing to lay out.
        Turn on "Show all params" to put something into one.
      </div>
    );
  }

  const endFor = (scene: number) => [
    scene === data.scene_a ? 'A' : null,
    scene === data.scene_b ? 'B' : null,
  ].filter(Boolean).join('/');

  return (
    <div className="scene-matrix">
      <div className="scene-matrix-scroll">
        <table className="scene-matrix-table">
          <thead>
            <tr ref={headWheelRef}>
              <th className="scene-row-track">Track</th>
              <th className="scene-row-page">Page</th>
              <th className="scene-row-label">Parameter</th>
              {data.scenes.map(scene => {
                const end = endFor(scene.scene_id);
                return (
                  <th
                    key={scene.scene_id}
                    className={[
                      'scene-matrix-head',
                      scene.scene_id === selected ? 'selected' : '',
                      end ? 'crossfader-end' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <button
                      onClick={() => onSceneChange(scene.scene_id)}
                      title={end
                        ? `Scene ${scene.scene_id + 1}, the ${end} end of the crossfader`
                        : `Scene ${scene.scene_id + 1}`}
                    >
                      {scene.scene_id + 1}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} title={rowTitle(row, data)}>
                <RowHead row={row} />
                {row.values.map((value, scene) => (
                  <td
                    key={scene}
                    className={[
                      'scene-matrix-cell',
                      value === null ? 'unheld' : '',
                      scene === selected ? 'selected' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <Cell row={row} scene={scene} editable={editable} onSet={onSet} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Two scenes side by side, listing only what either of them holds.
 *
 * Laid out as one card per track, the way the scene list itself is, rather than as a
 * single long table: a Part reaches for a few parameters on several tracks, so a
 * table is a narrow ribbon beside a screen of nothing, and forty rows of scrolling
 * for something that fits across the width.
 *
 * It opens on the crossfader's own two ends, because that is the comparison the
 * device cannot show you: a parameter only moves where the two ends disagree about
 * it, and a row they agree on is one the fader passes over doing nothing.
 */
export function SceneCompare({
  data, left, right, onPick, editable, showAll, onSet, onCopyTrack,
}: {
  data: ScenesResponse;
  left: number;
  right: number;
  onPick: (side: 'left' | 'right', sceneId: number) => void;
  editable: boolean;
  /** Every position either side could reach for, not only the ones they hold. */
  showAll: boolean;
  onSet: SetAssignment;
  /** Puts one track's whole scene state from one side into the other. */
  onCopyTrack: (trackId: number, from: number, to: number) => void;
}) {
  const rows = useMemo(
    () => sceneAssignments(data, showAll)
      .filter(row => showAll
        || row.values[left] !== null || row.values[right] !== null),
    [data, left, right, showAll],
  );

  /** The rows of each track that has any, in track order. */
  const byTrack = useMemo(() => {
    const tracks = new Map<number, AssignmentRow[]>();
    for (const row of rows) {
      const its = tracks.get(row.trackId);
      if (its) its.push(row);
      else tracks.set(row.trackId, [row]);
    }
    return [...tracks.entries()].sort(([a], [b]) => a - b);
  }, [rows]);

  const endFor = (scene: number) => [
    scene === data.scene_a ? 'A' : null,
    scene === data.scene_b ? 'B' : null,
  ].filter(Boolean).join('/');

  /** Which scene a side reads, chosen in what reads as a heading. */
  const picker = (side: 'left' | 'right', scene: number) => {
    const end = endFor(scene);
    return (
      <span className="scene-compare-heading">
        <select
          className="scene-compare-pick"
          value={scene}
          onChange={event => onPick(side, Number(event.target.value))}
          title={`Which scene this side reads${end ? `. Currently the ${end} end` : ''}`}
        >
          {data.scenes.map(s => (
            <option key={s.scene_id} value={s.scene_id}>
              Scene {s.scene_id + 1}
              {endFor(s.scene_id) ? ` (${endFor(s.scene_id)})` : ''}
            </option>
          ))}
        </select>
      </span>
    );
  };

  /**
   * How far the fader moves this parameter, in what the device shows rather than in
   * stored bytes - the two differ wherever a parameter reads either side of a centre.
   * Nothing is shown where a side does not hold it, or where the reading is a name
   * rather than a number.
   */
  const travel = (row: AssignmentRow) => {
    const from = row.values[left];
    const to = row.values[right];
    if (from === null || to === null) return null;
    const a = Number(formatSpecValue(from, row.spec));
    const b = Number(formatSpecValue(to, row.spec));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
    const by = b - a;
    return <span className={by > 0 ? 'rising' : 'falling'}>{by > 0 ? `+${by}` : by}</span>;
  };

  return (
    <div className="scene-compare">
      <div className="scene-compare-sides">
        {picker('left', left)}
        <span className="scene-compare-versus">against</span>
        {picker('right', right)}
      </div>

      {byTrack.length === 0 ? (
        <p className="scene-empty-message">
          Neither scene holds anything, so the crossfader has nothing to morph between
          here - everything stays as the Part sets it.
        </p>
      ) : (
        <div className="scene-tracks">
          {byTrack.map(([trackId, its]) => (
            <div className="scene-track" key={trackId}>
              <div className="scene-track-head">
                <TrackBadge trackId={trackId} />
                <span className="scene-track-machine">{data.machine_types[trackId]}</span>
                {editable && left !== right && (
                  // The operation a comparison asks for: make one side match the other
                  <span className="scene-track-actions">
                    <button
                      className="scene-track-action"
                      onClick={() => onCopyTrack(trackId, left, right)}
                      title={`Put this track's settings from scene ${left + 1} into scene ${right + 1}`}
                      aria-label={`Copy track ${trackId + 1} rightwards`}
                    >
                      <i className="fas fa-arrow-right" />
                    </button>
                    <button
                      className="scene-track-action"
                      onClick={() => onCopyTrack(trackId, right, left)}
                      title={`Put this track's settings from scene ${right + 1} into scene ${left + 1}`}
                      aria-label={`Copy track ${trackId + 1} leftwards`}
                    >
                      <i className="fas fa-arrow-left" />
                    </button>
                  </span>
                )}
                <span className="scene-track-count">
                  {its.filter(row => row.values[left] !== row.values[right]).length}
                </span>
              </div>
              <table className="scene-compare-table">
                <tbody>
                  {its.map(row => (
                    <tr
                      key={row.key}
                      className={row.values[left] === row.values[right] ? 'same' : 'differs'}
                      title={rowTitle(row, data)}
                    >
                      <td className="scene-row-page">{row.pageName}</td>
                      <td className="scene-row-label">{row.label}</td>
                      <td className="scene-compare-value">
                        <Cell row={row} scene={left} editable={editable} onSet={onSet} />
                      </td>
                      <td className="scene-compare-value">
                        <Cell row={row} scene={right} editable={editable} onSet={onSet} />
                      </td>
                      <td className="scene-compare-travel">{travel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
