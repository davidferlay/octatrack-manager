import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ChangeRecoveryStatus,
  RenameApi,
  RenamePlan,
  RenameRecoveryStatus,
  RootSession,
} from "../../api";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";
import { RenameSampleModal } from "./RenameSampleModal";
import { renameOperatorApiStubs } from "../../test/renameApiStubs";

const planId = `plan:v1:${"a".repeat(64)}`;
const operationId = `operation:v1:${"a".repeat(64)}`;
const authorityId = `authority:v1:${"b".repeat(64)}`;
const snapshotId = `snapshot:v1:${"c".repeat(64)}`;

const plan: RenamePlan = {
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
    referenceUpdates: [{
      projectDocumentRelativePath: "LIVE_SET/PROJECT_A/project.work",
      slotKind: "static",
      slotNumber: 12,
      fromRelativePath: "LIVE_SET/AUDIO/KICK.wav",
      toRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
    }],
  }],
  usageEdgeImpacts: [],
  sidecarImpacts: [],
  backupRelativePaths: [
    "LIVE_SET/AUDIO/KICK.wav",
    "LIVE_SET/PROJECT_A/project.work",
  ],
  estimatedMediaAdditionalBytes: 2048,
  estimatedLocalStagingBytes: 4096,
  referenceUpdateCount: 1,
  warnings: ["Use only cloned/test media."],
  requiresExplicitApproval: true,
  overwriteAllowed: false,
  removesSourceOnApply: true,
};

const selectedAsset: CatalogAssetSelection = {
  fileInstanceId: plan.sourceFileInstanceId,
  assetId: `asset:v1:${"e".repeat(64)}`,
  displayName: "KICK.wav",
  relativePath: "LIVE_SET/AUDIO/KICK.wav",
};

const recoveryClear: ChangeRecoveryStatus = {
  schema: "change-recovery-status:v1",
  recoveryRequired: false,
  operations: [],
};

const renameRecoveryClear: RenameRecoveryStatus = {
  schema: "rename-recovery-status:v1",
  recoveryRequired: false,
  operations: [],
};

function session(write: boolean): RootSession {
  return {
    rootId: "root-opaque",
    displayName: "Fixture Root",
    deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
    mode: write ? "write_enabled" : "read_only",
    observedRevision: 1,
    expiresInSeconds: 3600,
    writeGrantExpiresInSeconds: write ? 600 : null,
    capabilities: {
      read: true,
      write,
      stableDeviceIdentity: true,
    },
  };
}

function fakeApi(): RenameApi {
  return {
    plan: vi.fn().mockResolvedValue({ outcome: "planned", plan }),
    getPlan: vi.fn().mockResolvedValue(plan),
    authorize: vi.fn().mockResolvedValue({
      schema: "rename-authority:v1",
      authorityId,
      planId,
      operationId,
      expiresInSeconds: 600,
    }),
    createBackup: vi.fn().mockResolvedValue({
      schema: "rename-backup-status:v1",
      planId,
      snapshotId,
      state: "backup_verified",
      fileCount: 2,
      totalBytes: 4096,
      verified: true,
    }),
    prepare: vi.fn().mockResolvedValue({
      schema: "rename-prepare-status:v1",
      planId,
      operationId,
      snapshotId,
      state: "prepared",
      stagedFileCount: 2,
      totalStagedBytes: 4096,
      projectRewriteCount: 1,
    }),
    getStatus: vi.fn().mockResolvedValue({
      schema: "rename-status:v1",
      operationId,
      planId,
      state: "prepared",
      backupSnapshotId: snapshotId,
      failureCode: null,
      planExpired: false,
      recoveryEligible: false,
    }),
    recoveryStatus: vi.fn().mockResolvedValue(renameRecoveryClear),
    ...renameOperatorApiStubs(),
  };
}

