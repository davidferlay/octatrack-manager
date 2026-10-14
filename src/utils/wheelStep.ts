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
    };

    const onPointerMove = (e: PointerEvent) => {
      if (anchor === null || !latest.current) return;
      const by = Math.trunc((anchor - e.clientY) / PIXELS_PER_STEP);
      if (!by) return;
      // Nothing is selected while dragging over a readout, which otherwise highlights
      e.preventDefault();
      /*
       * Capture once the drag is real, not when the pointer went down.
       *
       * Capture retargets the click that follows to the capturing element, so taking
       * it on pointerdown meant a plain click on a button inside never reached the
       * button. Waiting for the first step leaves a click a click, and by then the
       * pointer has moved only a few pixels. Only an improvement, so a browser that
       * refuses it still steps while the pointer stays over the control.
       */
      if (!stepped) {
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          /* no capture: the drag still works while the pointer stays over the control */
        }
      }
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
 * Makes every row of pick-one buttons steppable with the wheel, in one place.
 *
 * A row like Audio / Both / MIDI is a drop-down drawn as buttons, so it answers the
 * wheel the way a drop-down does. A grid where several can be on at once is not: there
 * is no next value to step to, so those are left alone - which is what having exactly
 * one button marked as chosen means.
 *
 * Returns a function that removes the listener again.
 */
export function installToggleWheelStepping(target: Document = document): () => void {
  const onWheel = (event: Event) => {
    const e = event as WheelEvent;
    // Another of these has already answered this turn of the wheel
    if (e.defaultPrevented) return;
    const group = (e.target as HTMLElement | null)?.closest?.('.tools-toggle-group');
    if (!group) return;

    const buttons = Array.from(group.querySelectorAll('button.tools-toggle-btn'))
      .filter((button): button is HTMLButtonElement =>
        button instanceof HTMLButtonElement && !button.disabled);
    const chosen = buttons.filter(button => button.classList.contains('selected'));
    // Several at once is a grid, not a choice of one, so it has no next value
    if (chosen.length !== 1) return;

    const by = direction(e);
    if (!by) return;

    const next = buttons[buttons.indexOf(chosen[0]) + by];
    // Nothing left to step to, so the wheel goes back to being the page's
    if (!next) return;

    e.preventDefault();
    next.click();
  };

  target.addEventListener('wheel', onWheel, { passive: false });
  return () => target.removeEventListener('wheel', onWheel);
}

/** How far along its own track a slider's handle currently sits, in page pixels. */
function handleAt(slider: HTMLInputElement): number {
  const box = slider.getBoundingClientRect();
  const min = slider.min === '' ? 0 : Number(slider.min);
  const max = slider.max === '' ? 100 : Number(slider.max);
  const along = max === min ? 0 : (Number(slider.value) - min) / (max - min);
  return box.left + along * box.width;
}

/**
 * The slider the pointer is over, if any.
 *
 * Not simply the event's target: a pair of sliders sharing one track is built by
 * stacking them and letting the pointer through to the handles, so the wheel arrives
 * at the container rather than at either input. What is under the pointer is what the
 * wheel is about, so that is what is asked - and of a stacked pair, the one whose
 * handle is nearest, which is the one the hand is reaching for.
 */
function sliderUnder(e: WheelEvent): HTMLInputElement | null {
  const direct = (e.target as HTMLElement | null)?.closest?.('input[type="range"]');
  if (direct instanceof HTMLInputElement) return direct;

  const stacked = (document.elementsFromPoint?.(e.clientX, e.clientY) ?? [])
    .flatMap(el => (el instanceof HTMLInputElement && el.type === 'range'
      ? [el]
      : Array.from(el.querySelectorAll?.('input[type="range"]') ?? [])))
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
    /*
     * The pointer has to be over the slider itself.
     *
     * What is under the pointer includes every ancestor up to the document, and asking
     * those for their sliders turns up every slider on the page - so a wheel over a
     * row of buttons was moving the sliders underneath it.
     */
    .filter(slider => {
      const box = slider.getBoundingClientRect();
      return e.clientX >= box.left && e.clientX <= box.right
        && e.clientY >= box.top && e.clientY <= box.bottom;
    });
  if (stacked.length === 0) return null;

  return stacked.reduce((nearest, slider) => (
    Math.abs(handleAt(slider) - e.clientX) < Math.abs(handleAt(nearest) - e.clientX)
      ? slider
      : nearest
  ));
}

/**
 * Makes every slider in the app steppable with the wheel, in one place.
 *
 * A slider already drags - that is what it is - but it ignores the wheel, so the two
 * ways of changing a value disagree depending on which control you are over. The
 * Tools and the Audio Pool are built from these, so doing it here covers them all
 * without each one wiring it up.
 *
 * Returns a function that removes the listener again.
 */
export function installRangeWheelStepping(target: Document = document): () => void {
  const onWheel = (event: Event) => {
    const e = event as WheelEvent;
    // Another of these has already answered this turn of the wheel
    if (e.defaultPrevented) return;
    const input = sliderUnder(e);
    if (!input || input.disabled || input.readOnly) return;

    const by = direction(e);
    if (!by) return;

    const step = Number(input.step) || 1;
    const min = input.min === '' ? 0 : Number(input.min);
    const max = input.max === '' ? 100 : Number(input.max);
    const next = Math.min(max, Math.max(min, Number(input.value) + by * step));
    // Nothing left to step to, so the wheel goes back to being the page's. Holding it
    // here would strand the page whenever a slider sat at either end of its range.
    if (next === Number(input.value)) return;

    e.preventDefault();
    /*
     * Through the prototype's own setter, not the property.
     *
     * React keeps a tracker of what it last wrote to an input and skips the change
     * when the value it reads back matches; assigning the property updates that
     * tracker too, so the component would never hear about it.
     */
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, String(next));
    else input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  target.addEventListener('wheel', onWheel, { passive: false });
  return () => target.removeEventListener('wheel', onWheel);
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
    // Another of these has already answered this turn of the wheel
    if (e.defaultPrevented) return;
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
