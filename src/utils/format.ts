const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${i === 0 ? value : value.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`
}

// Octatrack stores these mixer levels as 0-127, centered on 64 (-64 to +63), displayed with a sign.
export function formatMixerLevel(raw: number): string {
  const value = raw - 64
  return value >= 0 ? `+${value}` : `${value}`
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Metronome pitch raw value 12 (factory default) displays as "C6" on the Octatrack.
export function formatMetronomePitch(raw: number): string {
  const octave = Math.floor(raw / 12) + 5
  return `${NOTE_NAMES[raw % 12]}${octave}`
}

/**
 * A sample slot's GAIN as the device shows it, in dB.
 *
 * The stored byte runs 0 to 96 over -24.0 dB to +24.0 dB in half-decibel steps, so
 * the resting value is 48 rather than 0. Showing the raw number makes a slot at unity
 * gain look like it is boosted.
 */
export function formatSlotGain(raw: number): string {
  const db = (raw - 48) / 2
  return db > 0 ? `+${db.toFixed(1)}` : db.toFixed(1)
}
