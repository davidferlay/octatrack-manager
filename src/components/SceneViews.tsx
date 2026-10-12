import { useMemo } from 'react';
import { TrackBadge } from './TrackBadge';
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
export function SceneMatrix({ data, selected, editable, showAll, onSet }: {
  data: ScenesResponse;
  selected: number;
  /** Values can be changed in place, as they can in the scene list. */
  editable: boolean;
  /** Every position a scene could reach for, not only the ones some scene holds. */
  showAll: boolean;
  onSet: SetAssignment;
}) {
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
            <tr>
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
                    title={end
                      ? `Scene ${scene.scene_id + 1}, the ${end} end of the crossfader`
                      : `Scene ${scene.scene_id + 1}`}
                  >
                    {scene.scene_id + 1}
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
                    {value === null ? (
                      <NotHeld
                        editable={editable}
                        onAdd={() => onSet(row, scene, row.spec.default)}
                      />
                    ) : (
                      <SceneValue
                        slot={{ spec: row.spec, value }}
                        editable={editable}
                        onChange={next => onSet(row, scene, next)}
                      />
                    )}
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
 * It opens on the crossfader's own two ends, because that is the comparison the
 * device cannot show you: a parameter only moves where the two ends disagree about
 * it, and a row they agree on is one the fader passes over doing nothing.
 */
export function SceneCompare({ data, left, right, onPick, editable, onSet }: {
  data: ScenesResponse;
  left: number;
  right: number;
  onPick: (side: 'left' | 'right', sceneId: number) => void;
  editable: boolean;
  onSet: SetAssignment;
}) {
  const rows = useMemo(
    () => sceneAssignments(data)
      .filter(row => row.values[left] !== null || row.values[right] !== null),
    [data, left, right],
  );

  const endFor = (scene: number) => [
    scene === data.scene_a ? 'A' : null,
    scene === data.scene_b ? 'B' : null,
  ].filter(Boolean).join('/');

  /** One side's heading: which scene it reads, and a way to change it. */
  const picker = (side: 'left' | 'right', scene: number) => {
    const end = endFor(scene);
    return (
      <th className="scene-compare-value">
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
              {s.locked_count ? '' : ' - empty'}
            </option>
          ))}
        </select>
      </th>
    );
  };

  return (
    <div className="scene-compare">
      {rows.length === 0 && (
        <p className="scene-empty-message">
          Neither scene holds anything, so the crossfader has nothing to morph between
          here - everything stays as the Part sets it.
        </p>
      )}
      <table className="scene-compare-table">
        <thead>
          <tr>
            <th className="scene-row-track">Track</th>
            <th className="scene-row-page">Page</th>
            <th className="scene-row-label">Parameter</th>
            {picker('left', left)}
            {picker('right', right)}
            {/* Soaks up the width the five real columns do not need, so a parameter
                and its two values stay next to each other */}
            <th className="scene-compare-filler" />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const same = row.values[left] === row.values[right];
            return (
              <tr
                key={row.key}
                className={same ? 'same' : 'differs'}
                title={rowTitle(row, data)}
              >
                <RowHead row={row} />
                {[left, right].map((scene, side) => {
                  const value = row.values[scene];
                  return (
                    <td
                      key={side}
                      className={`scene-compare-value ${value === null ? 'unheld' : ''}`}
                    >
                      {value === null ? (
                        <NotHeld
                          editable={editable}
                          onAdd={() => onSet(row, scene, row.spec.default)}
                        />
                      ) : (
                        <SceneValue
                          slot={{ spec: row.spec, value }}
                          editable={editable}
                          onChange={next => onSet(row, scene, next)}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="scene-compare-filler" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
