import { describe, expect, it } from "vitest";
import { createCloneApi } from "./clones";
import { createIpcClient, type IpcCommandArgs, type IpcTransport } from "./client";

describe("Clone API", () => {
  it("uses opaque IDs only", async () => {
    const calls: Array<[string, IpcCommandArgs | undefined]> = [];
    const transport: IpcTransport = async <Response>(
      command: string,
      args?: IpcCommandArgs,
    ) => {
      calls.push([command, args]);
      return {} as Response;
    };
    const api = createCloneApi(createIpcClient(transport));
    const sourceEvidenceId = `clone-source-evidence:v1:${"a".repeat(64)}`;

    await api.recordSourceEvidence("root-opaque");
    await api.createManagedClone("source-root");
    await api.verifyExternal("clone-root", sourceEvidenceId, true);
    await api.verificationStatus("clone-root");
    await api.reverify("clone-root");

    expect(calls).toEqual([
      ["v2_clone_record_source_evidence", { rootId: "root-opaque" }],
      ["v2_clone_create_managed", { sourceRootId: "source-root" }],
      ["v2_clone_verify_external", {
        rootId: "clone-root",
        sourceEvidenceId,
        acknowledgedDisposableClone: true,
      }],
      ["v2_clone_verification_status", { rootId: "clone-root" }],
      ["v2_clone_reverify", { rootId: "clone-root" }],
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/\/Users\/|\/Volumes\//);
  });
});
