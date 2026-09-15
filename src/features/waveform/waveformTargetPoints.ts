/** Backend contract: ot-audio MIN/MAX_TARGET_POINTS */
export const WAVEFORM_TARGET_POINTS_MIN = 32;
export const WAVEFORM_TARGET_POINTS_MAX = 4096;
export const WAVEFORM_TARGET_POINTS_STEP = 64;
export const WAVEFORM_QUERY_DEBOUNCE_MS = 150;

/**
 * Map plot CSS width to v2 query targetPoints (1 CSS px ≈ 1 peak bucket).
 * Does not multiply by devicePixelRatio — SVG scales visually in the layout box.
 */
export function targetPointsFromPlotWidthCss(widthCss: number): number | null {
  if (!Number.isFinite(widthCss) || widthCss <= 0) {
    return null;
  }
  const stepped =
    Math.round(widthCss / WAVEFORM_TARGET_POINTS_STEP) * WAVEFORM_TARGET_POINTS_STEP;
  const clamped = Math.max(
    WAVEFORM_TARGET_POINTS_MIN,
    Math.min(WAVEFORM_TARGET_POINTS_MAX, stepped),
  );
  return clamped;
}
