import { test, expect } from "@playwright/test";

const planId = `plan:v1:${"a".repeat(64)}`;
const operationId = `operation:v1:${"a".repeat(64)}`;
const authorityId = `authority:v1:${"b".repeat(64)}`;
const snapshotId = `snapshot:v1:${"c".repeat(64)}`;
const continuationAuthorityId = `continuation-authority:v1:${"g".repeat(64)}`;
const cloneRootId = "clone-root-opaque";

function librarySnapshot() {
  return {
    sets: [{
      displayName: "LIVE_SET",
      relativePath: "LIVE_SET",
      hasAudioPool: true,
      projects: [{
        displayName: "PROJECT_A",
        relativePath: "LIVE_SET/PROJECT_A",
        hasProjectFile: true,
        hasBanks: true,
      }],
    }],
    standaloneProjects: [],
    audioFiles: [{
      fileInstanceId: `fileinst:v1:${"d".repeat(64)}`,
      assetId: `asset:v1:${"e".repeat(64)}`,
      displayName: "KICK.wav",
      relativePath: "LIVE_SET/AUDIO/KICK.wav",
      byteSize: 2048,
      storageScope: "set_audio_pool",
    }],
    usageEdges: [],
  };
}

function preparedPlan() {
  return {
    schema: "rename-plan:v1",
    planId,
    operationId,
    operation: "rename_sample",
    sourceFileInstanceId: `fileinst:v1:${"d".repeat(64)}`,
    sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
    destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
    stateDocumentImpacts: [{
      relativePath: "LIVE_SET/PROJECT_A/project.work",
      role: "working",
      referenceUpdates: [],
    }],
    usageEdgeImpacts: [],
    sidecarImpacts: [],
    backupRelativePaths: ["LIVE_SET/AUDIO/KICK.wav"],
    estimatedMediaAdditionalBytes: 2048,
    estimatedLocalStagingBytes: 4096,
    referenceUpdateCount: 1,
    warnings: [],
    requiresExplicitApproval: true,
    overwriteAllowed: false,
    removesSourceOnApply: true,
  };
}

