import { useEffect } from "react";

/**
 * Stops the page behind a modal from scrolling while it is open.
 *
 * `overscroll-behavior: contain` is not enough on its own: it only engages on an
 * element that can actually scroll, so the wheel passes straight through a modal's
 * non-scrolling parts - its header, buttons or player bar - and through a short list
 * that does not overflow, and the page moves underneath.
 *
 * The scrollbar the lock removes is compensated with padding, so the page does not
 * jump sideways as the modal opens.
 */
export function useBodyScrollLock(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [enabled]);
}
