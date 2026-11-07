import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { isModalOpen, useEscapeClose } from "../hooks/useEscapeClose";
import { isMac, shortcutsFor, type ShortcutPage } from "../utils/shortcuts";
import { getUiZoom, stepUiZoom } from "../utils/uiZoom";

const TITLE = 'Shortcuts & zoom';

/**
 * True when ? is being typed as text. Only free-text fields count: a parameter value
 * (`.param-value`), a read-only field, a select or a checkbox never takes a ?, and those
 * keep focus after a click, so counting them would make ? do nothing on most of a page.
 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target instanceof HTMLInputElement
    && ['text', 'search', 'email', 'url', 'password', 'tel'].includes(target.type)
    && !target.readOnly
    && !target.classList.contains('param-value');
}

/**
 * The header button, and ? outside a text field: a window listing the shortcuts of the
 * page on screen (on the project page, of the open tab), then the ones that work
 * everywhere, with the interface zoom shown and changeable at the top.
 */
export function ShortcutsButton({ page, section }: { page: ShortcutPage; section?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      // Not on top of another window: ? closes this one, and only this one
      if (!open && isModalOpen()) return;
      e.preventDefault();
      setOpen(v => !v);
    };
    // Capture: a page handler that stops the key from bubbling cannot swallow ?
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <>
      <button
        className="toolbar-button shortcuts-button"
        onClick={() => setOpen(true)}
        title={`${TITLE} (?)`}
        aria-label={TITLE}
      >
        <AccessIcon />
      </button>
      {open && <ShortcutsModal page={page} section={section} onClose={close} />}
    </>
  );
}

/**
 * The accessibility figure, arms open: our own drawing, in the rounded style the user
 * picked (Font Awesome's circled and wheelchair versions were tried first). Zoom and the
 * keyboard are both about reaching the app, hence the theme.
 */
function AccessIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg className="access-icon" viewBox="0 0 24 24" width="1em" height="1em" style={style} aria-hidden="true">
      <circle cx="12" cy="2.7" r="2.5" fill="currentColor" />
      <path d="M3.6 7.2 Q12 9.4 20.4 7.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M9.2 8.6 L9.3 11 L7.6 21.6 L9.6 21.9 L12 14.6 L14.4 21.9 L16.4 21.6 L14.7 11 L14.8 8.6 Z"
        fill="currentColor" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
    </svg>
  );
}

function ShortcutsModal({ page, section, onClose }: { page: ShortcutPage; section?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState<number | null>(null);
  // A click on the backdrop closes, but only one that began there: a press inside that
  // ends over the backdrop, selecting text say, must not close it
  const pressedOnBackdrop = useRef(false);
  useEscapeClose(onClose);

  useEffect(() => {
    getUiZoom().then(setZoom).catch(() => setZoom(null));
    const onZoom = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener('ui-zoom', onZoom);
    return () => window.removeEventListener('ui-zoom', onZoom);
  }, []);

  const step = useCallback((s: 1 | -1 | 0) => {
    stepUiZoom(s).catch(error => console.error('Zoom failed:', error));
  }, []);
  const mac = isMac();
  const percent = zoom === null ? null : Math.round(zoom * 100);

  return createPortal(
    <div
      className="modal-overlay"
      onPointerDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal-content shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label={TITLE}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3><AccessIcon style={{ color: 'var(--elektron-orange)', marginRight: '0.5rem' }} />{TITLE}</h3>
          <div className="shortcuts-zoom" title={`Zoom: ${mac ? 'Cmd' : 'Ctrl'} + / - / 0`}>
            <span className="shortcuts-zoom-label">Zoom</span>
            <button className="toolbar-button" aria-label="Zoom out" onClick={() => step(-1)}><i className="fas fa-minus"></i></button>
            <output className="shortcuts-zoom-value" aria-label="Zoom">
              {percent === null ? '-' : `${percent}%`}
            </output>
            <button className="toolbar-button" aria-label="Zoom in" onClick={() => step(1)}><i className="fas fa-plus"></i></button>
            <button
              className="toolbar-button"
              aria-label="Reset zoom to 100%"
              title="Back to 100%"
              disabled={percent === 100}
              onClick={() => step(0)}
            >
              <i className="fas fa-rotate-left"></i>
            </button>
          </div>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {shortcutsFor(page, section, mac).map(group => (
            <section key={group.title} className="shortcuts-group">
              <h4>{group.title}</h4>
              <table className="shortcuts-table">
                <tbody>
                  {group.rows.map(row => (
                    <tr key={row.keys + row.action}>
                      <td className="shortcuts-keys"><kbd>{row.keys}</kbd></td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
