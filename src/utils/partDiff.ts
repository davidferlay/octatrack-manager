/**
 * What differs between the two copies the device keeps of a Part.
 *
 * Save copies the edited Part over the saved one and Reload does the opposite, so both
 * overwrite exactly the values listed here. Every field the editors read is compared,
 * scenes included - they live in the Part and go with it either way - and each is
 * named and read the way the editor shows it.
 */

import type { PartData } from '../context/ProjectsContext';
import { slotsForTrack, type PageKey, type ScenesResponse, type Slot } from '../components/sceneModel';
import {
  FieldSpec, fieldSpec, formatSpecValue, machineParamLabels, machineParamFields,
  machineSetupLabels, machineSetupFields, TRACK_LEVEL_SPEC, SCENE_XVOL_SPEC,
} from './partFieldSpecs';
import { formatFxType, getFxMainLabels, getFxSetupLabels } from './fxLabels';
import { fieldHelp, helpTitle, machineHelp, LEVEL_HELP } from './partFieldHelp';
import { fieldPath, scenePath } from './partLocks';

/** One copy of a Part, as `read_part_copies` returns it. */
export interface PartCopy {
  part: PartData;
  scenes: ScenesResponse;
}

export interface PartCopies {
  /** What Reload goes back to. Null until the Part is first saved. */
  saved: PartCopy | null;
  edited: PartCopy;
  /** Whether the two hold the same bytes, including ones the editors do not show. */
  identical: boolean;
}

export interface PartChange {
  /** T1-T8, M1-M8, or empty for the crossfader. */
  track: string;
  page: string;
  param: string;
  saved: string;
  current: string;
  /** What the editor's own tooltip says about this parameter, where it says something. */
  help?: string;
  /** The values the row shows, as value keys (see partLocks.ts). */
  paths: string[];
  /** What reverting this row puts back: its own `paths`, or its whole group's set. */
  revert: string[];
  /** What locking this row locks: its own `paths`, or its whole group's set. */
  lock: string[];
  /** Set on the rows of a machine or effect type change, which act together. */
  group?: { head: boolean; name: string };
}

type Leaf = string | number | null;
type Section = keyof Omit<PartData, 'part_id'>;

const AUDIO: Section[] = ['machines', 'volumes', 'amps', 'lfos', 'fxs', 'recorders'];
const MIDI: Section[] = ['midi_notes', 'midi_arps', 'midi_lfos', 'midi_ctrl1s', 'midi_ctrl2s'];

const PAGES: Partial<Record<Section, string>> = {
  amps: 'AMP', lfos: 'LFO', midi_lfos: 'LFO', recorders: 'REC',
  midi_notes: 'NOTE', midi_arps: 'ARP', midi_ctrl1s: 'CTRL1', midi_ctrl2s: 'CTRL2',
};

/** Fields the editor labels differently from their stored name. */
const NAMES: Record<string, string> = {
  xloop: 'LOOP', in_ab: 'INAB', in_cd: 'INCD',
  amp_setup_amp: 'AMP', amp_setup_sync: 'SYNC', amp_setup_atck: 'ATCK',
  amp_setup_fx1: 'FX1', amp_setup_fx2: 'FX2',
};

interface Named {
  page: string;
  param: string;
  read: (value: Leaf) => string;
  help?: string;
}

const reading = (spec: FieldSpec | null) => (value: Leaf): string => {
  if (value === null) return '-';
  if (typeof value === 'string') return value;
  return spec ? formatSpecValue(value, spec) : String(value);
};

/** Every value of one track's entry, under the name the editor stores it by. */
function leaves(entry: object): [string, Leaf][] {
  return Object.entries(entry).flatMap(([key, value]): [string, Leaf][] => {
    if (key === 'track_id') return [];
    if (Array.isArray(value)) return value.map((v, i) => [`${key}.${i}`, v]);
    if (value && typeof value === 'object') {
      return Object.entries(value).map(([k, v]) => [`${key}.${k}`, v as Leaf]);
    }
    return [[key, value as Leaf]];
  });
}

function pageOf(section: Section, field: string): string {
  const base = PAGES[section] ?? section.toUpperCase();
  const setup = section === 'amps' ? field.startsWith('amp_setup_')
    : section.endsWith('lfos') ? /^lfo\d_/.test(field)
      : section === 'midi_notes' ? ['chan', 'bank', 'prog', 'sbnk'].includes(field)
        : section === 'midi_arps' ? ['len', 'key'].includes(field)
          : section.startsWith('midi_ctrl') && field.endsWith('_num');
  return setup ? `${base} SETUP` : base;
}

