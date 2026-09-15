import { test, expect } from "@playwright/test";
import { uiText } from "./i18n";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";

function installLibraryMocks(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const source = window as any;
    source.__E2E_WAVEFORM_CALLS__ = [];
    source.__E2E_RANGE_CALLS__ = [];
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-zoom-range-root";
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        if (cmd === "v2_audio_waveform_query") {
          source.__E2E_WAVEFORM_CALLS__.push(args);
          const range = args.query?.range ?? { startFrame: "0", endFrameExclusive: "44100" };
          return {
            analyzerVersion: "waveform:v2",
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            range,
            framesPerPeak: "256",
            channelPeaks: [[{ min: -0.5, max: 0.5 }]],
          };
        }
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-zoom",
            displayName: "Synthetic zoom",
            deviceFingerprint: `rootfp:v1:${"c".repeat(64)}`,
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
              fileInstanceId: "file-zoom",
              assetId: "asset-zoom",
              displayName: "ZOOM.wav",
              relativePath: "DRUMS/AUDIO/ZOOM.wav",
              byteSize: 88244,
              storageScope: "set_audio_pool",
            }],
          };
        }
        if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") {
          return { recoveryRequired: false, operations: [] };
        }
        if (cmd === "v2_asset_metadata_get") return { tags: [], note: "" };
        if (cmd === "v2_audio_preview_range_create") {
          source.__E2E_RANGE_CALLS__.push({ cmd, args });
          return {
            previewToken: "preview:v1:range",
            expiresInSeconds: 120,
            mimeType: "audio/wav",
            byteLength: 4,
            durationMillis: 500,
            truncated: false,
            sampleRate: 44100,
            range: args.range,
          };
        }
        if (cmd === "v2_audio_preview_read") {
          return new Uint8Array([82, 73, 70, 70]).buffer;
        }
        return null;
      },
    };
  });
}

test("zoom, pan, and keyboard range preview in ja", async ({ page }) => {
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, "ja");
  }, LOCALE_STORAGE_KEY);
  await installLibraryMocks(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
  await page.getByRole("button", { name: /ZOOM\.wav/ }).click();
  const waveform = page.getByRole("region", {
    name: uiText("ja", "waveform.ariaFor", { displayName: "ZOOM.wav" }),
  });
  await expect(waveform.getByRole("img", { name: uiText("ja", "waveform.plotAria") })).toBeVisible();

  await waveform.getByRole("button", { name: uiText("ja", "waveform.zoomIn") }).click();
  await expect.poll(async () => {
    const calls: any[] = await page.evaluate(() => (window as any).__E2E_WAVEFORM_CALLS__ ?? []);
    return calls.some((entry) => entry.query?.range?.startFrame !== undefined
      && entry.query.range.startFrame !== "0");
  }).toBe(true);

  await waveform.getByRole("button", { name: uiText("ja", "waveform.panLater") }).click();
  await waveform.getByRole("button", { name: uiText("ja", "waveform.showAll") }).click();

  await waveform.getByLabel(uiText("ja", "waveform.startFrame")).fill("1000");
  await waveform.getByLabel(uiText("ja", "waveform.endFrame")).fill("5000");
  await waveform.getByRole("button", { name: uiText("ja", "waveform.playRange") }).click();
  await expect.poll(async () => page.evaluate(() => {
    const calls = (window as any).__E2E_RANGE_CALLS__ ?? [];
    return calls.some((entry: any) => entry.cmd === "v2_audio_preview_range_create");
  })).toBe(true);
  const rangeCall = await page.evaluate(() => {
    const calls = (window as any).__E2E_RANGE_CALLS__ ?? [];
    return calls.find((entry: any) => entry.cmd === "v2_audio_preview_range_create")?.args?.range;
  });
  expect(rangeCall).toEqual({ startFrame: "1000", endFrameExclusive: "5000" });
});

test("zoom controls fit 840px inspector width in en", async ({ page }) => {
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, "en");
  }, LOCALE_STORAGE_KEY);
  await installLibraryMocks(page);
  await page.setViewportSize({ width: 840, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("en", "sources.chooseRoot") }).click();
  await page.getByRole("button", { name: /ZOOM\.wav/ }).click();
  await expect(page.getByRole("button", { name: uiText("en", "waveform.zoomIn") })).toBeVisible();
  await expect(page.getByRole("button", { name: uiText("en", "waveform.fitSelection") })).toBeVisible();
});
