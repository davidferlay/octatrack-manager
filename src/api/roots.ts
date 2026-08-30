import { ipcClient, type IpcClient } from "./client";

export interface RootCapabilities {
  read: boolean;
  write: boolean;
  stableDeviceIdentity: boolean;
}

export interface RootSession {
  rootId: string;
  displayName: string;
  deviceFingerprint: string;
  mode: "read_only" | "write_enabled";
  observedRevision: number;
  expiresInSeconds: number;
  writeGrantExpiresInSeconds?: number | null;
  capabilities: RootCapabilities;
}

export interface LibraryProject {
  displayName: string;
  relativePath: string;
  hasProjectFile: boolean;
  hasBanks: boolean;
}

export interface LibrarySet {
  displayName: string;
  relativePath: string;
  hasAudioPool: boolean;
  projects: LibraryProject[];
}

export type SampleStorageScope =
  | "set_audio_pool"
  | "project_local"
  | "unclassified";

export interface LibraryAudioFile {
  fileInstanceId: string;
  assetId: string;
  displayName: string;
  relativePath: string;
  byteSize: number;
  storageScope: SampleStorageScope;
}

export type SampleSlotKind = "static" | "flex";
export type SampleUsageKind = "machine" | "sample_lock";
export type SampleReferenceStatus =
  | "resolved"
  | "missing"
  | "invalid_path"
  | "unassigned_slot";

/** Catalog usage edge (relative paths only). Sourced from M3-C2 usage graph. */
export interface SampleUsageEdge {
  bankDocumentRelativePath: string;
  projectDocumentRelativePath: string;
  slotKind: SampleSlotKind;
  slotNumber: number;
  usageKind: SampleUsageKind;
  trackIndex: number;
  partIndex: number | null;
  patternIndex: number | null;
  stepIndex: number | null;
  audible: boolean;
  referencedFileRelativePath: string | null;
  referenceStatus: SampleReferenceStatus;
}

export interface LibrarySnapshot {
  sets: LibrarySet[];
  standaloneProjects: LibraryProject[];
  audioFiles: LibraryAudioFile[];
  usageEdges: SampleUsageEdge[];
}

export interface RootApi {
  registerRoot(rawPath: string): Promise<RootSession>;
  rootStatus(rootId: string): Promise<RootSession>;
  enableWrite(rootId: string): Promise<RootSession>;
  disableWrite(rootId: string): Promise<RootSession>;
  closeRoot(rootId: string): Promise<void>;
  listLibrary(rootId: string): Promise<LibrarySnapshot>;
}

export function createRootApi(client: IpcClient = ipcClient): RootApi {
  return {
    registerRoot: (rawPath) =>
      client.request<RootSession>("v2_root_register", { rawPath }),
    rootStatus: (rootId) =>
      client.request<RootSession>("v2_root_status", { rootId }),
    enableWrite: (rootId) =>
      client.request<RootSession>("v2_root_enable_write", { rootId }),
    disableWrite: (rootId) =>
      client.request<RootSession>("v2_root_disable_write", { rootId }),
    closeRoot: (rootId) =>
      client.request<void>("v2_root_close", { rootId }),
    listLibrary: (rootId) =>
      client.request<LibrarySnapshot>("v2_library_list", { rootId }),
  };
}

export const rootApi = createRootApi();