function paramOf(field: string): string {
  const lfo = field.match(/^lfo(\d)_(\w+)$/);
  if (lfo) return `LFO${lfo[1]} ${lfo[2].toUpperCase()}`;
  const cc = field.match(/^cc(\d+)_num$/);
  if (cc) return `CC${cc[1]}#`;
  return NAMES[field] ?? field.toUpperCase();
}

/**
 * What a field is called on this copy, and how its value reads there. Null for a
 * position this copy's machine or effect does not use.
 */
function nameOn(part: PartData, section: Section, trackId: number, field: string): Named | null {
  const machine = part.machines[trackId];
  const type = machine?.machine_type;
  const fx = part.fxs[trackId];

  if (section === 'machines') {
    if (field === 'machine_type') {
      return { page: 'SRC', param: 'MACHINE', read: reading(null), help: machineHelp(type) };
    }
    if (field === 'static_slot_id' || field === 'flex_slot_id') {
      const pool = field[0].toUpperCase();
      return {
        page: 'SRC', param: 'SLOT',
        read: v => (v === null ? '-' : `${pool}${String(Number(v) + 1).padStart(3, '0')}`),
      };
    }
    const setup = field.startsWith('machine_setup.');
    const i = (setup ? machineSetupFields(type) : machineParamFields(type)).indexOf(field);
    const label = (setup ? machineSetupLabels(type) : machineParamLabels(type, true))[i];
    if (i < 0 || !label) return null;
    return {
      page: setup ? 'SRC SETUP' : 'SRC', param: label,
      read: reading(fieldSpec(field, type, { slic: machine.machine_setup.slic })),
      help: helpTitle(label, fieldHelp(field, type, { label })),
    };
  }

  if (section === 'fxs') {
    const [, slot, kind, n] = field.match(/^(fx[12])_(type|param|setup)(\d)?$/) ?? [];
    if (!slot) return null;
    const page = slot.toUpperCase();
    if (kind === 'type') return { page, param: 'TYPE', read: v => formatFxType(Number(v)) };
    const fxType = slot === 'fx1' ? fx.fx1_type : fx.fx2_type;
    const label = (kind === 'param' ? getFxMainLabels(fxType) : getFxSetupLabels(fxType))[Number(n) - 1];
    if (!label) return null;
    return {
      page: kind === 'setup' ? `${page} SETUP` : page, param: label,
      read: reading(fieldSpec(field, type)),
      help: helpTitle(label, fieldHelp(field, type, { label, fxType })),
    };
  }

  if (section === 'volumes') {
    const param = field === 'main' ? 'TRK' : 'CUE';
    return { page: 'LEVELS', param, read: reading(TRACK_LEVEL_SPEC), help: LEVEL_HELP[param] };
  }

  if (field.startsWith('custom_lfo_design.')) {
    return { page: 'LFO DESIGN', param: `STEP ${Number(field.split('.')[1]) + 1}`, read: reading(null) };
  }

  // A MIDI track's and the recorder's fields are named per page, as in the editor
  const midi = section.startsWith('midi_');
  const specKey = midi || section === 'recorders' ? `${section}.${field}` : field;
  const spec = field === 'xvol'
    ? SCENE_XVOL_SPEC
    : fieldSpec(specKey, midi ? undefined : type, { fx1Type: fx?.fx1_type, fx2Type: fx?.fx2_type });
  const param = paramOf(field);
  return {
    page: pageOf(section, field), param, read: reading(spec),
    help: helpTitle(param, fieldHelp(specKey, midi ? undefined : type, { label: param })),
  };
}

/**
 * One row for a value that differs. When the two copies name it differently - another
 * machine or effect gives the same position another meaning - the saved value carries
 * its own name, since it is a different parameter.
 */
function row(
  track: string,
  saved: { name: Named | null; value: Leaf },
  current: { name: Named | null; value: Leaf },
  fallback: Named,
  paths: string[],
): PartChange {
  const shown = current.name ?? saved.name ?? fallback;
  const text = (side: typeof saved) => (side.name ?? fallback).read(side.value);
  const renamed = saved.name && current.name && saved.name.param !== current.name.param;
  return {
    track,
    page: shown.page,
    param: shown.param,
    help: shown.help,
    saved: renamed ? `${saved.name!.param} ${text(saved)}` : saved.name || !current.name ? text(saved) : '-',
    current: current.name || !saved.name ? text(current) : '-',
    paths, revert: paths, lock: paths,
  };
}

