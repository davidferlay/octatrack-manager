import { describe, expect, it } from "vitest";
import { createAudioApi, type AudioPreviewToken, type AudioWaveform } from "./audio";
import { createIpcClient, type IpcCommandArgs, type IpcTransport } from "./client";

describe("audioApi", () => {
  it("uses only opaque root, asset, and preview token arguments", async () => {
    const waveform: AudioWaveform = {
      analyzerVersion: "waveform:v1",
      sampleRate: 44100,
      channels: 2,
      frameCount: 44100,
      durationSeconds: 1,
      samplesPerPeak: 256,
      peaks: [{ min: -0.5, max: 0.5 }],
    };
    const ticket: AudioPreviewToken = {
      previewToken: "preview:v1:opaque",
      expiresInSeconds: 120,
      mimeType: "audio/wav",
      byteLength: 48,
      durationMillis: 1000,
      truncated: false,
    };
    const calls: Array<[string, IpcCommandArgs | undefined]> = [];
    const responses: unknown[] = [waveform, ticket, new ArrayBuffer(4)];
    const transport: IpcTransport = async <Response>(
      command: string,
      args?: IpcCommandArgs,
    ) => {
      calls.push([command, args]);
      return responses.shift() as Response;
    };
    const api = createAudioApi(createIpcClient(transport));

    await api.getWaveform("root-opaque", "asset:v1:opaque", 640);
    await api.createPreviewToken("root-opaque", "asset:v1:opaque");
    await api.readPreview("root-opaque", "preview:v1:opaque");

    expect(calls).toEqual([
      ["v2_audio_waveform_get", {
        rootId: "root-opaque",
        assetId: "asset:v1:opaque",
        targetPoints: 640,
      }],
      ["v2_audio_preview_create", {
        rootId: "root-opaque",
        assetId: "asset:v1:opaque",
      }],
      ["v2_audio_preview_read", {
        rootId: "root-opaque",
        previewToken: "preview:v1:opaque",
      }],
    ]);
    expect(JSON.stringify(calls)).not.toContain("/Volumes/");
    expect(JSON.stringify(calls)).not.toContain("sha256:");
  });
});
