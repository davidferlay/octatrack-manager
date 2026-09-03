import { ipcClient, type IpcClient } from "./client";

export interface CloneSourceEvidence {
  schema: "clone-source-evidence:v1";
  sourceEvidenceId: string;
  entryCount: number;
}

export interface ManagedClone {
  schema: "managed-clone:v1";
  cloneRootId: string;
  cloneVerificationId: string;
  entryCount: number;
  sourceRootClosed: boolean;
}

export type CloneProvenance = "app_managed" | "external";

export type CloneVerificationState =
  | "verified"
  | "tampered"
  | "expired"
  | "revoked";

export interface CloneVerification {
  schema: "clone-verification:v1";
  cloneVerificationId: string;
  cloneRootId: string;
  provenance: CloneProvenance;
  state: CloneVerificationState;
  entryCount: number;
  expiresInSeconds: number;
}

export interface CloneApi {
  recordSourceEvidence(rootId: string): Promise<CloneSourceEvidence>;
  createManagedClone(sourceRootId: string): Promise<ManagedClone>;
  verifyExternal(
    rootId: string,
    sourceEvidenceId: string,
    acknowledgedDisposableClone: boolean,
  ): Promise<CloneVerification>;
  verificationStatus(rootId: string): Promise<CloneVerification | null>;
  reverify(rootId: string): Promise<CloneVerification>;
}

export function createCloneApi(client: IpcClient = ipcClient): CloneApi {
  return {
    recordSourceEvidence: (rootId) =>
      client.request<CloneSourceEvidence>("v2_clone_record_source_evidence", { rootId }),
    createManagedClone: (sourceRootId) =>
      client.request<ManagedClone>("v2_clone_create_managed", { sourceRootId }),
    verifyExternal: (rootId, sourceEvidenceId, acknowledgedDisposableClone) =>
      client.request<CloneVerification>("v2_clone_verify_external", {
        rootId,
        sourceEvidenceId,
        acknowledgedDisposableClone,
      }),
    verificationStatus: (rootId) =>
      client.request<CloneVerification | null>("v2_clone_verification_status", { rootId }),
    reverify: (rootId) =>
      client.request<CloneVerification>("v2_clone_reverify", { rootId }),
  };
}

export const cloneApi = createCloneApi();
