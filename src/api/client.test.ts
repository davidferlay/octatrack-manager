import { describe, expect, it } from "vitest";
import {
  createIpcClient,
  type IpcCommandArgs,
  type IpcTransport,
} from "./client";

describe("IPC client", () => {
  it("forwards typed requests through the configured transport", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const transport: IpcTransport = async <Response>(
      command: string,
      args?: IpcCommandArgs,
    ) => {
      calls.push([command, args]);
      return { roots: ["root-1"] } as Response;
    };
    const client = createIpcClient(transport);

    const response = await client.request<{ roots: string[] }>("list_roots", {
      includeOffline: false,
    });

    expect(response).toEqual({ roots: ["root-1"] });
    expect(calls).toEqual([
      ["list_roots", { includeOffline: false }],
    ]);
  });

  it("preserves transport failures for the caller", async () => {
    const transport: IpcTransport = async () => {
      throw new Error("IPC unavailable");
    };
    const client = createIpcClient(transport);

    await expect(client.request("list_roots")).rejects.toThrow(
      "IPC unavailable",
    );
  });
});
