import { describe, expect, it } from "vitest";
import {
  deriveOperationsStatus,
  operationsDrawerKindForStatus,
  preparedRenameCount,
} from "./operationsStatus";

describe("operationsStatus", () => {
  it("detects recovery and continuation states", () => {
    expect(deriveOperationsStatus({
      connected: true,
      busy: false,
      changeBusy: false,
      recovery: { schema: "change-recovery-status:v1", recoveryRequired: false, operations: [] },
      renameRecovery: {
        schema: "rename-recovery-status:v1",
        recoveryRequired: false,
        operations: [{
          schema: "rename-status:v1",
          operationId: "operation:v1:abc",
          planId: null,
          state: "prepared",
          backupSnapshotId: "snapshot:v1:abc",
          failureCode: null,
          planExpired: false,
          recoveryEligible: false,
        }],
      },
    })).toBe("continuation");

    expect(operationsDrawerKindForStatus({
      recovery: { schema: "change-recovery-status:v1", recoveryRequired: true, operations: [] },
      renameRecovery: { schema: "rename-recovery-status:v1", recoveryRequired: false, operations: [] },
      fallback: "clone",
    })).toBe("copy");
  });

  it("counts prepared rename operations", () => {
    expect(preparedRenameCount(null)).toBe(0);
    expect(preparedRenameCount({
      schema: "rename-recovery-status:v1",
      recoveryRequired: false,
      operations: [{
        schema: "rename-status:v1",
        operationId: "operation:v1:abc",
        planId: null,
        state: "prepared",
        backupSnapshotId: "snapshot:v1:abc",
        failureCode: null,
        planExpired: false,
        recoveryEligible: false,
      }],
    })).toBe(1);
  });
});
