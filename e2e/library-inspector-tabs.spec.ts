import { test, expect } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { expectNarrowShellClass, showInspectorFromContextBar } from "./narrowWorkspace";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";

function installLibraryMocks(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-inspector-tabs-root";
    source.__E2E_IPC_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_IPC_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-tabs",
            displayName: "Synthetic inspector tabs",
            deviceFingerprint: `rootfp:v1:${"b".repeat(64)}`,
            mode: "read_only",
            observedRevision: 1,
            expiresInSeconds: 3600,
            writeGrantExpiresInSeconds: null,
            capabilities: { read: true, write: true, stableDeviceIdentity: true },
          };
        }
        if (cmd === "v2_library_list") {
          return {
            sets: [{ displayName: "DRUMS", relativePath: "DRUMS", hasAudioPool: true, projects: [] }],
            standaloneProjects: [],
            usageEdges: [],
            audioFiles: [{
              fileInstanceId: "file-tabs",
              assetId: "asset-tabs",
              displayName: "LOOP.wav",
              relativePath: "DRUMS/AUDIO/LOOP.wav",
              byteSize: 88244,
              storageScope: "set_audio_pool",
            }],
          };
        }
        if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
          return { recoveryRequired: false, operations: [] };
        }
        if (cmd === "v2_asset_metadata_get") return { tags: [], note: "" };
        if (cmd === "v2_audio_waveform_query") {
          return {
            analyzerVersion: "waveform:v2",
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            range: { startFrame: "0", endFrameExclusive: "44100" },
            framesPerPeak: "256",
            channelPeaks: [[{ min: -0.5, max: 0.5 }]],
          };
        }
        return null;
      },
    };
  });
}

async function installLocale(page: import("@playwright/test").Page, locale: "ja" | "en") {
  await page.addInitScript(
    ([storageKey, localeId]) => {
      localStorage.setItem(storageKey, localeId);
    },
    [LOCALE_STORAGE_KEY, locale] as const,
  );
}

async function openSampleInspector(
  page: import("@playwright/test").Page,
  locale: "ja" | "en",
  narrow: boolean,
) {
  await installLocale(page, locale);
  await installLibraryMocks(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: uiText(locale, "sources.chooseRoot") }).click();
  await clickCatalogFileRow(page, locale, "LOOP.wav");
  if (narrow) {
    await expectNarrowShellClass(page);
    await showInspectorFromContextBar(page, locale);
  }
  await expect(page.getByRole("tab", { name: uiText(locale, "inspector.tabPreview") })).toBeVisible();
}

for (const locale of ["ja", "en"] as const) {
  test(`[${locale}] inspector tabs keep preview state at 1280px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSampleInspector(page, locale, false);

    await page.getByLabel(uiText(locale, "waveform.startFrame")).fill("1000");
    await page.getByRole("tab", { name: uiText(locale, "inspector.tabInfo") }).click();
    await expect(page.getByText(uiText(locale, "inspector.infoScope"))).toBeVisible();

    await page.getByRole("tab", { name: uiText(locale, "inspector.tabNotes") }).click();
    const note = page.getByRole("textbox", { name: uiText(locale, "metadata.noteAria") });
    await note.fill("tab persistence");

    await page.getByRole("tab", { name: uiText(locale, "inspector.tabPreview") }).click();
    await expect(page.getByLabel(uiText(locale, "waveform.startFrame"))).toHaveValue("1000");
    await page.getByRole("tab", { name: uiText(locale, "inspector.tabNotes") }).click();
    await expect(page.getByRole("textbox", { name: uiText(locale, "metadata.noteAria") })).toHaveValue(
      "tab persistence",
    );

    const waveformQueries = await page.evaluate(() => {
      const calls = (window as any).__E2E_IPC_CALLS__ ?? [];
      return calls.filter((entry: any) => entry.cmd === "v2_audio_waveform_query").length;
    });
    expect(waveformQueries).toBeLessThanOrEqual(2);
  });

  test(`[${locale}] inspector tabs at 840px narrow layout`, async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await openSampleInspector(page, locale, true);
    await page.getByRole("tab", { name: uiText(locale, "inspector.tabUsage") }).click();
    await expect(page.getByLabel(uiText(locale, "usage.aria"))).toContainText(
      uiText(locale, "usage.heading"),
    );
  });
}
