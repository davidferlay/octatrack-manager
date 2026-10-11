import { useMemo } from 'react';
import { TrackBadge } from './TrackBadge';
import { formatSpecValue } from '../utils/partFieldSpecs';
import { fieldHelp, helpTitle } from '../utils/partFieldHelp';
import { AssignmentRow, ScenesResponse, sceneAssignments } from './sceneModel';

/**
 * The two ways of reading a whole Part's scenes rather than one of them.
 *
 * The editor answers "what does this scene hold". These answer the questions it
 * cannot: which scenes touch the same parameter, and what the crossfader will
 * actually do between its two ends.
 */

/** A dash where a scene does not hold the parameter, as the device leaves it alone. */
const NOT_HELD = '-';

function readValue(row: AssignmentRow, scene: number): string {
  const value = row.values[scene];
  return value === null ? NOT_HELD : formatSpecValue(value, row.spec);
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

/** The track and parameter half of a row, which every view puts on the left. */
function RowHead({ row }: { row: AssignmentRow }) {
  return (
    <>
      <td className="scene-row-track"><TrackBadge trackId={row.trackId} /></td>
      <td className="scene-row-page">{row.pageName}</td>
      <td className="scene-row-label">{row.label}</td>
    </>
  );
}

/**
 * Every assigned parameter of the Part against all sixteen scenes.
 *
 * One row per parameter rather than per scene, because the question it answers is
 * "which scenes touch this" - a scene-per-row table is the editor, already there.
 */
export function SceneMatrix({ data, selected, onSceneChange }: {
  data: ScenesResponse;
  selected: number;
  onSceneChange: (sceneId: number) => void;
}) {
  const rows = useMemo(() => sceneAssignments(data), [data]);

  if (rows.length === 0) {
    return (
      <div className="scene-empty-message">
        No scene in this Part holds anything, so there is nothing to lay out.
      </div>
    );
  }

  const endFor = (scene: number) => [
    scene === data.scene_a ? 'A' : null,
    scene === data.scene_b ? 'B' : null,
  ].filter(Boolean).join('/');

  return (
    <div className="scene-matrix">
      <p className="scene-view-caption">
        One row per parameter some scene reaches for. A dash means that scene leaves it
        as the Part sets it. {rows.length} row{rows.length === 1 ? '' : 's'}.
      </p>
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
                  >
                    <button
                      onClick={() => onSceneChange(scene.scene_id)}
                      title={end
                        ? `Scene ${scene.scene_id + 1}, the ${end} end of the crossfader`
                        : `Scene ${scene.scene_id + 1}`}
                    >
                      {scene.scene_id + 1}
                      {end && <span className="scene-matrix-end">{end}</span>}
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
                    {value === null ? NOT_HELD : formatSpecValue(value, row.spec)}
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
 * A row where both hold the same value is marked as such: the crossfader passing over
 * it changes nothing, which is worth seeing when a move does less than expected.
 */
export function SceneCompare({ data, left, right, leftLabel, rightLabel, caption }: {
  data: ScenesResponse;
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
  caption?: string;
}) {
  const rows = useMemo(
    () => sceneAssignments(data)
      .filter(row => row.values[left] !== null || row.values[right] !== null),
    [data, left, right],
  );

  const differing = rows.filter(row => row.values[left] !== row.values[right]).length;

  if (rows.length === 0) {
    return (
      <div className="scene-empty-message">
        Neither scene holds anything, so the crossfader has nothing to morph between
        here - everything stays as the Part sets it.
      </div>
    );
  }

  return (
    <div className="scene-compare">
      <p className="scene-view-caption">
        {caption ? `${caption} ` : ''}
        {rows.length} parameter{rows.length === 1 ? '' : 's'} in play,
        {' '}{differing} that {differing === 1 ? 'differs' : 'differ'} between the two.
        {left === right && ' Both sides are the same scene, so nothing can differ.'}
      </p>
      <table className="scene-compare-table">
        <thead>
          <tr>
            <th className="scene-row-track">Track</th>
            <th className="scene-row-page">Page</th>
            <th className="scene-row-label">Parameter</th>
            <th className="scene-compare-value">{leftLabel}</th>
            <th className="scene-compare-value">{rightLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const same = row.values[left] === row.values[right];
            const onlyOne = row.values[left] === null || row.values[right] === null;
            return (
              <tr
                key={row.key}
                className={same ? 'same' : 'differs'}
                title={rowTitle(row, data)}
              >
                <RowHead row={row} />
                <td className={`scene-compare-value ${row.values[left] === null ? 'unheld' : ''}`}>
                  {readValue(row, left)}
                </td>
                <td className={`scene-compare-value ${row.values[right] === null ? 'unheld' : ''}`}>
                  {readValue(row, right)}
                  {!same && (
                    <span
                      className="scene-compare-mark"
                      title={onlyOne
                        ? 'Only one of the two holds this, so the other leaves it as the Part sets it'
                        : 'The two hold different values, so the crossfader moves this'}
                    >
                      {onlyOne ? '!' : '≠'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
