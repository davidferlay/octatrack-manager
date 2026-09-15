import { test, expect } from "@playwright/test";
import { uiText } from "./i18n";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";

async function installJaLocale(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ([storageKey, localeId]) => {
      localStorage.setItem(storageKey, localeId);
    },
    [LOCALE_STORAGE_KEY, "ja"] as const,
  );
}

async function chooseRoot(page: import("@playwright/test").Page) {
  const chooseRootButton = page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") });
  await expect(chooseRootButton).toBeVisible({ timeout: 15000 });
  await chooseRootButton.click();
}

test.describe("Workspace layout (synthetic IPC)", () => {
  test("connects catalog nav to sample list and inspector at 1280px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installJaLocale(page);
    await page.addInitScript(() => {
      (window as Window & { __E2E_ROOT_PATH__?: string }).__E2E_ROOT_PATH__ = "/tmp/fixture-root";
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "v2_root_register") {
            return {
              rootId: "root-opaque",
              displayName: "Fixture Root",
              deviceFingerprint: "0123456789abcdef",
              mode: "read_only",
              observedRevision: 1,
              expiresInSeconds: 3600,
              capabilities: { read: true, write: false, stableDeviceIdentity: true },
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
                fileInstanceId: "fileinst:v1:opaque",
                assetId: "asset:v1:opaque",
                displayName: "KICK.wav",
                relativePath: "LIVE_SET/AUDIO/KICK.wav",
                byteSize: 2048,
                storageScope: "set_audio_pool",
              }],
              usageEdges: [],
            };
          }
          if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
            return { schema: cmd, recoveryRequired: false, operations: [] };
          }
          if (cmd === "v2_clone_verification_status") return null;
          if (cmd === "v2_audio_waveform_query") {
            return {
              analyzerVersion: "waveform:v2",
              sampleRate: 44100,
              channels: 1,
              frameCount: "44100",
              range: { startFrame: "0", endFrameExclusive: "44100" },
              framesPerPeak: "256",
              channelPeaks: [[{ min: -0.2, max: 0.4 }]],
            };
          }
          if (cmd === "v2_asset_metadata_get") {
            return { tags: [], note: "" };
          }
          throw new Error(`Unexpected IPC in workspace-layout fixture: ${cmd}`);
        },
      };
    });

    await page.goto("/");
    await chooseRoot(page);
    await expect(page.getByRole("button", { name: /KICK\.wav/ })).toBeVisible();
    await page.getByRole("button", { name: /KICK\.wav/ }).click();
    await expect(page.getByLabel(uiText("ja", "inspector.aria"))).toContainText("KICK.wav");
  });

  test("exposes narrow layout toggles at 840px", async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await installJaLocale(page);
    await page.addInitScript(() => {
      (window as Window & { __E2E_ROOT_PATH__?: string }).__E2E_ROOT_PATH__ = "/tmp/fixture-root";
      (window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "v2_root_register") {
            return {
              rootId: "root-opaque",
              displayName: "Fixture Root",
              deviceFingerprint: "0123456789abcdef",
              mode: "read_only",
              observedRevision: 1,
              expiresInSeconds: 3600,
              capabilities: { read: true, write: false, stableDeviceIdentity: true },
            };
          }
          if (cmd === "v2_library_list") {
            return { sets: [], standaloneProjects: [], audioFiles: [], usageEdges: [] };
          }
          if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
            return { schema: cmd, recoveryRequired: false, operations: [] };
          }
          if (cmd === "v2_clone_verification_status") return null;
          throw new Error(`Unexpected IPC in workspace-layout narrow fixture: ${cmd}`);
        },
      };
    });

    await page.goto("/");
    await chooseRoot(page);
    await page.waitForFunction(() => window.matchMedia("(max-width: 840px)").matches);
    const contextBar = page.getByTestId("app-shell-context");
    await expect(contextBar.getByRole("button", { name: uiText("ja", "workspace.toggleNav") })).toBeVisible({
      timeout: 15000,
    });
    await expect(contextBar.getByRole("button", { name: uiText("ja", "workspace.showInspector") })).toBeVisible({
      timeout: 15000,
    });
  });
});
