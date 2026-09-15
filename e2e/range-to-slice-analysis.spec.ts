import { test, expect } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";

test("library range selection flows into explicit slice analysis", async ({ page }) => {
  await page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-range-slice-root";
    const analysisRegion = { startFrame: "11025", endExclusive: "22050" };
    let revision = 0;
    let markers: any[] = [];
    source.__E2E_SLICE_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_SLICE_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-range-slice",
            displayName: "Synthetic range slice",
            deviceFingerprint: `rootfp:v1:${"d".repeat(64)}`,
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
              displayName: "RANGE.wav",
              relativePath: "DRUMS/AUDIO/RANGE.wav",
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
        if (cmd === "v2_audio_preview_range_create") {
          return {
            previewToken: "preview-range",
            mimeType: "audio/wav",
            byteLength: 100,
            truncated: false,
            sampleRate: 44100,
            range: args.range,
          };
        }
        if (cmd === "v2_audio_preview_read") {
          return new Uint8Array(100);
        }
        if (cmd === "v2_audio_onsets_start") {
          return {
            jobId: "job-range",
            phase: "ready",
            error: null,
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            region: args.region ?? analysisRegion,
          };
        }
        if (cmd === "v2_slice_draft_get") {
          return {
            revision,
            region: analysisRegion,
            markers,
            canUndo: false,
            canRedo: false,
          };
        }
        if (cmd === "v2_audio_waveform_range_get") {
          return { range: args.range, peaks: [[[-0.5, 0.5]]] };
        }
        if (cmd === "v2_slice_proposal_create") {
          return {
            proposalId: `proposal-${revision}`,
            expectedRevision: revision,
            candidateCount: 1,
            suppressedCount: 0,
            exceedsDraftLimit: false,
            candidates: [{
              candidateId: "candidate-11025",
              noveltyPeakFrame: "11025",
              estimatedAttackFrame: "11025",
              suggestedStartFrame: "11025",
              strength: 0.8,
              bandScores: [5, 4, 3],
              thresholdMargin: 2,
              uncertainty: { startFrame: "11025", endExclusive: "11026" },
              warnings: [],
            }],
          };
        }
        if (cmd === "v2_slice_draft_update") {
          if (args.edit?.kind === "acceptProposal") {
            markers = [{
              markerId: "candidate-11025",
              startFrame: "11025",
              endExclusive: "22050",
              locked: false,
              manual: false,
            }];
            revision += 1;
          }
          return {
            revision,
            region: analysisRegion,
            markers,
            canUndo: true,
            canRedo: false,
          };
        }
        return null;
      },
    };
  });

  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
  await clickCatalogFileRow(page, "ja", "RANGE.wav");

  await page.getByLabel(uiText("ja", "waveform.startFrame")).fill("11025");
  await page.getByLabel(uiText("ja", "waveform.endFrame")).fill("22050");
  await page.getByRole("button", { name: uiText("ja", "waveform.playRange") }).click();

  await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
  const slice = page.getByRole("region", { name: uiText("ja", "slicing.ariaFor", { displayName: "RANGE.wav" }) });
  await slice.getByRole("button", { name: uiText("ja", "slicing.analyzeSelectedRange") }).click();

  await expect(slice.getByLabel(uiText("ja", "slicing.analysisRegionHeading"))).toContainText("11025");
  await expect(slice.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();

  const starts = await page.evaluate(() =>
    (window as any).__E2E_SLICE_CALLS__.filter((c: any) => c.cmd === "v2_audio_onsets_start"),
  );
  expect(starts).toHaveLength(1);
  expect(starts[0].args.region).toEqual({ startFrame: "11025", endExclusive: "22050" });

  await slice.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") }).click();
  await expect(slice.getByLabel("Start frame candidate-11025")).toHaveValue("11025");
});
