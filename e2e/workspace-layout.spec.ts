import { test, expect } from "@playwright/test";
import { catalogFileRowLocator, clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { expectNarrowShellClass, showInspectorFromContextBar } from "./narrowWorkspace";
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

function installWorkspaceFixture(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
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
}

test.describe("Workspace layout (synthetic IPC)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("connects catalog nav to sample list and inspector at 1280px", async ({ page }) => {
    await installJaLocale(page);
    await installWorkspaceFixture(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await chooseRoot(page);
    await expect(catalogFileRowLocator(page, "ja", "KICK.wav")).toBeVisible();
    await clickCatalogFileRow(page, "ja", "KICK.wav");
    await expect(
      page.getByRole("complementary", { name: uiText("ja", "inspector.aria") }),
    ).toContainText("KICK.wav");
  });

  test("wide layout keeps list and inspector visible together at 1280px", async ({ page }) => {
    await installJaLocale(page);
    await installWorkspaceFixture(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await chooseRoot(page);
    await expect(page.locator(".mo-app-shell--workspace")).toBeVisible({ timeout: 30000 });
    const shell = page.locator(".mo-app-shell");
    await expect(shell).not.toHaveClass(/mo-app-shell--narrow/);
    const listHeading = page.getByRole("heading", { name: uiText("ja", "library.audioFilesHeading") });
    const inspector = page.locator("aside.mo-inspector-pane");
    await clickCatalogFileRow(page, "ja", "KICK.wav");
    await expect(listHeading).toBeVisible();
    await expect(inspector).toBeVisible();
  });
});

test.describe.fixme("Workspace layout narrow (840px viewport)", () => {
  test.use({ viewport: { width: 840, height: 900 } });

  test("exposes narrow layout toggles at 840px", async ({ page }) => {
    await installJaLocale(page);
    await installWorkspaceFixture(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await chooseRoot(page);
    await expect(catalogFileRowLocator(page, "ja", "KICK.wav")).toBeVisible({ timeout: 60000 });
    await expectNarrowShellClass(page);
    const contextBar = page.getByTestId("app-shell-context");
    await expect(contextBar.getByRole("button", { name: uiText("ja", "workspace.toggleNav") })).toBeVisible({
      timeout: 15000,
    });
    await expect(contextBar.getByRole("button", { name: uiText("ja", "workspace.showInspector") })).toBeVisible({
      timeout: 15000,
    });
  });

  test("stacks list and inspector at 840px", async ({ page }) => {
    await installJaLocale(page);
    await installWorkspaceFixture(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await chooseRoot(page);
    await expect(catalogFileRowLocator(page, "ja", "KICK.wav")).toBeVisible({ timeout: 60000 });
    await expectNarrowShellClass(page);
    const listHeading = page.getByRole("heading", { name: uiText("ja", "library.audioFilesHeading") });
    const inspector = page.locator("aside.mo-inspector-pane");
    await expect(listHeading).toBeVisible();
    await expect(inspector).not.toBeVisible();
    await showInspectorFromContextBar(page, "ja");
    await expect(inspector).toBeVisible();
    await expect(listHeading).not.toBeVisible();
  });
});
