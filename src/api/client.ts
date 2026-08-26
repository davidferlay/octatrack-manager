import { invoke } from "@tauri-apps/api/core";

export type IpcCommandArgs = Record<string, unknown>;

export type IpcTransport = <Response>(
  command: string,
  args?: IpcCommandArgs,
) => Promise<Response>;

export interface IpcClient {
  request<Response>(
    command: string,
    args?: IpcCommandArgs,
  ): Promise<Response>;
}

const tauriTransport: IpcTransport = (command, args) => invoke(command, args);

export function createIpcClient(
  transport: IpcTransport = tauriTransport,
): IpcClient {
  return {
    request: (command, args) => transport(command, args),
  };
}

export const ipcClient = createIpcClient();
