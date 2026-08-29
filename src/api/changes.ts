import { ipcClient, type IpcClient } from "./client";

export interface ChangePlan {
  schema: "change-plan:v1";
  planId: string;
  operationId: string;
  operation: "additive_copy";
  sourceRelativePath: string;
  destinationRelativePath: string;
  byteSize: number;
  estimatedAdditionalBytes: number;
  backupRelativePaths: string[];
  warnings: string[];
  requiresExplicitApproval: true;
  overwriteAllowed: false;
  deleteCount: 0;
}

export type ChangeOperationState =
  | "planned"
  | "applying"
  | "committed"
  | "failed"
  | "recovery_required";

export interface ChangeStatus {
  schema: "change-status:v1";
  operationId: string;
  planId: string;
  state: ChangeOperationState;
  recoveryRequired: boolean;
  catalogRefreshRequired: boolean;
  failureCode: string | null;
  backupSnapshotId: string | null;
}

export interface ChangeRecoveryStatus {
  schema: "change-recovery-status:v1";
  recoveryRequired: boolean;
  operations: ChangeStatus[];
}

export interface ChangeApi {
  planAdditiveCopy(
    rootId: string,
    sourceFileInstanceId: string,
    destinationRelativePath: string,
  ): Promise<ChangePlan>;
  getPlan(rootId: string, planId: string): Promise<ChangePlan>;
  applyChange(
    rootId: string,
    planId: string,
    approvedPlanId: string,
  ): Promise<ChangeStatus>;
  changeStatus(rootId: string, operationId: string): Promise<ChangeStatus>;
  recoveryStatus(rootId: string): Promise<ChangeRecoveryStatus>;
}

export function createChangeApi(client: IpcClient = ipcClient): ChangeApi {
  return {
    planAdditiveCopy: (rootId, sourceFileInstanceId, destinationRelativePath) =>
      client.request<ChangePlan>("v2_change_plan", {
        rootId,
        sourceFileInstanceId,
        destinationRelativePath,
      }),
    getPlan: (rootId, planId) =>
      client.request<ChangePlan>("v2_change_get_plan", { rootId, planId }),
    applyChange: (rootId, planId, approvedPlanId) =>
      client.request<ChangeStatus>("v2_change_apply", {
        rootId,
        planId,
        approvedPlanId,
      }),
    changeStatus: (rootId, operationId) =>
      client.request<ChangeStatus>("v2_change_status", { rootId, operationId }),
    recoveryStatus: (rootId) =>
      client.request<ChangeRecoveryStatus>("v2_change_recovery_status", { rootId }),
  };
}

export const changeApi = createChangeApi();
