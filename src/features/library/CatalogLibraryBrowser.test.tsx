import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AudioApi, LibrarySnapshot, MetadataApi } from "../../api";
import { tJa } from "../../i18n/testStrings";
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
  usageEdges: [],
};

describe("CatalogLibraryBrowser", () => {
  it("browses Set Audio Pool and Project-local files without absolute paths", () => {
    render(<CatalogLibraryBrowser rootId="root-opaque" snapshot={snapshot} />);

    const poolFiles = screen.getByLabelText(tJa("library.audioFilesAria"));
    expect(within(poolFiles).getByText("POOL.wav")).toBeInTheDocument();
    expect(within(poolFiles).queryByText("PROJECT.wav")).not.toBeInTheDocument();
    expect(screen.queryByText("Project workspace")).not.toBeInTheDocument();
    expect(screen.getByText(tJa("audioLibrary.kicker"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: tJa("audioLibrary.poolTitle") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PROJECT_A/ }));
    const projectFiles = screen.getByLabelText(tJa("library.audioFilesAria"));
    expect(within(projectFiles).getByText("PROJECT.wav")).toBeInTheDocument();
    expect(within(projectFiles).queryByText("POOL.wav")).not.toBeInTheDocument();
    expect(projectFiles).not.toHaveTextContent("/private/");
    expect(screen.getByRole("heading", { name: "PROJECT_A" })).toBeInTheDocument();
    expect(screen.getByText(tJa("projectWorkspace.kicker"))).toBeInTheDocument();
    expect(screen.getByText(tJa("projectWorkspace.localSamples", { count: 1 }))).toBeInTheDocument();
    expect(screen.queryByText(tJa("audioLibrary.kicker"))).not.toBeInTheDocument();
  });

  it("keeps standalone Projects in a separate source", () => {
    render(<CatalogLibraryBrowser rootId="root-opaque" snapshot={snapshot} />);

    fireEvent.click(
      within(screen.getByLabelText(tJa("library.sourcesAria"))).getByRole("button", { name: /スタンドアロン/ }),
    );

    expect(
      within(screen.getByLabelText(tJa("library.locationsAria"))).getByRole("button", { name: /STANDALONE/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(tJa("library.audioFilesAria"))).toHaveTextContent("STANDALONE.wav");
  });

  it("orders files by display name when paths would sort differently", () => {
    const { container } = render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{
          ...snapshot,
          audioFiles: [
            {
              ...snapshot.audioFiles[0],
              fileInstanceId: "fileinst:v1:shallow",
              displayName: "beta.wav",
              relativePath: "LIVE_SET/AUDIO/beta.wav",
            },
            {
              ...snapshot.audioFiles[0],
              fileInstanceId: "fileinst:v1:deep",
              displayName: "alpha.wav",
              relativePath: "LIVE_SET/omega/alpha.wav",
            },
          ],
        }}
      />,
    );

    expect(
      Array.from(container.querySelectorAll(".catalog-library-file strong"))
        .map((element) => element.textContent),
    ).toEqual(["alpha.wav", "beta.wav"]);
  });

  it("reports an empty catalog explicitly", () => {
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ sets: [], standaloneProjects: [], audioFiles: [], usageEdges: [] }}
      />,
    );

    expect(screen.getByText(tJa("library.noCatalogEntries"))).toBeInTheDocument();
  });

  it("clears the selected file when switching locations", async () => {
    const audioClient: AudioApi = {
      getWaveform: vi.fn(),
      queryWaveform: vi.fn().mockResolvedValue({
        analyzerVersion: "waveform:v2",
        sampleRate: 44100,
        channels: 2,
        frameCount: "44100",
        range: { startFrame: "0", endFrameExclusive: "44100" },
        framesPerPeak: "256",
        channelPeaks: [[{ min: -0.5, max: 0.5 }]],
      }),
      createPreviewToken: vi.fn(),
      createRangePreviewToken: vi.fn(),
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
    expect(screen.getByText(tJa("library.selectFileForMetadata"))).toBeInTheDocument();
    expect(screen.getByText(tJa("projectWorkspace.kicker"))).toBeInTheDocument();
    expect(within(screen.getByLabelText(tJa("library.sourcesAria"))).getByRole("button", { name: /LIVE_SET/ })).toBeInTheDocument();
  });

  it("opens manual metadata for the selected opaque AssetId", async () => {
    const audioClient: AudioApi = {
      getWaveform: vi.fn(),
      queryWaveform: vi.fn().mockResolvedValue({
        analyzerVersion: "waveform:v2",
        sampleRate: 44100,
        channels: 2,
        frameCount: "44100",
        range: { startFrame: "0", endFrameExclusive: "44100" },
        framesPerPeak: "256",
        channelPeaks: [[{ min: -0.5, max: 0.5 }]],
      }),
      createPreviewToken: vi.fn(),
      createRangePreviewToken: vi.fn(),
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
    expect(screen.getByLabelText(tJa("usage.aria"))).toBeInTheDocument();
    expect(metadataClient.loadManualAssetMetadata).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:pool",
    );
    await waitFor(() => expect(audioClient.queryWaveform).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:pool",
      { range: null, targetPoints: 640 },
    ));
    expect(screen.getByLabelText(tJa("library.assetInspectorAria"))).not.toHaveTextContent("sha256:");
  });

  it("steps pagination from the clamped page after the snapshot shrinks", () => {
    const largeSnapshot = (count: number) => ({
      ...snapshot,
      audioFiles: Array.from({ length: count }, (_, index) => {
        const label = `sample-${String(index).padStart(3, "0")}.wav`;
        return {
          fileInstanceId: `fileinst:v1:${index}`,
          assetId: `asset:v1:${index}`,
          displayName: label,
          relativePath: `LIVE_SET/AUDIO/${label}`,
          byteSize: index,
          storageScope: "set_audio_pool" as const,
        };
      }),
    });

    const { rerender } = render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={largeSnapshot(201)}
        inspectorPlacement="shell"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 3, last: 3 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sample-200\.wav/ })).toBeInTheDocument();

    rerender(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={largeSnapshot(101)}
        inspectorPlacement="shell"
      />,
    );
    expect(screen.getByText(tJa("library.paginationPage", { current: 2, last: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sample-100\.wav/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationPrevious") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 1, last: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sample-000\.wav/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 2, last: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sample-100\.wav/ })).toBeInTheDocument();
  });

  it("resets to the first page when search shrinks a later page to 101–200 files", () => {
    const files = Array.from({ length: 250 }, (_, index) => ({
      fileInstanceId: `fileinst:v1:${index}`,
      assetId: `asset:v1:${index}`,
      displayName: index < 150 ? `keep-${String(index).padStart(3, "0")}.wav` : `drop-${index}.wav`,
      relativePath: `LIVE_SET/AUDIO/file-${String(index).padStart(3, "0")}.wav`,
      byteSize: index,
      storageScope: "set_audio_pool" as const,
    }));
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ ...snapshot, audioFiles: files }}
        inspectorPlacement="shell"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 3, last: 3 }))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(tJa("library.searchAria")), {
      target: { value: "keep-" },
    });
    expect(screen.getByText(tJa("library.paginationPage", { current: 1, last: 2 }))).toBeInTheDocument();
    expect(screen.getByText(tJa("library.fileCountSearch", { matching: 150, total: 250 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keep-000\.wav/ })).toBeInTheDocument();
  });

  it("resets to the first page when switching to another location with 101–200 files", () => {
    const files = [
      ...Array.from({ length: 201 }, (_, index) => ({
        fileInstanceId: `fileinst:pool:${index}`,
        assetId: `asset:pool:${index}`,
        displayName: `pool-${String(index).padStart(3, "0")}.wav`,
        relativePath: `LIVE_SET/AUDIO/pool-${String(index).padStart(3, "0")}.wav`,
        byteSize: index,
        storageScope: "set_audio_pool" as const,
      })),
      ...Array.from({ length: 150 }, (_, index) => ({
        fileInstanceId: `fileinst:project:${index}`,
        assetId: `asset:project:${index}`,
        displayName: `project-${String(index).padStart(3, "0")}.wav`,
        relativePath: `LIVE_SET/PROJECT_A/project-${String(index).padStart(3, "0")}.wav`,
        byteSize: index,
        storageScope: "project_local" as const,
      })),
    ];
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ ...snapshot, audioFiles: files }}
        inspectorPlacement="shell"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 3, last: 3 }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PROJECT_A/ }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 1, last: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /project-000\.wav/ })).toBeInTheDocument();
  });

  it("resets to the first page when sort changes on a later page", () => {
    const files = Array.from({ length: 201 }, (_, index) => ({
      fileInstanceId: `fileinst:v1:${index}`,
      assetId: `asset:v1:${index}`,
      displayName: `sample-${String(index).padStart(3, "0")}.wav`,
      relativePath: `LIVE_SET/AUDIO/sample-${String(index).padStart(3, "0")}.wav`,
      byteSize: index,
      storageScope: "set_audio_pool" as const,
    }));
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ ...snapshot, audioFiles: files }}
        inspectorPlacement="shell"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 3, last: 3 }))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(tJa("library.sortAria")), {
      target: { value: "size" },
    });
    expect(screen.getByText(tJa("library.paginationPage", { current: 1, last: 3 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sample-200\.wav/ })).toBeInTheDocument();
  });

  it("filters, paginates, and keeps selection when the file stays in the location", () => {
    const files = Array.from({ length: 101 }, (_, index) => ({
      fileInstanceId: `fileinst:v1:${index}`,
      assetId: `asset:v1:${index}`,
      displayName: `sample-${index}.wav`,
      relativePath: `LIVE_SET/AUDIO/sample-${index}.wav`,
      byteSize: index,
      storageScope: "set_audio_pool" as const,
    }));
    const onSelectedAssetChange = vi.fn();
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ ...snapshot, audioFiles: files }}
        inspectorPlacement="shell"
        onSelectedAssetChange={onSelectedAssetChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sample-0\.wav/ }));
    expect(onSelectedAssetChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileInstanceId: "fileinst:v1:0" }),
    );

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 2, last: 2 }))).toBeInTheDocument();
    expect(onSelectedAssetChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileInstanceId: "fileinst:v1:0" }),
    );

    fireEvent.change(screen.getByLabelText(tJa("library.searchAria")), {
      target: { value: "sample-99" },
    });
    expect(
      screen.getByText(tJa("library.fileCountSearch", { matching: 1, total: 101 })),
    ).toBeInTheDocument();
    expect(onSelectedAssetChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileInstanceId: "fileinst:v1:0" }),
    );
  });

  it("keeps querying the selected asset when pagination hides the row", async () => {
    const audioClient: AudioApi = {
      getWaveform: vi.fn(),
      queryWaveform: vi.fn().mockResolvedValue({
        analyzerVersion: "waveform:v2",
        sampleRate: 44100,
        channels: 1,
        frameCount: "44100",
        range: { startFrame: "0", endFrameExclusive: "44100" },
        framesPerPeak: "256",
        channelPeaks: [[{ min: -0.5, max: 0.5 }]],
      }),
      createPreviewToken: vi.fn(),
      createRangePreviewToken: vi.fn().mockResolvedValue({
        previewToken: "preview:v1:range",
        expiresInSeconds: 120,
        mimeType: "audio/wav",
        byteLength: 4,
        durationMillis: 500,
        truncated: false,
        sampleRate: 44100,
        range: { startFrame: "0", endFrameExclusive: "44100" },
      }),
      readPreview: vi.fn().mockResolvedValue(new Uint8Array([82, 73, 70, 70]).buffer),
    };
    const metadataClient: MetadataApi = {
      loadManualAssetMetadata: vi.fn().mockResolvedValue({ tags: [], note: "" }),
      replaceManualAssetMetadata: vi.fn(),
    };
    const files = Array.from({ length: 101 }, (_, index) => ({
      fileInstanceId: `fileinst:v1:${index}`,
      assetId: `asset:v1:${index}`,
      displayName: `sample-${index}.wav`,
      relativePath: `LIVE_SET/AUDIO/sample-${index}.wav`,
      byteSize: index,
      storageScope: "set_audio_pool" as const,
    }));
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={{ ...snapshot, audioFiles: files }}
        audioClient={audioClient}
        metadataClient={metadataClient}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sample-0\.wav/ }));
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    await waitFor(() => expect(screen.getByLabelText(tJa("waveform.endFrame"))).toHaveValue("44100"));
    vi.mocked(audioClient.queryWaveform).mockClear();

    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    await waitFor(() => expect(audioClient.createRangePreviewToken).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:0",
      expect.objectContaining({ startFrame: "0" }),
    ));
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.stop") }));

    fireEvent.click(screen.getByRole("button", { name: tJa("library.paginationNext") }));
    expect(screen.getByText(tJa("library.paginationPage", { current: 2, last: 2 }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sample-0\.wav/ })).not.toBeInTheDocument();
    expect(audioClient.queryWaveform).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: tJa("waveform.plotAria") })).toBeInTheDocument();

    vi.mocked(audioClient.createRangePreviewToken).mockClear();
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    await waitFor(() => expect(audioClient.createRangePreviewToken).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:0",
      expect.any(Object),
    ));
  });

  it("reports shell inspector selection without rendering the inline column", () => {
    const onSelectedAssetChange = vi.fn();
    render(
      <CatalogLibraryBrowser
        rootId="root-opaque"
        snapshot={snapshot}
        inspectorPlacement="shell"
        onSelectedAssetChange={onSelectedAssetChange}
      />,
    );

    expect(screen.queryByLabelText("Asset inspector")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /POOL\.wav/ }));
    expect(onSelectedAssetChange).toHaveBeenCalledWith({
      assetId: "asset:v1:pool",
      fileInstanceId: "fileinst:v1:pool",
      displayName: "POOL.wav",
      relativePath: "LIVE_SET/AUDIO/POOL.wav",
    });

    fireEvent.click(screen.getByRole("button", { name: /PROJECT_A/ }));
    expect(onSelectedAssetChange).toHaveBeenLastCalledWith(null);
  });
});
