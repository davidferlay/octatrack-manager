import type { TranslateFn } from './messages'
import { frame } from '../features/waveform/frameMath'

export type SpanDurationDisplay =
  | { kind: 'unknown' }
  | { kind: 'sub_ms' }
  | { kind: 'millis_tenths'; tenths: bigint }
  | { kind: 'whole_seconds'; seconds: bigint }
  | { kind: 'clock'; minutes: number; seconds: string }

const MAX_SAFE_FRAME = BigInt(Number.MAX_SAFE_INTEGER)

function normalizedSampleRate(sampleRate: number): number | null {
  if (!Number.isFinite(sampleRate)) return null
  const rate = Math.trunc(sampleRate)
  if (rate <= 0) return null
  return rate
}

/** Display-only span duration from frame count and sample rate (frames are canonical). */
export function spanDurationDisplay(
  spanFrames: bigint,
  sampleRate: number,
): SpanDurationDisplay {
  if (spanFrames <= 0n || spanFrames > MAX_SAFE_FRAME) {
    return { kind: 'unknown' }
  }
  const rate = normalizedSampleRate(sampleRate)
  if (rate === null) return { kind: 'unknown' }

  const wholeSeconds = spanFrames / BigInt(rate)
  if (wholeSeconds >= 60n) {
    const minutes = Number(wholeSeconds / 60n)
    const seconds = Number(wholeSeconds % 60n)
    const secondsLabel = seconds.toString().padStart(2, '0')
    return { kind: 'clock', minutes, seconds: secondsLabel }
  }
  if (wholeSeconds >= 1n) {
    return { kind: 'whole_seconds', seconds: wholeSeconds }
  }

  // Tenths of a millisecond: round(spanFrames * 10_000 / rate)
  const tenths =
    (spanFrames * 10_000n + BigInt(rate) / 2n) / BigInt(rate)
  if (tenths <= 0n) return { kind: 'sub_ms' }
  if (tenths < 10_000n) {
    if (tenths < 10n) return { kind: 'sub_ms' }
    return { kind: 'millis_tenths', tenths }
  }

  return { kind: 'whole_seconds', seconds: wholeSeconds }
}

export function formatSpanDurationLabel(
  spanFrames: bigint,
  sampleRate: number,
  t: TranslateFn,
): string {
  const display = spanDurationDisplay(spanFrames, sampleRate)
  switch (display.kind) {
    case 'unknown':
      return t('duration.unknown')
    case 'sub_ms':
      return t('duration.underOneMs')
    case 'millis_tenths': {
      const whole = display.tenths / 10n
      const frac = display.tenths % 10n
      const value = frac === 0n ? whole.toString() : `${whole}.${frac}`
      return t('duration.approxMs', { value })
    }
    case 'whole_seconds':
      return t('duration.seconds', { seconds: Number(display.seconds) })
    case 'clock':
      return t('duration.minutesSeconds', {
        minutes: display.minutes,
        seconds: display.seconds,
      })
  }
}

export function formatFrameSpanDurationLabel(
  startFrame: string,
  endFrameExclusive: string,
  sampleRate: number,
  t: TranslateFn,
): string | null {
  try {
    const span = frame(endFrameExclusive) - frame(startFrame)
    if (span <= 0n) return null
    return formatSpanDurationLabel(span, sampleRate, t)
  } catch {
    return null
  }
}

export function formatFileDurationLabel(
  frameCount: string,
  sampleRate: number,
  t: TranslateFn,
): string | null {
  try {
    const span = frame(frameCount)
    if (span <= 0n) return null
    return formatSpanDurationLabel(span, sampleRate, t)
  } catch {
    return null
  }
}
