/**
 * What a scene is made of, and how to read one.
 *
 * Shared by the editor and by the views that read a whole Part at once, so that a
 * parameter is named the same way wherever it is shown.
 */

import {
  FieldSpec, fieldSpec, machineParamLabels, machineParamFields,
  AMP_PARAM_FIELDS, LFO_PARAM_FIELDS, SCENE_XVOL_SPEC, SCENE_XLV_SPEC,
} from '../utils/partFieldSpecs';
import { getFxMainLabels, fxShortName } from '../utils/fxLabels';

/** The five parameter pages a scene can hold. The crossfader level sits beside them. */
export type PageKey = 'machine' | 'lfo' | 'amp' | 'fx1' | 'fx2';

export interface SceneTrackLocks {
  track_id: number;
  machine: (number | null)[];
  lfo: (number | null)[];
  amp: (number | null)[];
  fx1: (number | null)[];
  fx2: (number | null)[];
  xlv: number | null;
}

export interface SceneData {
  scene_id: number;
  tracks: SceneTrackLocks[];
  locked_count: number;
}

export interface ScenesResponse {
  scenes: SceneData[];
  scene_a: number;
  scene_b: number;
  machine_types: string[];
  fx1_types: number[];
  fx2_types: number[];
  parts_edited_bitmask: number;
  parts_saved_state: number[];
  scene_a_muted: boolean;
  scene_b_muted: boolean;
}

/** One position of one page on one track: what it is, and what the scene holds there. */
export interface Slot {
  page: PageKey | 'xlv';
  pageName: string;
  label: string;
  spec: FieldSpec;
  index: number;
  value: number | null;
  /** The Parts editor's name for it, which is how its help is looked up. */
  field: string;
}

const AMP_LABELS = ['ATK', 'HOLD', 'REL', 'VOL', 'BAL', 'XVOL'];
const LFO_LABELS = ['SPD1', 'SPD2', 'SPD3', 'DEP1', 'DEP2', 'DEP3'];

/**
 * Every position this track could hold, in page order.
 *
 * Positions the track's own machine or effect does not use are left out entirely: a
 * scene can store a byte there, but the device has nothing to apply it to, so offering
 * one would invite setting something that does nothing.
 */
export function slotsForTrack(
  track: SceneTrackLocks,
  machineType: string,
  fx1Type: number,
  fx2Type: number,
): Slot[] {
  const specFor = (field: string | null): FieldSpec | null => {
    // XVOL has no Parts spec on purpose - only a scene can set it - so it brings its own
    if (field === 'xvol') return SCENE_XVOL_SPEC;
    return field ? fieldSpec(field, machineType) : null;
  };

  const page = (
    key: PageKey,
    pageName: string,
    labels: (string | null)[],
    fields: (string | null)[],
  ): Slot[] => track[key].flatMap((value, index) => {
    const label = labels[index];
    const field = fields[index];
    const spec = specFor(field);
    if (!label || !spec || !field) return [];
    return [{ page: key, pageName, label, spec, index, value, field }];
  });

  const fxFields = (slot: 'fx1' | 'fx2') => [1, 2, 3, 4, 5, 6].map(n => `${slot}_param${n}`);

  return [
    ...page('machine', 'SRC', machineParamLabels(machineType, true),
      machineParamFields(machineType)),
    ...page('amp', 'AMP', AMP_LABELS, [...AMP_PARAM_FIELDS]),
    ...page('lfo', 'LFO', LFO_LABELS, [...LFO_PARAM_FIELDS]),
    ...page('fx1', fxShortName(fx1Type, 'FX1'), getFxMainLabels(fx1Type), fxFields('fx1')),
    ...page('fx2', fxShortName(fx2Type, 'FX2'), getFxMainLabels(fx2Type), fxFields('fx2')),
    {
      page: 'xlv', pageName: 'XLV', label: 'XLV', spec: SCENE_XLV_SPEC,
      index: 0, value: track.xlv, field: 'xlv',
    },
  ];
}

/** The same tracks with nothing held, for emptying a scene. */
export function emptyTracks(tracks: SceneTrackLocks[]): SceneTrackLocks[] {
  const six = () => [null, null, null, null, null, null];
  return tracks.map(t => ({
    track_id: t.track_id,
    machine: six(), lfo: six(), amp: six(), fx1: six(), fx2: six(), xlv: null,
  }));
}

export function countLocks(tracks: SceneTrackLocks[]): number {
  return tracks.reduce((total, t) => total
    + [t.machine, t.lfo, t.amp, t.fx1, t.fx2]
      .reduce((n, page) => n + page.filter(v => v !== null).length, 0)
    + (t.xlv === null ? 0 : 1), 0);
}


/**
 * One parameter of one track, and what each of the sixteen scenes holds for it.
 *
 * The views that read a whole Part at once - the matrix, the comparison, the map of
 * what the crossfader will actually do - all want the same thing: rows that exist
 * because at least one scene reaches for them, each carrying its value per scene.
 *
 * The shape of a track's positions does not change from scene to scene; only the
 * values do. So the labels are worked out once per track and the scenes are read
 * straight out of the arrays after that.
 */
export interface AssignmentRow {
  key: string;
  trackId: number;
  pageName: string;
  label: string;
  spec: FieldSpec;
  field: string;
  page: PageKey | 'xlv';
  /** Sixteen long, null where that scene does not hold this parameter. */
  values: (number | null)[];
}

/** Every parameter at least one scene of this Part holds, in track and page order. */
export function sceneAssignments(data: ScenesResponse): AssignmentRow[] {
  const rows: AssignmentRow[] = [];
  const first = data.scenes[0];
  if (!first) return rows;

  for (const track of first.tracks) {
    const id = track.track_id;
    const shape = slotsForTrack(
      track, data.machine_types[id], data.fx1_types[id], data.fx2_types[id],
    );
    for (const slot of shape) {
      const values = data.scenes.map(scene => {
        const its = scene.tracks[id];
        if (!its) return null;
        return slot.page === 'xlv' ? its.xlv : its[slot.page][slot.index];
      });
      // A row nobody reaches for is not an assignment, and sixteen dashes say nothing
      if (values.every(value => value === null)) continue;
      rows.push({
        key: `${id}-${slot.page}-${slot.index}`,
        trackId: id,
        pageName: slot.pageName,
        label: slot.label,
        spec: slot.spec,
        field: slot.field,
        page: slot.page,
        values,
      });
    }
  }
  return rows;
}
