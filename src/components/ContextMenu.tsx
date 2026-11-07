import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A right-click menu at a fixed position: the Part tab's and the fields' share it.
 * Entries close the menu themselves, through the context, so a caller only says what
 * each one does.
 */
const CloseContext = createContext<() => void>(() => {});

export function ContextMenu({ x, y, onClose, children }: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Where the pointer is, unless that would put part of the menu outside the window:
  // the menu's size is only known once it is on screen, so it is measured there and
  // moved back by what overflows, before the browser paints. offsetWidth/offsetHeight
  // rather than the bounding box, which the opening animation's scale would shrink, and
  // the document's client size rather than innerWidth, which counts a scrollbar.
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { clientWidth, clientHeight } = document.documentElement;
    // No layout (a test renderer): there is no window to keep the menu inside
    if (!clientWidth || !clientHeight) return;
    setAt({
      left: Math.max(0, x - Math.max(0, x + el.offsetWidth - clientWidth)),
      top: Math.max(0, y - Math.max(0, y + el.offsetHeight - clientHeight)),
    });
  }, [x, y]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Escape is handled here rather than through useEscapeClose, which stands aside
    // while any context menu is open - this one included - and would let the key
    // through to the project page, whose Escape leaves the project. Taken in the
    // capture phase and stopped, so nothing further down sees it.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [onClose]);

  return createPortal(
    <CloseContext.Provider value={onClose}>
      <div ref={ref} role="menu" className="context-menu" style={{ position: 'fixed', left: at.left, top: at.top }}>
        {children}
      </div>
    </CloseContext.Provider>,
    document.body,
  );
}

/** Closes the menu, then acts. */
export function MenuItem({ label, icon, enabled, title, onSelect }: {
  label: string;
  icon: string;
  enabled: boolean;
  title?: string;
  onSelect: () => void;
}) {
  const close = useContext(CloseContext);
  return (
    <button
      role="menuitem"
      className="context-menu-item"
      disabled={!enabled}
      title={title}
      onClick={() => { close(); onSelect(); }}
    >
      <i className={`fas ${icon}`} /> {label}
    </button>
  );
}
