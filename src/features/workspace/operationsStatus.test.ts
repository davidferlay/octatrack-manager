import { describe, expect, it } from "vitest";
import {
  deriveOperationsStatus,
  operationsDrawerKindForStatus,
  preparedRenameCount,
  renameHasExistingOperatorWork,
  resolveRenameDrawerPin,
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

  it("opens rename operator view for recovery without a selected sample", () => {
    expect(renameHasExistingOperatorWork({
      schema: "rename-recovery-status:v1",
      recoveryRequired: true,
      operations: [],
    })).toBe(true);

    expect(resolveRenameDrawerPin({
      renameRecovery: {
        schema: "rename-recovery-status:v1",
        recoveryRequired: true,
        operations: [],
      },
      explicitAsset: null,
      selectedAsset: null,
      writeEnabled: true,
      writeBlocked: true,
    })).toEqual({ open: true, pin: null });

    expect(resolveRenameDrawerPin({
      renameRecovery: {
        schema: "rename-recovery-status:v1",
        recoveryRequired: false,
        operations: [],
      },
      explicitAsset: {
        fileInstanceId: "a",
        assetId: "asset:a",
        displayName: "KICK.wav",
        relativePath: "A/KICK.wav",
      },
      selectedAsset: null,
      writeEnabled: true,
      writeBlocked: false,
    })).toEqual({
      open: true,
      pin: {
        fileInstanceId: "a",
        assetId: "asset:a",
        displayName: "KICK.wav",
        relativePath: "A/KICK.wav",
      },
    });

    expect(resolveRenameDrawerPin({
      renameRecovery: {
        schema: "rename-recovery-status:v1",
        recoveryRequired: false,
        operations: [],
      },
      explicitAsset: {
        fileInstanceId: "a",
        assetId: "asset:a",
        displayName: "KICK.wav",
        relativePath: "A/KICK.wav",
      },
      selectedAsset: null,
      writeEnabled: false,
      writeBlocked: false,
    })).toEqual({ open: false });
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
