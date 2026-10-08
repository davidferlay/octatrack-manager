/**
 * The effects, and what each one calls its twelve parameters.
 *
 * Position matters: the label at index n names parameter n+1, so an effect whose page
 * leaves a knob empty needs an empty entry there rather than a shorter list.
 * Compacting them would point every later knob at the wrong parameter. Each layout is
 * the one the manual's Appendix B shows.
 */

const FX_NAMES: { [key: number]: string } = {
  0: 'OFF',
  4: 'FILTER',
  5: 'SPATIALIZER',
  8: 'DELAY',
  12: 'EQ',
  13: 'DJ EQ',
  16: 'PHASER',
  17: 'FLANGER',
  18: 'CHORUS',
  19: 'COMB FILTER',
  20: 'PLATE REVERB',
  21: 'SPRING REVERB',
  22: 'DARK REVERB',
  24: 'COMPRESSOR',
  28: 'LO-FI', // B.11 LO-FI COLLECTION
};

/**
 * Every effect a slot can hold, for the picker, in the order the device's own list
 * draws them. That order is not the order of the values it stores - the spatializer is
 * eighth in the list and fifth by value - and it is the order the user guide's effects
 * appendix documents them in, B.1 to B.15.
 */
export const FX_TYPES: { value: number; label: string }[] = [
  0, 4, 12, 13, 16, 17, 18, 5, 19, 24, 28, 8, 20, 21, 22,
].map(value => ({ value, label: FX_NAMES[value] }));

/**
 * The delay and the three reverbs, which only the second effect block offers.
 *
 * Manual 11.4.10: "The selectable effects differ between the two effect pages." Its
 * FX1 list stops at the Lo-fi Collection; the FX2 list adds the Echo Freeze Delay,
 * the Gatebox Plate Reverb, the Spring Reverb and the Dark Reverb.
 */
const FX2_ONLY = new Set([8, 20, 21, 22]);

/** What the given block can be set to, in the order the device lists them. */
export function fxTypesForSlot(slot: 'fx1' | 'fx2'): { value: number; label: string }[] {
  return slot === 'fx2' ? FX_TYPES : FX_TYPES.filter(fx => !FX2_ONLY.has(fx.value));
}

export function formatFxType(value: number): string {
  return FX_NAMES[value] || `FX ${value}`;
}

/**
 * The six MAIN parameter labels of an effect, by position.
 *
 * Position matters: the label at index n names parameter n+1, so an effect whose
 * page leaves a knob empty needs an empty entry there rather than a shorter list.
 * Compacting them would point every later knob at the wrong parameter. Each layout
 * is the one the manual's Appendix B shows.
 */
export function getFxMainLabels(fxType: number): string[] {
  const mainMappings: { [key: number]: string[] } = {
    0: ['', '', '', '', '', ''], // OFF - no params
    4: ['BASE', 'WDTH', 'Q', 'DPTH', 'ATK', 'DEC'], // FILTER
    5: ['INP', 'DPTH', 'WDTH', 'HP', 'LP', 'SEND'], // SPATIALIZER
    8: ['TIME', 'FB', 'VOL', 'BASE', 'WDTH', 'SEND'], // DELAY
    12: ['FRQ1', 'GN1', 'Q1', 'FRQ2', 'GN2', 'Q2'], // EQ
    13: ['LS F', '', 'HS F', 'LOWG', 'MIDG', 'HI G'], // DJ EQ (B.4: a gap at slot 2)
    16: ['CNTR', 'DEP', 'SPD', 'FB', 'WID', 'MIX'], // PHASER
    17: ['DEL', 'DEP', 'SPD', 'FB', 'WID', 'MIX'], // FLANGER
    18: ['DEL', 'DEP', 'SPD', 'FB', 'WID', 'MIX'], // CHORUS
    19: ['PTCH', 'TUNE', 'LP', 'FB', '', 'MIX'], // COMB FILTER (B.9: a gap before MIX)
    20: ['TIME', 'DAMP', 'GATE', 'HP', 'LP', 'MIX'], // PLATE REVERB
    21: ['TIME', '', '', 'HP', 'LP', 'MIX'], // SPRING REVERB (B.14: TIME alone on the first row)
    22: ['TIME', 'SHVG', 'SHVF', 'HP', 'LP', 'MIX'], // DARK REVERB
    24: ['ATK', 'REL', 'THRS', 'RAT', 'GAIN', 'MIX'], // COMPRESSOR
    28: ['DIST', '', 'AMF', 'SRR', 'BRR', 'AMD'], // LO-FI COLLECTION (B.11: a gap at slot 2)
  }
  return mainMappings[fxType] || ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
}

export function getFxSetupLabels(fxType: number): string[] {
  // Returns array of 6 SETUP parameter labels for given FX type
  // Reference: Octatrack User Manual Appendix B (pages 122-136)
  const setupMappings: { [key: number]: string[] } = {
    0: ['', '', '', '', '', ''], // B.1 NONE - no setup params
    4: ['HP', 'LP', 'ENV', 'HOLD', 'Q', 'DIST'], // B.2 12/24DB MULTI MODE FILTER
    5: ['', 'PHSE', '', 'M/S', 'MG', 'SG'], // B.8 SPATIALIZER
    8: ['X', 'TAPE', 'DIR', 'SYNC', 'LOCK', 'PASS'], // B.12 ECHO FREEZE DELAY
    12: ['TYP1', '', '', 'TYP2', '', ''], // B.3 2-BAND PARAMETRIC EQ
    13: ['', '', '', '', '', ''], // B.4 DJ STYLE KILL EQ - no setup params
    16: ['', 'NUM', '', '', '', ''], // B.5 2-10 STAGE PHASER
    17: ['', '', '', '', '', ''], // B.6 FLANGER - no setup params
    18: ['TAPS', '', '', 'FBLP', '', ''], // B.7 2-10 TAP CHORUS
    19: ['', '', '', '', '', ''], // B.9 COMB FILTER - no setup params
    20: ['GVOL', 'BAL', 'MONO', '', '', 'MIXF'], // B.13 GATEBOX PLATE REVERB
    21: ['TYPE', 'BAL', '', '', '', ''], // B.14 SPRING REVERB
    22: ['PRE', 'BAL', 'MONO', '', '', 'MIXF'], // B.15 DARK REVERB
    24: ['RMS', '', '', '', '', ''], // B.10 DYNAMIX COMPRESSOR
    28: ['', '', 'AMPH', '', '', ''], // B.11 LO-FI COLLECTION
  }
  return setupMappings[fxType] || ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
}

/**
 * How the device abbreviates each effect, as it appears on the LFO SETUP page when an
 * LFO is pointed at one of that effect's parameters. Read off the hardware - they are
 * not derivable from the full names (PLATE REVERB is PLTE, not PLAT).
 */
const FX_SHORT_NAMES: { [key: number]: string } = {
  0: 'NONE',
  4: 'FLTR',
  5: 'SPAT',
  8: 'DEL',
  12: 'EQ',
  13: 'DJEQ',
  16: 'PHSR',
  17: 'FLNG',
  18: 'CHOR',
  19: 'COMB',
  20: 'PLTE',
  21: 'SPRG',
  22: 'DARK',
  24: 'COMP',
  28: 'LOFI',
};

/** The effect's short name, or the slot's own label when the effect is not known. */
export function fxShortName(fxType: number | undefined, fallback: string): string {
  return fxType === undefined ? fallback : (FX_SHORT_NAMES[fxType] ?? fallback);
}
