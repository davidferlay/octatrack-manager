import type { TranslateFn } from "../i18n";

/** Matches `legacy_command_gate::LEGACY_WRITE_DISABLED` in the Rust backend. */
export const LEGACY_WRITE_DISABLED = "LEGACY_WRITE_DISABLED";

/** @deprecated Use `legacyWriteRestrictionNotice(t)` in UI. Kept for containment tests. */
export const LEGACY_WRITE_RESTRICTION_NOTICE =
  "Legacy write commands are temporarily disabled on this build. Browse, search, and authorized rename/delete/backup still work; use v2 change and rename flows for structural edits.";

export function legacyWriteRestrictionNotice(t: TranslateFn): string {
  return t("legacy.notice");
}

export function isLegacyWriteDisabledError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return text.includes(LEGACY_WRITE_DISABLED);
}

export function legacyWriteDisabledToastMessage(t: TranslateFn): string {
  return t("legacy.toast");
}

export function formatInvokeErrorForToast(
  error: unknown,
  fallback: string,
  t: TranslateFn,
): string {
  if (isLegacyWriteDisabledError(error)) {
    return legacyWriteDisabledToastMessage(t);
  }
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return t("legacy.toastWithFallback", { fallback, detail });
}