/** The same row, acting as a member of a group whose sets it shares. */
const inGroup = (r: PartChange, group: PartChange['group'], revert: string[], lock: string[]): PartChange =>
  ({ ...r, group, revert, lock });

/** One track's type change, and the positions whose meaning it changes. */
interface TypeChange {
  /** The stored type field, e.g. `machine_type` or `fx1_type`. */
  head: string;
  name: string;
  /** Every position of the type's pages, in order; null where the type has none. */
  positions: (part: PartData) => (string | null)[];
}

const FX_SLOTS = ['fx1', 'fx2'] as const;

/**
 * The type changes of one track. Static and Flex have the same fields (R6), so a change
 * between them is an ordinary row, not a group.
 */
function typeChanges(saved: PartData, current: PartData, section: Section, t: number): TypeChange[] {
  if (section === 'machines') {
    const was = saved.machines[t]?.machine_type;
    const now = current.machines[t]?.machine_type;
    const family = (type: string) => (type === 'Static' || type === 'Flex' ? 'Flex' : type);
    if (was === undefined || now === undefined || family(was) === family(now)) return [];
    return [{
      head: 'machine_type', name: `T${t + 1} SRC`,
      positions: part => [
        ...machineParamFields(part.machines[t].machine_type),
        ...machineSetupFields(part.machines[t].machine_type),
      ],
    }];
  }
  if (section === 'fxs') {
    return FX_SLOTS.filter(slot => saved.fxs[t]?.[`${slot}_type`] !== current.fxs[t]?.[`${slot}_type`])
      .map(slot => ({
        head: `${slot}_type`, name: `T${t + 1} ${slot.toUpperCase()}`,
        positions: part => {
          const type = part.fxs[t][`${slot}_type`];
          const labelled = (labels: string[], kind: string) =>
            labels.map((label, i) => (label ? `${slot}_${kind}${i + 1}` : null));
          return [...labelled(getFxMainLabels(type), 'param'), ...labelled(getFxSetupLabels(type), 'setup')];
        },
      }));
  }
  return [];
}

function trackChanges(saved: PartData, current: PartData): PartChange[] {
  const rows: PartChange[] = [];
  const walk = (sections: Section[], prefix: string) => {
    for (let trackId = 0; trackId < 8; trackId++) {
      for (const section of sections) {
        const before = new Map(leaves(saved[section][trackId] ?? {}));
        const after = new Map(leaves(current[section][trackId] ?? {}));
        const track = `${prefix}${trackId + 1}`;
        const path = (field: string) => fieldPath(section, trackId, field);
        const plain = (field: string, value: Leaf): PartChange => {
          const was = before.get(field) ?? null;
          return row(
            track,
            { name: nameOn(saved, section, trackId, field), value: was },
            { name: nameOn(current, section, trackId, field), value },
            { page: pageOf(section, field), param: paramOf(field), read: reading(null) },
            [path(field)],
          );
        };

        // Positions a type change lists itself are left out of the ordinary rows
        const groups = typeChanges(saved, current, section, trackId);
        const grouped = new Set(groups.flatMap(g => [...g.positions(saved), ...g.positions(current)]));
        const heads = new Map(groups.map(g => [g.head, g]));

        for (const [field, value] of after) {
          const group = heads.get(field);
          if (group) {
            rows.push(...groupRows(group, plain(field, value)));
            continue;
          }
          if (grouped.has(field) || (before.get(field) ?? null) === value) continue;
          rows.push(plain(field, value));
        }

        function groupRows(g: TypeChange, head: PartChange): PartChange[] {
          const savedAt = g.positions(saved);
          const currentAt = g.positions(current);
          const headPath = path(g.head);
          const revert = [headPath, ...savedAt.filter((f): f is string => !!f).map(path)];
          const lock = [headPath, ...currentAt.filter((f): f is string => !!f && (before.get(f) ?? null) !== (after.get(f) ?? null)).map(path)];
          const members = savedAt.flatMap((sf, i): PartChange[] => {
            const cf = currentAt[i];
            if (!sf && !cf) return [];
            const side = (part: PartData, f: string | null, leafs: Map<string, Leaf>) =>
              ({ name: f ? nameOn(part, section, trackId, f) : null, value: f ? leafs.get(f) ?? null : null });
            const fallback = (cf ? nameOn(current, section, trackId, cf) : null)
              ?? (sf ? nameOn(saved, section, trackId, sf) : null);
            if (!fallback) return [];
            const shown = [sf, cf].filter((f): f is string => !!f).map(path);
            return [inGroup(
              row(track, side(saved, sf, before), side(current, cf, after), fallback, [...new Set(shown)]),
              { head: false, name: g.name }, revert, lock,
            )];
          });
          return [inGroup(head, { head: true, name: g.name }, revert, lock), ...members];
        }
      }
    }
  };
  walk(AUDIO, 'T');
  walk(MIDI, 'M');
  return rows;
}

