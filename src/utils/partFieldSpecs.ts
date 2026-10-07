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

import { AMP_HOLD, RETRIG_COUNT, RETRIG_TIME, PICKUP_GAIN, RECORD_FADE } from './otValueTables';
import { getFxMainLabels, fxShortName } from './fxLabels';

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
  display?: 'semitones' | 'offset' | 'note' | 'times' | 'plusOne';
  /**
   * The exact string the device shows for each stored value, where the parameter is
   * not a plain scale - a time, a note division, a word at one end.
   */
  table?: readonly string[] | Readonly<Record<number, string>>;
  /**
   * Set when the device's own ceiling has not been established and the spec falls
   * back to the byte's own limit. The floor is still the measured one.
   */
  maxUnverified?: true;
}

/** Machine types that carry their own SRC MAIN and SRC SETUP fields. */
export type MachineType = 'Static' | 'Flex' | 'Thru' | 'Neighbor' | 'Pickup';

/** The five machines, in the order the device lists them, which is also their raw order. */
export const MACHINE_TYPES: MachineType[] = ['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup'];

/**
 * The machines a given track can run, by its zero-based index.
 *
 * A Neighbor machine takes its audio from the track before it, so tracks 1 and 5 - the
 * first of each group of four - have no neighbour to take it from and the device will
 * not let them run one (manual A.4).
 */
