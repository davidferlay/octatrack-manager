import { ipcClient, type IpcClient } from "./client";

export interface RenameBlockReason {
  code: string;
  message: string;
}

export interface RenameReferenceUpdate {
  projectDocumentRelativePath: string;
  slotKind: "static" | "flex";
  slotNumber: number;
  fromRelativePath: string;
  toRelativePath: string;
}

export interface RenameStateDocumentImpact {
  relativePath: string;
  role: "working" | "saved_checkpoint";
  referenceUpdates: RenameReferenceUpdate[];
}

export interface RenameUsageEdgeImpact {
  bankDocumentRelativePath: string;
  projectDocumentRelativePath: string;
  slotKind: "static" | "flex";
  slotNumber: number;
  usageKind: "machine" | "sample_lock";
  referencedFileRelativePath: string;
  referenceStatus: string;
}

export interface RenameSidecarImpact {
  sourceSidecarRelativePath: string;
  destinationSidecarRelativePath: string;
}

export interface RenamePlan {
  schema: "rename-plan:v1";
  planId: string;
  operationId: string;
  operation: "rename_sample";
  sourceFileInstanceId: string;
  sourceRelativePath: string;
  destinationRelativePath: string;
  stateDocumentImpacts: RenameStateDocumentImpact[];
  usageEdgeImpacts: RenameUsageEdgeImpact[];
  sidecarImpacts: RenameSidecarImpact[];
  backupRelativePaths: string[];
  estimatedMediaAdditionalBytes: number;
  estimatedLocalStagingBytes: number;
  referenceUpdateCount: number;
  warnings: string[];
  requiresExplicitApproval: true;
  overwriteAllowed: false;
  removesSourceOnApply: boolean;
}

export interface BlockedRenamePlan {
  schema: "rename-blocked:v1";
  sourceRelativePath: string | null;
  destinationRelativePath: string;
  observedStateDocumentCount: number;
  observedUsageEdgeCount: number;
  observedSidecarCount: number;
  referenceUpdateCount: number;
  blockReasons: RenameBlockReason[];
}

export type RenamePlanResponse =
  | { outcome: "planned"; plan: RenamePlan }
  | { outcome: "blocked"; blocked: BlockedRenamePlan };

export interface RenameAuthority {
  schema: "rename-authority:v1";
  authorityId: string;
  planId: string;
  operationId: string;
  expiresInSeconds: number;
}

export interface RenameBackupStatus {
  schema: "rename-backup-status:v1";
  planId: string;
  snapshotId: string;
  state: "backup_verified";
  fileCount: number;
  totalBytes: number;
  verified: true;
}

export interface RenamePrepareStatus {
  schema: "rename-prepare-status:v1";
  planId: string;
  operationId: string;
  snapshotId: string;
  state: "prepared";
  stagedFileCount: number;
  totalStagedBytes: number;
  projectRewriteCount: number;
}

export type RenameOperationState =
  | "planned"
  | "authorized"
  | "backup_verified"
  | "prepared"
  | "applying"
  | "committed"
  | "rolled_back"
  | "recovery_required";

export interface RenameStatus {
  schema: "rename-status:v1";
  operationId: string;
  planId: string | null;
  state: RenameOperationState;
  backupSnapshotId: string | null;
  failureCode: string | null;
  planExpired: boolean;
}

export interface RenameRecoveryStatus {
  schema: "rename-recovery-status:v1";
  recoveryRequired: boolean;
  operations: RenameStatus[];
}

export interface RenameApi {
  plan(
    rootId: string,
    sourceFileInstanceId: string,
    destinationRelativePath: string,
  ): Promise<RenamePlanResponse>;
  getPlan(rootId: string, planId: string): Promise<RenamePlan>;
  authorize(rootId: string, planId: string): Promise<RenameAuthority>;
  createBackup(
    rootId: string,
    planId: string,
    authorityId: string,
  ): Promise<RenameBackupStatus>;
  prepare(
    rootId: string,
    planId: string,
    authorityId: string,
    snapshotId: string,
  ): Promise<RenamePrepareStatus>;
  getStatus(rootId: string, operationId: string): Promise<RenameStatus>;
  recoveryStatus(rootId: string): Promise<RenameRecoveryStatus>;
}

function normalizePlanResponse(raw: unknown): RenamePlanResponse {
  const value = raw as Record<string, unknown>;
  if (value.outcome === "blocked") {
    return { outcome: "blocked", blocked: value as unknown as BlockedRenamePlan };
  }
  return { outcome: "planned", plan: value as unknown as RenamePlan };
}

export function createRenameApi(client: IpcClient = ipcClient): RenameApi {
  return {
    plan: (rootId, sourceFileInstanceId, destinationRelativePath) =>
      client
        .request<unknown>("v2_rename_plan", {
          rootId,
          sourceFileInstanceId,
          destinationRelativePath,
        })
        .then(normalizePlanResponse),
    getPlan: (rootId, planId) =>
      client.request<RenamePlan>("v2_rename_get_plan", { rootId, planId }),
    authorize: (rootId, planId) =>
      client.request<RenameAuthority>("v2_rename_authorize", { rootId, planId }),
    createBackup: (rootId, planId, authorityId) =>
      client.request<RenameBackupStatus>("v2_rename_create_backup", {
        rootId,
        planId,
        authorityId,
      }),
    prepare: (rootId, planId, authorityId, snapshotId) =>
      client.request<RenamePrepareStatus>("v2_rename_prepare", {
        rootId,
        planId,
        authorityId,
        snapshotId,
      }),
    getStatus: (rootId, operationId) =>
      client.request<RenameStatus>("v2_rename_get_status", { rootId, operationId }),
    recoveryStatus: (rootId) =>
      client.request<RenameRecoveryStatus>("v2_rename_recovery_status", { rootId }),
  };
}

export const renameApi = createRenameApi();
