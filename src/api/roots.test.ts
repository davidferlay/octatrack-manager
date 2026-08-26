import { describe, expect, it } from "vitest";
import { createIpcClient, type IpcCommandArgs, type IpcTransport } from "./client";
import { createRootApi, type LibrarySnapshot, type RootSession } from "./roots";

const session: RootSession = {
  rootId: "root-opaque",
  displayName: "Fixture",
  deviceFingerprint: "0123456789abcdef",
  mode: "read_only",
  observedRevision: 1,
  expiresInSeconds: 3600,
  capabilities: {
    read: true,
    write: false,
    stableDeviceIdentity: true,
  },
};

describe("Root API", () => {
  it("sends a raw absolute path only to root registration", async () => {
    const calls: Array<[string, IpcCommandArgs | undefined]> = [];
    const transport: IpcTransport = async <Response>(command: string, args?: IpcCommandArgs) => {
      calls.push([command, args]);
      if (command === "v2_root_register" || command === "v2_root_status") {
        return session as Response;
      }
      if (command === "v2_library_list") {
        return { sets: [], standaloneProjects: [] } as Response;
      }
      return undefined as Response;
    };
    const api = createRootApi(createIpcClient(transport));

    await api.registerRoot("/private/tmp/fixture");
    await api.rootStatus(session.rootId);
    await api.listLibrary(session.rootId);
    await api.closeRoot(session.rootId);

    expect(calls).toEqual([
      ["v2_root_register", { rawPath: "/private/tmp/fixture" }],
      ["v2_root_status", { rootId: "root-opaque" }],
      ["v2_library_list", { rootId: "root-opaque" }],
      ["v2_root_close", { rootId: "root-opaque" }],
    ]);
  });

  it("returns only relative library paths after registration", async () => {
    const snapshot: LibrarySnapshot = {
      sets: [{
        displayName: "SET",
        relativePath: "SET",
        hasAudioPool: true,
        projects: [{
          displayName: "PROJECT",
          relativePath: "SET/PROJECT",
          hasProjectFile: true,
          hasBanks: true,
        }],
      }],
      standaloneProjects: [],
    };
    const transport: IpcTransport = async <Response>() => snapshot as Response;

    const result = await createRootApi(createIpcClient(transport)).listLibrary("root-opaque");

    expect(result.sets[0].projects[0].relativePath).toBe("SET/PROJECT");
    expect(JSON.stringify(result)).not.toContain("/private/");
  });
});
