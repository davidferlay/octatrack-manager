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
 * A ref for a parameter cell whose value the wheel should step.
 *
 * Only the cell's own controls answer - its knob, its readout, its indicator. The name
 * and the space around it stay ordinary scrolling surface, because a page made mostly
 * of parameters has to remain scrollable without editing everything on the way past.
 *
 * Pass null to leave it alone, which is what a read-only field does.
 */
export function useWheelStep(step: ((by: 1 | -1) => void) | null) {
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
      if (!target?.closest?.('.param-control, .param-value')) return;
      const by = direction(e);
      if (!by || !latest.current) return;
      e.preventDefault();
      // Keeps the app-wide handler from stepping the same thing twice
      e.stopPropagation();
      latest.current(by);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);
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
