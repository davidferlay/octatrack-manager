import type { MessageKey } from './messages'

export type FrameRangeErrorCode =
  | 'empty_or_inverted'
  | 'beyond_file'
  | 'preview_limit'

const FRAME_RANGE_ERROR_MESSAGES: Record<FrameRangeErrorCode, string> = {
  empty_or_inverted: 'Range is empty or inverted.',
  beyond_file: 'Range extends beyond the file length.',
  preview_limit: 'Range exceeds the 60 second or 32 MiB preview limit.',
}

export function frameRangeErrorMessageKey(code: FrameRangeErrorCode): MessageKey {
  switch (code) {
    case 'empty_or_inverted':
      return 'waveform.error.rangeEmpty'
    case 'beyond_file':
      return 'waveform.error.rangeBeyondFile'
    case 'preview_limit':
      return 'waveform.error.rangePreviewLimit'
  }
}

export function classifyFrameRangeError(error: unknown): FrameRangeErrorCode | null {
  const message = error instanceof Error ? error.message : String(error)
  for (const [code, text] of Object.entries(FRAME_RANGE_ERROR_MESSAGES) as [
    FrameRangeErrorCode,
    string,
  ][]) {
    if (message === text) return code
  }
  return null
}