export function machineTypesForTrack(trackId: number): MachineType[] {
  const hasNeighbour = trackId !== 0 && trackId !== 4;
  return MACHINE_TYPES.filter(m => m !== 'Neighbor' || hasNeighbour);
}

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
    // LEN counts from one, so the byte reads one higher than it is stored
    'machine_params.len': { min: 0, max: 127, default: 0, widget: 'unipolar', display: 'plusOne' },
    // RATE runs backwards below its centre, where 0 is not playing at all
    'machine_params.rate': {
      min: 0, max: 127, default: 127, widget: 'bipolar', center: 64, display: 'offset',
    },
    // RTRG counts retrigs and ends at INF
    'machine_params.rtrg': { min: 0, max: 127, default: 0, widget: 'unipolar', table: RETRIG_COUNT },
    // RTIM is a time, written as a decimal or a note division depending where it sits
    'machine_params.rtim': { min: 0, max: 127, default: 79, widget: 'unipolar', table: RETRIG_TIME },
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
    // The input volumes read either side of their centre, as the AMP page's VOL does
    'machine_params.vol_ab': {
      min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset',
    },
    'machine_params.in_cd': SELECT(0, INPUTS_CD),
    'machine_params.vol_cd': {
      min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset',
    },
  },
  // A Neighbor machine takes the track before it as its input and has nothing to set
  Neighbor: {},
  Pickup: {
    'machine_params.ptch': PTCH,
    // The PICKUP_MAX project could not give these ceilings - it holds its maxima in
    // the Static block - so these come from the lists the device offers.
    'machine_params.dir': SELECT(2, PICKUP_DIRECTIONS),
    'machine_params.len': SELECT(1, PICKUP_LENGTHS),
    // GAIN reads in dB, from silence at the bottom to about +12 at the top
    'machine_params.gain': { min: 0, max: 127, default: 64, widget: 'unipolar', table: PICKUP_GAIN },
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

/** What a MIDI track's LFO can modulate - a different list from an audio track's. */
/**
 * What a MIDI track's LFO can modulate, in the order the device lists them.
 *
 * Named page-then-parameter in the device's own abbreviations, the same way the audio
 * targets are - "NOTE VEL", not "Note Velocity" - so the two lists read alike and each
 * entry matches the label on the page it points at.
 *
 * The order is the device's and the values are not consecutive within it: the ARP
 * targets are listed before the LFO ones but stored after them.
 */
const MIDI_TARGETS: { value: number; label: string }[] = [
  ...['NOTE', 'VEL', 'LEN', 'NOT2', 'NOT3', 'NOT4']
    .map((name, i) => ({ value: i, label: `NOTE ${name}` })),
  ...['TRAN', 'LEG', 'MODE', 'SPD', 'RNGE', 'NLEN']
    .map((name, i) => ({ value: 12 + i, label: `ARP ${name}` })),
  ...[1, 2, 3].map((n, i) => ({ value: 6 + i, label: `LFO${n} SPD` })),
  ...[1, 2, 3].map((n, i) => ({ value: 9 + i, label: `LFO${n} DEP` })),
  { value: 18, label: 'CTRL1 PB' },
  { value: 19, label: 'CTRL1 AT' },
  ...[1, 2, 3, 4].map((n, i) => ({ value: 20 + i, label: `CTRL1 CC${n}` })),
  ...[5, 6, 7, 8, 9, 10].map((n, i) => ({ value: 24 + i, label: `CTRL2 CC${n}` })),
];

const MIDI_TARGET: FieldSpec = {
  min: 0, max: 29, default: 0, widget: 'selector', options: MIDI_TARGETS,
};

/** [ArpMode], [ArpRange], [ArpKey] - the arpeggiator's named settings. */
const ARP_MODES = ['OFF', 'TRUE', 'UP', 'DOWN', 'CYCL', 'SHFL', 'RND'];
const ARP_RANGES = ['1 OCT', '2 OCT', '3 OCT', '4 OCT', '5 OCT', '6 OCT', '7 OCT', '8 OCT'];
const ARP_KEYS = [
  'Off',
  ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    .flatMap(note => [`${note} MAJ`, `${note} MIN`]),
];

/** The sixteen MIDI channels, stored from zero and shown from one. */
const MIDI_CHANNELS = Array.from({ length: 16 }, (_, i) => String(i + 1));

/** Which inputs the recorder samples - the same five choices a Thru machine has. */
const RECORD_SOURCES = ['-', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'MAIN', 'CUE'];
/** How sampling is started and stopped. */
const RECORD_TRIGS = ['ONE', 'ONE2', 'HOLD'];
/** Recording and playback quantisation, which keeps 255 for OFF. */
const RECORD_QUANTS: { value: number; label: string }[] = [
  { value: 255, label: 'OFF' },
  { value: 0, label: 'PLEN' },
  ...[1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]
    .map((steps, i) => ({ value: i + 1, label: String(steps) })),
];

/**
 * An audio track's recorder buffer, the device's two RECORDING SETUP pages.
 *
 * RLEN counts sequencer steps up to 64 and then reads MAX, so its top setting is one
 * past the lengths rather than the longest of them. QREC and QPL keep 255 for OFF,
 * which sits outside their ordinary range - hence their own option lists.
 */
const RECORDER: Record<string, FieldSpec> = {
  'recorders.in_ab': SELECT(1, INPUTS_AB),
  'recorders.in_cd': SELECT(1, INPUTS_CD),
  'recorders.rlen': {
    min: 0, max: 64, default: 64, widget: 'unipolar', display: 'times',
    options: [{ value: 64, label: 'MAX' }],
  },
  'recorders.trig': SELECT(0, RECORD_TRIGS),
  'recorders.src3': SELECT(0, RECORD_SOURCES),
  'recorders.xloop': TOGGLE(1, ['OFF', 'ON']),
  // The fades count sequencer steps, in sixteenths below the first whole one
  'recorders.fin': { min: 0, max: 112, default: 0, widget: 'unipolar', table: RECORD_FADE },
  'recorders.fout': { min: 0, max: 112, default: 0, widget: 'unipolar', table: RECORD_FADE },
  'recorders.ab': U(0, 127, 0),
  'recorders.cd': U(0, 127, 0),
  'recorders.qrec': { min: 0, max: 255, default: 255, widget: 'selector', options: RECORD_QUANTS },
  'recorders.qpl': { min: 0, max: 255, default: 255, widget: 'selector', options: RECORD_QUANTS },
};

/**
 * A MIDI track's own fields, keyed by the page they sit on: NOTE and ARP both have a
 * LEN, and they are not the same parameter.
 *
 * Ranges are the device's lists where it has one, checked against every bank of the
 * projects to hand (354 of them) for the fields that have no list.
 */
const MIDI: Record<string, FieldSpec> = {
  // The note itself, shown the way a keyboard names it
  'midi_notes.note': { min: 0, max: 127, default: 48, widget: 'unipolar', display: 'note' },
  'midi_notes.vel': U(0, 127, 100),
  'midi_notes.len': U(0, 127, 6),
  // The three extra notes are offsets from the first
  'midi_notes.not2': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },
  'midi_notes.not3': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },
  'midi_notes.not4': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },
  'midi_notes.chan': SELECT(0, MIDI_CHANNELS),
  // Bank, Program and Sub Bank each carry one past the top of the byte for "off",
  // which is where a track that sends none of them rests
  'midi_notes.bank': { min: 0, max: 128, default: 128, widget: 'unipolar', options: [{ value: 128, label: 'Off' }] },
  'midi_notes.prog': { min: 0, max: 128, default: 128, widget: 'unipolar', options: [{ value: 128, label: 'Off' }] },
  'midi_notes.sbnk': { min: 0, max: 128, default: 128, widget: 'unipolar', options: [{ value: 128, label: 'Off' }] },

  'midi_arps.tran': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },
  'midi_arps.leg': TOGGLE(0, ['OFF', 'ON']),
  'midi_arps.mode': SELECT(0, ARP_MODES),
  // Ninety-six speeds, shown as the multiple they are
  'midi_arps.spd': { min: 0, max: 95, default: 5, widget: 'unipolar', display: 'times' },
  'midi_arps.rnge': SELECT(0, ARP_RANGES),
  'midi_arps.nlen': U(0, 127, 6),
  'midi_arps.len': SELECT(7, Array.from({ length: 16 }, (_, i) => String(i + 1))),
  'midi_arps.key': SELECT(0, ARP_KEYS),

  'midi_ctrl1s.pb': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },
  'midi_ctrl1s.at': U(0, 127, 0),

  // A MIDI track's LFOs modulate its own parameters, not an audio track's
  'midi_lfos.lfo1_pmtr': MIDI_TARGET,
  'midi_lfos.lfo2_pmtr': MIDI_TARGET,
  'midi_lfos.lfo3_pmtr': MIDI_TARGET,
};

