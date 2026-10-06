/**
 * What the device writes into an effect block's twelve parameters when an effect is
 * loaded into it.
 *
 * The Octatrack resets them: assign an effect and its parameters come up at these
 * values, whatever the block held before. This was checked on the hardware, one effect
 * at a time, photographing both pages of each.
 *
 * The numbers here are the stored bytes, not what the screen shows, and the two differ
 * in two ways:
 *
 * - A parameter the device draws with a sign reads either side of its centre, so a
 *   screen showing `+0` is a stored 64 and one showing `-19` is a stored 45.
 * - A named setting shows its name, so the byte comes from that setting's own list -
 *   a filter's Q reading BOTH is a stored 3, a spring reverb's TYPE reading 2 is a
 *   stored 1, a comb filter's PTCH reading `C 3` is a stored 26.
 *
 * `null` means "leave this byte alone": a knob position the effect does not use, which
 * the device leaves blank and never writes.
 */

export interface FxDefaults {
  /** The six MAIN parameters, by position. */
  main: (number | null)[];
  /** The six SETUP parameters, by position. */
  setup: (number | null)[];
}

const NONE: (number | null)[] = [null, null, null, null, null, null];

export const FX_DEFAULTS: Record<number, FxDefaults> = {
  // Multi mode filter. SETUP: HP 12dB, LP 12dB, ENV WDTH, HOLD off, Q BOTH, DIST off
  4: {
    main: [0, 127, 0, 64, 0, 64],
    setup: [0, 0, 1, 0, 3, 0],
  },
  // Spatializer. SETUP: PHSE L, M/S off, MG and SG centred
  5: {
    main: [127, 42, 96, 0, 127, 0],
    setup: [null, 1, null, 0, 64, 64],
  },
  // Echo freeze delay. SETUP: X off, TAPE on, DIR 127, SYNC on, LOCK off, PASS off
  8: {
    main: [48, 0, 127, 0, 127, 0],
    setup: [0, 1, 127, 1, 0, 0],
  },
  // Parametric EQ. Both bands come up as full parametric
  12: {
    main: [64, 64, 0, 64, 64, 0],
    setup: [1, null, null, 1, null, null],
  },
  // DJ style kill EQ - no setup page. The second MAIN slot is one the device leaves blank
  13: {
    main: [64, null, 64, 64, 64, 64],
    setup: NONE,
  },
  // Phaser. SETUP: NUM reads 6 stages, which is stored as 2
  16: {
    main: [64, 64, 32, 64, 90, 0],
    setup: [null, 2, null, null, null, null],
  },
  // Flanger - no setup page. FB comes up at -19, which is stored as 45
  17: {
    main: [64, 64, 32, 45, 0, 0],
    setup: NONE,
  },
  // Chorus. SETUP: TAPS reads 3, which is stored as 2
  18: {
    main: [64, 64, 13, 0, 127, 0],
    setup: [2, null, null, 127, null, null],
  },
  // Comb filter - no setup page. PTCH reads C 3 (stored 26), FB reads +32 (stored 96)
  19: {
    main: [26, 64, 127, 96, null, 0],
    setup: NONE,
  },
  // Gatebox plate reverb. SETUP: MIXF comes up as MIX rather than SEND
  20: {
    main: [24, 0, 127, 0, 127, 0],
    setup: [0, 64, 0, null, null, 0],
  },
  // Spring reverb. SETUP: TYPE reads 2, which is stored as 1
  21: {
    main: [23, null, null, 20, 127, 0],
    setup: [1, 64, null, null, null, null],
  },
  // Dark reverb. SETUP: MIXF comes up as MIX rather than SEND
  22: {
    main: [24, 0, 127, 0, 127, 0],
    setup: [0, 64, 0, null, null, 0],
  },
  // Dynamix compressor
  24: {
    main: [64, 64, 127, 0, 0, 127],
    setup: [0, null, null, null, null, null],
  },
  // Lo-fi collection. SETUP: AMPH comes up OFF, which is stored as 0
  28: {
    main: [0, null, 0, 0, 0, 0],
    setup: [null, null, 0, null, null, null],
  },
};

/**
 * The values to write when this effect is loaded, or undefined for one with no page.
 *
 * A block set to OFF keeps whatever it held: the device has nothing to show for it, so
 * there is nothing it could be said to reset the parameters to.
 */
export function fxDefaults(fxType: number): FxDefaults | undefined {
  return FX_DEFAULTS[fxType];
}
