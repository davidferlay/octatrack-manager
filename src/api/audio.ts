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

export interface AudioFrameRange {
  startFrame: string;
  endFrameExclusive: string;
}

export interface AudioWaveformQuery {
  range: AudioFrameRange | null;
  targetPoints: number;
}

export interface AudioWaveformWindow {
  analyzerVersion: "waveform:v2";
  sampleRate: number;
  channels: number;
  frameCount: string;
  range: AudioFrameRange;
  framesPerPeak: string;
  channelPeaks: WaveformPeak[][];
}

export interface AudioPreviewToken {
  previewToken: string;
  expiresInSeconds: number;
  mimeType: string;
  byteLength: number;
  durationMillis: number;
  truncated: boolean;
}

export interface AudioPreviewRangeToken extends AudioPreviewToken {
  sampleRate: number;
  range: AudioFrameRange;
}

export type AudioPreviewBytes = ArrayBuffer | number[];

export interface AudioApi {
  getWaveform(
    rootId: string,
    assetId: string,
    targetPoints: number,
  ): Promise<AudioWaveform>;
  queryWaveform(
    rootId: string,
    assetId: string,
    query: AudioWaveformQuery,
  ): Promise<AudioWaveformWindow>;
  createPreviewToken(rootId: string, assetId: string): Promise<AudioPreviewToken>;
  createRangePreviewToken(
    rootId: string,
    assetId: string,
    range: AudioFrameRange,
  ): Promise<AudioPreviewRangeToken>;
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
    queryWaveform: (rootId, assetId, query) =>
      client.request<AudioWaveformWindow>("v2_audio_waveform_query", {
        rootId,
        assetId,
        query,
      }),
    createPreviewToken: (rootId, assetId) =>
      client.request<AudioPreviewToken>("v2_audio_preview_create", {
        rootId,
        assetId,
      }),
    createRangePreviewToken: (rootId, assetId, range) =>
      client.request<AudioPreviewRangeToken>("v2_audio_preview_range_create", {
        rootId,
        assetId,
        range,
      }),
    readPreview: (rootId, previewToken) =>
      client.request<AudioPreviewBytes>("v2_audio_preview_read", {
        rootId,
        previewToken,
      }),
  };
}

export const audioApi = createAudioApi();
