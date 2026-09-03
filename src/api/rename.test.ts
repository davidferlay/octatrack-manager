import { describe, expect, it } from "vitest";
import { createIpcClient, type IpcCommandArgs, type IpcTransport } from "./client";
import { createRenameApi } from "./rename";

describe("Rename API", () => {
  it("uses opaque IDs and root-relative destination paths only", async () => {
    const calls: Array<[string, IpcCommandArgs | undefined]> = [];
    const transport: IpcTransport = async <Response>(
      command: string,
      args?: IpcCommandArgs,
    ) => {
      calls.push([command, args]);
      return {} as Response;
    };
    const api = createRenameApi(createIpcClient(transport));
    const planId = `plan:v1:${"a".repeat(64)}`;
    const operationId = `operation:v1:${"a".repeat(64)}`;
    const authorityId = `authority:v1:${"b".repeat(64)}`;
    const snapshotId = `snapshot:v1:${"c".repeat(64)}`;
    const continuationAuthorityId = `continuation-authority:v1:${"d".repeat(64)}`;

    await api.plan(
      "root-opaque",
      `fileinst:v1:${"f".repeat(64)}`,
      "LIVE_SET/AUDIO/KICK_DEEP.wav",
    );
    await api.getPlan("root-opaque", planId);
    await api.getPreparedPlan("root-opaque", operationId);
    await api.authorize("root-opaque", planId);
    await api.createBackup("root-opaque", planId, authorityId);
    await api.prepare("root-opaque", planId, authorityId, snapshotId);
    await api.getStatus("root-opaque", operationId);
    await api.recoveryStatus("root-opaque");
    await api.continuationStatus("root-opaque", operationId);
    await api.continueOperation("root-opaque", operationId, operationId);
    await api.apply("root-opaque", operationId, operationId, continuationAuthorityId);
    await api.verifyCommitted("root-opaque", operationId);
    await api.recover("root-opaque", operationId, operationId);
    await api.verifyRolledBack("root-opaque", operationId);

    expect(calls).toEqual([
      ["v2_rename_plan", {
        rootId: "root-opaque",
        sourceFileInstanceId: `fileinst:v1:${"f".repeat(64)}`,
        destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
      }],
      ["v2_rename_get_plan", { rootId: "root-opaque", planId }],
      ["v2_rename_get_prepared_plan", { rootId: "root-opaque", operationId }],
      ["v2_rename_authorize", { rootId: "root-opaque", planId }],
      ["v2_rename_create_backup", { rootId: "root-opaque", planId, authorityId }],
      ["v2_rename_prepare", {
        rootId: "root-opaque",
        planId,
        authorityId,
        snapshotId,
      }],
      ["v2_rename_get_status", { rootId: "root-opaque", operationId }],
      ["v2_rename_recovery_status", { rootId: "root-opaque" }],
      ["v2_rename_continuation_status", { rootId: "root-opaque", operationId }],
      ["v2_rename_continue", {
        rootId: "root-opaque",
        operationId,
        approvedOperationId: operationId,
      }],
      ["v2_rename_apply", {
        rootId: "root-opaque",
        operationId,
        approvedOperationId: operationId,
        continuationAuthorityId,
      }],
      ["v2_rename_verify_committed", { rootId: "root-opaque", operationId }],
      ["v2_rename_recover", {
        rootId: "root-opaque",
        operationId,
        approvedOperationId: operationId,
      }],
      ["v2_rename_verify_rolled_back", { rootId: "root-opaque", operationId }],
    ]);
    expect(JSON.stringify(calls)).not.toContain("/Volumes/");
    expect(JSON.stringify(calls)).not.toContain("Application Support");
  });
});
