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

/**
 * Where a value is edited, for Go to param: the Parts editor's track (0-7 audio, 8-15
 * MIDI), page (its unified index: 0 SRC/NOTE, 1 AMP/ARP, 2 LFO, 3 FX1/CTRL1, 4 FX2/CTRL2,
 * 5 REC) and LFO sub-tab, or a scene lock's scene and track. A field shown in the track
 * header (machine, slot, levels) has no page: it is on all of them.
 */
export interface ParamLocation {
  tab: 'parts' | 'scenes';
  track?: number;
  page?: number;
  lfoTab?: 'LFO1' | 'LFO2' | 'LFO3' | 'DESIGN';
  sceneId?: number;
}

const PAGES: Record<string, number> = {
  machines: 0, amps: 1, lfos: 2, recorders: 5,
  midi_notes: 0, midi_arps: 1, midi_lfos: 2, midi_ctrl1s: 3, midi_ctrl2s: 4,
};

export function paramLocation(path: string): ParamLocation | null {
  const part = path.match(/^\/part\/(\w+)\/(\d)\/([\w/]+)$/);
  if (part) {
    const [, section, t, field] = part;
    const track = Number(t) + (section.startsWith('midi_') ? 8 : 0);
    const header = section === 'volumes'
      || (section === 'machines' && !/^machine_(params|setup)\//.test(field));
    const page = header ? undefined
      : section === 'fxs' ? (field.startsWith('fx2_') ? 4 : 3)
        : PAGES[section];
    const lfo = field.match(/^(?:lfo([123])_|spd([123])$|dep([123])$)/);
    const lfoTab = !section.endsWith('lfos') ? undefined
      : field.startsWith('custom_lfo_design') ? 'DESIGN'
        : lfo ? (`LFO${lfo[1] ?? lfo[2] ?? lfo[3]}` as ParamLocation['lfoTab']) : undefined;
    return { tab: 'parts', track, page, ...(lfoTab ? { lfoTab } : {}) };
  }
  const scene = path.match(/^\/scenes\/scenes\/(\d+)\/tracks\/(\d)\//);
  if (scene) return { tab: 'scenes', sceneId: Number(scene[1]), track: Number(scene[2]) };
  if (/^\/scenes\/scene_[ab]$/.test(path)) return { tab: 'scenes' };
  return null;
}
