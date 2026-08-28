import { describe, expect, it } from "vitest";
import { createIpcClient, type IpcCommandArgs, type IpcTransport } from "./client";
import {
  createMetadataApi,
  type ManualAssetMetadata,
} from "./metadata";

describe("Metadata API", () => {
  it("uses only opaque root and asset IDs for manual metadata commands", async () => {
    const calls: Array<[string, IpcCommandArgs | undefined]> = [];
    const response: ManualAssetMetadata = {
      tags: ["kick"],
      note: "Main live kick",
    };
    const transport: IpcTransport = async <Response>(
      command: string,
      args?: IpcCommandArgs,
    ) => {
      calls.push([command, args]);
      return response as Response;
    };
    const api = createMetadataApi(createIpcClient(transport));

    await api.loadManualAssetMetadata("root-opaque", "asset:v1:opaque");
    await api.replaceManualAssetMetadata(
      "root-opaque",
      "asset:v1:opaque",
      response,
    );

    expect(calls).toEqual([
      [
        "v2_asset_metadata_get",
        { rootId: "root-opaque", assetId: "asset:v1:opaque" },
      ],
      [
        "v2_asset_metadata_replace",
        {
          rootId: "root-opaque",
          assetId: "asset:v1:opaque",
          metadata: response,
        },
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain("sha256:");
    expect(JSON.stringify(calls)).not.toContain("/private/");
  });
});
