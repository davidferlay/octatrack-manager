import { invoke } from '@tauri-apps/api/core';

/**
 * Zooming the whole UI from the keyboard, as in a web browser: Ctrl (Cmd on macOS) with
 * + or = zooms in, - zooms out, 0 goes back to 100%. The backend owns the levels, applies
 * the zoom to the webview and keeps it for the next launch; this only reads the keys and
 * shows the new level for a moment.
 */

/** 1 to zoom in, -1 to zoom out, 0 to reset, null for any other key. */
export function zoomStepFor(e: KeyboardEvent): 1 | -1 | 0 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return 1;
  if (e.key === '-' || e.code === 'NumpadSubtract') return -1;
  // By position as well: on AZERTY the 0 key types "à" without Shift
  if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') return 0;
  return null;
}

const SHOWN_MS = 1500;

/** The zoom in force, as the backend has it (1 = 100%). */
export const getUiZoom = () => invoke<number>('get_ui_zoom');

/**
 * Steps the zoom (1 in, -1 out, 0 back to 100%) and returns the new one. Announced as a
 * `ui-zoom` window event, so whatever shows the zoom follows, whoever changed it.
 */
export async function stepUiZoom(step: 1 | -1 | 0): Promise<number> {
  const zoom = await invoke<number>('step_ui_zoom', { step });
  window.dispatchEvent(new CustomEvent('ui-zoom', { detail: zoom }));
  return zoom;
}

/** Installs the shortcut for the whole app; returns the uninstaller. */
export function installUiZoom(target: Document = document): () => void {
  let badge: HTMLDivElement | null = null;
  let hideTimer: number | undefined;

  const show = (zoom: number) => {
    // A new badge each time, so the toast's fade-out starts over rather than finishing
    // on a level just changed; never two at once
    badge?.remove();
    badge = target.createElement('div');
    badge.className = 'toast-notification zoom-toast';
    badge.textContent = `Zoom ${Math.round(zoom * 100)}%`;
    target.body.append(badge);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { badge?.remove(); badge = null; }, SHOWN_MS);
  };

  const onKey = (e: KeyboardEvent) => {
    const step = zoomStepFor(e);
    if (step === null) return;
    e.preventDefault();
    stepUiZoom(step)
      .then(show)
      .catch(error => console.error('Zoom failed:', error));
  };

  target.addEventListener('keydown', onKey);
  return () => {
    target.removeEventListener('keydown', onKey);
    window.clearTimeout(hideTimer);
    badge?.remove();
  };
}
