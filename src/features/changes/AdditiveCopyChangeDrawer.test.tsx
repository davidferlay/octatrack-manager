import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ChangeApi,
  ChangePlan,
  ChangeRecoveryStatus,
  RootSession,
} from "../../api";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";
import { AdditiveCopyChangeDrawer } from "./AdditiveCopyChangeDrawer";

const planId = `plan:v1:${"a".repeat(64)}`;
const operationId = `operation:v1:${"a".repeat(64)}`;
const plan: ChangePlan = {
  schema: "change-plan:v1",
  planId,
  operationId,
  operation: "additive_copy",
  sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
  destinationRelativePath: "LIVE_SET/PROJECT_A/KICK_COPY.wav",
  byteSize: 2048,
  estimatedAdditionalBytes: 2048,
  backupRelativePaths: ["LIVE_SET/AUDIO/KICK.wav"],
  warnings: ["Use only cloned/test media."],
  requiresExplicitApproval: true,
  overwriteAllowed: false,
  deleteCount: 0,
};

const selectedAsset: CatalogAssetSelection = {
  fileInstanceId: `fileinst:v1:${"b".repeat(64)}`,
  assetId: `asset:v1:${"c".repeat(64)}`,
  displayName: "KICK.wav",
  relativePath: "LIVE_SET/AUDIO/KICK.wav",
};

const recoveryClear: ChangeRecoveryStatus = {
  schema: "change-recovery-status:v1",
  recoveryRequired: false,
  operations: [],
};