function sceneChanges(saved: ScenesResponse, current: ScenesResponse): PartChange[] {
  const rows: PartChange[] = [];
  const ends: ['A' | 'B', 'scene_a' | 'scene_b'][] = [['A', 'scene_a'], ['B', 'scene_b']];
  for (const [end, key] of ends) {
    if (saved[key] !== current[key]) {
      rows.push({
        track: '', page: 'CROSSFADER', param: end,
        saved: `Scene ${saved[key] + 1}`, current: `Scene ${current[key] + 1}`,
        paths: [`/scenes/${key}`], revert: [`/scenes/${key}`], lock: [`/scenes/${key}`],
      });
    }
  }

  const slots = (scenes: ScenesResponse, sceneId: number, t: number) => new Map(
    slotsForTrack(
      scenes.scenes[sceneId].tracks[t], scenes.machine_types[t], scenes.fx1_types[t], scenes.fx2_types[t],
    ).map((slot): [string, Slot] => [`${slot.page}:${slot.index}`, slot]),
  );
  const slotKey = (key: string): [PageKey | 'xlv', number] => {
    const [page, index] = key.split(':');
    return [page as PageKey | 'xlv', Number(index)];
  };
  const named = (slot: Slot | undefined, sceneId: number, t: number, scenes: ScenesResponse): Named | null => slot
    ? {
      page: `Scene ${sceneId + 1} ${slot.pageName}`, param: slot.label, read: reading(slot.spec),
      help: helpTitle(slot.label, fieldHelp(slot.field, scenes.machine_types[t], {
        label: slot.label,
        fxType: slot.page === 'fx1' ? scenes.fx1_types[t] : slot.page === 'fx2' ? scenes.fx2_types[t] : undefined,
      })),
    }
    : null;

  for (let sceneId = 0; sceneId < 16; sceneId++) {
    for (let t = 0; t < 8; t++) {
      const before = slots(saved, sceneId, t);
      const after = slots(current, sceneId, t);
      for (const key of new Set([...after.keys(), ...before.keys()])) {
        const was = before.get(key);
        const now = after.get(key);
        if ((was?.value ?? null) === (now?.value ?? null)) continue;
        const fallback = (now ? named(now, sceneId, t, current) : named(was, sceneId, t, saved))!;
        rows.push(row(
          `T${t + 1}`,
          { name: named(was, sceneId, t, saved), value: was?.value ?? null },
          { name: named(now, sceneId, t, current), value: now?.value ?? null },
          fallback,
          [scenePath(sceneId, t, ...slotKey(key))],
        ));
      }
    }
  }
  return rows;
}

/** T1-T8, then M1-M8, then the crossfader, which belongs to no track. */
export const trackRank = (track: string) =>
  (track ? (track[0] === 'M' ? 8 : 0) + Number(track.slice(1)) : 99);

/**
 * Everything Save or Reload would overwrite, one block per track: its own values in
 * the order the editors lay them out, then its scene locks, scene by scene.
 */
export function partChanges(saved: PartCopy, current: PartCopy): PartChange[] {
  // sort is stable, so each block keeps the order it was built in
  return [...trackChanges(saved.part, current.part), ...sceneChanges(saved.scenes, current.scenes)]
    .sort((a, b) => trackRank(a.track) - trackRank(b.track));
}

/**
 * What an undo entry or a menu calls the row's value: track, page and parameter, or the
 * group's own name for a row of a type change, since those act as one.
 */
export function actionName(row: PartChange): string {
  if (row.group) return row.group.name;
  return [row.track, row.page, row.param].filter(Boolean).join(' ');
}
