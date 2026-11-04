import { FieldSpec, formatSpecValue, parseSpecValue, clampToSpec, stepInSpec }
  from '../utils/partFieldSpecs';
import { useWheelStep } from '../utils/wheelStep';
import { savedNote } from './sceneModel';

/** Enough of a parameter to show and change its value: the views pass a row, the
 *  editor passes one of a track's slots. */
export interface ValueSlot {
  spec: FieldSpec;
  value: number | null;
}

/** A scene's value for one position: typed, or stepped with the wheel. */
export function SceneValue({ slot, onChange, editable, saved }: {
  slot: ValueSlot;
  onChange: (value: number) => void;
  editable: boolean;
  /** What the Part's saved copy holds here. Left out where nothing is compared. */
  saved?: number | null;
}) {
  const value = slot.value as number;
  const changed = saved !== undefined && saved !== value;
  const wheelRef = useWheelStep(
    editable ? (by: 1 | -1) => onChange(stepInSpec(value, by, slot.spec)) : null,
  );
  return (
    <span
      ref={wheelRef}
      className={`scene-value-wrap${changed ? ' param-changed' : ''}`}
      title={changed ? savedNote(saved, slot.spec) : undefined}
    >
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
