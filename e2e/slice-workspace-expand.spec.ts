import { test, expect } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { showInspectorFromContextBar } from "./narrowWorkspace";

async function seedSliceFixture(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-slice-workspace-root";
    const range = { startFrame: "0", endExclusive: "44100" };
    let revision = 0;
    let markers: any[] = [];
    const draft = () => ({
      revision,
      region: range,
      markers,
      canUndo: false,
      canRedo: false,
    });
    source.__E2E_SLICE_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_SLICE_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-slice-ws",
            displayName: "Synthetic slice workspace",
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
              fileInstanceId: "file-slice-ws",
              assetId: "asset-slice-ws",
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
        if (cmd === "v2_audio_onsets_start") {
          return {
            jobId: "job-slice-ws",
            phase: "ready",
            error: null,
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            region: range,
          };
        }
        if (cmd === "v2_slice_draft_get") return draft();
        if (cmd === "v2_audio_waveform_range_get") {
          return {
            range: args.range,
            peaks: [Array.from({ length: 640 }, (_, i) => {
              const amp = i % 160 < 50 ? Math.exp(-(i % 160) / 20) : 0.01;
              return [-amp, amp];
            })],
          };
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
        return null;
      },
    };
  });
}

test.describe("slice workspace expand", () => {
  test("1280px: expand, analyze, collapse keeps analysis state", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSliceFixture(page);
    await page.goto("/");
    await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
    await clickCatalogFileRow(page, "ja", "LOOP.wav");
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    await expect(page.getByRole("button", { name: uiText("ja", "slicing.detectAttacks") })).toBeVisible();

    await page.getByRole("button", { name: uiText("ja", "inspector.expandSliceWorkspaceAria") }).click();
    const shell = page.getByTestId("slice-workspace-expanded-shell");
    await expect(shell).toBeVisible();
    await expect(page.getByTestId("catalog-workspace-main-host")).toBeHidden();

    const expandedEditor = page.getByTestId("slice-workbench-expanded");
    await expandedEditor.getByRole("button", { name: uiText("ja", "slicing.detectAttacks") }).click();
    await expect(expandedEditor.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();

    await page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") }).click();
    await expect(shell).toBeHidden();
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    await expect(page.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();
  });

  test("840px: exit control stays visible while expanded", async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await seedSliceFixture(page);
    await page.goto("/");
    await page.waitForFunction(() => window.matchMedia("(max-width: 840px)").matches);
    await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
    await clickCatalogFileRow(page, "ja", "LOOP.wav");
    await showInspectorFromContextBar(page, "ja");
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    await page.getByRole("button", { name: uiText("ja", "inspector.expandSliceWorkspaceAria") }).click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeVisible();

    const exit = page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") });
    await expect(exit).toBeVisible();
    await exit.scrollIntoViewIfNeeded();
    await expect(exit).toBeInViewport();
  });
});