function session(write: boolean): RootSession {
  return {
    rootId: "root-opaque",
    displayName: "Fixture Root",
    deviceFingerprint: `rootfp:v1:${"d".repeat(64)}`,
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

function fakeApi(): ChangeApi {
  return {
    planAdditiveCopy: vi.fn().mockResolvedValue(plan),
    getPlan: vi.fn().mockResolvedValue(plan),
    applyChange: vi.fn().mockResolvedValue({
      schema: "change-status:v1",
      operationId,
      planId,
      state: "committed",
      recoveryRequired: false,
      catalogRefreshRequired: false,
      failureCode: null,
      backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
    }),
    changeStatus: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue(recoveryClear),
    recoverChange: vi.fn().mockResolvedValue({
      schema: "change-status:v1",
      operationId,
      planId,
      state: "rolled_back",
      recoveryRequired: false,
      catalogRefreshRequired: false,
      failureCode: "RECOVERED_INCOMPLETE_OPERATION",
      backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
    }),
  };
}

describe("AdditiveCopyChangeDrawer", () => {
  it("keeps Apply disabled until the exact displayed plan is explicitly approved", async () => {
    const api = fakeApi();
    const onCommitted = vi.fn();
    render(
      <AdditiveCopyChangeDrawer
        session={session(true)}
        selectedAsset={selectedAsset}
        recovery={recoveryClear}
        api={api}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onCommitted={onCommitted}
        onRecovered={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Destination relative path"), {
      target: { value: "LIVE_SET/PROJECT_A/KICK_COPY.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review plan" }));

    expect(await screen.findByLabelText("Additive copy plan")).toHaveTextContent("CREATE");
    expect(screen.getByText("LIVE_SET/PROJECT_A/KICK_COPY.wav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply approved plan" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Apply approved plan" }));

    await waitFor(() => expect(api.applyChange).toHaveBeenCalledWith(
      "root-opaque",
      planId,
      planId,
    ));
    expect(api.getPlan).toHaveBeenCalledWith("root-opaque", planId);
    expect(await screen.findByRole("status")).toHaveTextContent("Operation committed");
    expect(onCommitted).toHaveBeenCalledOnce();
  });

  it("allows plan review in read-only mode but blocks approval and apply", async () => {
    const api = fakeApi();
    render(
      <AdditiveCopyChangeDrawer
        session={session(false)}
        selectedAsset={selectedAsset}
        recovery={recoveryClear}
        api={api}
        refreshSession={vi.fn().mockResolvedValue(session(false))}
        onCommitted={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Destination relative path"), {
      target: { value: "LIVE_SET/PROJECT_A/KICK_COPY.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review plan" }));

    expect(await screen.findByText(/Enable edit mode in Sources/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply approved plan" })).toBeDisabled();
  });

  it("fails closed when recovery status is unavailable or incomplete", () => {
    const { rerender } = render(
      <AdditiveCopyChangeDrawer
        session={session(true)}
        selectedAsset={selectedAsset}
        recovery={null}
        api={fakeApi()}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onCommitted={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Write safety status is unavailable");
    expect(screen.getByRole("button", { name: "Review plan" })).toBeDisabled();

    rerender(
      <AdditiveCopyChangeDrawer
        session={session(true)}
        selectedAsset={selectedAsset}
        recovery={{
          schema: "change-recovery-status:v1",
          recoveryRequired: true,
          operations: [],
        }}
        api={fakeApi()}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onCommitted={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("incomplete operation exists");
  });

  it("revalidates the live session and rejects an expired write grant before Apply", async () => {
    const api = fakeApi();
    render(
      <AdditiveCopyChangeDrawer
        session={session(true)}
        selectedAsset={selectedAsset}
        recovery={recoveryClear}
        api={api}
        refreshSession={vi.fn().mockResolvedValue(session(false))}
        onCommitted={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Destination relative path"), {
      target: { value: "LIVE_SET/PROJECT_A/KICK_COPY.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
    await screen.findByLabelText("Additive copy plan");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Apply approved plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("write grant expired");
    expect(api.getPlan).not.toHaveBeenCalled();
    expect(api.applyChange).not.toHaveBeenCalled();
  });

  it("recovers a committed result after the Apply response is interrupted", async () => {
    const api = fakeApi();
    const committed = {
      schema: "change-status:v1" as const,
      operationId,
      planId,
      state: "committed" as const,
      recoveryRequired: false,
      catalogRefreshRequired: false,
      failureCode: null,
      backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
    };
    vi.mocked(api.applyChange).mockRejectedValue(new Error("IPC response interrupted"));
    vi.mocked(api.changeStatus).mockResolvedValue(committed);
    const onCommitted = vi.fn();
    const onRecoveryChange = vi.fn();
    render(
      <AdditiveCopyChangeDrawer
        session={session(true)}
        selectedAsset={selectedAsset}
        recovery={recoveryClear}
        api={api}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onCommitted={onCommitted}
        onRecovered={vi.fn()}
        onRecoveryChange={onRecoveryChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Destination relative path"), {
      target: { value: "LIVE_SET/PROJECT_A/KICK_COPY.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
    await screen.findByLabelText("Additive copy plan");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Apply approved plan" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Operation committed");
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onRecoveryChange).toHaveBeenCalledWith(recoveryClear);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Apply approved plan" })).toBeDisabled();
    expect(screen.getByText(/Apply response was interrupted/)).toBeInTheDocument();
  });

  it("locks the drawer and reports recovery when an attempted Apply needs recovery", async () => {
    const api = fakeApi();
    const recoveryRequired = {
      schema: "change-recovery-status:v1" as const,
      recoveryRequired: true,
      operations: [{
        schema: "change-status:v1" as const,
        operationId,
        planId,
        state: "recovery_required" as const,
        recoveryRequired: true,
        catalogRefreshRequired: true,
        failureCode: "ROLLBACK_DESTINATION_CHANGED",
        backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
      }],
    };
    vi.mocked(api.applyChange).mockRejectedValue(new Error("recovery required"));
    vi.mocked(api.changeStatus).mockResolvedValue(recoveryRequired.operations[0]);
    vi.mocked(api.recoveryStatus).mockResolvedValue(recoveryRequired);
    const onRecoveryChange = vi.fn();
    render(
      <AdditiveCopyChangeDrawer
        session={session(true)}
        selectedAsset={selectedAsset}
        recovery={recoveryClear}
        api={api}
        refreshSession={vi.fn().mockResolvedValue(session(true))}
        onCommitted={vi.fn()}
        onRecovered={vi.fn()}
        onRecoveryChange={onRecoveryChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Destination relative path"), {
      target: { value: "LIVE_SET/PROJECT_A/KICK_COPY.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
    await screen.findByLabelText("Additive copy plan");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Apply approved plan" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Operation recovery required");
    expect(screen.getByText("RECOVERY REQUIRED")).toBeInTheDocument();
    expect(screen.getByText(/incomplete operation exists/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review plan" })).toBeDisabled();
    expect(onRecoveryChange).toHaveBeenCalledWith(recoveryRequired);
  });

  it("requires exact one-shot approval before rolling back an incomplete operation", async () => {
    const api = fakeApi();
    const recoveryRequired: ChangeRecoveryStatus = {
      schema: "change-recovery-status:v1",
      recoveryRequired: true,
      operations: [{
        schema: "change-status:v1",
        operationId,
        planId,
        state: "recovery_required",
        recoveryRequired: true,
        catalogRefreshRequired: true,
        failureCode: "SIMULATED_PROCESS_EXIT",
        backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
      }],
    };
    const refreshSession = vi.fn().mockResolvedValue(session(false));
    const onRecovered = vi.fn();
    render(
      <AdditiveCopyChangeDrawer
        session={session(false)}
        selectedAsset={selectedAsset}
        recovery={recoveryRequired}
        api={api}
        refreshSession={refreshSession}
        onCommitted={vi.fn()}
        onRecovered={onRecovered}
      />,
    );

    const recoverButton = screen.getByRole("button", { name: "Roll back incomplete copy" });
    expect(recoverButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(
      "I approve rollback of this exact incomplete additive-copy operation.",
    ));
    expect(recoverButton).toBeEnabled();
    fireEvent.click(recoverButton);

    await waitFor(() => expect(api.recoverChange).toHaveBeenCalledWith(
      "root-opaque",
      operationId,
      operationId,
    ));
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(onRecovered).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("Operation rolled back");
    expect(screen.getByLabelText(
      "I approve rollback of this exact incomplete additive-copy operation.",
    )).not.toBeChecked();
  });

  it("reconciles a completed rollback after the Recovery response is interrupted", async () => {
    const api = fakeApi();
    const operation = {
      schema: "change-status:v1" as const,
      operationId,
      planId,
      state: "recovery_required" as const,
      recoveryRequired: true,
      catalogRefreshRequired: true,
      failureCode: "SIMULATED_PROCESS_EXIT",
      backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
    };
    const rolledBack = {
      ...operation,
      state: "rolled_back" as const,
      recoveryRequired: false,
      failureCode: "RECOVERED_INCOMPLETE_OPERATION",
    };
    vi.mocked(api.recoverChange).mockRejectedValue(new Error("IPC response interrupted"));
    vi.mocked(api.changeStatus).mockResolvedValue(rolledBack);
    vi.mocked(api.recoveryStatus).mockResolvedValue(recoveryClear);
    const onRecovered = vi.fn();
    const onRecoveryChange = vi.fn();
    render(
      <AdditiveCopyChangeDrawer
        session={session(false)}
        selectedAsset={selectedAsset}
        recovery={{
          schema: "change-recovery-status:v1",
          recoveryRequired: true,
          operations: [operation],
        }}
        api={api}
        refreshSession={vi.fn().mockResolvedValue(session(false))}
        onCommitted={vi.fn()}
        onRecovered={onRecovered}
        onRecoveryChange={onRecoveryChange}
      />,
    );

    fireEvent.click(screen.getByLabelText(
      "I approve rollback of this exact incomplete additive-copy operation.",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Roll back incomplete copy" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Operation rolled back");
    expect(onRecovered).toHaveBeenCalledOnce();
    expect(onRecoveryChange).toHaveBeenCalledWith(recoveryClear);
    expect(screen.getByText(/Recovery response was interrupted/)).toBeInTheDocument();
  });
});
