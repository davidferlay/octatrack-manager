export { createIpcClient, ipcClient } from "./client";
export type { IpcClient, IpcCommandArgs, IpcTransport } from "./client";
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
