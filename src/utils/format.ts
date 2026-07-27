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
