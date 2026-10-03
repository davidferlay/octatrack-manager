/**
 * What each Part field is actually allowed to hold on the device.
 *
 * Every field used to be treated as a plain 0-127 rotary, which let the app write
 * values the Octatrack never produces - a project the hardware then has to make sense
 * of. The ranges below come from projects made on the device itself with every field
 * driven to its minimum and to its maximum (ATOOLSTEST/PRESETS/*_MIN and *_MAX, Bank A,
 * Part 1, Track 4), so they are what the hardware writes, not what the format allows.
 *
 * Defaults are the factory values ot-tools-io writes for a blank Part.
 *
 * Value names are the ones the Octatrack itself shows, listed in the order it offers
 * them and paired with the raw byte each one stores. Every list's length matches what
 * the device-made projects measure.
 */

export type Widget =
  /** 0..max, rising from the left - the usual knob. */
  | 'unipolar'
  /** Centred: the value means "how far from the middle", in either direction. */
  | 'bipolar'
  /** Two states. */
  | 'toggle'
  /** A short list of named or numbered choices. */
  | 'selector';

export interface FieldSpec {
  min: number;
  max: number;
  /** Factory value for a blank Part. */
  default: number;
  widget: Widget;
  /** Raw value this field is centred on, for a bipolar widget. */
  center?: number;
  /**
   * The choices this field offers, in the order the device lists them, each paired
   * with the raw value it stores. The two are not always the same: the LFO target
   * list shows the AMP targets before the LFO ones but stores them higher, so a
   * plain index-to-name array would write the wrong byte.
   */
  options?: { value: number; label: string }[];
  /** How the number reads to a human, where it is not just the number. */
  display?: 'semitones' | 'offset';
  /**
   * Set when the device's own ceiling has not been established and the spec falls
   * back to the byte's own limit. The floor is still the measured one.
   */
  maxUnverified?: true;
}

/** Machine types that carry their own SRC MAIN and SRC SETUP fields. */
export type MachineType = 'Static' | 'Flex' | 'Thru' | 'Neighbor' | 'Pickup';

const U = (min: number, max: number, def: number): FieldSpec =>
  ({ min, max, default: def, widget: 'unipolar' });

/** Builds options from names listed in raw-value order, which is the common case. */
const named = (labels: string[], from = 0) =>
  labels.map((label, i) => ({ value: from + i, label }));

const TOGGLE = (def: number, labels: string[]): FieldSpec =>
  ({ min: 0, max: 1, default: def, widget: 'toggle', options: named(labels) });

const SELECT = (def: number, labels: string[], from = 0): FieldSpec => ({
  min: from,
  max: from + labels.length - 1,
  default: def,
  widget: 'selector',
  options: named(labels, from),
});

/**
 * PTCH is the one SRC field the device does not run over the whole byte: it stops 60
 * either side of centre, which the manual describes as one octave up and one down.
 */
const PTCH: FieldSpec = {
  min: 4, max: 124, default: 64, widget: 'bipolar', center: 64, display: 'semitones',
};

/* The named settings, in the order the device lists them. */

/** The envelope behaviours, shared by AMP, FX1 and FX2. */
const ENVELOPE_MODES = ['ANLG', 'RTRG', 'R+T', 'TTRG'];
/** LOOP, on SRC SETUP. */
const LOOP_MODES = ['OFF', 'AUTO', 'ON', 'PIPO'];
/** TSTR, on SRC SETUP. */
const TIMESTRETCH_MODES = ['OFF', 'AUTO', 'NORM', 'BEAT'];
/** Eleven basic waveforms then the eight LFO designer slots. */
const LFO_WAVES = [
  'TRI', 'ITRI', 'SAW', 'ISAW', 'SQR', 'ISQR', 'EXP', 'IEXP', 'RMP', 'IRMP', 'RND',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8',
];
/** MULT, which multiplies the LFO speed. */
const LFO_MULTIPLIERS = ['1X', '2X', '4X', '8X', '16X', '32X', '64X'];
/** TRIG, how the LFO reacts to a sample trig. */
const LFO_TRIG_MODES = [
  'FREE', 'TRIG', 'HOLD', 'ONE', 'HALF', 'SYNC TRIG', 'SYNC ONE', 'SYNC HALF',
];
/** What a Thru machine listens to. */
const INPUTS_AB = ['-', 'A B', 'A', 'B', 'A+B'];
const INPUTS_CD = ['-', 'C D', 'C', 'D', 'C+D'];
/** A Pickup machine's direction, recording behaviour and slave-loop length. */
const PICKUP_DIRECTIONS = ['REV', 'PIPO', 'FWD'];
const PICKUP_BEHAVIOURS = ['GAIN', 'DUB'];
const PICKUP_LENGTHS = ['OFF', 'x1', 'x2', 'x4', 'x8'];
/** Whether the SRC page's RATE drives timestretch or pitch. */
const RATE_TARGETS = ['PTCH', 'TSTR'];
/** SETUP LEN names its two settings differently depending on SLIC. */
const LEN_WHEN_SLIC_OFF = ['OFF', 'TIME'];
const LEN_WHEN_SLIC_ON = ['SLIC', 'TIME'];

