/**
 * Formats a track ID (0-15) into a display name (T1-T8)
 *
 * Audio tracks: 0-7 → T1-T8
 * MIDI tracks: 8-15 → T1-T8
 *
 * @param trackId - The track ID (0-15)
 * @returns The formatted track name (e.g., "T1", "T8")
 */
export function formatTrackName(trackId: number): string {
  const displayNumber = trackId >= 8 ? trackId - 7 : trackId + 1;
  return `T${displayNumber}`;
}

/**
 * Gets the display number for a track ID (1-8)
 *
 * @param trackId - The track ID (0-15)
 * @returns The display number (1-8)
 */
export function getTrackDisplayNumber(trackId: number): number {
  return trackId >= 8 ? trackId - 7 : trackId + 1;
}
