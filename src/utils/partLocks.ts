/**
 * Value keys: the JSON pointers that name one value inside a `PartCopy`, which is how
 * the backend is told what to revert or lock. The format is fixed by the backend, so
 * every key is built here and nowhere else.
 */

import type { PageKey } from '../components/sceneModel';
import type { PartCopy, PartCopies } from './partDiff';

/** A value of a track's entry in a Part section; a field's dots become slashes. */
export const fieldPath = (section: string, trackIndex: number, field: string): string =>
  `/part/${section}/${trackIndex}/${field.replace(/\./g, '/')}`;

/** What a scene holds at one position of one track (XLV has no position). */
export const scenePath = (
  sceneId: number, trackId: number, page: PageKey | 'xlv', index: number,
): string => `/scenes/scenes/${sceneId}/tracks/${trackId}/${page === 'xlv' ? 'xlv' : `${page}/${index}`}`;

/** The value a pointer names in one copy; null where it holds nothing or leads nowhere. */
export function valueAt(copy: PartCopy, path: string): unknown {
  let node: unknown = copy;
  for (const key of path.split('/').slice(1)) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[key];
  }
  return node ?? null;
}

/** Whether the two copies hold different values there. False until a saved copy exists. */
export const differs = (copies: PartCopies, path: string): boolean =>
  copies.saved !== null && valueAt(copies.saved, path) !== valueAt(copies.edited, path);
