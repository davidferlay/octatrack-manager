import { test, expect } from "@playwright/test";

const planId = `plan:v1:${"a".repeat(64)}`;
const operationId = `operation:v1:${"a".repeat(64)}`;
const authorityId = `authority:v1:${"b".repeat(64)}`;
const snapshotId = `snapshot:v1:${"c".repeat(64)}`;

test.describe("Rename prepare workflow", () => {
  test("reviews impacts and prepares a rename without apply", async ({ page }) => {
    const calls: string[] = [];
    await page.addInitScript(({ planId, operationId, authorityId, snapshotId }) => {
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
              rootId: "root-opaque",
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
          if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
            return {
              schema: cmd === "v2_change_recovery_status"
                ? "change-recovery-status:v1"
                : "rename-recovery-status:v1",
              recoveryRequired: false,
              operations: [],
            };
          }
          if (cmd === "v2_rename_plan") {
            return {
              outcome: "planned",
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
                referenceUpdates: [{
                  projectDocumentRelativePath: "LIVE_SET/PROJECT_A/project.work",
                  slotKind: "static",
                  slotNumber: 12,
                  fromRelativePath: "LIVE_SET/AUDIO/KICK.wav",
                  toRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
                }],
              }],
              usageEdgeImpacts: [],
              sidecarImpacts: [],
              backupRelativePaths: [
                "LIVE_SET/AUDIO/KICK.wav",
                "LIVE_SET/PROJECT_A/project.work",
              ],
              estimatedMediaAdditionalBytes: 2048,
              estimatedLocalStagingBytes: 4096,
              referenceUpdateCount: 1,
              warnings: ["Use only cloned/test media."],
              requiresExplicitApproval: true,
              overwriteAllowed: false,
              removesSourceOnApply: true,
            };
          }
          if (cmd === "v2_rename_get_plan") {
            return {
              outcome: "planned",
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
          if (cmd === "v2_rename_authorize") {
            return {
              schema: "rename-authority:v1",
              authorityId,
              planId,
              operationId,
              expiresInSeconds: 600,
            };
          }
          if (cmd === "v2_rename_create_backup") {
            return {
              schema: "rename-backup-status:v1",
              planId,
              snapshotId,
              state: "backup_verified",
              fileCount: 2,
              totalBytes: 4096,
              verified: true,
            };
          }
          if (cmd === "v2_rename_prepare") {
            return {
              schema: "rename-prepare-status:v1",
              planId,
              operationId,
              snapshotId,
              state: "prepared",
              stagedFileCount: 2,
              totalStagedBytes: 4096,
              projectRewriteCount: 1,
            };
          }
          if (cmd === "v2_rename_get_status") {
            return {
              schema: "rename-status:v1",
              operationId,
              planId,
              state: "prepared",
              backupSnapshotId: snapshotId,
              failureCode: null,
              planExpired: false,
            };
          }
          if (cmd === "v2_audio_get_waveform") {
            return {
              durationSeconds: 1,
              sampleRate: 44100,
              channels: 1,
              peaks: [{ min: -0.2, max: 0.4 }],
            };
          }
          if (cmd === "v2_metadata_load_manual_asset") {
            return { tags: [], note: "" };
          }
          return null;
        },
      };
    }, { planId, operationId, authorityId, snapshotId });

    await page.goto("/");
    await page.getByRole("button", { name: "Choose root..." }).click();
    await expect(page.getByText("PROJECT_A")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Edit" })).toBeEnabled();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByTestId("app-shell-sources").getByText("EDIT ENABLED", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /KICK\.wav/ }).click();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("New file name").fill("KICK_DEEP.wav");
    await page.getByRole("button", { name: "Review Rename" }).click();
    await expect(page.getByText("1 reference will be updated")).toBeVisible();
    await page.getByRole("button", { name: "Approve & Prepare" }).click();
    await expect(page.getByText("Rename prepared")).toBeVisible();
    await expect(page.getByText(/No Octatrack media changes have been applied/i)).toBeVisible();

    const invokeCalls = await page.evaluate(() => (window as any).__E2E_INVOKE_CALLS__ ?? []);
    calls.push(...invokeCalls);
    const authorizeIndex = calls.indexOf("v2_rename_authorize");
    const backupIndex = calls.indexOf("v2_rename_create_backup");
    const prepareIndex = calls.indexOf("v2_rename_prepare");
    expect(authorizeIndex).toBeGreaterThan(-1);
    expect(backupIndex).toBeGreaterThan(authorizeIndex);
    expect(prepareIndex).toBeGreaterThan(backupIndex);
    expect(calls.filter((cmd) => cmd === "v2_rename_authorize")).toHaveLength(1);
    expect(calls.includes("v2_rename_apply")).toBe(false);
  });

  test("shows blocked rename without Approve & Prepare", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_ROOT_PATH__ = "/tmp/fixture-root";
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "v2_root_register") {
            return {
              rootId: "root-opaque",
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
          if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
            return {
              schema: cmd === "v2_change_recovery_status"
                ? "change-recovery-status:v1"
                : "rename-recovery-status:v1",
              recoveryRequired: false,
              operations: [],
            };
          }
          if (cmd === "v2_rename_plan") {
            return {
              outcome: "blocked",
              schema: "rename-blocked:v1",
              sourceRelativePath: "LIVE_SET/AUDIO/KICK.wav",
              destinationRelativePath: "LIVE_SET/AUDIO/KICK_DEEP.wav",
              observedStateDocumentCount: 1,
              observedUsageEdgeCount: 1,
              observedSidecarCount: 0,
              referenceUpdateCount: 0,
              blockReasons: [{
                code: "DESTINATION_OCCUPIED",
                message: "destination already exists",
              }],
            };
          }
          if (cmd === "v2_audio_get_waveform") {
            return {
              durationSeconds: 1,
              sampleRate: 44100,
              channels: 1,
              peaks: [{ min: -0.2, max: 0.4 }],
            };
          }
          if (cmd === "v2_metadata_load_manual_asset") {
            return { tags: [], note: "" };
          }
          return null;
        },
      };
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Choose root..." }).click();
    await expect(page.getByText("PROJECT_A")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Edit" })).toBeEnabled();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByTestId("app-shell-sources").getByText("EDIT ENABLED", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /KICK\.wav/ }).click();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("New file name").fill("KICK_DEEP.wav");
    await page.getByRole("button", { name: "Review Rename" }).click();
    await expect(page.getByText("Rename blocked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve & Prepare" })).toHaveCount(0);
  });
});
