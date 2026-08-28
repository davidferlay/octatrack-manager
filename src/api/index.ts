export { createIpcClient, ipcClient } from "./client";
export type { IpcClient, IpcCommandArgs, IpcTransport } from "./client";
export { audioApi, createAudioApi } from "./audio";
export type {
  AudioApi,
  AudioPreviewBytes,
  AudioPreviewToken,
  AudioWaveform,
  WaveformPeak,
} from "./audio";
export { createMetadataApi, metadataApi } from "./metadata";
export type { ManualAssetMetadata, MetadataApi } from "./metadata";
export { createRootApi, rootApi } from "./roots";
export type {
  LibraryAudioFile,
  LibraryProject,
  LibrarySet,
  LibrarySnapshot,
  RootApi,
  RootCapabilities,
  RootSession,
  SampleStorageScope,
} from "./roots";
