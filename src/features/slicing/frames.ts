import type { SlicePreview, SliceRange } from "../../api/slices";

export function frame(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Enter a whole PCM frame number.");
  const parsed = BigInt(value);
  if (parsed > 18446744073709551615n) throw new Error("Frame number is too large.");
  return parsed;
}
export function inRange(value: string, range: SliceRange): boolean {
  return frame(value) >= frame(range.startFrame) && frame(value) < frame(range.endExclusive);
}
/** Map a viewport X coordinate into [0, 1] along the drawn SVG content (meet letterboxing). */
export function pointerRatioInMeetSvg(
  clientX: number,
  svg: SVGSVGElement,
  viewBoxWidth: number,
  viewBoxHeight: number,
): number | null {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null;
  const scale = Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight);
  const drawnWidth = scale * viewBoxWidth;
  if (drawnWidth <= 0) return null;
  const offsetX = (rect.width - drawnWidth) / 2;
  const x = clientX - rect.left - offsetX;
  return Math.min(1, Math.max(0, x / drawnWidth));
}

export function frameAt(ratio: number, range: SliceRange): string {
  const start = frame(range.startFrame);
  const size = frame(range.endExclusive) - start;
  const offset = size * BigInt(Math.round(Math.max(0, Math.min(1, ratio)) * 1_000_000)) / 1_000_000n;
  return (start + (offset >= size ? size - 1n : offset)).toString();
}
export function position(value: string, range: SliceRange): number {
  // Only the bounded viewport-relative difference enters floating-point space.
  return Number(frame(value) - frame(range.startFrame)) / Number(frame(range.endExclusive) - frame(range.startFrame));
}
export function previewChannels(ticket: SlicePreview, bytes: ArrayBuffer | number[]): Float32Array[] {
  const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
  const count = frame(ticket.frameCount);
  if (![44100, 48000].includes(ticket.sampleRate) || ![1, 2].includes(ticket.channels)
    || count === 0n || count > BigInt(ticket.sampleRate * 30)
    || buffer.byteLength !== ticket.byteLength || buffer.byteLength > 16 * 1024 * 1024
    || BigInt(buffer.byteLength) !== count * BigInt(ticket.channels * 4)) {
    throw new Error("Preview response failed validation.");
  }
  const view = new DataView(buffer);
  const channels = Array.from({ length: ticket.channels }, () => new Float32Array(Number(count)));
  for (let n = 0; n < Number(count); n++) {
    for (let ch = 0; ch < ticket.channels; ch++) {
      const value = view.getFloat32((n * ticket.channels + ch) * 4, true);
      if (!Number.isFinite(value)) throw new Error("Preview contains invalid PCM.");
      channels[ch][n] = value;
    }
  }
  return channels;
}
