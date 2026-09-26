import { test, expect, type Locator } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { installDerivationIpcDefaults } from "./derivationIpcMocks";

const RANGE_A = { startFrame: "11025", endExclusive: "22050" };

function parseFramesLine(text: string): { startFrame: string; endExclusive: string } | null {
  const match = text.match(/(?:Frames|フレーム) \[(\d+), (\d+)\)/);
  if (!match) return null;
  return { startFrame: match[1], endExclusive: match[2] };
}

async function dragPendingRangeOnSliceWaveform(slice: Locator) {
  const waveform = slice.getByLabel("Slice waveform");
  await expect(waveform).toBeVisible();
  const box = await waveform.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  const xStart = box!.x + box!.width * 0.2;
  const xEnd = box!.x + box!.width * 0.8;
  await waveform.evaluate(
    (svg, coords) => {
      const fire = (type: string, clientX: number) => {
        svg.dispatchEvent(
          new PointerEvent(type, {
            clientX,
            clientY: coords.y,
            pointerId: 1,
            pointerType: "mouse",
            bubbles: true,
            cancelable: true,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      };
      fire("pointerdown", coords.xStart);
      fire("pointermove", coords.xEnd);
      fire("pointerup", coords.xEnd);
    },
    { xStart, xEnd, y },
  );
}

test("slice workspace supports pending range reselection and re-analysis", async ({ page }) => {
  await installDerivationIpcDefaults(page);
  await page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-range-reselect-root";
    let analysisRegion = { startFrame: "11025", endExclusive: "22050" };
    let revision = 0;
    let markers: any[] = [];
    let jobSeq = 0;
    source.__E2E_SLICE_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_SLICE_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-range-reselect",
            displayName: "Synthetic range reselect",
            deviceFingerprint: `rootfp:v1:${"e".repeat(64)}`,
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
        if (cmd === "v2_audio_onsets_start") {
          jobSeq += 1;
          if (args.region) {
            analysisRegion = args.region;
          }
          return {
            jobId: `job-range-${jobSeq}`,
            phase: "ready",
            error: null,
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            region: analysisRegion,
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
          const isFirstRegion =
            analysisRegion.startFrame === "11025" && analysisRegion.endExclusive === "22050";
          return {
            proposalId: `proposal-${revision}-${isFirstRegion ? "a" : "b"}`,
            expectedRevision: revision,
            candidateCount: 1,
            suppressedCount: 0,
            exceedsDraftLimit: false,
            candidates: [{
              candidateId: isFirstRegion ? "candidate-a" : "candidate-b",
              noveltyPeakFrame: analysisRegion.startFrame,
              estimatedAttackFrame: analysisRegion.startFrame,
              suggestedStartFrame: analysisRegion.startFrame,
              strength: 0.8,
              bandScores: [5, 4, 3],
              thresholdMargin: 2,
              uncertainty: {
                startFrame: analysisRegion.startFrame,
                endExclusive: String(Number(analysisRegion.startFrame) + 1),
              },
              warnings: [],
            }],
          };
        }
        if (cmd === "v2_slice_draft_update") {
          if (args.edit?.kind === "replaceRegion") {
            analysisRegion = {
              startFrame: args.edit.startFrame,
              endExclusive: args.edit.endExclusive,
            };
            markers = [];
            revision += 1;
          } else if (args.edit?.kind === "acceptProposal") {
            markers = [{
              markerId: args.edit.proposalId.includes("b") ? "candidate-b" : "candidate-a",
              startFrame: analysisRegion.startFrame,
              endExclusive: analysisRegion.endExclusive,
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
        const __derivationMock = (window as any).__MO_E2E_TRY_DERIVATION_IPC__?.(cmd, args ?? {});
        if (__derivationMock !== undefined) return __derivationMock;
        return null;
      },
    };
  });

  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
  await clickCatalogFileRow(page, "ja", "RANGE.wav");

  await page.getByLabel(uiText("ja", "waveform.startFrame")).fill(RANGE_A.startFrame);
  await page.getByLabel(uiText("ja", "waveform.endFrame")).fill(RANGE_A.endExclusive);
  await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
  const slice = page.getByRole("region", { name: uiText("ja", "slicing.ariaFor", { displayName: "RANGE.wav" }) });
  await slice.getByRole("button", { name: uiText("ja", "slicing.analyzeSelectedRange") }).click();
  await expect(slice.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();
  await slice.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") }).click();
  await expect(slice.getByLabel("Start frame candidate-a")).toHaveValue(RANGE_A.startFrame);
  await expect(slice.getByLabel(uiText("ja", "slicing.analysisRegionHeading"))).toContainText(RANGE_A.startFrame);

  await slice.getByRole("button", { name: uiText("ja", "slicing.enterRangeReselect") }).click();
  await dragPendingRangeOnSliceWaveform(slice);

  const pendingBlock = slice.getByRole("region", { name: uiText("ja", "slicing.pendingRangeHeading") });
  const pendingCoord = pendingBlock.locator(".slice-coordinate").filter({ hasText: /\[\d+, \d+\)/ });
  await expect(pendingCoord).toBeVisible();
  const pendingText = await pendingCoord.innerText();
  const pendingRange = parseFramesLine(pendingText);
  expect(pendingRange).not.toBeNull();
  expect(pendingRange!.startFrame).not.toBe(RANGE_A.startFrame);
  expect(pendingRange!.endExclusive).not.toBe(RANGE_A.endExclusive);

  const callsBeforeReanalyze = await page.evaluate(() => (window as any).__E2E_SLICE_CALLS__);
  const startsBefore = callsBeforeReanalyze.filter((c: any) => c.cmd === "v2_audio_onsets_start");
  const replaceBefore = callsBeforeReanalyze.filter(
    (c: any) => c.cmd === "v2_slice_draft_update" && c.args.edit?.kind === "replaceRegion",
  );
  expect(startsBefore).toHaveLength(1);
  expect(replaceBefore).toHaveLength(0);
  await expect(slice.getByLabel("Start frame candidate-a")).toHaveValue(RANGE_A.startFrame);

  await slice.getByRole("button", { name: uiText("ja", "slicing.reanalyzePendingRange") }).click();
  await expect(slice.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();
  await slice.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") }).click();
  await expect(slice.getByLabel("Start frame candidate-b")).toHaveValue(pendingRange!.startFrame);
  await expect(slice.getByLabel("Start frame candidate-a")).toHaveCount(0);

  const updates = await page.evaluate(() =>
    (window as any).__E2E_SLICE_CALLS__.filter((c: any) => c.cmd === "v2_slice_draft_update"),
  );
  expect(updates.some((c: any) => c.args.edit?.kind === "replaceRegion")).toBe(true);
  const starts = await page.evaluate(() =>
    (window as any).__E2E_SLICE_CALLS__.filter((c: any) => c.cmd === "v2_audio_onsets_start"),
  );
  expect(starts.length).toBeGreaterThanOrEqual(2);
  expect(starts.at(-1)?.args.region).toEqual(pendingRange);
});