/**
 * What an LFO can modulate.
 *
 * The one list whose picker order is not its stored order: the device groups the AMP
 * targets before the LFO ones but stores them above, so each entry carries its own
 * raw value.
 */
const LFO_TARGETS: { value: number; label: string }[] = [
  ...[0, 1, 2, 3, 4, 5].map(i => ({ value: i, label: `P1 P0${i + 1}` })),
  { value: 12, label: 'Amp Attack' },
  { value: 13, label: 'Amp Hold' },
  { value: 14, label: 'Amp Release' },
  { value: 15, label: 'Amp Volume' },
  { value: 16, label: 'Amp Balance' },
  { value: 17, label: 'Amp XVol' },
  { value: 6, label: 'LFO 1 Speed' },
  { value: 7, label: 'LFO 2 Speed' },
  { value: 8, label: 'LFO 3 Speed' },
  { value: 9, label: 'LFO 1 Depth' },
  { value: 10, label: 'LFO 2 Depth' },
  { value: 11, label: 'LFO 3 Depth' },
  ...[0, 1, 2, 3, 4, 5].map(i => ({ value: 18 + i, label: `FX1 P0${i + 1}` })),
  ...[0, 1, 2, 3, 4, 5].map(i => ({ value: 24 + i, label: `FX2 P0${i + 1}` })),
];

/** SRC MAIN and SRC SETUP, per machine. A machine absent from a page has no fields there. */
const SRC: Record<MachineType, Record<string, FieldSpec>> = {
  Static: {
    'machine_params.ptch': PTCH,
    'machine_params.strt': U(0, 127, 0),
    'machine_params.len': U(0, 127, 0),
    'machine_params.rate': U(0, 127, 127),
    'machine_params.rtrg': U(0, 127, 0),
    'machine_params.rtim': U(0, 127, 79),
    'machine_setup.xloop': SELECT(1, LOOP_MODES),
    'machine_setup.slic': TOGGLE(0, ['OFF', 'ON']),
    // Reads OFF/TIME or SLIC/TIME depending on SLIC - resolved in fieldSpec
    'machine_setup.len': TOGGLE(0, LEN_WHEN_SLIC_OFF),
    'machine_setup.rate': TOGGLE(0, RATE_TARGETS),
    'machine_setup.tstr': SELECT(1, TIMESTRETCH_MODES),
    'machine_setup.tsns': U(0, 127, 64),
  },
  // Flex and Static carry the same SRC fields with the same ranges - measured, not assumed
  Flex: {} as Record<string, FieldSpec>,
  Thru: {
    'machine_params.in_ab': SELECT(0, INPUTS_AB),
    'machine_params.vol_ab': U(0, 127, 64),
    'machine_params.in_cd': SELECT(0, INPUTS_CD),
    'machine_params.vol_cd': U(0, 127, 64),
  },
  // A Neighbor machine takes the track before it as its input and has nothing to set
  Neighbor: {},
  Pickup: {
    'machine_params.ptch': PTCH,
    // The PICKUP_MAX project could not give these ceilings - it holds its maxima in
    // the Static block - so these come from the lists the device offers.
    'machine_params.dir': SELECT(2, PICKUP_DIRECTIONS),
    'machine_params.len': SELECT(1, PICKUP_LENGTHS),
    // GAIN runs the whole byte, from silence at the bottom to about +12 dB
    'machine_params.gain': U(0, 127, 64),
    'machine_params.op': SELECT(1, PICKUP_BEHAVIOURS),
    // Timestretch cannot be turned off here, so this one starts at 1 - exactly the
    // floor the device-made project measured
    'machine_setup.tstr': SELECT(1, ['AUTO', 'NORM', 'BEAT'], 1),
    'machine_setup.tsns': U(0, 127, 64),
  },
};
SRC.Flex = SRC.Static;

/** The LFO modulation target: 30 choices whose picker order is not their raw order. */
const TARGET: FieldSpec = {
  min: 0, max: 29, default: 0, widget: 'selector', options: LFO_TARGETS,
};

