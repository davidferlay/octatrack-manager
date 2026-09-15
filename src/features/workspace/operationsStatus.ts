import type { ChangeRecoveryStatus, RenameRecoveryStatus } from "../../api";

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
