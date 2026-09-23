import { useEffect, useRef } from "react";

// Modals currently listening, innermost last. A modal opened on top of another
// takes Escape first, so one press peels one layer instead of closing both.
const stack: symbol[] = [];

/**
 * True while any modal overlay is on screen.
 *
 * Page-level keyboard shortcuts must stand down when this is true - Escape on a
 * project page leaves the project, which is the wrong thing to do to someone who
 * only meant to dismiss a dialog. Checks the DOM rather than the stack below, so
 * it also covers modals that handle Escape their own way.
 */
export function isModalOpen(): boolean {
  return document.querySelector(".modal-overlay") !== null;
}

/**
 * Escape closes this modal.
 *
 * Listens in the capture phase and stops the event, so the page-level handlers
 * further down never see it. Pass `enabled: false` while the modal must not be
 * dismissed (mid-conversion, say) - exactly when its close button is hidden.
 */
export function useEscapeClose(onClose: () => void, enabled: boolean = true) {
  const latest = useRef(onClose);
  latest.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("modal");
    stack.push(id);

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1] !== id) return;
      // A context menu opened inside this modal closes first, on its own handler.
      if (document.querySelector(".context-menu")) return;
      // So does a focused field: Escape there clears a search box or cancels an
      // inline edit. Once it blurs, the next press reaches this handler.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      e.stopPropagation();
      latest.current();
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(id);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [enabled]);
}
