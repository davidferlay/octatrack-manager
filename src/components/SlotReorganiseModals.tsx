import { useState } from "react";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { SORT_ORDERS } from "../utils/slotMoves";

/**
 * Escape from a field inside the window.
 *
 * useEscapeClose leaves Escape to a focused input (a search box clears on it), so it
 * never fires while the slider or a sort choice has focus. Here Escape always
 * means cancel, and it must not reach the page behind, where it leaves the project.
 */
function escapeCancels(onCancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };
}

// Where slot n sits along the slider: the thumb's centre travels from half a thumb in from
// each end (18px thumb plus its 2px border each side, see .tools-dual-range-input).
const alongSlider = (n: number) => `calc(11px + (100% - 22px) * ${(n - 1) / 127})`;

/**
 * Picks the slot to move to on a 1 to 128 slider, for moving without dragging (any view,
 * any sort). Behind the slider, a strip of the 128 slots shows which are taken, with a pin
 * on each moving slot. Owns nothing but the chosen number: the table decides what moves.
 */
export function MoveToSlotModal({ sources, taken, slotLabel, slotHolds, onCancel, onConfirm }: {
  /** The taken slots moving, in slot order. */
  sources: number[];
  taken: Set<number>;
  slotLabel: (n: number) => string;
  /** What a slot holds now: a file name, or "empty". */
  slotHolds: (n: number) => string;
  onCancel: () => void;
  onConfirm: (target: number) => void;
}) {
  const [target, setTarget] = useState(sources[0]);
  useEscapeClose(onCancel);
  const single = sources.length === 1;
  // A block that would run past the last slot is refused by the backend; say so here instead
  const pastEnd = target + sources.length - 1 > 128;
  const last = Math.min(target + sources.length - 1, 128);
  // One slot onto itself moves nothing; a selection may still pack from its first slot
  const valid = !(single && target === sources[0]) && !pastEnd;
  const submit = () => { if (valid) onConfirm(target); };
  // Slots the block lands on that hold something and are not part of it get pushed down
  const inTheWay = Array.from({ length: last - target + 1 }, (_, i) => target + i)
    .filter(n => taken.has(n) && !sources.includes(n)).length;
  const sourceText = single ? slotHolds(sources[0]) : sources.map(slotLabel).join(', ');
  const targetText = single ? slotHolds(target)
    : pastEnd ? `runs past ${slotLabel(128)}`
    : inTheWay === 0 ? 'all empty' : `${inTheWay} taken, pushed down`;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content move-slot-modal" onClick={(e) => e.stopPropagation()} onKeyDown={escapeCancels(onCancel)}>
        <div className="modal-header">
          <h3><i className="fas fa-arrows-up-down" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Move to slot</h3>
        </div>
        <div className="modal-body">
          <div className="move-slot-cards">
            <div className="move-slot-card" data-testid="move-source">
              <span className="move-slot-card-label">From</span>
              <span className="move-slot-card-slot">{single ? slotLabel(sources[0]) : `${sources.length} slots`}</span>
              <span className="move-slot-card-holds" title={sourceText}>{sourceText}</span>
            </div>
            <i className="fas fa-arrow-right move-slot-arrow"></i>
            <div className="move-slot-card to" data-testid="move-target">
              <span className="move-slot-card-label">To</span>
              <span className="move-slot-card-slot">{single || last === target ? slotLabel(target) : `${slotLabel(target)}-${slotLabel(last)}`}</span>
              <span className="move-slot-card-holds" title={targetText}>{targetText}</span>
            </div>
          </div>
          <div className="move-slot-picker">
            <div className="move-slot-map" aria-hidden="true">
              {Array.from({ length: 128 }, (_, i) => <span key={i} className={taken.has(i + 1) ? 'taken' : ''} />)}
            </div>
            {sources.map(n => (
              <span key={n} className="move-slot-source-marker" style={{ left: alongSlider(n) }} title={`${slotLabel(n)} is here`} />
            ))}
            {/* Shown while the slider is hovered or dragged (CSS). Its anchor slides from its left
                edge at slot 1 to its right edge at 128, so it never pokes out of the window. */}
            <span className="move-slot-thumb-tip" style={{ left: alongSlider(target), transform: `translateX(${-100 * (target - 1) / 127}%)` }}>
              <strong>{slotLabel(target)}</strong> {slotHolds(target)}
            </span>
            {/* The table lists slots 1 to 128 only; the recorder buffers above are never a target */}
            <div className="tools-dual-range-slider tools-single-range">
              <input
                type="range"
                className="tools-dual-range-input"
                aria-label="Target slot"
                min="1"
                max="128"
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
              />
            </div>
          </div>
          <div className="move-slot-scale">
            <span>{slotLabel(1)}</span>
            <span>
              <i className="move-slot-legend taken"></i>Taken
              {/* As many pins as on the track, up to five */}
              <span className="move-slot-legend-pins">
                {sources.slice(0, 5).map(n => <i key={n} className="move-slot-legend pin"></i>)}
              </span>
              Selection
            </span>
            <span>{slotLabel(128)}</span>
          </div>
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onCancel}>Cancel</button>
            <button className="modal-button primary" onClick={submit} disabled={!valid}>Move</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The sort window behind the Tidy button. Sorts the whole list unless asked to sort only a
 * run of side-by-side selected slots; scattered picks cannot be sorted on their own.
 */
