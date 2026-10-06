import type { ReactNode } from 'react';
import { useWheelStep } from '../utils/wheelStep';

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
 * Shapes taken from photographs of the hardware: TRI, ITRI, SAW, ISAW, ISQR, EXP, RMP
 * and RND. SQR, IEXP and IRMP are the mirror of a shape that was photographed, which
 * is how the device pairs them everywhere else.
 *
 * Worth noting, because it is not obvious: SAW is a plain rising line while RMP is a
 * rising ramp that resets - they are different shapes, not synonyms.
 *
 * The eight designer slots (T1-T8) have no fixed shape - they hold whatever was drawn
 * into that track's DESIGN page - so they get a stand-in stepped outline, dimmed to say
 * it stands for a shape rather than being one. A dashed stroke was tried first and
 * broke into scattered dots at this size, which read as noise.
 */
const WAVE_PATHS: Record<string, string> = {
  TRI: 'M1 11 L8 1 L15 11',
  ITRI: 'M1 1 L8 11 L15 1',
  SAW: 'M1 11 L15 1',
  ISAW: 'M1 1 L15 11',
  SQR: 'M1 1 L8 1 L8 11 L15 11',
  ISQR: 'M1 11 L8 11 L8 1 L15 1',
  EXP: 'M1 11 L3 1 Q6 10 15 10',
  IEXP: 'M1 1 L3 11 Q6 2 15 2',
  RMP: 'M1 11 L9 1 L9 11 L15 11',
  IRMP: 'M1 1 L9 11 L9 1 L15 1',
  RND: 'M1 8 L3 8 L3 3 L6 3 L6 10 L9 10 L9 5 L12 5 L12 9 L15 9',
};

/** Stands in for a designer slot: a drawn shape, without claiming to be its shape. */
const DESIGNED = 'M1 10 L4 10 L4 4 L7 4 L7 8 L10 8 L10 2 L13 2 L13 10 L15 10';

export function WaveGlyph({ wave }: { wave: string }) {
  // Named rather than "anything not in the table", so a name that is neither a fixed
  // shape nor a designer slot still draws nothing instead of being papered over
  const designed = /^T[1-8]$/.test(wave);
  const path = WAVE_PATHS[wave] ?? (designed ? DESIGNED : null);
  if (!path) return null;
  return (
    <svg
      className={`param-wave-glyph${designed ? ' designed' : ''}`}
      viewBox="0 0 16 12"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * A parameter cell whose value the scroll wheel steps while the pointer is over it.
 *
 * The whole cell responds, not just the control in it: the label, the knob and the
 * readout are all the same parameter, and having to find the one live pixel would be
 * worse than not offering it at all. A drop-down inside is left to the app-wide
 * stepping, which knows how to walk its options.
 *
 * A component rather than a hook call inside the renderer, because the renderer runs
 * once per parameter and hooks cannot be called in a loop. It also keeps the listener
 * attached across renders instead of being torn down and rebuilt on every knob drag.
 */
export function WheelStepper(
  { step, className, title, children }: {
    /** Moves the value one step, or null where the field cannot be changed. */
    step: ((by: 1 | -1) => void) | null;
    className: string;
    title?: string;
    children: ReactNode;
  },
) {
  return (
    <div className={className} title={title} ref={useWheelStep(step)}>
      {children}
    </div>
  );
}
