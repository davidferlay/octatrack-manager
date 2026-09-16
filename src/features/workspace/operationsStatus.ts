import type { ChangeRecoveryStatus, RenameRecoveryStatus } from "../../api";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";

export type OperationsStatusKind =
  | "idle"
  | "processing"
  | "continuation"
  | "recovery"
  | "status_unavailable";

export function preparedRenameCount(renameRecovery: RenameRecoveryStatus | null): number {
  if (renameRecovery === null) return 0;
  return renameRecovery.operations.filter((operation) => operation.state === "prepared").length;
}

/** Existing rename operator UI (recovery, prepared continuation, or status unavailable). */
export function renameHasExistingOperatorWork(renameRecovery: RenameRecoveryStatus | null): boolean {
  if (renameRecovery === null) return true;
  if (renameRecovery.recoveryRequired) return true;
  return preparedRenameCount(renameRecovery) > 0;
}

export function canStartNewRenamePlan(input: {
  writeEnabled: boolean;
  writeBlocked: boolean;
}): boolean {
  return input.writeEnabled && !input.writeBlocked;
}

export function resolveRenameDrawerPin(input: {
  renameRecovery: RenameRecoveryStatus | null;
  explicitAsset: CatalogAssetSelection | null | undefined;
  selectedAsset: CatalogAssetSelection | null;
  writeEnabled: boolean;
  writeBlocked: boolean;
}): { open: true; pin: CatalogAssetSelection | null } | { open: false } {
  const existingWork = renameHasExistingOperatorWork(input.renameRecovery);
  const candidate = input.explicitAsset ?? input.selectedAsset ?? null;
  if (candidate === null) {
    return existingWork ? { open: true, pin: null } : { open: false };
  }
  if (input.renameRecovery?.recoveryRequired === true) {
    return { open: true, pin: null };
  }
  if (!canStartNewRenamePlan({
    writeEnabled: input.writeEnabled,
    writeBlocked: input.writeBlocked,
  })) {
    return existingWork ? { open: true, pin: null } : { open: false };
  }
  return { open: true, pin: candidate };
}

export function deriveOperationsStatus(input: {
  connected: boolean;
  busy: boolean;
  changeBusy: boolean;
  recovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
}): OperationsStatusKind {
  if (!input.connected) return "idle";
  if (input.busy || input.changeBusy) return "processing";
  if (input.recovery === null || input.renameRecovery === null) return "status_unavailable";
  if (input.recovery.recoveryRequired || input.renameRecovery.recoveryRequired) {
    return "recovery";
  }
  if (preparedRenameCount(input.renameRecovery) > 0) return "continuation";
  return "idle";
}

export function operationsDrawerKindForStatus(input: {
  recovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
  fallback: "clone" | "rename" | "copy";
}): "clone" | "rename" | "copy" {
  if (input.renameRecovery?.recoveryRequired === true) return "rename";
  if (preparedRenameCount(input.renameRecovery) > 0) return "rename";
  if (input.recovery?.recoveryRequired === true) return "copy";
  return input.fallback;
}
