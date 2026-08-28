import { ipcClient, type IpcClient } from "./client";

export interface WaveformPeak {
  min: number;
  max: number;
}

export interface AudioWaveform {
  analyzerVersion: string;
  sampleRate: number;
  channels: number;
  frameCount: number;
  durationSeconds: number;
  samplesPerPeak: number;
  peaks: WaveformPeak[];
}

export interface AudioPreviewToken {
  previewToken: string;
  expiresInSeconds: number;
  mimeType: string;
  byteLength: number;
  durationMillis: number;
  truncated: boolean;
}

export type AudioPreviewBytes = ArrayBuffer | number[];

export interface AudioApi {
  getWaveform(
    rootId: string,
    assetId: string,
    targetPoints: number,
  ): Promise<AudioWaveform>;
  createPreviewToken(rootId: string, assetId: string): Promise<AudioPreviewToken>;
  readPreview(rootId: string, previewToken: string): Promise<AudioPreviewBytes>;
}

export function createAudioApi(client: IpcClient = ipcClient): AudioApi {
  return {
    getWaveform: (rootId, assetId, targetPoints) =>
      client.request<AudioWaveform>("v2_audio_waveform_get", {
        rootId,
        assetId,
        targetPoints,
      }),
    createPreviewToken: (rootId, assetId) =>
      client.request<AudioPreviewToken>("v2_audio_preview_create", {
        rootId,
        assetId,
      }),
    readPreview: (rootId, previewToken) =>
      client.request<AudioPreviewBytes>("v2_audio_preview_read", {
        rootId,
        previewToken,
      }),
  };
}

export const audioApi = createAudioApi();
