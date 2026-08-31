/**
 * The directory currently browsed inside an Audio Pool, remembered per pool
 * path for the length of the session.
 *
 * Keyed by the pool root rather than by the component, so the Audio Pool page
 * and a project's Audio Pool pane share one location: navigating between them
 * (either direction) lands you where you were, instead of snapping back to
 * `AUDIO/`.
 */
const key = (poolPath: string) => `poolDir:${poolPath}`;

/** The remembered directory for `poolPath`, or the pool root when there is
 *  none, it is unusable, or it no longer sits under that root. */
export function readPoolDir(poolPath: string): string {
  if (!poolPath) return poolPath;
  try {
    const saved = sessionStorage.getItem(key(poolPath));
    return saved && saved.startsWith(poolPath) ? saved : poolPath;
  } catch {
    // Private mode / storage disabled: browsing just starts at the root.
    return poolPath;
  }
}

export function writePoolDir(poolPath: string, dir: string) {
  if (!poolPath || !dir) return;
  try {
    sessionStorage.setItem(key(poolPath), dir);
  } catch {
    // Nothing to do: the location simply is not remembered.
  }
}
