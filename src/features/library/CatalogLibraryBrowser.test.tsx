import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AudioApi, LibrarySnapshot, MetadataApi } from "../../api";
import { CatalogLibraryBrowser } from "./CatalogLibraryBrowser";

const snapshot: LibrarySnapshot = {
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
  standaloneProjects: [{
    displayName: "STANDALONE",
    relativePath: "STANDALONE",
    hasProjectFile: true,
    hasBanks: false,
  }],
  audioFiles: [
    {
      fileInstanceId: "fileinst:v1:pool",
      assetId: "asset:v1:pool",
      displayName: "POOL.wav",
      relativePath: "LIVE_SET/AUDIO/POOL.wav",
      byteSize: 2048,
      storageScope: "set_audio_pool",
    },
    {
      fileInstanceId: "fileinst:v1:project",
      assetId: "asset:v1:project",
      displayName: "PROJECT.wav",
      relativePath: "LIVE_SET/PROJECT_A/PROJECT.wav",
      byteSize: 4096,
      storageScope: "project_local",
    },
    {
      fileInstanceId: "fileinst:v1:standalone",
      assetId: "asset:v1:standalone",
      displayName: "STANDALONE.wav",
      relativePath: "STANDALONE/STANDALONE.wav",
      byteSize: 512,
      storageScope: "project_local",
    },
  ],
};

describe("CatalogLibraryBrowser", () => {
  it("browses Set Audio Pool and Project-local files without absolute paths", () => {
    render(<CatalogLibraryBrowser rootId="root-opaque" snapshot={snapshot} />);

    const poolFiles = screen.getByLabelText("Audio files");
    expect(within(poolFiles).getByText("POOL.wav")).toBeInTheDocument();
    expect(within(poolFiles).queryByText("PROJECT.wav")).not.toBeInTheDocument();
    expect(screen.queryByText("Project workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Audio library")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Audio Pool" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PROJECT_A/ }));
    const projectFiles = screen.getByLabelText("Audio files");
    expect(within(projectFiles).getByText("PROJECT.wav")).toBeInTheDocument();
    expect(within(projectFiles).queryByText("POOL.wav")).not.toBeInTheDocument();
    expect(projectFiles).not.toHaveTextContent("/private/");
    expect(screen.getByRole("heading", { name: "PROJECT_A" })).toBeInTheDocument();
    expect(screen.getByText("Project workspace")).toBeInTheDocument();
    expect(screen.getByText("1 local sample")).toBeInTheDocument();
    expect(screen.queryByText("Audio library")).not.toBeInTheDocument();
  });

  it("keeps standalone Projects in a separate source", () => {
    render(<CatalogLibraryBrowser rootId="root-opaque" snapshot={snapshot} />);

    fireEvent.click(
      within(screen.getByLabelText("Sources")).getByRole("button", { name: /Standalone/ }),
    );

    expect(
      within(screen.getByLabelText("Locations")).getByRole("button", { name: /STANDALONE/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Audio files")).toHaveTextContent("STANDALONE.wav");
  });

  it("orders root-relative paths deterministically without locale collation", () => {
    const { container } = render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{
          ...snapshot,
          audioFiles: [
            {
              ...snapshot.audioFiles[0],
              fileInstanceId: "fileinst:v1:lower",
              displayName: "a.wav",
              relativePath: "LIVE_SET/AUDIO/a.wav",
            },
            {
              ...snapshot.audioFiles[0],
              fileInstanceId: "fileinst:v1:upper",
              displayName: "Z.wav",
              relativePath: "LIVE_SET/AUDIO/Z.wav",
            },
          ],
        }}
      />,
    );

    expect(
      Array.from(container.querySelectorAll(".catalog-library-file strong"))
        .map((element) => element.textContent),
    ).toEqual(["Z.wav", "a.wav"]);
  });

  it("reports an empty catalog explicitly", () => {
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ sets: [], standaloneProjects: [], audioFiles: [] }}
      />,
    );

    expect(screen.getByText("No catalog entries are available.")).toBeInTheDocument();
  });

  it("clears the selected file when switching locations", async () => {
    const audioClient: AudioApi = {
      getWaveform: vi.fn().mockResolvedValue({
        analyzerVersion: "waveform:v1",
        sampleRate: 44100,
        channels: 2,
        frameCount: 44100,
        durationSeconds: 1,
        samplesPerPeak: 256,
        peaks: [{ min: -0.5, max: 0.5 }],
      }),
      createPreviewToken: vi.fn(),
      readPreview: vi.fn(),
    };
    const metadataClient: MetadataApi = {
      loadManualAssetMetadata: vi.fn().mockResolvedValue({
        tags: ["kick"],
        note: "Live set",
      }),
      replaceManualAssetMetadata: vi.fn(),
    };
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={snapshot}
        audioClient={audioClient}
        metadataClient={metadataClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /POOL\.wav/ }));
    expect(await screen.findByDisplayValue("kick")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PROJECT_A/ }));
    expect(screen.queryByDisplayValue("kick")).not.toBeInTheDocument();
    expect(screen.getByText("Select an audio file to edit local metadata.")).toBeInTheDocument();
    expect(screen.getByText("Project workspace")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Sources")).getByRole("button", { name: /LIVE_SET/ })).toBeInTheDocument();
  });

  it("opens manual metadata for the selected opaque AssetId", async () => {
    const audioClient: AudioApi = {
      getWaveform: vi.fn().mockResolvedValue({
        analyzerVersion: "waveform:v1",
        sampleRate: 44100,
        channels: 2,
        frameCount: 44100,
        durationSeconds: 1,
        samplesPerPeak: 256,
        peaks: [{ min: -0.5, max: 0.5 }],
      }),
      createPreviewToken: vi.fn(),
      readPreview: vi.fn(),
    };
    const metadataClient: MetadataApi = {
      loadManualAssetMetadata: vi.fn().mockResolvedValue({
        tags: ["kick"],
        note: "Live set",
      }),
      replaceManualAssetMetadata: vi.fn(),
    };
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={snapshot}
        audioClient={audioClient}
        metadataClient={metadataClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /POOL\.wav/ }));

    expect(await screen.findByDisplayValue("kick")).toBeInTheDocument();
    expect(metadataClient.loadManualAssetMetadata).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:pool",
    );
    expect(audioClient.getWaveform).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:pool",
      640,
    );
    expect(screen.getByLabelText("Asset inspector")).not.toHaveTextContent("sha256:");
  });
});