describe("RenameSampleModal", () => {
  it("does not authorize until Approve & Prepare is clicked", async () => {
    const api = fakeApi();
    render(
      <RenameSampleModal
        open
        session={session(true)}
        selectedAsset={selectedAsset}
        changeRecovery={recoveryClear}
        renameRecovery={renameRecoveryClear}
        api={api}
        onClose={vi.fn()}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onPrepared={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New file name"), {
      target: { value: "KICK_DEEP.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review Rename" }));

    expect(await screen.findByText("KICK_DEEP.wav")).toBeInTheDocument();
    expect(api.authorize).not.toHaveBeenCalled();
    expect(api.createBackup).not.toHaveBeenCalled();
    expect(api.prepare).not.toHaveBeenCalled();
  });

  it("runs authorize, backup, and prepare in order after approval", async () => {
    const api = fakeApi();
    const callOrder: string[] = [];
    vi.mocked(api.authorize).mockImplementation(async () => {
      callOrder.push("authorize");
      return {
        schema: "rename-authority:v1",
        authorityId,
        planId,
        operationId,
        expiresInSeconds: 600,
      };
    });
    vi.mocked(api.createBackup).mockImplementation(async () => {
      callOrder.push("backup");
      return {
        schema: "rename-backup-status:v1",
        planId,
        snapshotId,
        state: "backup_verified",
        fileCount: 2,
        totalBytes: 4096,
        verified: true,
      };
    });
    vi.mocked(api.prepare).mockImplementation(async () => {
      callOrder.push("prepare");
      return {
        schema: "rename-prepare-status:v1",
        planId,
        operationId,
        snapshotId,
        state: "prepared",
        stagedFileCount: 2,
        totalStagedBytes: 4096,
        projectRewriteCount: 1,
      };
    });

    render(
      <RenameSampleModal
        open
        session={session(true)}
        selectedAsset={selectedAsset}
        changeRecovery={recoveryClear}
        renameRecovery={renameRecoveryClear}
        api={api}
        onClose={vi.fn()}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onPrepared={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New file name"), {
      target: { value: "KICK_DEEP.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review Rename" }));
    await screen.findByRole("button", { name: "Approve & Prepare" });
    fireEvent.click(screen.getByRole("button", { name: "Approve & Prepare" }));

    await waitFor(() => expect(callOrder).toEqual(["authorize", "backup", "prepare"]));
    expect(await screen.findByText("Rename prepared")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/i })).not.toBeInTheDocument();
  });

  it("shows blocked reasons without Approve & Prepare", async () => {
    const api = fakeApi();
    vi.mocked(api.plan).mockResolvedValue({
      outcome: "blocked",
      blocked: {
        schema: "rename-blocked:v1",
        sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
        destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
        observedStateDocumentCount: 1,
        observedUsageEdgeCount: 1,
        observedSidecarCount: 0,
        referenceUpdateCount: 0,
        blockReasons: [{
          code: "DESTINATION_OCCUPIED",
          message: "destination already exists",
        }],
      },
    });

    render(
      <RenameSampleModal
        open
        session={session(true)}
        selectedAsset={selectedAsset}
        changeRecovery={recoveryClear}
        renameRecovery={renameRecoveryClear}
        api={api}
        onClose={vi.fn()}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onPrepared={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New file name"), {
      target: { value: "KICK_DEEP.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review Rename" }));

    expect(await screen.findByText("Rename blocked")).toBeInTheDocument();
    expect(screen.getByText(/already exists at the destination name/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve & Prepare" })).not.toBeInTheDocument();
  });

  it("does not call backup when authorize fails", async () => {
    const api = fakeApi();
    vi.mocked(api.authorize).mockRejectedValue({ code: "ROOT_CHANGED", message: "changed" });

    render(
      <RenameSampleModal
        open
        session={session(true)}
        selectedAsset={selectedAsset}
        changeRecovery={recoveryClear}
        renameRecovery={renameRecoveryClear}
        api={api}
        onClose={vi.fn()}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onPrepared={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("New file name"), {
      target: { value: "KICK_DEEP.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review Rename" }));
    await screen.findByRole("button", { name: "Approve & Prepare" });
    fireEvent.click(screen.getByRole("button", { name: "Approve & Prepare" }));

    await waitFor(() => expect(api.authorize).toHaveBeenCalledOnce());
    expect(api.createBackup).not.toHaveBeenCalled();
    expect(api.prepare).not.toHaveBeenCalled();
    expect(await screen.findByText(/Review the rename again/i)).toBeInTheDocument();
  });
});
