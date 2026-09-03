import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ChangeApi,
  ChangeRecoveryStatus,
  CloneVerification,
  RenameApi,
  RenameContinuationStatus,
  RenamePlan,
  RenameRecoveryStatus,
  RootSession,
} from "../../api";
import { RenameOperatorPanel } from "./RenameOperatorPanel";

const planId = `plan:v1:${"a".repeat(64)}`;
const operationId = `operation:v1:${"a".repeat(64)}`;

const preparedPlan: RenamePlan = {
  schema: "rename-plan:v1",
  planId,
  operationId,
  operation: "rename_sample",
  sourceFileInstanceId: `fileinst:v1:${"d".repeat(64)}`,
  sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
  destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
  stateDocumentImpacts: [{
    relativePath: "LIVE_SET/PROJECT_A/project.work",
    role: "working",
    referenceUpdates: [],
  }],
  usageEdgeImpacts: [],
  sidecarImpacts: [],
  backupRelativePaths: ["LIVE_SET/AUDIO/KICK.wav"],
  estimatedMediaAdditionalBytes: 2048,
  estimatedLocalStagingBytes: 4096,
  referenceUpdateCount: 1,
  warnings: [],
  requiresExplicitApproval: true,
  overwriteAllowed: false,
  removesSourceOnApply: true,
};

const continuationReady: RenameContinuationStatus = {
  schema: "rename-continuation-status:v1",
  operationId,
  planId,
  state: "ready_to_continue",
  preparedSnapshotAvailable: true,
  backupVerified: true,
  cloneVerified: true,
};

const renameRecoveryPrepared: RenameRecoveryStatus = {
  schema: "rename-recovery-status:v1",
  recoveryRequired: false,
  operations: [{
    schema: "rename-status:v1",
    operationId,
    planId,
    state: "prepared",
    backupSnapshotId: `snapshot:v1:${"c".repeat(64)}`,
    failureCode: null,
    planExpired: true,
    recoveryEligible: false,
  }],
};

const changeRecoveryClear: ChangeRecoveryStatus = {
  schema: "change-recovery-status:v1",
  recoveryRequired: false,
  operations: [],
};

const cloneVerified: CloneVerification = {
  schema: "clone-verification:v1",
  cloneVerificationId: `clone-verification:v1:${"e".repeat(64)}`,
  cloneRootId: "root-opaque",
  provenance: "app_managed",
  state: "verified",
  entryCount: 12,
  expiresInSeconds: 600,
};

function session(): RootSession {
  return {
    rootId: "root-opaque",
    displayName: "Fixture Root",
    deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
    mode: "write_enabled",
    observedRevision: 1,
    expiresInSeconds: 3600,
    writeGrantExpiresInSeconds: 600,
    capabilities: { read: true, write: true, stableDeviceIdentity: true },
  };
}

function fakeRenameApi(): RenameApi {
  return {
    plan: vi.fn(),
    getPlan: vi.fn(),
    getPreparedPlan: vi.fn().mockResolvedValue(preparedPlan),
    authorize: vi.fn(),
    createBackup: vi.fn(),
    prepare: vi.fn(),
    getStatus: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue(renameRecoveryPrepared),
    continuationStatus: vi.fn().mockResolvedValue(continuationReady),
    continueOperation: vi.fn().mockResolvedValue({
      schema: "rename-continuation-authority:v1",
      operationId,
      continuationAuthorityId: `continuation-authority:v1:${"g".repeat(64)}`,
      expiresInSeconds: 120,
    }),
    apply: vi.fn().mockResolvedValue({
      schema: "rename-apply-status:v2",
      planId,
      operationId,
      snapshotId: `snapshot:v1:${"c".repeat(64)}`,
      mutationState: "committed",
      verificationState: "passed",
      verificationCode: null,
      rescanCompleted: true,
      observedFileCount: 4,
      missingReferenceCount: 0,
      invalidReferenceCount: 0,
      unresolvedReferenceCount: 0,
    }),
    verifyCommitted: vi.fn(),
    recover: vi.fn(),
    verifyRolledBack: vi.fn(),
  };
}

function fakeChangeApi(): ChangeApi {
  return {
    planAdditiveCopy: vi.fn(),
    getPlan: vi.fn(),
    applyChange: vi.fn(),
    changeStatus: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue(changeRecoveryClear),
    recoverChange: vi.fn(),
  };
}