// The CC values and the CC numbers behind them, which are plain MIDI ranges
for (const [section, numbers] of [
  ['midi_ctrl1s', [1, 2, 3, 4]],
  ['midi_ctrl2s', [5, 6, 7, 8, 9, 10]],
] as const) {
  for (const n of numbers) {
    MIDI[`${section}.cc${n}`] = U(0, 127, 0);
    MIDI[`${section}.cc${n}_num`] = U(0, 127, 0);
  }
}

/** AMP, LFO and the other pages, which every audio machine shares. */
const SHARED: Record<string, FieldSpec> = {
  'atk': U(0, 127, 0),
  'hold': { min: 0, max: 127, default: 127, widget: 'unipolar', table: AMP_HOLD },
  'rel': U(0, 127, 127),
  'vol': { min: 0, max: 127, default: 64, widget: 'bipolar', center: 64, display: 'offset' },
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
 * What a track's six SRC parameters are called, by position, for the machine it runs.
 *
 * Used where a parameter is shown without the Parts editor's own layout around it -
 * a step's parameter locks, for one. A machine that does not use a position gets null
 * there, so nothing is drawn for a byte the device never sets. A Pickup machine's
 * parameters cannot be locked at all (manual A.5), but its names are here anyway for
 * anywhere else they are shown.
 */
export function machineParamLabels(machineType?: string, short = false): (string | null)[] {
  const pick = (pairs: ([string, string] | null)[]) =>
    pairs.map(p => (p === null ? null : short ? p[0] : `${p[0]} (${p[1]})`));
  switch (machineType) {
    case 'Static':
    case 'Flex':
      return pick([['PTCH', 'Pitch'], ['STRT', 'Start'], ['LEN', 'Length'],
        ['RATE', 'Rate'], ['RTRG', 'Retrigs'], ['RTIM', 'Retrig Time']]);
    case 'Thru':
      return pick([['INAB', 'Input AB'], ['VOL', 'Volume AB'], null,
        ['INCD', 'Input CD'], ['VOL', 'Volume CD'], null]);
    case 'Neighbor':
      return [null, null, null, null, null, null];
    case 'Pickup':
      return pick([['PTCH', 'Pitch'], ['DIR', 'Direction'], ['LEN', 'Length'], null,
        ['GAIN', 'Gain'], ['OP', 'Recording behaviour']]);
    default:
      // An unknown machine still shows its locks rather than hiding them
      return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  }
}

/**
 * The spec key behind each SRC position, matching `machineParamLabels` position for
 * position - including its gaps, so the two can never drift apart.
 *
 * Needed wherever a value is shown by position rather than through the Parts editor's
 * own layout: a scene records six SRC bytes and says nothing about what they are.
 */
export function machineParamFields(machineType?: string): (string | null)[] {
  const key = (name: string | null) => (name === null ? null : `machine_params.${name}`);
  switch (machineType) {
    case 'Static':
    case 'Flex':
      return ['ptch', 'strt', 'len', 'rate', 'rtrg', 'rtim'].map(key);
    case 'Thru':
      return ['in_ab', 'vol_ab', null, 'in_cd', 'vol_cd', null].map(key);
    case 'Neighbor':
      return [null, null, null, null, null, null];
    case 'Pickup':
      return ['ptch', 'dir', 'len', null, 'gain', 'op'].map(key);
    default:
      return [null, null, null, null, null, null];
  }
}

/**
 * What a track's six SRC SETUP parameters are called, by position.
 *
 * A Pickup machine uses only the last two of the six - the device leaves the whole top
 * row and the first of the bottom row blank (manual A.5) - and Thru and Neighbor
 * machines have no setup page at all.
 */
export function machineSetupLabels(machineType?: string): (string | null)[] {
  switch (machineType) {
    case 'Static':
    case 'Flex':
      return ['LOOP', 'SLIC', 'LEN', 'RATE', 'TSTR', 'TSNS'];
    case 'Pickup':
      return [null, null, null, null, 'TSTR', 'TSNS'];
    default:
      return [null, null, null, null, null, null];
  }
}

/** The spec key behind each SRC SETUP position, matching `machineSetupLabels`. */
export function machineSetupFields(machineType?: string): (string | null)[] {
  const key = (name: string | null) => (name === null ? null : `machine_setup.${name}`);
  switch (machineType) {
    case 'Static':
    case 'Flex':
      return ['xloop', 'slic', 'len', 'rate', 'tstr', 'tsns'].map(key);
    case 'Pickup':
      return [null, null, null, null, 'tstr', 'tsns'].map(key);
    default:
      return [null, null, null, null, null, null];
  }
}

/**
 * XVOL, the AMP page's sixth position.
 *
 * The device only shows it while a scene key is held, so a scene is the only place it
 * can be set and the Parts editor has no knob for it - which is why it is here rather
 * than among the AMP fields.
 *
 * It holds one of two settings, not a level: MIN mutes the signal before the track
 * effects, MAX lets it through at the LEVEL already set. The byte is 0 or 127 and
 * nothing between, which is why those two are the only legal values rather than just
 * the two with names on them.
 */
export const SCENE_XVOL_SPEC: FieldSpec = {
  min: 0,
  max: 127,
  default: 0,
  widget: 'unipolar',
  options: [{ value: 0, label: 'MIN' }, { value: 127, label: 'MAX' }],
  table: { 0: 'MIN', 127: 'MAX' },
};

/**
 * The level a scene sets for a track under the crossfader, as an overlay on LEVEL.
 *
 * The same two settings as XVOL, and the same two bytes - the difference is where they
 * act: XLV mutes after the track effects, XVOL before them. Checked against the device:
 * across every bank of the real projects to hand, this byte is only ever 0, 127, or the
 * 255 that means the scene does not touch it.
 */
export const SCENE_XLV_SPEC: FieldSpec = {
  min: 0,
  max: 127,
  default: 0,
  widget: 'unipolar',
  options: [{ value: 0, label: 'MIN' }, { value: 127, label: 'MAX' }],
  table: { 0: 'MIN', 127: 'MAX' },
};

/**
 * A track's Track and Cue levels, which the device keeps per Part rather than per page.
 *
 * Both are plain levels, and the stored byte is the number shown - measured from the
 * device's own min and max preset projects, where Bank A / Part 1 / Track 4 reads 0 at
 * one end and 127 at the other for both. A factory bank comes up at 108.
 */
export const TRACK_LEVEL_SPEC: FieldSpec = {
  min: 0,
  max: 127,
  default: 108,
  widget: 'unipolar',
};

/** The AMP page by position. The sixth is the one only a scene can set. */
export const AMP_PARAM_FIELDS = ['atk', 'hold', 'rel', 'vol', 'bal', 'xvol'] as const;

/** The LFO MAIN page by position, which is the three speeds then the three depths. */
export const LFO_PARAM_FIELDS = ['spd1', 'spd2', 'spd3', 'dep1', 'dep2', 'dep3'] as const;

/**
 * What an LFO can modulate, named the way the device names it: the parameter page it
 * belongs to, then the parameter itself.
 *
 * The first six depend on the machine the track runs - an LFO pointed at the second
 * SRC parameter modulates STRT on a Flex machine and the AB volume on a Thru one - so
 * the list is built for the track rather than being fixed.
 *
 * The picker order is not the storage order: the AMP targets are listed before the
 * LFO ones but stored above them, so each entry carries the value it writes.
 */
export function lfoTargetOptions(
  machineType?: string,
  fx1Type?: number,
  fx2Type?: number,
): { value: number; label: string }[] {
  // An effect target names that effect's own parameter - the device shows the effect
  // and the parameter, so "MIX" on a plate reverb rather than a slot number
  const fxNames = (slot: 'FX1' | 'FX2', type?: number) => {
    const effect = fxShortName(type, slot);
    return [0, 1, 2, 3, 4, 5].map(i => {
      const name = type === undefined ? null : getFxMainLabels(type)[i];
      // The device names a slot the effect does not use after the slot itself,
      // which is what <B> and the rest mean on its own display
      return `${effect} ${name || `<${String.fromCharCode(65 + i)}>`}`;
    });
  };
  // A track whose machine is not known yet falls back to numbered parameters rather
  // than borrowing another machine's names
  const known = ['Static', 'Flex', 'Thru', 'Neighbor', 'Pickup'].includes(machineType ?? '');
  const src = known ? machineParamLabels(machineType, true) : [];
  return [
    ...[0, 1, 2, 3, 4, 5].map(i => ({
      value: i, label: `SRC ${src[i] ?? `P0${i + 1}`}`,
    })),
    ...['ATK', 'HOLD', 'REL', 'VOL', 'BAL', 'XVOL']
      .map((name, i) => ({ value: 12 + i, label: `AMP ${name}` })),
    ...[1, 2, 3].map((n, i) => ({ value: 6 + i, label: `LFO${n} SPD` })),
    ...[1, 2, 3].map((n, i) => ({ value: 9 + i, label: `LFO${n} DEP` })),
    ...fxNames('FX1', fx1Type).map((label, i) => ({ value: 18 + i, label })),
    ...fxNames('FX2', fx2Type).map((label, i) => ({ value: 24 + i, label })),
  ];
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
  ctx?: { slic?: number | null; fx1Type?: number; fx2Type?: number },
): FieldSpec | null {
  if (!isDeviceField(field)) return null;
  const midi = MIDI[field] ?? RECORDER[field];
  if (midi) return midi;
  // An LFO's target names the parameters of the machine the track runs
  if (/^lfo[123]_pmtr$/.test(field)) {
    return { ...TARGET, options: lfoTargetOptions(machineType, ctx?.fx1Type, ctx?.fx2Type) };
  }
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
/**
 * Whether the device can actually hold this raw value.
 *
 * Most fields run straight through their range. A few are sparse: RTIM offers 120 times
 * over the byte's 128 values, and the eight it leaves out are ones the device's own
 * encoder steps over rather than settings it can be left on.
 */
function isLegal(raw: number, spec: FieldSpec): boolean {
  if (raw < spec.min || raw > spec.max) return false;
  if (!spec.table) return true;
  return (spec.table as Record<number, string>)[raw] !== undefined;
}

export function clampToSpec(value: number, spec: FieldSpec): number {
  if (!Number.isFinite(value)) return spec.default;
  const bounded = Math.min(spec.max, Math.max(spec.min, Math.round(value)));
  if (isLegal(bounded, spec)) return bounded;
  // Landed in a gap, so take the nearest value the device does use. Looking both ways
  // rather than only downwards: a value nudged into a gap belongs at whichever edge of
  // it that is closer, which is what dragging a knob across one should feel like.
  for (let away = 1; away <= spec.max - spec.min; away++) {
    if (isLegal(bounded - away, spec)) return bounded - away;
    if (isLegal(bounded + away, spec)) return bounded + away;
  }
  return spec.default;
}

/**
 * The value one step away, which is not always the next number.
 *
 * Stepping over a sparse field's gaps rather than stopping in one: a wheel notch moves
 * to the next setting the device has, the same as turning its encoder. Returns the
 * value unchanged at either end of the range.
 */
export function stepInSpec(value: number, by: 1 | -1, spec: FieldSpec): number {
  for (let next = value + by; next >= spec.min && next <= spec.max; next += by) {
    if (isLegal(next, spec)) return next;
  }
  return value;
}

/**
 * How the value reads. A bipolar field shows its distance from centre with a sign,
 * which is what the device shows and what makes "0" mean "no change".
 */
export function formatSpecValue(value: number, spec: FieldSpec): string {
  const option = spec.options?.find(o => o.value === value);
  if (option) return option.label;
  const tabled = spec.table?.[value as keyof typeof spec.table];
  if (typeof tabled === 'string') return tabled;
  // Pitch is stored five steps to the semitone, and reads in semitones
  if (spec.display === 'semitones' && spec.center !== undefined) {
    return ((value - spec.center) / 5).toFixed(1);
  }
  if (spec.display === 'offset' && spec.center !== undefined) {
    return String(value - spec.center);
  }
  if (spec.display === 'note') return noteName(value);
  if (spec.display === 'times') return `x${value + 1}`;
  if (spec.display === 'plusOne') return String(value + 1);
  const fromTable = spec.table?.[value as keyof typeof spec.table];
  if (typeof fromTable === 'string') return fromTable;
  return String(value);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI note number as a keyboard names it: 0 is C-1, 60 is C4. */
export function noteName(value: number): string {
  return `${NOTE_NAMES[value % 12]}${Math.floor(value / 12) - 1}`;
}

/** Turns what a human typed back into the raw byte, for a field that reads differently. */
export function parseSpecValue(text: string, spec: FieldSpec): number | null {
  // A value the device shows by name reads back by that name, so what is on screen can
  // be typed straight back in - otherwise MIN and MAX would be unsettable by hand
  const named = text.trim().toUpperCase();
  if (named) {
    const option = spec.options?.find(o => o.label.toUpperCase() === named);
    if (option) return option.value;
    const entries = Array.isArray(spec.table)
      ? spec.table.map((label, value) => [value, label] as const)
      : Object.entries(spec.table ?? {}).map(([v, label]) => [Number(v), label] as const);
    const hit = entries.find(([, label]) => label.toUpperCase() === named);
    if (hit) return hit[0];
  }
  // A multiplier reads back the way it is shown, with or without its leading x
  const n = parseFloat(spec.display === 'times' ? text.replace(/^\s*x/i, '') : text);
  if (!Number.isFinite(n)) return null;
  if (spec.display === 'semitones' && spec.center !== undefined) {
    return Math.round(spec.center + n * 5);
  }
  if (spec.display === 'offset' && spec.center !== undefined) {
    return Math.round(spec.center + n);
  }
  if (spec.display === 'times') return Math.round(n) - 1;
  return Math.round(n);
}
