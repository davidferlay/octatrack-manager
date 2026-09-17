import { test, expect, type Locator, type Page } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";

type LayoutBox = { x: number; y: number; width: number; height: number };

async function installJaLocale(page: Page) {
  await page.addInitScript(
    ([storageKey, localeId]) => {
      localStorage.setItem(storageKey, localeId);
    },
    [LOCALE_STORAGE_KEY, "ja"] as const,
  );
}

async function seedLayoutFixture(page: Page, displayName: string) {
  await page.addInitScript((name: string) => {
    const source = window as any;
    source.__E2E_ROOT_PATH__ = "/tmp/synthetic-inspector-layout-root";
    const range = { startFrame: "0", endExclusive: "44100" };
    let revision = 0;
    source.__TAURI_INTERNALS__ = {
      transformCallback: () => {},
      invoke: async (cmd: string, args: any = {}) => {
        if (cmd === "v2_root_register" || cmd === "v2_root_status") {
          return {
            rootId: "root-layout",
            displayName: "Synthetic layout",
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
            usageEdges: [{ fromRelativePath: name, toRelativePath: "DRUMS/PROJECT_A/PROJECT.ot", kind: "sample_in_project" }],
            audioFiles: [{
              fileInstanceId: "file-layout",
              assetId: "asset-layout",
              displayName: name,
              relativePath: `DRUMS/AUDIO/${name}`,
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
        if (cmd === "v2_slice_draft_get") {
          return {
            revision,
            region: range,
            markers: [],
            canUndo: false,
            canRedo: false,
          };
        }
        if (cmd === "v2_audio_waveform_range_get") {
          return {
            range: args.range,
            peaks: [Array.from({ length: 640 }, () => [-0.2, 0.2])],
          };
        }
        if (cmd === "v2_audio_onsets_start") {
          return {
            jobId: "job-layout",
            phase: "ready",
            error: null,
            sampleRate: 44100,
            channels: 1,
            frameCount: "44100",
            region: range,
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
  }, displayName);
}

async function boxOf(locator: Locator): Promise<LayoutBox> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function expectBoxesStable(baseline: LayoutBox, current: LayoutBox, label: string) {
  expect(Math.abs(baseline.x - current.x), `${label} x`).toBeLessThanOrEqual(1);
  expect(Math.abs(baseline.y - current.y), `${label} y`).toBeLessThanOrEqual(1);
  expect(Math.abs(baseline.width - current.width), `${label} width`).toBeLessThanOrEqual(1);
  expect(Math.abs(baseline.height - current.height), `${label} height`).toBeLessThanOrEqual(1);
}

async function captureWorkspaceChrome(page: Page) {
  const shell = page.locator(".mo-app-shell--workspace");
  await expect(shell).toBeVisible();
  const sourcesDivider = page.getByTestId("app-shell-divider");
  const mainInspectorDivider = page.locator(".mo-app-shell__inner-split .mo-split-pane__divider").first();
  return {
    sources: await boxOf(page.locator(".mo-app-shell__sources")),
    main: await boxOf(page.locator(".mo-app-shell__main")),
    inspector: await boxOf(page.locator(".mo-app-shell__inspector")),
    tablist: await boxOf(page.locator(".mo-inspector-tabbed__tablist")),
    status: await boxOf(page.getByTestId("app-shell-status")),
    sourcesDividerX: (await boxOf(sourcesDivider)).x,
    mainInspectorDividerX: (await boxOf(mainInspectorDivider)).x,
  };
}

async function openInspectorSample(page: Page, displayName: string) {
  await installJaLocale(page);
  await seedLayoutFixture(page, displayName);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: uiText("ja", "sources.chooseRoot") }).click();
  await clickCatalogFileRow(page, "ja", displayName);
  await expect(page.locator(".mo-app-shell--workspace")).toBeVisible();
}

test.describe("inspector layout stability", () => {
  test("1280px: tab cycle keeps pane boundaries and status bar", async ({ page }) => {
    const displayName = "VERY_LONG_SAMPLE_NAME_FOR_LAYOUT_STABILITY_CHECK.wav";
    await openInspectorSample(page, displayName);

    await page.getByLabel(uiText("ja", "waveform.startFrame")).fill("1000");
    const baseline = await captureWorkspaceChrome(page);

    const tabs = [
      uiText("ja", "inspector.tabSlice"),
      uiText("ja", "inspector.tabInfo"),
      uiText("ja", "inspector.tabUsage"),
      uiText("ja", "inspector.tabNotes"),
      uiText("ja", "inspector.tabPreview"),
    ] as const;

    for (const tab of tabs) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      const current = await captureWorkspaceChrome(page);
      expectBoxesStable(baseline.sources, current.sources, "sources");
      expectBoxesStable(baseline.inspector, current.inspector, "inspector");
      expectBoxesStable(baseline.tablist, current.tablist, "tablist");
      expectBoxesStable(baseline.status, current.status, "status");
      expect(Math.abs(baseline.sourcesDividerX - current.sourcesDividerX)).toBeLessThanOrEqual(1);
      expect(Math.abs(baseline.mainInspectorDividerX - current.mainInspectorDividerX)).toBeLessThanOrEqual(1);
      expect(Math.abs(baseline.main.x - current.main.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(baseline.inspector.x - current.inspector.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(baseline.main.width - current.main.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(baseline.inspector.width - current.inspector.width)).toBeLessThanOrEqual(1);
    }

    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    await expect(page.getByTestId("slice-workbench-compact")).toBeVisible();
    const afterSliceEditor = await captureWorkspaceChrome(page);
    expect(Math.abs(baseline.mainInspectorDividerX - afterSliceEditor.mainInspectorDividerX)).toBeLessThanOrEqual(1);
    expect(Math.abs(baseline.main.width - afterSliceEditor.main.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(baseline.inspector.width - afterSliceEditor.inspector.width)).toBeLessThanOrEqual(1);

    await page.getByRole("tab", { name: uiText("ja", "inspector.tabPreview") }).click();
    await expect(page.getByLabel(uiText("ja", "waveform.startFrame"))).toHaveValue("1000");
    await page.screenshot({
      path: "docs/testing/screenshots/mo-ui-inspector-layout-stability-1/after-1280-tab-cycle.png",
      fullPage: false,
    });
  });

  test("1280px: expand slice workspace restores main/inspector widths", async ({ page }) => {
    await openInspectorSample(page, "LOOP.wav");
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();

    const beforeExpand = await captureWorkspaceChrome(page);
    const expand = page.getByRole("button", { name: uiText("ja", "inspector.expandSliceWorkspaceAria") });
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeVisible();

    await page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") }).click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeHidden();

    const afterCollapse = await captureWorkspaceChrome(page);
    expectBoxesStable(beforeExpand.main, afterCollapse.main, "main after collapse");
    expectBoxesStable(beforeExpand.inspector, afterCollapse.inspector, "inspector after collapse");
  });

  test("840px: narrow stack keeps workspace shell class", async ({ page }) => {
    await openInspectorSample(page, "LOOP.wav");
    await page.setViewportSize({ width: 840, height: 900 });
    await page.waitForFunction(() => window.matchMedia("(max-width: 840px)").matches);
    await expect(page.locator(".mo-app-shell--narrow")).toBeVisible();
    await expect(page.locator(".mo-app-shell--workspace")).toBeVisible();
    await page.screenshot({
      path: "docs/testing/screenshots/mo-ui-inspector-layout-stability-1/after-840-narrow.png",
      fullPage: false,
    });
  });
});
