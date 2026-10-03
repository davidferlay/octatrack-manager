/**
 * The two widgets the Octatrack draws for a parameter that is not a knob.
 *
 * On the device a setting with a fixed list of values shows a short horizontal bar
 * with a marker, telling you where in the list you are, and the value as text beneath
 * it. The LFO waveform shows the shape itself rather than its name.
 */

interface PositionBarProps {
  /** How many choices the setting has. */
  count: number;
  /** Which one is selected, from zero. */
  index: number;
}

/**
 * Where this value sits among the choices, as the device's own indicator does.
 *
 * A two-state setting gets the same bar as a thirty-entry one: the point is the
 * position, not the count.
 */
export function PositionBar({ count, index }: PositionBarProps) {
  if (count < 2) return null;
  const clamped = Math.min(Math.max(index, 0), count - 1);
  // The marker keeps its own width, so the travel is the track less that width
  const widthPercent = Math.max(100 / count, 8);
  const left = (clamped / (count - 1)) * (100 - widthPercent);
  return (
    <div className="param-position-bar" aria-hidden="true">
      <div
        className="param-position-marker"
        style={{ width: `${widthPercent}%`, left: `${left}%` }}
      />
    </div>
  );
}

/**
 * One cycle of an LFO waveform, drawn the way the device draws it.
 *
 * The triangle and its inverse are taken from photographs of the hardware; the rest
 * follow the shape each name describes. The name is kept alongside in the editor
 * rather than replaced, so a shape is never the only thing identifying a setting.
 *
 * The eight designer slots have no fixed shape - they are whatever was drawn into
 * them - so they show no glyph.
 */
const WAVE_PATHS: Record<string, string> = {
  TRI: 'M1 11 L8 1 L15 11',
  ITRI: 'M1 1 L8 11 L15 1',
  SAW: 'M1 1 L13 11 L13 1 L15 1',
  ISAW: 'M1 11 L13 1 L13 11 L15 11',
  SQR: 'M1 11 L1 1 L8 1 L8 11 L15 11',
  ISQR: 'M1 1 L1 11 L8 11 L8 1 L15 1',
  EXP: 'M1 1 Q3 11 15 11',
  IEXP: 'M1 11 Q3 1 15 1',
  RMP: 'M1 11 L15 1',
  IRMP: 'M1 1 L15 11',
  RND: 'M1 8 L3 8 L3 3 L6 3 L6 10 L9 10 L9 5 L12 5 L12 9 L15 9',
};

export function WaveGlyph({ wave }: { wave: string }) {
  const path = WAVE_PATHS[wave];
  if (!path) return null;
  return (
    <svg className="param-wave-glyph" viewBox="0 0 16 12" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
