import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LibraryAudioFile, LibrarySnapshot } from "../../api";
import { tJa } from "../../i18n/testStrings";
import { InspectorTabbedAssetPanel } from "./InspectorTabbedAssetPanel";

const file: LibraryAudioFile = {
  fileInstanceId: "fileinst:v1:pool",
  assetId: "asset:v1:pool",
  displayName: "POOL.wav",
  relativePath: "LIVE_SET/AUDIO/POOL.wav",
  byteSize: 2048,
  storageScope: "set_audio_pool",
};

const snapshot: LibrarySnapshot = {
  sets: [],
  standaloneProjects: [],
  audioFiles: [file],
  usageEdges: [],
};

const audioClient = {
  queryWaveform: vi.fn().mockResolvedValue({
    analyzerVersion: "waveform:v2",
    sampleRate: 44100,
    channels: 2,
    frameCount: "1000",
    range: { startFrame: "0", endFrameExclusive: "1000" },
    framesPerPeak: "1",
    channelPeaks: [[{ min: -0.5, max: 0.5 }]],
  }),
  createPreviewToken: vi.fn(),
  createRangePreviewToken: vi.fn(),
  readPreview: vi.fn(),
  getWaveform: vi.fn(),
};

const metadataClient = {
  loadManualAssetMetadata: vi.fn().mockResolvedValue({ tags: [], note: null }),
  replaceManualAssetMetadata: vi.fn(),
};

describe("InspectorTabbedAssetPanel", () => {
  it("switches tabs without remounting waveform query on tab change alone", async () => {
    render(
      <InspectorTabbedAssetPanel
        rootId="root-opaque"
        file={file}
        snapshot={snapshot}
        audioClient={audioClient}
        metadataClient={metadataClient}
        geometrySelectionGeneration={1}
        librarySelectionRange={null}
        stopPlaybackToken={0}
        renameRecovery={null}
        renameBlocked
        copyBlocked
        renameBusy={false}
        writeEnabled={false}
        onRename={vi.fn()}
        onCopy={vi.fn()}
        onCommittedGeometryRangeChange={vi.fn()}
        onRequestStopLibraryPlayback={vi.fn()}
      />,
    );

    await waitFor(() => expect(audioClient.queryWaveform).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabSlice") }));
    expect(screen.getByRole("tab", { name: tJa("inspector.tabSlice") })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabPreview") }));
    expect(audioClient.queryWaveform).toHaveBeenCalledTimes(1);
  });

  it("keeps notes editor mounted while another tab is visible", async () => {
    render(
      <InspectorTabbedAssetPanel
        rootId="root-opaque"
        file={file}
        snapshot={snapshot}
        audioClient={audioClient}
        metadataClient={metadataClient}
        geometrySelectionGeneration={1}
        librarySelectionRange={null}
        stopPlaybackToken={0}
        renameRecovery={null}
        renameBlocked
        copyBlocked
        renameBusy={false}
        writeEnabled={false}
        onRename={vi.fn()}
        onCopy={vi.fn()}
        onCommittedGeometryRangeChange={vi.fn()}
        onRequestStopLibraryPlayback={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabNotes") }));
    const note = await screen.findByLabelText(tJa("metadata.noteAria"));
    fireEvent.change(note, { target: { value: "keep me" } });

    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabInfo") }));
    fireEvent.click(screen.getByRole("tab", { name: tJa("inspector.tabNotes") }));
    expect(screen.getByLabelText(tJa("metadata.noteAria"))).toHaveValue("keep me");
  });
});
