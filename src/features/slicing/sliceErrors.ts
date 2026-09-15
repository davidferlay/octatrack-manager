import type { TranslateFn } from "../../i18n";

const KNOWN_SLICE_ERROR_CODES = [
  "ANALYSIS_REGION_MISMATCH",
  "ANALYSIS_BUSY",
  "ANALYSIS_CANCELLED",
  "ANALYSIS_NOT_FOUND",
  "DRAFT_CONFLICT",
  "SOURCE_CHANGED",
  "AUDIO_LIMIT_EXCEEDED",
  "INVALID_SLICE_REQUEST",
  "REQUEST_SUPERSEDED",
] as const;

type KnownSliceErrorCode = (typeof KNOWN_SLICE_ERROR_CODES)[number];

function isKnownCode(code: string): code is KnownSliceErrorCode {
  return (KNOWN_SLICE_ERROR_CODES as readonly string[]).includes(code);
}

export function sliceErrorMessage(t: TranslateFn, error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (isKnownCode(code)) {
      return t(`slicing.error.${code}` as Parameters<TranslateFn>[0]);
    }
  }
  const detail =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : error instanceof Error
        ? error.message
        : String(error);
  return t("slicing.error.genericDetail", { detail });
}