export function TidySlotsModal({ run, slotLabel, onCancel, onConfirm }: {
  /** First and last slot of the selection when it is a continuous run, else null. */
  run: [number, number] | null;
  slotLabel: (n: number) => string;
  onCancel: () => void;
  onConfirm: (orderId: string, onlyRun: boolean) => void;
}) {
  const [order, setOrder] = useState(SORT_ORDERS[0].id);
  // A selected run is most likely what the user wants sorted
  const [onlyRun, setOnlyRun] = useState(run != null);
  useEscapeClose(onCancel);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content tidy-slots-modal" onClick={(e) => e.stopPropagation()} onKeyDown={escapeCancels(onCancel)}>
        <div className="modal-header">
          <h3><i className="fas fa-sort-amount-down" style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }}></i>Tidy slots</h3>
          <span className="modal-header-subtitle">Reorders slots and closes the gaps</span>
        </div>
        <div className="modal-body">
          {run ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={onlyRun}
              aria-label={`Only selected slots, ${slotLabel(run[0])} to ${slotLabel(run[1])}`}
              title={`Sorts ${slotLabel(run[0])} to ${slotLabel(run[1])} among themselves, packed from the first one holding a sample. Unticked, the whole list is sorted from slot 1.`}
              className={`tidy-only-run ${onlyRun ? 'selected' : ''}`}
              onClick={() => setOnlyRun(v => !v)}
            >
              <i className={onlyRun ? 'fas fa-square-check' : 'far fa-square'}></i>
              <span className="tidy-sort-order-label">Only selected slots</span>
              <span className="tidy-sort-order-hint">{slotLabel(run[0])} to {slotLabel(run[1])}, instead of the whole list</span>
            </button>
          ) : null}
          <div className="tidy-sort-orders" role="radiogroup" aria-label="Sort order">
            {SORT_ORDERS.map(o => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={order === o.id}
                aria-label={o.label}
                title={o.tip}
                className={`tidy-sort-order ${order === o.id ? 'selected' : ''}`}
                onClick={() => setOrder(o.id)}
              >
                <i className={`fas ${o.icon}`}></i>
                <span className="tidy-sort-order-label">{o.label}</span>
                <span className="tidy-sort-order-hint">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <div className="modal-buttons-row">
            <button className="modal-button" onClick={onCancel}>Cancel</button>
            <button className="modal-button primary" onClick={() => onConfirm(order, onlyRun)} autoFocus>Sort</button>
          </div>
        </div>
      </div>
    </div>
  );
}
