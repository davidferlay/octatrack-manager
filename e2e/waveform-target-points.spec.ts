import { test, expect } from "@playwright/test";
import { uiText } from "./i18n";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";

test("uses width-quantized targetPoints for v2_audio_waveform_query", async ({ page }) => {
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, "ja");
    const source = window as any;
    source.__E2E_WAVEFORM_CALLS__ = [];
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-waveform-width-root";
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        if (cmd === "v2_audio_waveform_query") {
          source.__E2E_WAVEFORM_CALLS__.push(args);
        }
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-width",
            displayName: "Synthetic width",
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
              fileInstanceId: "file-width",
              assetId: "asset-width",
              displayName: "HIT.wav",
              relativePath: "DRUMS/AUDIO/HIT.wav",
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
  }, LOCALE_STORAGE_KEY);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
  await page.getByRole("button", { name: /HIT\.wav/ }).click();
  await expect(page.getByRole("img", { name: uiText("ja", "waveform.plotAria") })).toBeVisible();

  await expect.poll(async () => {
    const calls: any[] = await page.evaluate(() => (window as any).__E2E_WAVEFORM_CALLS__ ?? []);
    return calls.length;
  }).toBeGreaterThan(0);

  const calls: any[] = await page.evaluate(() => (window as any).__E2E_WAVEFORM_CALLS__);
  const targetPoints = calls[0]?.query?.targetPoints;
  expect(typeof targetPoints).toBe("number");
  expect(targetPoints).toBeGreaterThanOrEqual(32);
  expect(targetPoints).toBeLessThanOrEqual(4096);
  expect(targetPoints % 64).toBe(0);
});
