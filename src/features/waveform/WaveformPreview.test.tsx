import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioApi, AudioWaveformWindow } from "../../api";
import { tJa } from "../../i18n/testStrings";
import { WaveformPreview, waveformChannelPath, waveformPath } from "./WaveformPreview";

const waveformWindow: AudioWaveformWindow = {
  analyzerVersion: "waveform:v2",
  sampleRate: 44100,
  channels: 2,
  frameCount: "44100",
  range: { startFrame: "0", endFrameExclusive: "44100" },
  framesPerPeak: "256",
  channelPeaks: [
    [
      { min: -0.5, max: 0.75 },
      { min: -1, max: 1 },
    ],
    [
      { min: -0.25, max: 0.5 },
      { min: -0.5, max: 0.5 },
    ],
  ],
};

function api(overrides: Partial<AudioApi> = {}): AudioApi {
  return {
    getWaveform: vi.fn(),
    queryWaveform: vi.fn().mockResolvedValue(waveformWindow),
    createPreviewToken: vi.fn().mockResolvedValue({
      previewToken: "preview:v1:opaque",
      expiresInSeconds: 120,
      mimeType: "audio/wav",
      byteLength: 4,
      durationMillis: 1000,
      truncated: false,
    }),
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
    ...overrides,
  };
}

