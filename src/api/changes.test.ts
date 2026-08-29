import { describe, expect, it } from "vitest";
import { createIpcClient, type IpcCommandArgs, type IpcTransport } from "./client";
import { createChangeApi } from "./changes";

describe("Change API", () => {
  it("uses opaque IDs and one validated root-relative destination", async () => {
    const calls: Array<[string, IpcCommandArgs | undefined]> = [];
    const transport: IpcTransport = async <Response>(
      command: string,
      args?: IpcCommandArgs,
    ) => {
      calls.push([command, args]);
      return {} as Response;
    };
    const api = createChangeApi(createIpcClient(transport));
    const planId = `plan:v1:${"a".repeat(64)}`;
    const operationId = `operation:v1:${"a".repeat(64)}`;

    await api.planAdditiveCopy(
      "root-opaque",
      `fileinst:v1:${"b".repeat(64)}`,
      "LIVE_SET/PROJECT_A/KICK.wav",
    );
    await api.getPlan("root-opaque", planId);
    await api.applyChange("root-opaque", planId, planId);
    await api.changeStatus("root-opaque", operationId);
    await api.recoveryStatus("root-opaque");
    await api.recoverChange("root-opaque", operationId, operationId);

    expect(calls).toEqual([
      ["v2_change_plan", {
        rootId: "root-opaque",
        sourceFileInstanceId: `fileinst:v1:${"b".repeat(64)}`,
        destinationRelativePath: "LIVE_SET/PROJECT_A/KICK.wav",
      }],
      ["v2_change_get_plan", { rootId: "root-opaque", planId }],
      ["v2_change_apply", { rootId: "root-opaque", planId, approvedPlanId: planId }],
      ["v2_change_status", { rootId: "root-opaque", operationId }],
      ["v2_change_recovery_status", { rootId: "root-opaque" }],
      ["v2_change_recover", {
        rootId: "root-opaque",
        operationId,
        approvedOperationId: operationId,
      }],
    ]);
    expect(JSON.stringify(calls)).not.toContain("/Volumes/");
    expect(JSON.stringify(calls)).not.toContain("sha256:");
  });
});
