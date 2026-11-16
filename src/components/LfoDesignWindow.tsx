import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useWheelStep } from '../utils/wheelStep';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { WriteHistory, WriteHistoryControls } from './WriteHistoryControls';
import {
  LfoShape, clearShape, invertShape, parseShareText, pointToStep, randomShape, sameShape, setAllModes, toRaw,
  toShareText, toSigned, waveformPoints, yOf,
} from '../utils/lfoDesign';
import './LfoDesignWindow.css';

/** none: show only (mid-stroke); now: save at once; settle: save after the editor's usual short delay. */
export type LfoSave = 'none' | 'now' | 'settle';

export interface LfoDesignWindowProps {
  title: string;
  /** Export file name without extension */
  fileName: string;
  shape: LfoShape;
  /** The Part's saved copy; undefined when nothing is compared. */
  saved?: LfoShape;
  /** Edit mode */
  editable: boolean;
  history?: WriteHistory;
  onChange: (next: LfoShape, save: LfoSave) => void;
  onClose: () => void;
  /** Tests inject it; defaults to Math.random. */
  random?: () => number;
}

const CANVAS_W = 640;
const CANVAS_H = 255;
const FILE_FILTERS = [{ name: 'LFO design', extensions: ['json'] }];

/** The last copied design: the fallback when the webview cannot read the clipboard. */
let copyBuffer = '';

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** What Tab can land on inside the window, in document order. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  .filter(el => !el.closest('[aria-hidden="true"]'));

/** A stroke in progress: its own accumulated shape, the last point written and the last pointer y. */
interface Stroke {
  shape: LfoShape;
  step: number;
  /** Signed, kept as a float for fine mode */
  value: number;
  clientY: number;
  /** Something changed: the release saves */
  dirty: boolean;
}

/**
 * A step value: typed text commits on Enter or blur, Escape and garbage put the value back.
 * Enter and Escape then hand the focus back to the drawing, so the next Escape closes the
 * window and the arrows act on this step.
 */
function StepValueInput({ n, value, savedValue, editable, onCommit, onNudge, onFocus, onLeave }: {
  n: number;
  value: number;
  savedValue?: number;
  editable: boolean;
  onCommit: (signed: number) => void;
  /** The wheel or a vertical drag over the field, a step at a time (Edit mode only) */
  onNudge: (by: 1 | -1) => void;
  onFocus: () => void;
  /** Moves the focus out of the field */
  onLeave: () => void;
}) {
  // The same wheel and drag as every other value of the Parts editor
  const wheelRef = useWheelStep(editable ? onNudge : null, '.lfo-design-value');
  // null while the field shows the value itself
  const [text, setText] = useState<string | null>(null);
  // Set while Enter or Escape moves the focus away: the blur that follows must not commit
  // again (Enter) or commit the text Escape dropped (the state update has not landed yet)
  const leaving = useRef(false);
  const changed = savedValue !== undefined && savedValue !== value;

  const commit = () => {
    if (text !== null && text.trim() !== '' && Number.isFinite(Number(text))) {
      const raw = toRaw(Number(text));
      if (toSigned(raw) !== value) onCommit(toSigned(raw));
    }
    setText(null);
  };
  const leave = () => {
    leaving.current = true;
    onLeave();
    leaving.current = false;
  };

  return (
    <span className="lfo-design-value-wrap" ref={wheelRef}>
      <input
        className={`lfo-design-value${editable ? ' editable' : ''}${changed ? ' param-changed' : ''}`}
        aria-label={`Step ${n} value`}
        title={changed ? `Saved: ${savedValue}` : undefined}
        inputMode="numeric"
        readOnly={!editable}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onFocus={onFocus}
        onBlur={() => { if (!leaving.current) commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            leave();
          } else if (e.key === 'Escape') {
            setText(null);
            leave();
          }
        }}
      />
    </span>
  );
}

