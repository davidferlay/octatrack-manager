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

/** Display-only time at an absolute PCM frame (Slice preview selection labels). */
export function formatPreviewFrameTimeSeconds(frameValue: string, sampleRate: number): string {
  const sec = durationSeconds(frameValue, sampleRate);
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const totalRounded = Math.round(sec * 1000) / 1000;
  if (totalRounded >= 60) {
    let minutes = Math.floor(totalRounded / 60);
    let seconds = Math.round((totalRounded - minutes * 60) * 1000) / 1000;
    if (seconds >= 60) {
      minutes += 1;
      seconds = 0;
    }
    return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
  }
  return `${totalRounded.toFixed(3)} s`;
}

/** Library preview policy, matching ot-audio `create_preview_range`. */
export const LIBRARY_PREVIEW_MAX_SECONDS = 60;
export const LIBRARY_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

export function maxLibraryPreviewFrames(sampleRate: number, channels: number): bigint {
  const rate = Math.trunc(sampleRate);
  const outputChannels = Math.min(2, Math.trunc(channels));
  if (!Number.isFinite(rate) || rate <= 0 || outputChannels <= 0) {
    return 0n;
  }
  const maxByDuration = BigInt(rate) * BigInt(LIBRARY_PREVIEW_MAX_SECONDS);
  const bytesPerFrame = BigInt(outputChannels * 2);
  const maxByBytes = BigInt(LIBRARY_PREVIEW_MAX_BYTES - 44) / bytesPerFrame;
  return maxByDuration < maxByBytes ? maxByDuration : maxByBytes;
}

export function defaultLibraryPreviewEndFrame(
  fileFrameCount: string,
  sampleRate: number,
  channels: number,
): string {
  const total = frame(fileFrameCount);
  const limit = maxLibraryPreviewFrames(sampleRate, channels);
  return (total < limit ? total : limit).toString();
}

/** Half-open PCM range within the file. Does not apply Library preview limits. */
export function validateGeometryFrameRange(
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

export function validateFrameRange(
  startFrame: string,
  endFrameExclusive: string,
  fileFrameCount: string,
  sampleRate: number,
  channels: number,
): void {
  validateGeometryFrameRange(startFrame, endFrameExclusive, fileFrameCount);
  const start = frame(startFrame);
  const end = frame(endFrameExclusive);
  if (end - start > maxLibraryPreviewFrames(sampleRate, channels)) {
    throw new Error("Range exceeds the 60 second or 32 MiB preview limit.");
  }
}

export function positionInRange(value: string, startFrame: string, endFrameExclusive: string): number {
  const start = frame(startFrame);
  const end = frame(endFrameExclusive);
  const size = end - start;
  if (size <= 0n) return 0;
  return Number(frame(value) - start) / Number(size);
}