describe("RenameOperatorPanel", () => {
  it("keeps Continue and Apply disabled until separate approvals are checked", async () => {
    const api = fakeRenameApi();
    render(
      <RenameOperatorPanel
        session={session()}
        changeRecovery={changeRecoveryClear}
        renameRecovery={renameRecoveryPrepared}
        cloneVerification={cloneVerified}
        api={api}
        changeClient={fakeChangeApi()}
        refreshSession={vi.fn().mockResolvedValue(session())}
        onApplied={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    expect(await screen.findByText("LIVE_SET/AUDIO/KICK.wav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue prepared rename" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Apply approved rename" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", {
      name: /approve continuing this exact operation/i,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Continue prepared rename" }));

    await waitFor(() => expect(api.continueOperation).toHaveBeenCalledWith(
      "root-opaque",
      operationId,
      operationId,
    ));
    expect(await screen.findByRole("button", { name: "Apply approved rename" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", {
      name: /approve applying this exact rename/i,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Apply approved rename" }));

    await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1));
  });

  it("shows committed verification failure without a recovery action", async () => {
    const api = fakeRenameApi();
    api.apply = vi.fn().mockResolvedValue({
      schema: "rename-apply-status:v2",
      planId,
      operationId,
      snapshotId: `snapshot:v1:${"c".repeat(64)}`,
      mutationState: "committed",
      verificationState: "failed",
      verificationCode: "MISSING_REFERENCE",
      rescanCompleted: true,
      observedFileCount: 4,
      missingReferenceCount: 1,
      invalidReferenceCount: 0,
      unresolvedReferenceCount: 0,
    });

    render(
      <RenameOperatorPanel
        session={session()}
        changeRecovery={changeRecoveryClear}
        renameRecovery={renameRecoveryPrepared}
        cloneVerification={cloneVerified}
        api={api}
        changeClient={fakeChangeApi()}
        refreshSession={vi.fn().mockResolvedValue(session())}
        onApplied={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", {
      name: /approve continuing this exact operation/i,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Continue prepared rename" }));
    fireEvent.click(await screen.findByRole("checkbox", {
      name: /approve applying this exact rename/i,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Apply approved rename" }));

    expect(await screen.findByText(/VERIFICATION FAILED/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run verification" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Roll back incomplete rename/i })).not.toBeInTheDocument();
  });

  it("does not persist continuation authority outside component memory", async () => {
    const api = fakeRenameApi();
    render(
      <RenameOperatorPanel
        session={session()}
        changeRecovery={changeRecoveryClear}
        renameRecovery={renameRecoveryPrepared}
        cloneVerification={cloneVerified}
        api={api}
        changeClient={fakeChangeApi()}
        refreshSession={vi.fn().mockResolvedValue(session())}
        onApplied={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", {
      name: /approve continuing this exact operation/i,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Continue prepared rename" }));
    await waitFor(() => expect(api.continueOperation).toHaveBeenCalled());

    expect(localStorage.getItem("continuationAuthorityId")).toBeNull();
    expect(sessionStorage.getItem("continuationAuthorityId")).toBeNull();
    expect(window.location.search).not.toContain("continuationAuthorityId");
  });

  it("shows prepared operations without catalog selection", async () => {
    render(
      <RenameOperatorPanel
        session={session()}
        changeRecovery={changeRecoveryClear}
        renameRecovery={renameRecoveryPrepared}
        cloneVerification={cloneVerified}
        api={fakeRenameApi()}
        changeClient={fakeChangeApi()}
        refreshSession={vi.fn().mockResolvedValue(session())}
        onApplied={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    expect(await screen.findByText("LIVE_SET/AUDIO/KICK.wav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue prepared rename" })).toBeInTheDocument();
  });

  it("blocks continue when additive recovery is required", async () => {
    render(
      <RenameOperatorPanel
        session={session()}
        changeRecovery={{
          schema: "change-recovery-status:v1",
          recoveryRequired: true,
          operations: [],
        }}
        renameRecovery={renameRecoveryPrepared}
        cloneVerification={cloneVerified}
        api={fakeRenameApi()}
        changeClient={fakeChangeApi()}
        refreshSession={vi.fn().mockResolvedValue(session())}
        onApplied={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    expect(await screen.findByText(/additive-copy operation exists/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue prepared rename" })).toBeDisabled();
  });
});
