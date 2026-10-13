import { useCallback, useRef } from 'react';

/**
 * Running through a field's values with the scroll wheel, without opening it.
 *
 * Wheel up goes to the next value, wheel down to the previous one - "up is more",
 * the way a wheel works over a volume or a zoom. It is the one direction choice in
 * here, and inverting it means flipping the sign in `direction` below.
 *
 * Both of these use a native listener rather than React's `onWheel`. React registers
 * wheel at the root as a passive listener, where `preventDefault` does nothing, so the
 * page would scroll away underneath the field being changed.
 */

/** Which way a wheel event is asking to go: 1 for the next value, -1 for the previous. */
function direction(e: WheelEvent): 1 | -1 | 0 {
  const delta = e.deltaY || e.deltaX;
  if (!delta) return 0;
  return delta < 0 ? 1 : -1;
}

/**
 * How far the pointer travels for one step while dragging.
 *
 * Small enough that a parameter's whole range is a comfortable stroke - 127 steps is
 * about 500 px - and large enough that a hand resting on the button does not nudge it.
 */
const PIXELS_PER_STEP = 4;

/**
 * A ref for a parameter cell whose value the wheel steps, and a drag changes.
 *
 * Only the cell's own controls answer - its knob, its readout, its indicator. The name
 * and the space around it stay ordinary scrolling surface, because a page made mostly
 * of parameters has to remain scrollable without editing everything on the way past.
 *
 * Pass null to leave it alone, which is what a read-only field does.
 *
 * `within` narrows which part of the element answers. The default is the parameter's
 * own controls; passing null makes the whole element answer, which is what a region
 * that is one control - a row of cards to pick from - wants.
 *
 * Dragging up and down changes the value too, but only where `within` names the
 * controls. A region that is one control is a surface the pointer may legitimately be
 * dragged across, and taking the drag there would mean a swipe over a row of cards
 * quietly moved the selection.
 */
export function useWheelStep(
  step: ((by: 1 | -1) => void) | null,
  within: string | null = '.param-control, .param-value',
) {
  // Read through a ref so the listener survives every render without being rebound
  const latest = useRef(step);
  latest.current = step;

  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      // A select inside is handled by the app-wide stepping, which knows about options
      if (target?.closest?.('select')) return;
      // Only over the parameter's own controls, not the whole cell. On a page that is
      // mostly parameters, a cell-wide target means scrolling the page quietly edits
      // everything the pointer passes over - the label and the gaps have to stay
      // ordinary scrolling surface for the page to be usable at all.
      if (within && !target?.closest?.(within)) return;
      const by = direction(e);
      if (!by || !latest.current) return;
      e.preventDefault();
      // Keeps the app-wide handler from stepping the same thing twice
      e.stopPropagation();
      latest.current(by);
    };
    /**
     * Dragging up and down, which is how a knob is turned everywhere else.
     *
     * Up is more, as the wheel is. The anchor follows the pointer a step at a time
     * rather than being read from where the drag began, so a long drag does not drift
     * and a change of direction answers at once.
     */
    let anchor: number | null = null;
    let stepped = false;

    const onPointerDown = (e: PointerEvent) => {
      // The main button only: a right-click opens a menu, a middle one pastes
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('select')) return;
      if (!within || !target?.closest?.(within)) return;
      if (!latest.current) return;
      anchor = e.clientY;
      stepped = false;
      // Keeps the moves coming when the pointer leaves the control mid-drag. Only an
      // improvement, so a browser that refuses it still steps.
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* no capture: the drag still works while the pointer stays over the control */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (anchor === null || !latest.current) return;
      const by = Math.trunc((anchor - e.clientY) / PIXELS_PER_STEP);
      if (!by) return;
      // Nothing is selected while dragging over a readout, which otherwise highlights
      e.preventDefault();
      stepped = true;
      anchor -= by * PIXELS_PER_STEP;
      const direction = by > 0 ? 1 : -1;
      for (let taken = 0; taken < Math.abs(by); taken++) latest.current(direction);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (anchor === null) return;
      anchor = null;
      try {
        if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
      } catch {
        /* it was never taken */
      }
      // A drag that changed something must not also count as a click on the control
      if (stepped) {
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        node.addEventListener('click', swallow, { capture: true, once: true });
        // Nothing to swallow if no click follows, so it does not sit there waiting
        setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', onPointerUp);
    node.addEventListener('pointercancel', onPointerUp);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
    };
  }, [within]);
}

/**
 * Makes every drop-down in the app steppable with the wheel, in one place.
 *
 * A select has everything the stepping needs - its options, in order, and which one is
 * chosen - so there is nothing a component could add by doing this itself.
 *
 * Returns a function that removes the listener again.
 */
export function installSelectWheelStepping(target: Document = document): () => void {
  const onWheel = (event: Event) => {
    const e = event as WheelEvent;
    const select = (e.target as HTMLElement | null)?.closest?.('select');
    if (!(select instanceof HTMLSelectElement)) return;
    // A list box shows its options already and scrolls through them on its own
    if (select.disabled || select.multiple || select.size > 1) return;

    const options = Array.from(select.options).filter(o => !o.disabled);
    if (options.length < 2) return;

    const by = direction(e);
    if (!by) return;

    const at = options.indexOf(select.options[select.selectedIndex]);
    const next = options[at + by];
    // Nothing left to step to, so the wheel goes back to being the page's. Holding it
    // here would strand the page whenever a drop-down sat at either end of its list.
    if (at === -1 || !next) return;

    e.preventDefault();
    select.value = next.value;
    // React listens for the change event on a select, and its own value tracker sees
    // the difference, so the component is told exactly as if the list had been used
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  target.addEventListener('wheel', onWheel, { passive: false });
  return () => target.removeEventListener('wheel', onWheel);
}
