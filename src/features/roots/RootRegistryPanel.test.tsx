import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AudioApi, ChangeApi, MetadataApi, RenameApi, RootApi, RootSession } from "../../api";
import { RootRegistryPanel } from "./RootRegistryPanel";
import { renameOperatorApiStubs } from "../../test/renameApiStubs";

const session: RootSession = {
  rootId: "root-opaque",
  displayName: "Fixture Root",
  deviceFingerprint: "0123456789abcdef",
  mode: "read_only",
  observedRevision: 1,
  expiresInSeconds: 3600,
  capabilities: {
    read: true,
    write: false,
    stableDeviceIdentity: true,
  },
};

function fakeApi(): RootApi {
  return {
    registerRoot: vi.fn().mockResolvedValue(session),
    rootStatus: vi.fn().mockResolvedValue(session),
    enableWrite: vi.fn().mockResolvedValue({
      ...session,
      mode: "write_enabled",
      writeGrantExpiresInSeconds: 600,
      capabilities: { ...session.capabilities, write: true },
    }),
    disableWrite: vi.fn().mockResolvedValue(session),
    closeRoot: vi.fn().mockResolvedValue(undefined),
    listLibrary: vi.fn().mockResolvedValue({
      sets: [{
        displayName: "LIVE_SET",
        relativePath: "LIVE_SET",
        hasAudioPool: true,
        projects: [{
          displayName: "PROJECT_A",
          relativePath: "LIVE_SET/PROJECT_A",
          hasProjectFile: true,
          hasBanks: true,
        }],
      }],
      standaloneProjects: [],
      audioFiles: [{
        fileInstanceId: "fileinst:v1:opaque",
        assetId: "asset:v1:opaque",
        displayName: "KICK.wav",
        relativePath: "LIVE_SET/AUDIO/KICK.wav",
        byteSize: 2048,
        storageScope: "set_audio_pool",
      }],
      usageEdges: [{
        bankDocumentRelativePath: "LIVE_SET/PROJECT_A/bank01.work",
        projectDocumentRelativePath: "LIVE_SET/PROJECT_A/project.work",
        slotKind: "static",
        slotNumber: 1,
        usageKind: "machine",
        trackIndex: 0,
        partIndex: 0,
        patternIndex: null,
        stepIndex: null,
        audible: true,
        referencedFileRelativePath: "LIVE_SET/AUDIO/KICK.wav",
        referenceStatus: "resolved",
      }],
    }),
  };
}

function fakeRenameApi(): RenameApi {
  return {
    plan: vi.fn(),
    getPlan: vi.fn(),
    authorize: vi.fn(),
    createBackup: vi.fn(),
    prepare: vi.fn(),
    getStatus: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue({
      schema: "rename-recovery-status:v1",
      recoveryRequired: false,
      operations: [],
    }),
    ...renameOperatorApiStubs(),
  };
}

function fakeChangeApi(): ChangeApi {
  return {
    planAdditiveCopy: vi.fn(),
    getPlan: vi.fn(),
    applyChange: vi.fn(),
    changeStatus: vi.fn(),
    recoverChange: vi.fn(),
    recoveryStatus: vi.fn().mockResolvedValue({
      schema: "change-recovery-status:v1",
      recoveryRequired: false,
      operations: [],
    }),
  };
}

