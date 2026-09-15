import type { AudioFrameRange } from "../../api";
import { frame } from "./frameMath";

export type ViewportRange = AudioFrameRange;

export function fullFileViewport(fileFrameCount: string): ViewportRange {
  const total = frame(fileFrameCount);
  if (total <= 0n) {
    return { startFrame: "0", endFrameExclusive: "0" };
  }
  return { startFrame: "0", endFrameExclusive: total.toString() };
}

export function viewportLength(viewport: ViewportRange): bigint {
  const start = frame(viewport.startFrame);
  const end = frame(viewport.endFrameExclusive);
  return end > start ? end - start : 0n;
}

export function clampViewportToFile(
  desiredWidth: bigint,
  center: bigint,
  fileFrameCount: string,
): ViewportRange {
  const lo = 0n;
  const hi = frame(fileFrameCount);
  if (hi <= lo) {
    return { startFrame: "0", endFrameExclusive: "0" };
  }
  let size = desiredWidth < 1n ? 1n : desiredWidth;
  if (size > hi - lo) {
    size = hi - lo;
  }
  let start = center - size / 2n;
  if (start < lo) {
    start = lo;
  }
  if (start + size > hi) {
    start = hi - size;
  }
  return { startFrame: start.toString(), endFrameExclusive: (start + size).toString() };
}

export function zoomViewport(
  viewport: ViewportRange,
  fileFrameCount: string,
  zoomIn: boolean,
): ViewportRange {
  const length = viewportLength(viewport);
  if (length <= 0n) {
    return fullFileViewport(fileFrameCount);
  }
  const center = frame(viewport.startFrame) + length / 2n;
  const nextWidth = zoomIn ? length / 2n : length * 2n;
  return clampViewportToFile(nextWidth, center, fileFrameCount);
}

export function panViewport(
  viewport: ViewportRange,
  fileFrameCount: string,
  direction: -1 | 1,
): ViewportRange {
  const length = viewportLength(viewport);
  if (length <= 0n) {
    return fullFileViewport(fileFrameCount);
  }
  const step = length / 4n || 1n;
  const center = frame(viewport.startFrame) + length / 2n + BigInt(direction) * step;
  return clampViewportToFile(length, center, fileFrameCount);
}

export function viewportAroundRange(
  selection: ViewportRange,
  fileFrameCount: string,
): ViewportRange {
  const selStart = frame(selection.startFrame);
  const selEnd = frame(selection.endFrameExclusive);
  if (selEnd <= selStart) {
    return fullFileViewport(fileFrameCount);
  }
  const center = selStart + (selEnd - selStart) / 2n;
  const width = selEnd - selStart;
  return clampViewportToFile(width, center, fileFrameCount);
}

export function frameRangesEqual(a: ViewportRange, b: ViewportRange): boolean {
  return a.startFrame === b.startFrame && a.endFrameExclusive === b.endFrameExclusive;
}

export function waveformQueryKey(
  rootId: string,
  assetId: string,
  viewport: ViewportRange,
  targetPoints: number,
): string {
  return `${rootId}\0${assetId}\0${viewport.startFrame}\0${viewport.endFrameExclusive}\0${targetPoints}`;
}

export function positionInViewport(value: string, viewport: ViewportRange): number {
  const start = frame(viewport.startFrame);
  const end = frame(viewport.endFrameExclusive);
  const size = end - start;
  if (size <= 0n) {
    return 0;
  }
  return Number(frame(value) - start) / Number(size);
}

export function selectionRectInViewBox(
  selection: ViewportRange,
  viewport: ViewportRange,
  viewBoxWidth: number,
): { x: number; width: number } | null {
  const viewStart = frame(viewport.startFrame);
  const viewEnd = frame(viewport.endFrameExclusive);
  const viewSize = viewEnd - viewStart;
  if (viewSize <= 0n || viewBoxWidth <= 0) {
    return null;
  }
  const selStart = frame(selection.startFrame);
  const selEnd = frame(selection.endFrameExclusive);
  const start = selStart > viewStart ? selStart : viewStart;
  const end = selEnd < viewEnd ? selEnd : viewEnd;
  if (end <= start) {
    return null;
  }
  const x = (Number(start - viewStart) / Number(viewSize)) * viewBoxWidth;
  const width = (Number(end - start) / Number(viewSize)) * viewBoxWidth;
  return { x, width };
}

function clampPixel(value: number, widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= widthPx) {
    return widthPx;
  }
  return value;
}

/**
 * Map drag endpoints in plot CSS pixels to an absolute half-open frame range within a fixed viewport.
 */
export function framesFromDragPixels(
  viewport: ViewportRange,
  widthPx: number,
  x0: number,
  x1: number,
): ViewportRange | null {
  const widthInt = Math.floor(widthPx);
  if (widthInt <= 0) {
    return null;
  }
  const leftPx = Math.floor(clampPixel(Math.min(x0, x1), widthInt));
  const rightPx = Math.ceil(clampPixel(Math.max(x0, x1), widthInt));
  if (rightPx <= leftPx) {
    return null;
  }

  const viewStart = frame(viewport.startFrame);
  const viewEnd = frame(viewport.endFrameExclusive);
  const size = viewEnd - viewStart;
  if (size <= 0n) {
    return null;
  }

  const widthBig = BigInt(widthInt);
  const startOffset = (size * BigInt(leftPx)) / widthBig;
  let endOffset = (size * BigInt(rightPx) + widthBig - 1n) / widthBig;
  if (endOffset > size) {
    endOffset = size;
  }
  if (endOffset <= startOffset) {
    return null;
  }

  return {
    startFrame: (viewStart + startOffset).toString(),
    endFrameExclusive: (viewStart + endOffset).toString(),
  };
}
