export function frame(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Frame value must be a canonical decimal u64 string.");
  }
  const parsed = BigInt(value);
  if (parsed > 18446744073709551615n) {
    throw new Error("Frame number is too large.");
  }
  return parsed;
}

export function durationSeconds(frameCount: string, sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return Number(frame(frameCount)) / sampleRate;
}

const MAX_SAFE_FRAME = BigInt(Number.MAX_SAFE_INTEGER);

export function frameFitsJsNumber(value: string): boolean {
  return frame(value) <= MAX_SAFE_FRAME;
}

export function durationLabelForFrame(frameCount: string, sampleRate: number): string | null {
  if (!frameFitsJsNumber(frameCount)) return null;
  const seconds = durationSeconds(frameCount, sampleRate);
  if (!Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function validateFrameRange(
  startFrame: string,
  endFrameExclusive: string,
  fileFrameCount: string,
): void {
  const start = frame(startFrame);
  const end = frame(endFrameExclusive);
  const total = frame(fileFrameCount);
  if (start >= end) {
    throw new Error("Range is empty or inverted.");
  }
  if (end > total) {
    throw new Error("Range extends beyond the file length.");
  }
}

export function positionInRange(value: string, startFrame: string, endFrameExclusive: string): number {
  const start = frame(startFrame);
  const end = frame(endFrameExclusive);
  const size = end - start;
  if (size <= 0n) return 0;
  return Number(frame(value) - start) / Number(size);
}