describe("RootRegistryPanel", () => {
  it("does nothing when the native picker is cancelled", async () => {
    const api = fakeApi();
    const selectDirectory = vi.fn().mockResolvedValue(null);
    render(<RootRegistryPanel api={api} changeClient={fakeChangeApi()} renameClient={fakeRenameApi()} selectDirectory={selectDirectory} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    await waitFor(() => expect(selectDirectory).toHaveBeenCalledOnce());
    expect(api.registerRoot).not.toHaveBeenCalled();
    expect(api.listLibrary).not.toHaveBeenCalled();
  });

  it("reports a native picker failure without registering a root", async () => {
    const api = fakeApi();
    const selectDirectory = vi.fn().mockRejectedValue(new Error("picker unavailable"));
    render(<RootRegistryPanel api={api} changeClient={fakeChangeApi()} renameClient={fakeRenameApi()} selectDirectory={selectDirectory} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    expect(await screen.findByRole("alert")).toHaveTextContent("picker unavailable");
    expect(api.registerRoot).not.toHaveBeenCalled();
  });

  it("renders only backend-approved display names and relative paths", async () => {
    const api = fakeApi();
    const rawPath = "/private/tmp/secret-fixture-root";
    render(
      <RootRegistryPanel
        api={api}
        changeClient={fakeChangeApi()} renameClient={fakeRenameApi()}
        selectDirectory={vi.fn().mockResolvedValue(rawPath)}
      />,
    );

    expect(screen.getByText("READ ONLY")).toHaveClass("root-mode-badge");

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    expect(await screen.findByText("PROJECT_A")).toBeInTheDocument();
    expect(screen.getByText("KICK.wav")).toBeInTheDocument();
    expect(screen.getByText("LIVE_SET/AUDIO/KICK.wav")).toBeInTheDocument();
    expect(screen.getByLabelText("Inspector")).toBeInTheDocument();
    expect(screen.getByText("Notes & details")).toBeInTheDocument();
    expect(screen.queryByLabelText("Asset inspector")).not.toBeInTheDocument();
    expect(screen.queryByText(rawPath)).not.toBeInTheDocument();
    expect(api.registerRoot).toHaveBeenCalledWith(rawPath);
    expect(api.listLibrary).toHaveBeenCalledWith("root-opaque");
  });

  it("loads shell Inspector waveform and metadata for the selected asset", async () => {
    const api = fakeApi();
    const audioClient: AudioApi = {
      getWaveform: vi.fn().mockResolvedValue({
        durationSeconds: 1,
        sampleRate: 44100,
        channels: 1,
        peaks: [{ min: -0.2, max: 0.4 }],
      }),
      createPreviewToken: vi.fn(),
      readPreview: vi.fn(),
    };
    const metadataClient: MetadataApi = {
      loadManualAssetMetadata: vi.fn().mockResolvedValue({
        tags: ["kick"],
        note: "Shell note",
      }),
      replaceManualAssetMetadata: vi.fn(),
    };

    render(
      <RootRegistryPanel
        api={api}
        changeClient={fakeChangeApi()} renameClient={fakeRenameApi()}
        audioClient={audioClient}
        metadataClient={metadataClient}
        selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));
    expect(await screen.findByText("KICK.wav")).toBeInTheDocument();

    const inspector = screen.getByLabelText("Inspector");
    expect(inspector).toHaveTextContent("Select an audio file to inspect");

    fireEvent.click(screen.getByRole("button", { name: /KICK\.wav/ }));

    expect(await screen.findByDisplayValue("kick")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Shell note")).toBeInTheDocument();
    expect(inspector).toHaveTextContent("KICK.wav");
    expect(inspector).toHaveTextContent("LIVE_SET/AUDIO/KICK.wav");
    expect(
      screen.getByText(/PROJECT_A · Bank A \(1\) · S001 · Part 1 · T1 · Machine · Working/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Usage graph")).toBeInTheDocument();
    expect(screen.getByLabelText("Usage summary")).toHaveTextContent("1 used");
    expect(audioClient.getWaveform).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
      640,
    );
    expect(metadataClient.loadManualAssetMetadata).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
    );
  });

  it("enables only the session write grant after recovery status is clear", async () => {
    const api = fakeApi();
    const changeClient = fakeChangeApi();
    render(
      <RootRegistryPanel
        api={api}
        changeClient={changeClient}
        renameClient={fakeRenameApi()}
        selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));
    expect(await screen.findByText("PROJECT_A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findAllByText("EDIT ENABLED")).toHaveLength(2);
    expect(changeClient.recoveryStatus).toHaveBeenCalledTimes(2);
    expect(api.enableWrite).toHaveBeenCalledWith("root-opaque");

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(api.disableWrite).toHaveBeenCalledWith("root-opaque");
    expect(await screen.findAllByText("READ ONLY")).toHaveLength(2);
  });

  it("refreshes the catalog and recovery gate after an approved rollback", async () => {
    const api = fakeApi();
    const changeClient = fakeChangeApi();
    const operationId = `operation:v1:${"a".repeat(64)}`;
    const planId = `plan:v1:${"a".repeat(64)}`;
    vi.mocked(changeClient.recoveryStatus)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValue({
        schema: "change-recovery-status:v1",
        recoveryRequired: false,
        operations: [],
      });
    vi.mocked(changeClient.recoverChange).mockResolvedValue({
      schema: "change-status:v1",
      operationId,
      planId,
      state: "rolled_back",
      recoveryRequired: false,
      catalogRefreshRequired: false,
      failureCode: "RECOVERED_INCOMPLETE_OPERATION",
      backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
    });
    render(
      <RootRegistryPanel
        api={api}
        changeClient={changeClient}
        renameClient={fakeRenameApi()}
        selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));
    expect(await screen.findByText("Rollback required")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(
      "I approve rollback of this exact incomplete additive-copy operation.",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Roll back incomplete copy" }));

    await waitFor(() => expect(changeClient.recoverChange).toHaveBeenCalledWith(
      "root-opaque",
      operationId,
      operationId,
    ));
    await waitFor(() => expect(api.listLibrary).toHaveBeenCalledTimes(2));
    expect(changeClient.recoveryStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Rollback required")).not.toBeInTheDocument();
  });

  it("blocks root closure while a change request is in flight", async () => {
    const api = fakeApi();
    const changeClient = fakeChangeApi();
    const audioClient: AudioApi = {
      getWaveform: vi.fn().mockResolvedValue({
        durationSeconds: 1,
        sampleRate: 44100,
        channels: 1,
        peaks: [{ min: -0.2, max: 0.4 }],
      }),
      createPreviewToken: vi.fn(),
      readPreview: vi.fn(),
    };
    const metadataClient: MetadataApi = {
      loadManualAssetMetadata: vi.fn().mockResolvedValue({ tags: [], note: "" }),
      replaceManualAssetMetadata: vi.fn(),
    };
    vi.mocked(changeClient.planAdditiveCopy).mockImplementation(
      () => new Promise(() => undefined),
    );
    render(
      <RootRegistryPanel
        api={api}
        changeClient={changeClient}
        renameClient={fakeRenameApi()}
        audioClient={audioClient}
        metadataClient={metadataClient}
        selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));
    expect(await screen.findByText("PROJECT_A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /KICK\.wav/ }));
    const closeRoot = screen.getByRole("button", { name: "Close root" });
    fireEvent.change(screen.getByLabelText("Destination relative path"), {
      target: { value: "LIVE_SET/PROJECT_A/KICK_COPY.wav" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review plan" }));

    await waitFor(() => expect(closeRoot).toBeDisabled());
    fireEvent.click(closeRoot);
    expect(api.closeRoot).not.toHaveBeenCalled();
  });

  it("shows the rename entry point and prepared notice after recovery status loads", async () => {
    const api = fakeApi();
    const renameClient = fakeRenameApi();
    const audioClient: AudioApi = {
      getWaveform: vi.fn().mockResolvedValue({
        durationSeconds: 1,
        sampleRate: 44100,
        channels: 1,
        peaks: [{ min: -0.2, max: 0.4 }],
      }),
      createPreviewToken: vi.fn(),
      readPreview: vi.fn(),
    };
    const metadataClient: MetadataApi = {
      loadManualAssetMetadata: vi.fn().mockResolvedValue({ tags: [], note: "" }),
      replaceManualAssetMetadata: vi.fn(),
    };
    vi.mocked(renameClient.recoveryStatus).mockResolvedValue({
      schema: "rename-recovery-status:v1",
      recoveryRequired: false,
      operations: [{
        schema: "rename-status:v1",
        operationId: `operation:v1:${"a".repeat(64)}`,
        planId: null,
        state: "prepared",
        backupSnapshotId: `snapshot:v1:${"a".repeat(64)}`,
        failureCode: null,
        planExpired: true,
        recoveryEligible: false,
      }],
    });
    render(
      <RootRegistryPanel
        api={api}
        changeClient={fakeChangeApi()}
        renameClient={renameClient}
        audioClient={audioClient}
        metadataClient={metadataClient}
        selectDirectory={vi.fn().mockResolvedValue("/tmp/fixture-root")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));
    expect(await screen.findByText("PROJECT_A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /KICK\.wav/ }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByText(/A prepared rename operation exists/i)).toBeInTheDocument();
    expect(renameClient.recoveryStatus).toHaveBeenCalled();
  });
});
