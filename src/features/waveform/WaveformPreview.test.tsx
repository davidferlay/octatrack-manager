import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioApi, AudioWaveform } from "../../api";
import { WaveformPreview, waveformPath } from "./WaveformPreview";

const waveform: AudioWaveform = {
  analyzerVersion: "waveform:v1",
  sampleRate: 44100,
  channels: 2,
  frameCount: 44100,
  durationSeconds: 1,
  samplesPerPeak: 256,
  peaks: [
    { min: -0.5, max: 0.75 },
    { min: -1, max: 1 },
  ],
};

function api(): AudioApi {
  return {
    getWaveform: vi.fn().mockResolvedValue(waveform),
    createPreviewToken: vi.fn().mockResolvedValue({
      previewToken: "preview:v1:opaque",
      expiresInSeconds: 120,
      mimeType: "audio/wav",
      byteLength: 4,
      durationMillis: 1000,
      truncated: false,
    }),
    readPreview: vi.fn().mockResolvedValue(new Uint8Array([82, 73, 70, 70]).buffer),
  };
}

describe("WaveformPreview", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads waveform peaks with opaque IDs", async () => {
    const client = api();
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );

    expect(await screen.findByRole("img", { name: "Audio waveform" })).toBeInTheDocument();
    expect(client.getWaveform).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
      640,
    );
    expect(screen.getByText("0:01")).toBeInTheDocument();
  });

  it("redeems a short-lived token before exposing preview bytes to audio", async () => {
    const client = api();
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load preview" }));

    await waitFor(() => expect(client.readPreview).toHaveBeenCalledWith(
      "root-opaque",
      "preview:v1:opaque",
    ));
    expect(client.createPreviewToken).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
    );
    expect(await screen.findByLabelText("Preview kick.wav")).toHaveAttribute(
      "src",
      "blob:preview",
    );
  });

  it("reports waveform failure without creating a preview token", async () => {
    const client = api();
    vi.mocked(client.getWaveform).mockRejectedValue(new Error("source changed"));
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("source changed");
    expect(client.createPreviewToken).not.toHaveBeenCalled();
  });

  it("rejects preview bytes that do not match the bounded token response", async () => {
    const client = api();
    vi.mocked(client.createPreviewToken).mockResolvedValue({
      previewToken: "preview:v1:opaque",
      expiresInSeconds: 120,
      mimeType: "audio/wav",
      byteLength: 99,
      durationMillis: 1000,
      truncated: false,
    });
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Preview response failed validation.",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("does not create a Blob URL when an in-flight preview outlives the component", async () => {
    const client = api();
    let resolvePreview: ((bytes: ArrayBuffer) => void) | undefined;
    vi.mocked(client.readPreview).mockReturnValue(new Promise((resolve) => {
      resolvePreview = resolve;
    }));
    const view = render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load preview" }));
    await waitFor(() => expect(client.readPreview).toHaveBeenCalled());

    view.unmount();
    resolvePreview?.(new Uint8Array([82, 73, 70, 70]).buffer);
    await Promise.resolve();

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("clamps untrusted peak values when building the SVG path", () => {
    const path = waveformPath({
      ...waveform,
      peaks: [{ min: -5, max: 5 }],
    });

    expect(path).toBe("M320.00 0.00V140.00");
  });
});