/** AMP, LFO and the other pages, which every audio machine shares. */
const SHARED: Record<string, FieldSpec> = {
  'atk': U(0, 127, 0),
  'hold': U(0, 127, 127),
  'rel': U(0, 127, 127),
  'vol': U(0, 127, 64),
  // Reads -64 to +63 around its centre
  'bal': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },

  // The four envelope behaviours the manual lists for AMP, FX1 and FX2 (page 59), in
  // the order it lists them - the same mapping the app already uses for FX1 and FX2.
  'amp_setup_amp': SELECT(1, ENVELOPE_MODES),
  'amp_setup_sync': TOGGLE(1, ['OFF', 'ON']),
  'amp_setup_atck': TOGGLE(0, ['LIN', 'LOG']),
  'amp_setup_fx1': SELECT(0, ENVELOPE_MODES),
  'amp_setup_fx2': SELECT(0, ENVELOPE_MODES),

  'spd1': U(0, 127, 32),
  'spd2': U(0, 127, 32),
  'spd3': U(0, 127, 32),
  'dep1': { min: 0, max: 127, default: 0, widget: 'bipolar', center: 64, display: 'offset' },
  'dep2': { min: 0, max: 127, default: 0, widget: 'bipolar', center: 64, display: 'offset' },
  'dep3': { min: 0, max: 127, default: 0, widget: 'bipolar', center: 64, display: 'offset' },

  'lfo1_pmtr': TARGET, 'lfo2_pmtr': TARGET, 'lfo3_pmtr': TARGET,
  'lfo1_wave': SELECT(0, LFO_WAVES), 'lfo2_wave': SELECT(0, LFO_WAVES), 'lfo3_wave': SELECT(0, LFO_WAVES),
  'lfo1_mult': SELECT(0, LFO_MULTIPLIERS), 'lfo2_mult': SELECT(0, LFO_MULTIPLIERS), 'lfo3_mult': SELECT(0, LFO_MULTIPLIERS),
  'lfo1_trig': SELECT(0, LFO_TRIG_MODES), 'lfo2_trig': SELECT(0, LFO_TRIG_MODES), 'lfo3_trig': SELECT(0, LFO_TRIG_MODES),
};

/**
 * Fields the AMP page itself does not carry, which earlier versions still drew a knob
 * for. The device's AMP page has five parameters - ATK, HOLD, REL, VOL and BAL.
 *
 * The sixth byte is XVOL, the crossfader volume: the manual (page 59) says it "only
 * will appear when pressing a [SCENE] key" and "can only be locked to scenes", and
 * that slot is the track's crossfader volume. It is a real value, so it is read and
 * written back untouched - it is simply not set from this page.
 */
const NOT_ON_AMP_PAGE = new Set(['xvol']);

export function isDeviceField(field: string): boolean {
  return !NOT_ON_AMP_PAGE.has(field);
}

/**
 * Whatever is known about a field, or null when the device has no such control here.
 *
 * Null means "established absent": a machine that does not carry this parameter, or a
 * byte the hardware has no control for. A field nobody has measured yet - the effect
 * pages, the MIDI tracks - is not absent, so it keeps the permissive range it always
 * had rather than disappearing from the editor.
 */
export function fieldSpec(
  field: string,
  machineType?: string,
  ctx?: { slic?: number | null },
): FieldSpec | null {
  if (!isDeviceField(field)) return null;
  if (field.startsWith('machine_')) {
    // SRC fields are enumerated per machine, so a miss here really is absent
    const machine = SRC[machineType as MachineType];
    const spec = machine?.[field] ?? null;
    // SETUP LEN names its two settings differently once slices are switched on:
    // OFF/TIME becomes SLIC/TIME, exactly as the device relabels it
    if (spec && field === 'machine_setup.len' && ctx?.slic) {
      return { ...spec, options: named(LEN_WHEN_SLIC_ON) };
    }
    return spec;
  }
  return SHARED[field] ?? UNMEASURED;
}

/** What a field falls back to until its real range is measured on the device. */
const UNMEASURED: FieldSpec = { min: 0, max: 127, default: 0, widget: 'unipolar', maxUnverified: true };

/** Keeps a value inside what the device accepts. Out-of-range input lands on the edge. */
export function clampToSpec(value: number, spec: FieldSpec): number {
  if (!Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
}

/**
 * How the value reads. A bipolar field shows its distance from centre with a sign,
 * which is what the device shows and what makes "0" mean "no change".
 */
export function formatSpecValue(value: number, spec: FieldSpec): string {
  const option = spec.options?.find(o => o.value === value);
  if (option) return option.label;
  // Pitch is stored five steps to the semitone, and reads in semitones
  if (spec.display === 'semitones' && spec.center !== undefined) {
    return ((value - spec.center) / 5).toFixed(1);
  }
  if (spec.display === 'offset' && spec.center !== undefined) {
    return String(value - spec.center);
  }
  return String(value);
}

/** Turns what a human typed back into the raw byte, for a field that reads differently. */
export function parseSpecValue(text: string, spec: FieldSpec): number | null {
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return null;
  if (spec.display === 'semitones' && spec.center !== undefined) {
    return Math.round(spec.center + n * 5);
  }
  if (spec.display === 'offset' && spec.center !== undefined) {
    return Math.round(spec.center + n);
  }
  return Math.round(n);
}
