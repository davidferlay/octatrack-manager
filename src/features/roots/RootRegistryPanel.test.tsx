import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AudioApi, MetadataApi, RootApi, RootSession } from "../../api";
import { RootRegistryPanel } from "./RootRegistryPanel";

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

describe("RootRegistryPanel", () => {
  it("does nothing when the native picker is cancelled", async () => {
    const api = fakeApi();
    const selectDirectory = vi.fn().mockResolvedValue(null);
    render(<RootRegistryPanel api={api} selectDirectory={selectDirectory} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose root..." }));

    await waitFor(() => expect(selectDirectory).toHaveBeenCalledOnce());
    expect(api.registerRoot).not.toHaveBeenCalled();
    expect(api.listLibrary).not.toHaveBeenCalled();
  });

  it("reports a native picker failure without registering a root", async () => {
    const api = fakeApi();
    const selectDirectory = vi.fn().mockRejectedValue(new Error("picker unavailable"));
    render(<RootRegistryPanel api={api} selectDirectory={selectDirectory} />);

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
});
