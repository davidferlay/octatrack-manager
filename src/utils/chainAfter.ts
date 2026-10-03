/**
 * CHAIN AFTER - how long a pattern plays before a cued one takes over.
 *
 * The stored byte is not the number of steps. The device offers a fixed list of
 * settings, and only the first few happen to line up with their own value: setting 8
 * is sixteen steps, not eight, and the list tops out at 256 steps. Printing the raw
 * number would therefore understate every setting past the fourth.
 *
 * The device counts in sixteenth notes, which is what the "n/16" labels mean.
 */
const CHAIN_AFTER_LABELS: Record<number, string> = {
  0: 'PLEN',
  2: '2/16',
  3: '3/16',
  4: '4/16',
  5: '6/16',
  6: '8/16',
  7: '12/16',
  8: '16/16',
  9: '24/16',
  10: '32/16',
  11: '48/16',
  12: '64/16',
  13: '96/16',
  14: '128/16',
  15: '192/16',
  16: '256/16',
};

/**
 * The CHAIN AFTER setting as the device shows it. A value the device does not offer
 * (there is no setting 1) falls back to its number rather than being hidden.
 */
export function formatChainAfter(value: number): string {
  return CHAIN_AFTER_LABELS[value] ?? String(value);
}

/** How many sixteenth steps a setting chains after, or null for PLEN and the unknown. */
export function chainAfterSteps(value: number): number | null {
  const label = CHAIN_AFTER_LABELS[value];
  if (!label || label === 'PLEN') return null;
  return parseInt(label, 10);
}
