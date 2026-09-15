import { test, expect } from "@playwright/test";
import { uiText } from "./i18n";

test("read-only library supports attack review, boundary editing and undo", async ({ page }) => {
  await page.addInitScript(() => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-slice-root";
    const range = { startFrame: "0", endExclusive: "44100" };
    let revision = 0;
    let markers: any[] = [];
    const history: any[][] = [];
    const draft = () => ({ revision, region: range, markers, canUndo: history.length > 0, canRedo: false });
    source.__E2E_SLICE_CALLS__ = [];
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        source.__E2E_SLICE_CALLS__.push({ cmd, args });
        if (cmd === "v2_root_register" || cmd === "v2_root_status") return {
          rootId: "root-slice", displayName: "Synthetic drum loop", deviceFingerprint: `rootfp:v1:${"f".repeat(64)}`,
          mode: "read_only", observedRevision: 1, expiresInSeconds: 3600, writeGrantExpiresInSeconds: null,
          capabilities: { read: true, write: true, stableDeviceIdentity: true },
        };
        if (cmd === "v2_library_list") return {
          sets: [{ displayName: "DRUMS", relativePath: "DRUMS", hasAudioPool: true, projects: [] }],
          standaloneProjects: [], usageEdges: [], audioFiles: [{
            fileInstanceId: "file-slice", assetId: "asset-slice", displayName: "LOOP.wav", relativePath: "DRUMS/AUDIO/LOOP.wav", byteSize: 88244, storageScope: "set_audio_pool",
          }],
        };
        if (cmd === "v2_change_recovery_status" || cmd === "v2_rename_recovery_status") return { recoveryRequired: false, operations: [] };
        if (cmd === "v2_asset_metadata_get") return { tags: [], note: "" };
        if (cmd === "v2_audio_waveform_get") return { sampleRate: 44100, channels: 1, durationSeconds: 1, frameCount: 44100, samplesPerPeak: 100, peaks: [{ min: -0.5, max: 0.5 }] };
        if (cmd === "v2_audio_onsets_start") return { jobId: "job-slice", phase: "ready", error: null, sampleRate: 44100, channels: 1, frameCount: "44100", region: range };
        if (cmd === "v2_slice_draft_get") return draft();
        if (cmd === "v2_audio_waveform_range_get") return { range: args.range, peaks: [Array.from({ length: 640 }, (_, i) => { const amp = i % 160 < 50 ? Math.exp(-(i % 160) / 20) : 0.01; return [-amp, amp]; })] };
        if (cmd === "v2_slice_proposal_create") return {
          proposalId: `proposal-${revision}`, expectedRevision: revision, candidateCount: 2, suppressedCount: 0, exceedsDraftLimit: false,
          candidates: ["11025", "22050"].map(value => ({ candidateId: `candidate-${value}`, noveltyPeakFrame: value, estimatedAttackFrame: value, suggestedStartFrame: value, strength: 0.8, bandScores: [5, 4, 3], thresholdMargin: 2, uncertainty: { startFrame: value, endExclusive: String(Number(value) + 1) }, warnings: [] })),
        };
        if (cmd === "v2_slice_draft_update") {
          if (args.expectedRevision !== revision) throw { code: "DRAFT_CONFLICT", message: "stale revision" };
          const edit = args.edit;
          if (edit.kind === "undo") markers = history.pop()!;
          else {
            history.push(structuredClone(markers));
            if (edit.kind === "acceptProposal") markers = ["11025", "22050"].map((value, i) => ({ markerId: `candidate-${value}`, startFrame: value, endExclusive: i ? "44100" : "22050", locked: false, manual: false }));
            if (edit.kind === "move") markers = markers.map(m => m.markerId === edit.markerId ? { ...m, startFrame: edit.frame, locked: true, manual: true } : m);
          }
          revision++;
          return draft();
        }
        return null;
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
  await page.getByRole("button", { name: /LOOP\.wav/ }).click();
  const editor = page.getByRole("region", { name: uiText("ja", "slicing.ariaFor", { displayName: "LOOP.wav" }) });
  await editor.getByRole("button", { name: uiText("ja", "slicing.detectAttacks") }).click();
  await expect(editor.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__E2E_SLICE_CALLS__.filter((c: any) => c.cmd === "v2_slice_draft_update"))).toEqual([]);
  await editor.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") }).click();
  const boundary = editor.getByLabel("Start frame candidate-11025");
  await boundary.fill("11000");
  await boundary.press("Enter");
  await expect(editor.getByLabel("Fixed 11000")).toBeChecked();
  await editor.getByRole("button", { name: "Undo" }).click();
  await expect(boundary).toHaveValue("11025");
  await expect(editor.getByLabel("Fixed 11025")).not.toBeChecked();
  await editor.getByRole("button", { name: "Zoom in" }).click();
  await expect(editor.getByText(/Frames \[/)).not.toContainText("[0, 44100)");
  const calls: string[] = await page.evaluate(() => (window as any).__E2E_SLICE_CALLS__.map((c: any) => c.cmd));
  expect(calls).not.toContain("v2_root_enable_write");
  expect(calls).not.toContain("v2_change_apply");
  expect(calls).not.toContain("v2_rename_apply");
  const screenshot = test.info().outputPath("slice-workbench.png");
  await editor.screenshot({ path: screenshot });
  await test.info().attach("Slice workbench", { path: screenshot, contentType: "image/png" });
});
