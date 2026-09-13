/** Matches `legacy_command_gate::LEGACY_WRITE_DISABLED` in the Rust backend. */
export const LEGACY_WRITE_DISABLED = "LEGACY_WRITE_DISABLED";

export const LEGACY_WRITE_RESTRICTION_NOTICE =
  "Legacy write commands are temporarily disabled on this build. Browse, search, and authorized rename/delete/backup still work; use v2 change and rename flows for structural edits.";

export function isLegacyWriteDisabledError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return text.includes(LEGACY_WRITE_DISABLED);
}

/** User-facing toast text when a legacy write IPC returns LEGACY_WRITE_DISABLED. */
export function legacyWriteDisabledToastMessage(): string {
  return "Legacy write is disabled on this build. Use v2 change/rename flows for edits.";
}

export function formatInvokeErrorForToast(error: unknown, fallback: string): string {
  if (isLegacyWriteDisabledError(error)) {
    return legacyWriteDisabledToastMessage();
  }
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return `${fallback}: ${detail}`;
}
