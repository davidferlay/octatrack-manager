import { useMemo, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import type { AssignmentRow } from './sceneModel';
import {
  DEFAULT_BOUNDS, rowsHeldBy, type RandomizeBounds, type RandomizeMode,
} from './sceneRandomize';

interface SceneRandomizeModalProps {
  /** Every parameter the Part holds, which the scene selection then narrows. */
  rows: AssignmentRow[];
  /** The scene the grid has selected, where this starts. */
  selected: number;
  onApply: (scenes: number[], rows: AssignmentRow[], bounds: RandomizeBounds) => void;
  onClose: () => void;
}

/** The controls behind the gear: how far values may move, and what gets moved. */
export function SceneRandomizeModal({
  rows, selected, onApply, onClose,
}: SceneRandomizeModalProps) {
  useEscapeClose(onClose);

  const [bounds, setBounds] = useState<RandomizeBounds>(DEFAULT_BOUNDS);
  /*
   * The common case is the scene on screen, so that is a choice rather than
   * sixteen buttons to read: the grid only appears once the user asks to pick.
   */
  const [pickingScenes, setPickingScenes] = useState(false);
  const [picked, setPicked] = useState<number[]>([selected]);
  const scenes = pickingScenes ? picked : [selected];
  const setScenes = setPicked;
  /*
   * The parameters explicitly turned off, rather than the ones turned on.
   *
   * The list changes as scenes are added, and a parameter that has just come into
   * scope should be in - remembering what was switched off says that, where
   * remembering what was switched on would quietly drop every new arrival.
   */
  const [off, setOff] = useState<Set<string>>(new Set());

  const inScope = useMemo(() => rowsHeldBy(rows, scenes), [rows, scenes]);
  const chosen = useMemo(() => inScope.filter(r => !off.has(r.key)), [inScope, off]);

  /** The parameters in scope, under the page each one belongs to. */
  const pages = useMemo(() => {
    const byPage = new Map<string, AssignmentRow[]>();
    for (const row of inScope) {
      const group = byPage.get(row.pageName);
      if (group) group.push(row);
      else byPage.set(row.pageName, [row]);
    }
    return [...byPage.entries()];
  }, [inScope]);

  const toggleScene = (idx: number) => setScenes(prev => (prev.includes(idx)
    ? prev.filter(i => i !== idx)
    : [...prev, idx].sort((a, b) => a - b)));

  const setKeys = (keys: string[], on: boolean) => setOff(prev => {
    const next = new Set(prev);
    for (const key of keys) {
      if (on) next.delete(key);
      else next.add(key);
    }
    return next;
  });

  const mode = (next: RandomizeMode) => setBounds(b => ({ ...b, mode: next }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content scene-randomize-modal"
        role="dialog"
        aria-label="Randomize"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header scene-randomize-header">
          <h3>
            <i className="fas fa-shuffle"></i>
            Randomize
          </h3>
          <div className="scene-randomize-header-info">
            {chosen.length} parameter{chosen.length === 1 ? '' : 's'} in{' '}
            {scenes.length} scene{scenes.length === 1 ? '' : 's'}
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body scene-randomize-body">
          <div className="scene-randomize-column">
      <div className="scene-randomize-field">
        <label>Bounds</label>
        <div className="tools-toggle-group">
          <button
            type="button"
            className={`tools-toggle-btn ${bounds.mode === 'window' ? 'selected' : ''}`}
            onClick={() => mode('window')}
            title="Reroll anywhere in a slice of each parameter's own range, whatever it holds now"
          >
            Window
          </button>
          <button
            type="button"
            className={`tools-toggle-btn ${bounds.mode === 'drift' ? 'selected' : ''}`}
            onClick={() => mode('drift')}
            title="Move each value away from where it already sits, by no more than so much"
          >
            Drift
          </button>
        </div>
      </div>

      {bounds.mode === 'window' ? (
        <div className="scene-randomize-field">
          <label>{bounds.low}% to {bounds.high}%</label>
          <div
            className="tools-dual-range-slider"
            title="The same slice of every parameter's own range, so it means the same for a volume and for an LFO speed"
          >
            <div
              className="tools-dual-range-track-fill"
              style={{ left: `${bounds.low}%`, width: `${bounds.high - bounds.low}%` }}
            />
            <input
              type="range"
              className="tools-dual-range-input tools-dual-range-min"
              aria-label="Lowest"
              min="0"
              max="100"
              value={bounds.low}
              onChange={(e) => setBounds(b => ({
                ...b, low: Math.min(Number(e.target.value), b.high),
              }))}
            />
            <input
              type="range"
              className="tools-dual-range-input tools-dual-range-max"
              aria-label="Highest"
              min="0"
              max="100"
              value={bounds.high}
              onChange={(e) => setBounds(b => ({
                ...b, high: Math.max(Number(e.target.value), b.low),
              }))}
            />
          </div>
        </div>
      ) : (
        <div className="scene-randomize-field">
          <label>Within {bounds.drift}%</label>
          <div
            className="tools-dual-range-slider tools-single-range"
            title="How far a value may move from where it sits now. Nothing moves past the ends of its own range"
          >
            <input
              type="range"
              className="tools-dual-range-input"
              aria-label="Drift"
              min="0"
              max="100"
              value={bounds.drift}
              onChange={(e) => setBounds(b => ({ ...b, drift: Number(e.target.value) }))}
            />
          </div>
        </div>
      )}

      <div className="scene-randomize-field">
        <label>Scenes</label>
        <div className="tools-toggle-group">
          <button
            type="button"
            className={`tools-toggle-btn ${pickingScenes ? '' : 'selected'}`}
            onClick={() => setPickingScenes(false)}
            title="Reroll the scene the grid has selected"
          >
            Current Scene
          </button>
          <button
            type="button"
            className={`tools-toggle-btn ${pickingScenes ? 'selected' : ''}`}
            onClick={() => setPickingScenes(true)}
            title="Choose which scenes to reroll"
          >
            Selected Scenes
          </button>
        </div>
        {pickingScenes && (
        <div className="tools-multi-select banks-stacked">
          {[[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]].map((row, rowIdx) => (
            <div className="tools-track-row-buttons" key={rowIdx}>
              {row.map((idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`tools-multi-btn pattern-btn ${scenes.includes(idx) ? 'selected' : ''}`}
                  onClick={() => toggleScene(idx)}
                  title={`Scene ${idx + 1}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          ))}
          <div className="tools-select-actions">
            <button
              type="button"
              className="tools-multi-btn pattern-btn tools-select-all"
              onClick={() => setScenes([])}
              title="Deselect all scenes"
            >
              None
            </button>
            <button
              type="button"
              className={`tools-multi-btn pattern-btn tools-select-all ${scenes.length === 16 ? 'selected' : ''}`}
              onClick={() => setScenes(scenes.length === 16
                ? []
                : Array.from({ length: 16 }, (_, i) => i))}
              title="Select all scenes"
            >
              All
            </button>
          </div>
        </div>
        )}
      </div>
          </div>

          <div className="scene-randomize-column scene-randomize-params-column">
      <div className="scene-randomize-field">
        <label>
          Parameters
          <span className="scene-randomize-count">{chosen.length} of {inScope.length}</span>
        </label>
        {inScope.length === 0 ? (
          <div className="scene-randomize-hint">
            {scenes.length === 0
              ? 'Pick a scene first.'
              : 'Those scenes hold nothing, so there is nothing to reroll.'}
          </div>
        ) : (
          <div className="scene-randomize-params">
            {pages.map(([pageName, group]) => {
              const keys = group.map(r => r.key);
              const on = keys.filter(k => !off.has(k)).length;
              return (
                <div className="scene-randomize-page" key={pageName}>
                  <button
                    type="button"
                    className={`scene-randomize-page-head ${on > 0 ? 'on' : ''}`}
                    aria-pressed={on > 0}
                    onClick={() => setKeys(keys, on !== keys.length)}
                    title={on === keys.length
                      ? `Leave the ${pageName} page alone`
                      : `Reroll the whole ${pageName} page`}
                  >
                    <span className="scene-randomize-tick">{on === keys.length ? '■' : on > 0 ? '▣' : '□'}</span>
                    {pageName}
                  </button>
                  <div className="scene-randomize-page-params">
                    {group.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        className={`scene-randomize-param ${off.has(row.key) ? '' : 'on'}`}
                        aria-pressed={!off.has(row.key)}
                        onClick={() => setKeys([row.key], off.has(row.key))}
                        title={`T${row.trackId + 1} ${row.pageName} ${row.label}`}
                      >
                        T{row.trackId + 1} {row.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
          </div>
        </div>

        <div className="scene-randomize-actions">
        <button className="scene-action" onClick={onClose}>Cancel</button>
        <button
          className="scene-action scene-randomize-go"
          disabled={chosen.length === 0 || scenes.length === 0}
          onClick={() => onApply(scenes, chosen, bounds)}
          title={chosen.length === 0
            ? 'Nothing selected to reroll'
            : `Reroll ${chosen.length} parameter${chosen.length > 1 ? 's' : ''} in ${scenes.length} scene${scenes.length > 1 ? 's' : ''}`}
        >
          Randomize
        </button>
        </div>
      </div>
    </div>
  );
}

export default SceneRandomizeModal;
