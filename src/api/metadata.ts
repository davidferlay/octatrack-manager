import { ipcClient, type IpcClient } from "./client";

export interface ManualAssetMetadata {
  tags: string[];
  note: string | null;
}

export interface MetadataApi {
  loadManualAssetMetadata(
    rootId: string,
    assetId: string,
  ): Promise<ManualAssetMetadata>;
  replaceManualAssetMetadata(
    rootId: string,
    assetId: string,
    metadata: ManualAssetMetadata,
  ): Promise<ManualAssetMetadata>;
}

export function createMetadataApi(client: IpcClient = ipcClient): MetadataApi {
  return {
    loadManualAssetMetadata: (rootId, assetId) =>
      client.request<ManualAssetMetadata>("v2_asset_metadata_get", {
        rootId,
        assetId,
      }),
    replaceManualAssetMetadata: (rootId, assetId, metadata) =>
      client.request<ManualAssetMetadata>("v2_asset_metadata_replace", {
        rootId,
        assetId,
        metadata,
      }),
  };
}

export const metadataApi = createMetadataApi();