export default function LfoDesignWindow({
  title, fileName, shape, saved, editable, history, onChange, onClose, random,
}: LfoDesignWindowProps) {
  useEscapeClose(onClose);
  useBodyScrollLock();

  const [selected, setSelected] = useState(0);
  const stroke = useRef<Stroke | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  // A click on the backdrop closes, but only one that began there: a drag from a field or
  // the drawing that ends over the backdrop must not close the window
  const pressedOnBackdrop = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The shape the next nudge builds on: a wheel turn or a drag can step several times
  // before the panel renders the first change back
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  // Copy, Paste, Export and Import answer in a floating badge, as copying a project does
  const [toast, setToast] = useState<{ message: string; icon: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (message: string, icon: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, icon, error });
    // Just past the badge's own fade (App.css: 1.2 s, or 2.5 s for a warning)
    toastTimer.current = setTimeout(() => setToast(null), error ? 2800 : 1500);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // The focus starts in the window, not on the preview behind the backdrop that opened it
  useEffect(() => {
    canvasRef.current?.focus();
  }, []);

  // Tab and Shift+Tab go round the window's controls and never reach the editor behind,
  // where an arrow key would change a Part nobody can see
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = dialogRef.current;
      if (e.key !== 'Tab' || !root) return;
      const items = focusables(root);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      let to: HTMLElement | null = null;
      if (!active || !root.contains(active)) to = e.shiftKey ? last : first;
      else if (e.shiftKey && active === first) to = last;
      else if (!e.shiftKey && active === last) to = first;
      if (!to) return;
      e.preventDefault();
      to.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // A stroke still drawing when the window closes (Escape mid-drag) is saved, not left
  // on screen unwritten
  useEffect(() => () => {
    const st = stroke.current;
    stroke.current = null;
    if (st?.dirty) onChangeRef.current(st.shape, 'now');
  }, []);

  // The same when E leaves Edit mode mid-drag: what was drawn in Edit mode is saved, and
  // the rest of the drag draws nothing
  useEffect(() => {
    if (editable) return;
    const st = stroke.current;
    stroke.current = null;
    if (st?.dirty) onChangeRef.current(st.shape, 'now');
  }, [editable]);

  /** Writes the pointer's point into the stroke; false when the canvas is unmeasured. */
  const strokePoint = (e: React.PointerEvent<SVGSVGElement>, first: boolean): boolean => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const { step, signed } = pointToStep(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const st = stroke.current!;
    let value = signed;
    if (!first && e.shiftKey) {
      const moved = ((st.clientY - e.clientY) * 255) / rect.height / 4;
      value = clampInt(st.value + moved, -128, 127);
    }
    const from = first ? step : st.step;
    const fromValue = first ? value : st.value;
    const values = [...st.shape.values];
    const span = step - from;
    const dir = Math.sign(span) || 1;
    for (let i = 0; i <= Math.abs(span); i++) {
      const t = span === 0 ? 1 : i / Math.abs(span);
      values[from + i * dir] = toRaw(fromValue + (value - fromValue) * t);
    }
    const changed = values.some((v, i) => v !== st.shape.values[i]);
    st.step = step;
    st.value = value;
    st.clientY = e.clientY;
    setSelected(step);
    if (changed) {
      st.shape = { ...st.shape, values };
      st.dirty = true;
      onChange(st.shape, 'none');
    }
    return true;
  };
  const endStroke = () => {
    const st = stroke.current;
    if (!st) return;
    stroke.current = null;
    if (st.dirty) onChange(st.shape, 'now');
  };

  const onCanvasKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (!horizontal && !vertical) return;
    e.preventDefault();
    e.stopPropagation();
    if (horizontal) {
      setSelected(clampInt(selected + (e.key === 'ArrowRight' ? 1 : -1), 0, 15));
    } else if (editable) {
      nudge(selected, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 8 : 1));
    }
  };

  /** Moves a step's value by `by`, saved after the editor's short delay. */
  const nudge = (i: number, by: number) => {
    const current = shapeRef.current;
    const values = [...current.values];
    values[i] = toRaw(toSigned(values[i]) + by);
    // at 127 or -128 it changes nothing, and nothing is written
    if (values[i] === current.values[i]) return;
    const next = { ...current, values };
    shapeRef.current = next;
    onChange(next, 'settle');
  };

  /** Saves at once, unless the shape would not change: a no-op is neither written nor an Undo step. */
  const apply = (next: LfoShape) => {
    if (!sameShape(next, shape)) onChange(next, 'now');
  };

  const setValue = (i: number, signed: number) => {
    const values = [...shape.values];
    values[i] = toRaw(signed);
    apply({ ...shape, values });
  };
  const flipMode = (i: number) => {
    const interpolation = [...shape.interpolation];
    interpolation[i] = interpolation[i] === 1 ? 0 : 1;
    apply({ ...shape, interpolation });
  };

  const copy = async () => {
    const text = toShareText(shape);
    copyBuffer = text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // the buffer still serves Paste
    }
    notify('LFO design copied', 'fa-copy');
  };

  const applyText = (text: string, done: string, icon: string) => {
    let next: LfoShape;
    try {
      next = parseShareText(text);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Not an LFO design', 'fa-triangle-exclamation', true);
      return;
    }
    apply(next);
    notify(done, icon);
  };

  const paste = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // fall back to the buffer
    }
    applyText(text || copyBuffer, 'LFO design pasted', 'fa-paste');
  };

  const exportFile = async () => {
    try {
      const path = await save({ defaultPath: `${fileName}.json`, filters: FILE_FILTERS });
      if (!path) return;
      await invoke('write_text_file', { path, contents: toShareText(shape) });
      notify('LFO design exported', 'fa-file-export');
    } catch {
      notify('Export failed', 'fa-triangle-exclamation', true);
    }
  };

  const importFile = async () => {
    let text: string;
    try {
      const path = await open({ multiple: false, filters: FILE_FILTERS });
      if (!path || Array.isArray(path)) return;
      text = await invoke<string>('read_text_file', { path });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      notify(message === 'File too large' ? message : 'Import failed', 'fa-triangle-exclamation', true);
      return;
    }
    applyText(text, 'LFO design imported', 'fa-file-import');
  };

  const tool = (label: string, run: () => void, alwaysOn = false, mode?: 'smooth' | 'step') => (
    <button
      key={label}
      className={`lfo-design-tool ${alwaysOn ? 'reads' : 'writes'}${mode ? ` ${mode}` : ''}`}
      disabled={!alwaysOn && !editable}
      onClick={run}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      className="modal-overlay"
      onPointerDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="modal-content lfo-design-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="lfo-design-close" aria-label="Close" onClick={onClose}>
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="lfo-design-toolbar">
          <div className="lfo-design-group" role="group" aria-label="Step modes">
            {tool('All smooth', () => apply(setAllModes(shape, 1)), false, 'smooth')}
            {tool('All stepped', () => apply(setAllModes(shape, 0)), false, 'step')}
          </div>
          <div className="lfo-design-group" role="group" aria-label="Shape">
            {tool('Invert', () => apply(invertShape(shape)))}
            {tool('Random', () => apply(randomShape(random ?? Math.random)))}
            {tool('Clear', () => apply(clearShape()))}
          </div>
          <div className="lfo-design-group" role="group" aria-label="Clipboard">
            {tool('Copy', copy, true)}
            {tool('Paste', paste)}
          </div>
          <div className="lfo-design-group" role="group" aria-label="File">
            {tool('Export', exportFile, true)}
            {tool('Import', importFile)}
          </div>
          {history && (
            // Hidden with its separator in View mode, as the header hides the pair
            <div
              className="lfo-design-group lfo-design-history"
              role="group"
              aria-label="History"
              style={editable ? undefined : { visibility: 'hidden' }}
            >
              <WriteHistoryControls history={history} visible={editable} />
            </div>
          )}
        </div>
        <div className="modal-body lfo-design-body">
          <svg
            ref={canvasRef}
            className={`lfo-design-canvas${editable ? ' editable' : ''}`}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            preserveAspectRatio="none"
            tabIndex={0}
            onKeyDown={onCanvasKeyDown}
            onPointerDown={(e) => {
              // The main button only: a right or middle click does not draw
              if (e.button !== 0) return;
              if (!editable) {
                // Nothing to draw in View mode: a click selects the step under the pointer
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width && rect.height) {
                  setSelected(pointToStep(e.clientX - rect.left, 0, rect.width, rect.height).step);
                }
                return;
              }
              stroke.current = { shape, step: 0, value: 0, clientY: e.clientY, dirty: false };
              if (!strokePoint(e, true)) {
                stroke.current = null;
                return;
              }
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (stroke.current) strokePoint(e, false);
            }}
            onPointerUp={endStroke}
            onLostPointerCapture={endStroke}
          >
            <defs>
              {/* The preview's colours. In user space: a flat shape has no height, and a
                  bounding-box gradient would leave it undrawn */}
              <linearGradient id="lfoDesignGradient" gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={CANVAS_W} y2={0}>
                <stop offset="0%" stopColor="#4ac8ff" />
                <stop offset="50%" stopColor="#7b68ee" />
                <stop offset="100%" stopColor="#ff6b9d" />
              </linearGradient>
            </defs>
            {Array.from({ length: 17 }, (_, i) => (
              <line
                key={i}
                className="lfo-design-grid"
                x1={(i * CANVAS_W) / 16} x2={(i * CANVAS_W) / 16} y1={0} y2={CANVAS_H}
              />
            ))}
            <line className="lfo-design-centre" x1={0} x2={CANVAS_W} y1={yOf(0, CANVAS_H)} y2={yOf(0, CANVAS_H)} />
            <rect
              className="lfo-design-selected"
              x={(selected * CANVAS_W) / 16} y={0} width={CANVAS_W / 16} height={CANVAS_H}
            />
            <polyline
              className="lfo-design-wave"
              fill="none"
              points={waveformPoints(shape, CANVAS_W, CANVAS_H)}
            />
          </svg>
          <div className="lfo-design-strip">
            {shape.values.map((raw, i) => {
              const n = i + 1;
              const smooth = shape.interpolation[i] === 1;
              const modeChanged = saved !== undefined && saved.interpolation[i] !== shape.interpolation[i];
              return (
                <div className={`lfo-design-cell${i === selected ? ' selected' : ''}`} key={n}>
                  {/* Selects the step without drawing, in Edit mode too; the arrows then act on it */}
                  <button
                    type="button"
                    className="lfo-design-step"
                    aria-label={`Select step ${n}`}
                    aria-pressed={i === selected}
                    tabIndex={-1}
                    onClick={() => {
                      setSelected(i);
                      canvasRef.current?.focus();
                    }}
                  >
                    {n}
                  </button>
                  <StepValueInput
                    n={n}
                    value={toSigned(raw)}
                    savedValue={saved ? toSigned(saved.values[i]) : undefined}
                    editable={editable}
                    onCommit={(signed) => setValue(i, signed)}
                    onNudge={(by) => nudge(i, by)}
                    onFocus={() => setSelected(i)}
                    onLeave={() => canvasRef.current?.focus()}
                  />
                  <button
                    className={`lfo-design-mode ${smooth ? 'smooth' : 'step'}${modeChanged ? ' param-changed' : ''}`}
                    aria-label={`Step ${n} mode`}
                    title={modeChanged ? `Saved: ${saved!.interpolation[i] === 1 ? 'smooth' : 'stepped'}` : undefined}
                    disabled={!editable}
                    onClick={() => flipMode(i)}
                  >
                    {smooth ? 'smooth' : 'step'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {toast && (
        <div className={`toast-notification${toast.error ? ' warning' : ''}`} role="status">
          <i className={`fas ${toast.icon}`} /> {toast.message}
        </div>
      )}
    </div>,
    document.body,
  );
}
