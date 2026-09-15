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

export type SliceErrorState = {
  code?: string;
  detail?: string;
};

function trimDetail(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Normalize IPC / local failures for locale-independent state. */
export function normalizeSliceError(error: unknown): SliceErrorState {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    const message =
      "message" in error && (error as { message?: unknown }).message != null
        ? String((error as { message: unknown }).message)
        : undefined;
    return { code, detail: trimDetail(message) };
  }
  if (error instanceof Error) {
    return { detail: trimDetail(error.message) };
  }
  if (typeof error === "string") {
    return { detail: trimDetail(error) };
  }
  return { detail: trimDetail(String(error)) };
}

export function shouldShowDiagnosticDetail(state: SliceErrorState): boolean {
  if (!state.detail) return false;
  if (state.code === "INVALID_SLICE_REQUEST") return true;
  if (!state.code || !isKnownCode(state.code)) return true;
  return false;
}

export function sliceErrorSummary(t: TranslateFn, state: SliceErrorState): string {
  if (state.code && isKnownCode(state.code)) {
    return t(`slicing.error.${state.code}` as Parameters<TranslateFn>[0]);
  }
  if (shouldShowDiagnosticDetail(state)) {
    return t("slicing.error.generic");
  }
  if (state.detail) {
    return t("slicing.error.genericDetail", { detail: state.detail });
  }
  return t("slicing.error.generic");
}

/** @deprecated Use normalizeSliceError + sliceErrorSummary at render time. */
export function sliceErrorMessage(t: TranslateFn, error: unknown): string {
  return sliceErrorSummary(t, normalizeSliceError(error));
}
