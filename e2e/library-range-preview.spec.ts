import { test, expect } from "@playwright/test";

function installLibraryMocks(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-range-preview-root";
    source.__E2E_RANGE_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_RANGE_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-range",
            displayName: "Synthetic range preview",
            deviceFingerprint: `rootfp:v1:${"a".repeat(64)}`,
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
              fileInstanceId: "file-range",
              assetId: "asset-range",
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
        if (cmd === "v2_audio_preview_range_create") {
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

async function exerciseRangePreview(page: import("@playwright/test").Page) {
  await installLibraryMocks(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Choose root..." }).click();
  await page.getByRole("button", { name: /LOOP\.wav/ }).click();
  await expect(page.getByRole("img", { name: "Audio waveform" })).toBeVisible();
  await page.getByLabel("Start frame").fill("1000");
  await page.getByLabel("End frame (exclusive)").fill("2000");
  await page.getByRole("button", { name: "Play selected range" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const calls = (window as any).__E2E_RANGE_CALLS__ ?? [];
    return calls.some((entry: any) => entry.cmd === "v2_audio_preview_range_create");
  })).toBe(true);
  const calls: any[] = await page.evaluate(() => (window as any).__E2E_RANGE_CALLS__);
  const createCall = calls.find((entry) => entry.cmd === "v2_audio_preview_range_create");
  expect(createCall.args.assetId).toBe("asset-range");
  expect(createCall.args.range).toEqual({
    startFrame: "1000",
    endFrameExclusive: "2000",
  });
  expect(calls.some((entry) => entry.cmd === "v2_audio_preview_read")).toBe(true);
}

test("keeps selection and calls range preview IPC at 1280px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await exerciseRangePreview(page);
});

test("keeps selection and calls range preview IPC at 840px", async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 900 });
  await exerciseRangePreview(page);
});