describe("WaveformPreview", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads v2 waveform peaks with opaque IDs", async () => {
    const client = api();
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );

    expect(await screen.findByRole("img", { name: tJa("waveform.plotAria") })).toBeInTheDocument();
    expect(client.queryWaveform).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
      { range: null, targetPoints: 640 },
    );
    expect(screen.getByText(tJa("duration.seconds", { seconds: 1 }))).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.loadPreview") }));

    await waitFor(() => expect(client.readPreview).toHaveBeenCalledWith(
      "root-opaque",
      "preview:v1:opaque",
    ));
    expect(client.createPreviewToken).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
    );
    expect(await screen.findByLabelText(tJa("waveform.previewAria", { displayName: "kick.wav" }))).toHaveAttribute(
      "src",
      "blob:preview",
    );
  });

  it("reports waveform failure without creating a preview token", async () => {
    const client = api({
      queryWaveform: vi.fn().mockRejectedValue(new Error("source changed")),
    });
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

  it("discards stale waveform results after a fast asset switch", async () => {
    const client = api();
    let resolveFirst: ((value: AudioWaveformWindow) => void) | undefined;
    vi.mocked(client.queryWaveform)
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...waveformWindow,
        frameCount: "88200",
      });

    const view = render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:first"
        displayName="first.wav"
      />,
    );

    view.rerender(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:second"
        displayName="second.wav"
      />,
    );

    expect(await screen.findByText(tJa("duration.seconds", { seconds: 2 }))).toBeInTheDocument();
    resolveFirst?.(waveformWindow);
    await Promise.resolve();
    expect(screen.getByText(tJa("duration.seconds", { seconds: 2 }))).toBeInTheDocument();
    expect(screen.queryByText("0:01")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.loadPreview") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      tJa("waveform.error.previewValidation"),
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
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.loadPreview") }));
    await waitFor(() => expect(client.readPreview).toHaveBeenCalled());

    view.unmount();
    resolvePreview?.(new Uint8Array([82, 73, 70, 70]).buffer);
    await Promise.resolve();

    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("clamps untrusted peak values when building the SVG path", () => {
    const path = waveformChannelPath(
      [{ min: -5, max: 5 }],
      1,
    );

    expect(path).toBe("M320.00 0.00V140.00");
  });

  it("derives the legacy helper path from the first channel", () => {
    const path = waveformPath(waveformWindow);
    expect(path).toContain("M");
    expect(path).toBe(waveformChannelPath(waveformWindow.channelPeaks[0], 2));
  });

  it("plays a validated frame range through the range preview API", async () => {
    const client = api();
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });

    fireEvent.change(screen.getByLabelText(tJa("waveform.startFrame")), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(tJa("waveform.endFrame")), {
      target: { value: "2000" },
    });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));

    await waitFor(() => expect(client.createRangePreviewToken).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
      { startFrame: "1000", endFrameExclusive: "2000" },
    ));
    expect(client.readPreview).toHaveBeenCalledWith("root-opaque", "preview:v1:range");
  });

  it("shows invalid range feedback without calling the range preview API", async () => {
    const client = api();
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });

    fireEvent.change(screen.getByLabelText(tJa("waveform.endFrame")), {
      target: { value: "0" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("waveform.error.rangeEmpty"));
    expect(client.createRangePreviewToken).not.toHaveBeenCalled();
  });

  it("discards stale range preview results after a fast asset switch", async () => {
    const client = api();
    let resolveRange: (() => void) | undefined;
    vi.mocked(client.createRangePreviewToken).mockImplementation(
      () => new Promise((resolve) => {
        resolveRange = () => resolve({
          previewToken: "preview:v1:late",
          expiresInSeconds: 120,
          mimeType: "audio/wav",
          byteLength: 4,
          durationMillis: 500,
          truncated: false,
          sampleRate: 44100,
          range: { startFrame: "0", endFrameExclusive: "44100" },
        });
      }),
    );

    const view = render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:first"
        displayName="first.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));

    view.rerender(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:second"
        displayName="second.wav"
      />,
    );

    resolveRange?.();
    await Promise.resolve();
    expect(client.readPreview).not.toHaveBeenCalled();
  });

  it("does not play after Stop when a delayed range create completes", async () => {
    const client = api();
    let resolveCreate: (() => void) | undefined;
    vi.mocked(client.createRangePreviewToken).mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = () => resolve({
          previewToken: "preview:v1:range",
          expiresInSeconds: 120,
          mimeType: "audio/wav",
          byteLength: 4,
          durationMillis: 500,
          truncated: false,
          sampleRate: 44100,
          range: { startFrame: "0", endFrameExclusive: "44100" },
        });
      }),
    );
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
    const createObjectUrl = vi.mocked(URL.createObjectURL);

    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.stop") }));

    resolveCreate?.();
    await waitFor(() => expect(client.createRangePreviewToken).toHaveBeenCalled());
    expect(client.readPreview).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("does not play stale range A after range B finishes preparing", async () => {
    const client = api();
    let resolveA: (() => void) | undefined;
    let call = 0;
    vi.mocked(client.createRangePreviewToken).mockImplementation(
      () => new Promise((resolve) => {
        call += 1;
        if (call === 1) {
          resolveA = () => resolve({
            previewToken: "preview:v1:range-a",
            expiresInSeconds: 120,
            mimeType: "audio/wav",
            byteLength: 4,
            durationMillis: 500,
            truncated: false,
            sampleRate: 44100,
            range: { startFrame: "0", endFrameExclusive: "44100" },
          });
          return;
        }
        resolve({
          previewToken: "preview:v1:range-b",
          expiresInSeconds: 120,
          mimeType: "audio/wav",
          byteLength: 4,
          durationMillis: 500,
          truncated: false,
          sampleRate: 44100,
          range: { startFrame: "0", endFrameExclusive: "44100" },
        });
      }),
    );
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");

    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.stop") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));

    await waitFor(() => expect(client.readPreview).toHaveBeenCalledWith(
      "root-opaque",
      "preview:v1:range-b",
    ));
    expect(playSpy).toHaveBeenCalledTimes(1);

    resolveA?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.readPreview).not.toHaveBeenCalledWith(
      "root-opaque",
      "preview:v1:range-a",
    );
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("does not clear range loading when a stale range request finally completes", async () => {
    const client = api();
    let resolveSlow: (() => void) | undefined;
    let call = 0;
    vi.mocked(client.createRangePreviewToken).mockImplementation(
      () => new Promise((resolve) => {
        call += 1;
        if (call === 1) {
          resolveSlow = () => resolve({
            previewToken: "preview:v1:slow",
            expiresInSeconds: 120,
            mimeType: "audio/wav",
            byteLength: 4,
            durationMillis: 500,
            truncated: false,
            sampleRate: 44100,
            range: { startFrame: "0", endFrameExclusive: "44100" },
          });
          return;
        }
        resolve({
          previewToken: "preview:v1:fast",
          expiresInSeconds: 120,
          mimeType: "audio/wav",
          byteLength: 4,
          durationMillis: 500,
          truncated: false,
          sampleRate: 44100,
          range: { startFrame: "0", endFrameExclusive: "44100" },
        });
      }),
    );

    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    expect(screen.getByRole("button", { name: tJa("waveform.preparingRange") })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.stop") }));
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Preparing range..." })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.stop") }));

    resolveSlow?.();
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: "Preparing range..." })).not.toBeInTheDocument();
  });

  it("does not play after asset switch when a delayed range read completes", async () => {
    const client = api();
    let resolveRead: (() => void) | undefined;
    vi.mocked(client.readPreview).mockImplementation(
      () => new Promise((resolve) => {
        resolveRead = () => resolve(new Uint8Array([82, 73, 70, 70]).buffer);
      }),
    );
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");

    const view = render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:first"
        displayName="first.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    await waitFor(() => expect(client.createRangePreviewToken).toHaveBeenCalled());

    view.rerender(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:second"
        displayName="second.wav"
      />,
    );
    await waitFor(() => expect(screen.getByLabelText(tJa("waveform.endFrame"))).toHaveValue("44100"));
    playSpy.mockClear();

    resolveRead?.();
    await waitFor(() => expect(playSpy).not.toHaveBeenCalled());
  });

  it("pauses head preview audio when range playback starts", async () => {
    const client = api();
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause");

    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.loadPreview") }));
    await screen.findByLabelText(tJa("waveform.previewAria", { displayName: "kick.wav" }));

    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    await waitFor(() => expect(client.createRangePreviewToken).toHaveBeenCalled());
    expect(pauseSpy).toHaveBeenCalled();
  });

  it("initializes the range end within the Library preview limit", async () => {
    const client = api({
      queryWaveform: vi.fn().mockResolvedValue({
        ...waveformWindow,
        frameCount: "3969000",
      }),
    });
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="long.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    expect(screen.getByLabelText(tJa("waveform.endFrame"))).toHaveValue("2646000");
    expect(screen.getByRole("button", { name: tJa("waveform.playRange") })).toBeEnabled();
  });

  it("shows preview-limit feedback without calling the range preview API", async () => {
    const client = api({
      queryWaveform: vi.fn().mockResolvedValue({
        ...waveformWindow,
        frameCount: "3969000",
      }),
    });
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="long.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.change(screen.getByLabelText(tJa("waveform.endFrame")), {
      target: { value: "2646001" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("waveform.error.rangePreviewLimit"));
    expect(screen.getByRole("button", { name: tJa("waveform.playRange") })).toBeDisabled();
    expect(client.createRangePreviewToken).not.toHaveBeenCalled();
  });

  it("stops range playback when the head preview player starts", async () => {
    const client = api();
    render(
      <WaveformPreview
        api={client}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="kick.wav"
      />,
    );
    await screen.findByRole("img", { name: tJa("waveform.plotAria") });
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.loadPreview") }));
    const head = await screen.findByLabelText(tJa("waveform.previewAria", { displayName: "kick.wav" }));
    fireEvent.click(screen.getByRole("button", { name: tJa("waveform.playRange") }));
    await waitFor(() => expect(screen.getByRole("button", { name: tJa("waveform.stop") })).toBeEnabled());

    fireEvent.play(head);
    await waitFor(() => expect(screen.getByRole("button", { name: tJa("waveform.stop") })).toBeDisabled());
  });
});