test.describe("Rename operator workflow", () => {
  test("managed clone then continue and apply prepared rename", async ({ page }) => {
    let activeRootId = "root-opaque";
    await page.addInitScript(({ cloneRootId }) => {
      (window as any).__E2E_ROOT_PATH__ = "/tmp/fixture-root";
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          (window as any).__E2E_INVOKE_CALLS__ = [
            ...((window as any).__E2E_INVOKE_CALLS__ ?? []),
            cmd,
          ];
          if (cmd === "v2_root_register") {
            return {
              rootId: activeRootId,
              displayName: "Fixture Root",
              deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
              mode: "read_only",
              observedRevision: 1,
              expiresInSeconds: 3600,
              writeGrantExpiresInSeconds: null,
              capabilities: { read: true, write: true, stableDeviceIdentity: true },
            };
          }
          if (cmd === "v2_root_status" || cmd === "v2_root_enable_write") {
            return {
              rootId: activeRootId,
              displayName: "Fixture Root",
              deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
              mode: "write_enabled",
              observedRevision: 1,
              expiresInSeconds: 3600,
              writeGrantExpiresInSeconds: 600,
              capabilities: { read: true, write: true, stableDeviceIdentity: true },
            };
          }
          if (cmd === "v2_library_list") return librarySnapshot();
          if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
            return {
              schema: cmd === "v2_change_recovery_status"
                ? "change-recovery-status:v1"
                : "rename-recovery-status:v1",
              recoveryRequired: false,
              operations: cmd === "v2_rename_recovery_status" ? [{
                schema: "rename-status:v1",
                operationId,
                planId,
                state: "prepared",
                backupSnapshotId: snapshotId,
                failureCode: null,
                planExpired: true,
                recoveryEligible: false,
              }] : [],
            };
          }
          if (cmd === "v2_clone_create_managed") {
            activeRootId = cloneRootId;
            return {
              schema: "managed-clone:v1",
              cloneRootId,
              cloneVerificationId: `clone-verification:v1:${"h".repeat(64)}`,
              entryCount: 12,
              sourceRootClosed: true,
            };
          }
          if (cmd === "v2_clone_verification_status") {
            return {
              schema: "clone-verification:v1",
              cloneVerificationId: `clone-verification:v1:${"h".repeat(64)}`,
              cloneRootId: activeRootId,
              provenance: "app_managed",
              state: "verified",
              entryCount: 12,
              expiresInSeconds: 600,
            };
          }
          if (cmd === "v2_rename_get_prepared_plan" || cmd === "v2_rename_get_plan") {
            return preparedPlan();
          }
          if (cmd === "v2_rename_continuation_status") {
            return {
              schema: "rename-continuation-status:v1",
              operationId,
              planId,
              state: "ready_to_continue",
              preparedSnapshotAvailable: true,
              backupVerified: true,
              cloneVerified: true,
            };
          }
          if (cmd === "v2_rename_continue") {
            return {
              schema: "rename-continuation-authority:v1",
              operationId,
              continuationAuthorityId,
              expiresInSeconds: 120,
            };
          }
          if (cmd === "v2_rename_apply") {
            return {
              schema: "rename-apply-status:v2",
              planId,
              operationId,
              snapshotId,
              mutationState: "committed",
              verificationState: "passed",
              verificationCode: null,
              rescanCompleted: true,
              observedFileCount: 4,
              missingReferenceCount: 0,
              invalidReferenceCount: 0,
              unresolvedReferenceCount: 0,
            };
          }
          return {};
        },
      };
    }, { cloneRootId });

    await page.goto("/");
    await page.getByRole("button", { name: "Choose root..." }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Create managed disposable clone" }).click();
    await expect(page.getByText("VERIFIED CLONE")).toBeVisible();
    await page.getByRole("checkbox", {
      name: /approve continuing this exact operation/i,
    }).check();
    await page.getByRole("button", { name: "Continue prepared rename" }).click();
    await page.getByRole("checkbox", {
      name: /approve applying this exact rename/i,
    }).check();
    await page.getByRole("button", { name: "Apply approved rename" }).click();
    await expect(page.getByText(/COMMITTED/i)).toBeVisible();
    await expect(page.getByText(/VERIFIED/i)).toBeVisible();

    const calls: string[] = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
    expect(calls.filter((cmd) => cmd === "v2_rename_apply")).toHaveLength(1);
    expect(calls).toContain("v2_clone_create_managed");
    expect(calls).toContain("v2_rename_get_prepared_plan");
  });

  test("redisplays durable prepared plan after reload", async ({ page }) => {
    await page.addInitScript(() => {
      const planId = `plan:v1:${"a".repeat(64)}`;
      const operationId = `operation:v1:${"a".repeat(64)}`;
      const snapshotId = `snapshot:v1:${"c".repeat(64)}`;
      (window as any).__E2E_ROOT_PATH__ = "/tmp/fixture-root";
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "v2_root_register" || cmd === "v2_root_status" || cmd === "v2_root_enable_write") {
            return {
              rootId: "root-opaque",
              displayName: "Fixture Root",
              deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
              mode: "write_enabled",
              observedRevision: 1,
              expiresInSeconds: 3600,
              writeGrantExpiresInSeconds: 600,
              capabilities: { read: true, write: true, stableDeviceIdentity: true },
            };
          }
          if (cmd === "v2_library_list") {
            return {
              sets: [],
              standaloneProjects: [],
              audioFiles: [],
              usageEdges: [],
            };
          }
          if (cmd === "v2_change_recovery_status") {
            return { schema: "change-recovery-status:v1", recoveryRequired: false, operations: [] };
          }
          if (cmd === "v2_rename_recovery_status") {
            return {
              schema: "rename-recovery-status:v1",
              recoveryRequired: false,
              operations: [{
                schema: "rename-status:v1",
                operationId,
                planId,
                state: "prepared",
                backupSnapshotId: snapshotId,
                failureCode: null,
                planExpired: true,
                recoveryEligible: false,
              }],
            };
          }
          if (cmd === "v2_clone_verification_status") {
            return {
              schema: "clone-verification:v1",
              cloneVerificationId: `clone-verification:v1:${"h".repeat(64)}`,
              cloneRootId: "root-opaque",
              provenance: "app_managed",
              state: "verified",
              entryCount: 12,
              expiresInSeconds: 600,
            };
          }
          if (cmd === "v2_rename_get_prepared_plan") {
            return {
              schema: "rename-plan:v1",
              planId,
              operationId,
              operation: "rename_sample",
              sourceFileInstanceId: `fileinst:v1:${"d".repeat(64)}`,
              sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
              destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
              stateDocumentImpacts: [],
              usageEdgeImpacts: [],
              sidecarImpacts: [],
              backupRelativePaths: ["LIVE_SET/AUDIO/KICK.wav"],
              estimatedMediaAdditionalBytes: 2048,
              estimatedLocalStagingBytes: 4096,
              referenceUpdateCount: 1,
              warnings: [],
              requiresExplicitApproval: true,
              overwriteAllowed: false,
              removesSourceOnApply: true,
            };
          }
          if (cmd === "v2_rename_continuation_status") {
            return {
              schema: "rename-continuation-status:v1",
              operationId,
              planId,
              state: "ready_to_continue",
              preparedSnapshotAvailable: true,
              backupVerified: true,
              cloneVerified: true,
            };
          }
          return {};
        },
      };
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Choose root..." }).click();
    await expect(page.getByText("LIVE_SET/AUDIO/KICK.wav")).toBeVisible();
    await page.reload();
    await expect(page.getByText("LIVE_SET/AUDIO/KICK_DEEP.wav")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue prepared rename" })).toBeVisible();
  });
});
