import { test, expect, type Locator, type Page } from "@playwright/test";
import { catalogFileRowLocator, clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";
import { LOCALE_STORAGE_KEY } from "../src/i18n/registry";
import {
  assertNoLayoutDiagnostics,
  attachLayoutDiagnostics,
  attachLayoutMetrics,
} from "./layoutDiagnostics";
import {
  expectNarrowBreakpointMatches,
  expectNarrowShellClass,
  expectNoDocumentHorizontalOverflow,
  toggleSourcesNav,
  expectNoWorkspaceHorizontalOverflow,
  expectSourcesColumnHidden,
  expectVisiblePaneUsesBodyWidth,
  expectWideShellClass,
  openSourcesDrawer,
  showInspectorFromContextBar,
  showListFromContextBar,
  showListFromStatusBar,
  syncViewportLayout,
} from "./narrowWorkspace";

type LayoutBox = { x: number; y: number; width: number; height: number };

async function installLocale(page: Page, localeId: "ja" | "en") {
  await page.addInitScript(
    ([storageKey, locale]) => {
      localStorage.setItem(storageKey, locale);
    },
    [LOCALE_STORAGE_KEY, localeId] as const,
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

async function dragSourcesDivider(page: Page, deltaX: number) {
  const divider = page.getByTestId("app-shell-divider");
  const dividerBox = await boxOf(divider);
  const startX = dividerBox.x + dividerBox.width / 2;
  const y = dividerBox.y + dividerBox.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, y, { steps: 10 });
  await page.mouse.up();
}

async function expandedSliceGridColumns(page: Page): Promise<number> {
  return page.getByTestId("slice-workbench-expanded").evaluate((el) => {
    const columns = getComputedStyle(el).gridTemplateColumns.trim();
    if (columns === "none" || columns === "") return 0;
    return columns.split(/\s+/).length;
  });
}

async function innerSplitClientWidth(page: Page): Promise<number> {
  return page.locator(".mo-app-shell__inner-split.mo-split-pane").evaluate((el) => el.clientWidth);
}

/** Main primary should consume the inner split row while slice workspace is expanded. */
async function expectExpandedMainFillsInnerSplit(page: Page, tolerancePx = 2) {
  const innerWidth = await innerSplitClientWidth(page);
  const mainBox = await boxOf(page.locator(".mo-app-shell__inner-split > .mo-split-pane__primary"));
  expect(Math.abs(mainBox.width - innerWidth), "expanded main vs inner split").toBeLessThanOrEqual(
    tolerancePx,
  );
}

async function dragInnerMainInspectorDivider(page: Page, deltaX: number) {
  const divider = page.locator(".mo-app-shell__inner-split .mo-split-pane__divider").first();
  const dividerBox = await boxOf(divider);
  const startX = dividerBox.x + dividerBox.width / 2;
  const y = dividerBox.y + dividerBox.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, y, { steps: 10 });
  await page.mouse.up();
}

async function attachLayoutScreenshot(page: Page, name: string) {
  const path = test.info().outputPath(name);
  await page.screenshot({ path, fullPage: false });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function expectTabbedScrollEscape(page: Page) {
  const overflowY = await page.locator(".mo-inspector-tabbed").evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"], "tabbed overflow escape").toContain(overflowY);
}

async function scrollControlIntoInspectorPanels(page: Page, control: Locator) {
  const handle = await control.elementHandle();
  expect(handle).not.toBeNull();
  const scrolled = await page.evaluate((controlButton) => {
    if (!(controlButton instanceof HTMLElement)) return false;
    const host = controlButton.closest(".mo-inspector-pane__tabbed-host");
    const tabbed = controlButton.closest(".mo-inspector-tabbed");
    const panels = controlButton.closest(".mo-inspector-tabbed__panels");
    if (!(tabbed instanceof HTMLElement) || !(panels instanceof HTMLElement)) return false;

    const isClickable = () => {
      const btnRect = controlButton.getBoundingClientRect();
      const panelRect = panels.getBoundingClientRect();
      const margin = 6;
      if (
        btnRect.width <= 0
        || btnRect.height <= 0
        || btnRect.top < panelRect.top + margin
        || btnRect.bottom > panelRect.bottom - margin
      ) {
        return false;
      }
      const cx = btnRect.left + btnRect.width / 2;
      const cy = btnRect.top + btnRect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return (
        topEl === controlButton
        || controlButton.contains(topEl)
        || (topEl instanceof Node && controlButton.contains(topEl))
      );
    };

    const scrollers: HTMLElement[] = [];
    if (host instanceof HTMLElement) scrollers.push(host);
    scrollers.push(tabbed, panels);

    for (let pass = 0; pass < 2; pass += 1) {
      for (const scroller of scrollers) {
        for (let step = 0; step <= 40; step += 1) {
          scroller.scrollTop = Math.round((scroller.scrollHeight * step) / 40);
          panels.scrollTop = 0;
          if (isClickable()) return true;
        }
      }
      for (const scroller of scrollers) {
        for (let step = 0; step <= 40; step += 1) {
          panels.scrollTop = Math.round((panels.scrollHeight * step) / 40);
          if (isClickable()) return true;
        }
      }
    }
    return isClickable();
  }, handle!);
  expect(scrolled, "control should be clickable inside inspector panels").toBe(true);
}

async function clickSliceDetectAttacksInCompactInspector(page: Page, locale: "ja" | "en" = "ja") {
  await page.locator(".mo-app-shell--workspace").scrollIntoViewIfNeeded();
  const editor = page.getByTestId("slice-workbench-compact");
  const detect = editor.getByRole("button", { name: uiText(locale, "slicing.detectAttacks") });
  await expect(async () => {
    await scrollControlIntoInspectorPanels(page, detect);
  }).toPass({ timeout: 12000 });
  await detect.click();
  const apply = editor.getByRole("button", { name: uiText(locale, "slicing.applyCandidates") });
  await expect(apply).toBeEnabled({ timeout: 15000 });
  await scrollControlIntoInspectorPanels(page, apply);
  await expect(apply).toBeVisible();
}

/** Scroll workspace and inspector panels so bottom controls are reachable (short viewport / Home chrome). */
async function expectReachableInInspectorPanels(page: Page, control: Locator) {
  await page.locator(".mo-app-shell--workspace").scrollIntoViewIfNeeded();
  const tabbed = page.locator(".mo-inspector-tabbed");
  const panels = page.locator(".mo-inspector-tabbed__panels");
  await tabbed.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await panels.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const tagName = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === "input" || tagName === "textarea") {
    await control.fill("204800");
    await expect(control).toHaveValue("204800");
    return;
  }
  await expect(async () => {
    await tabbed.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await panels.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await control.scrollIntoViewIfNeeded();
    await control.click({ trial: true });
  }).toPass({ timeout: 8000 });
}

async function openInspectorSample(
  page: Page,
  displayName: string,
  locale: "ja" | "en" = "ja",
  viewport: { width: number; height: number } = { width: 1280, height: 900 },
) {
  await installLocale(page, locale);
  await seedLayoutFixture(page, displayName);
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: uiText(locale, "sources.chooseRoot") }).click();
  await expect(catalogFileRowLocator(page, locale, displayName)).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".mo-app-shell--workspace")).toBeVisible({ timeout: 30000 });
  await clickCatalogFileRow(page, locale, displayName);
  if (viewport.width <= 840) {
    await expectNarrowShellClass(page);
  }
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

    const plot = page.locator(".waveform-preview-plot");
    const plotBox = await plot.boundingBox();
    expect(plotBox, "preview plot should be visible").not.toBeNull();
    expect(plotBox!.height, "preview plot height").toBeGreaterThanOrEqual(80);
    expect(plotBox!.height, "preview plot must not fill the inspector").toBeLessThanOrEqual(200);

    await attachLayoutScreenshot(page, "after-1280-tab-cycle.png");
  });

  test("1280x600: short viewport reaches tab bottom controls without shifting chrome", async ({ page }) => {
    const displayName = "VERY_LONG_SAMPLE_NAME_FOR_LAYOUT_STABILITY_CHECK.wav";
    await openInspectorSample(page, displayName, "ja", { width: 1280, height: 600 });
    await page.evaluate(() => {
      const shell = document.querySelector(".mo-app-shell--workspace");
      if (shell !== null) {
        const top = shell.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.max(0, top - 8) });
      }
    });

    const baseline = await captureWorkspaceChrome(page);
    await expect(page.locator(".mo-inspector-tabbed__tablist")).toBeVisible();
    const workspaceHeight = await page.locator(".mo-app-shell--workspace").evaluate((el) => el.getBoundingClientRect().height);
    expect(workspaceHeight, "workspace must keep a usable height").toBeGreaterThan(160);

    await page.getByRole("tab", { name: uiText("ja", "inspector.tabPreview") }).click();
    const endFrame = page.getByLabel(uiText("ja", "waveform.endFrame"));
    await expectReachableInInspectorPanels(page, endFrame);
    const previewPlot = page.locator(".waveform-preview-plot");
    const previewPlotBox = await previewPlot.boundingBox();
    expect(previewPlotBox!.height).toBeGreaterThanOrEqual(80);
    expect(previewPlotBox!.height).toBeLessThanOrEqual(200);

    await expectTabbedScrollEscape(page);

    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    await expect(page.getByTestId("slice-workbench-compact-host")).toBeVisible();
    const panels = page.locator(".mo-inspector-tabbed__panels");
    const scrollBefore = await panels.evaluate((el) => el.scrollTop);
    await panels.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await panels.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(scrollBefore);
    await clickSliceDetectAttacksInCompactInspector(page, "ja");

    await page.getByRole("tab", { name: uiText("ja", "inspector.tabNotes") }).click();
    const noteField = page.getByLabel(uiText("ja", "metadata.noteLabel"));
    await expectReachableInInspectorPanels(page, noteField);

    const afterTabs = await captureWorkspaceChrome(page);
    expectBoxesStable(baseline.inspector, afterTabs.inspector, "inspector short viewport");
    expectBoxesStable(baseline.status, afterTabs.status, "status short viewport");
    expect(Math.abs(baseline.tablist.x - afterTabs.tablist.x), "tablist x").toBeLessThanOrEqual(1);
    expect(Math.abs(baseline.tablist.width - afterTabs.tablist.width), "tablist width").toBeLessThanOrEqual(1);
    expect(Math.abs(baseline.sourcesDividerX - afterTabs.sourcesDividerX)).toBeLessThanOrEqual(1);
    expect(Math.abs(baseline.mainInspectorDividerX - afterTabs.mainInspectorDividerX)).toBeLessThanOrEqual(1);

    await attachLayoutScreenshot(page, "after-1280x600-tab-reach.png");
  });

  test("1280x600 en: long name tabbed escape and slice detect click", async ({ page }) => {
    const displayName = "very_long_disposable_name_for_layout_overflow_acceptance_check.wav";
    await openInspectorSample(page, displayName, "en", { width: 1280, height: 600 });
    await expectTabbedScrollEscape(page);
    await page.getByRole("tab", { name: uiText("en", "inspector.tabSlice") }).click();
    await clickSliceDetectAttacksInCompactInspector(page, "en");
  });

  test("1280px: expand slice workspace fills inner split and restores widths", async ({ page }) => {
    await openInspectorSample(page, "LOOP.wav");
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();

    await dragInnerMainInspectorDivider(page, -80);
    const beforeExpand = await captureWorkspaceChrome(page);

    const expand = page.getByRole("button", { name: uiText("ja", "inspector.expandSliceWorkspaceAria") });
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeVisible();
    await expect(page.locator(".mo-app-shell__inner-split--slice-expanded")).toBeVisible();
    await expectExpandedMainFillsInnerSplit(page);

    await page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") }).click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeHidden();

    const afterCollapse = await captureWorkspaceChrome(page);
    expectBoxesStable(beforeExpand.main, afterCollapse.main, "main after collapse");
    expectBoxesStable(beforeExpand.inspector, afterCollapse.inspector, "inspector after collapse");

    await dragInnerMainInspectorDivider(page, 80);
    const beforeExpandWide = await captureWorkspaceChrome(page);
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeVisible();
    await expect(page.locator(".mo-app-shell__inner-split--slice-expanded")).toBeVisible();
    await expectExpandedMainFillsInnerSplit(page);
    await page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") }).click();
    const afterCollapseWide = await captureWorkspaceChrome(page);
    expectBoxesStable(beforeExpandWide.main, afterCollapseWide.main, "main after wide drag collapse");
    expectBoxesStable(beforeExpandWide.inspector, afterCollapseWide.inspector, "inspector after wide drag collapse");

    await attachLayoutScreenshot(page, "after-expand-inner-split-fill.png");
  });

  test("900px: wide sources stack expanded slice; widening restores two columns", async ({ page }) => {
    await openInspectorSample(page, "LOOP.wav", "ja", { width: 900, height: 900 });
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();

    await dragSourcesDivider(page, 200);
    const expand = page.getByRole("button", { name: uiText("ja", "inspector.expandSliceWorkspaceAria") });
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(page.getByTestId("slice-workbench-expanded")).toBeVisible();
    await expect(page.locator(".mo-app-shell__inner-split--slice-expanded")).toBeVisible();
    await expectExpandedMainFillsInnerSplit(page);
    const hostWidth = await page.getByTestId("slice-workbench-expanded-host").evaluate((el) => el.clientWidth);
    expect(hostWidth, "wide sources should narrow expanded host").toBeLessThan(640);
    expect(await expandedSliceGridColumns(page)).toBe(1);

    const expandedEditor = page.getByTestId("slice-workbench-expanded");
    await expandedEditor.getByRole("button", { name: uiText("ja", "slicing.detectAttacks") }).click();
    const apply = expandedEditor.getByRole("button", { name: uiText("ja", "slicing.applyCandidates") });
    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeEnabled();
    await expect(apply).toBeVisible();

    const exit = page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") });
    await exit.scrollIntoViewIfNeeded();
    await expect(exit).toBeVisible();

    await exit.click();
    await dragSourcesDivider(page, -120);
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(page.getByTestId("slice-workbench-expanded")).toBeVisible();

    const hostWidthWide = await page.getByTestId("slice-workbench-expanded-host").evaluate((el) => el.clientWidth);
    if (hostWidthWide >= 640) {
      expect(await expandedSliceGridColumns(page)).toBeGreaterThanOrEqual(2);
    }

    await attachLayoutScreenshot(page, "after-900-expanded-slice-stack.png");
  });

  test("840px: narrow stack, expand roundtrip keeps preview range", async ({ page }, testInfo) => {
    const diagnostics = attachLayoutDiagnostics(page);
    await openInspectorSample(page, "LOOP.wav", "ja", { width: 840, height: 900 });
    await expectNarrowShellClass(page);
    await expect(page.locator(".mo-app-shell--workspace")).toBeVisible();

    await page.getByRole("button", { name: uiText("ja", "workspace.showList"), exact: true }).click();
    await page.getByRole("button", { name: uiText("ja", "workspace.showInspector"), exact: true }).click();
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabPreview") }).click();
    await page.getByLabel(uiText("ja", "waveform.startFrame")).fill("1000");

    await page.getByRole("tab", { name: uiText("ja", "inspector.tabSlice") }).click();
    const expand = page.getByRole("button", { name: uiText("ja", "inspector.expandSliceWorkspaceAria") });
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    await expect(page.getByTestId("slice-workspace-expanded-shell")).toBeVisible();

    await page.getByRole("button", { name: uiText("ja", "inspector.exitSliceWorkspaceAria") }).click();
    await showInspectorFromContextBar(page, "ja");
    await page.getByRole("tab", { name: uiText("ja", "inspector.tabPreview") }).click();
    await expect(page.getByLabel(uiText("ja", "waveform.startFrame"))).toHaveValue("1000");

    await attachLayoutScreenshot(page, "after-840-narrow.png");
    await attachLayoutMetrics(page, testInfo, "after-840-narrow");
    assertNoLayoutDiagnostics(diagnostics);
  });

  test("1280px en: long filename wraps and preview plot height stays bounded", async ({ page }) => {
    const displayName = "very_long_disposable_name_for_layout_overflow_acceptance_check.wav";
    await openInspectorSample(page, displayName, "en", { width: 1280, height: 720 });
    await page.getByRole("tab", { name: uiText("en", "inspector.tabPreview") }).click();
    const plotBox = await page.locator(".waveform-preview-plot").boundingBox();
    expect(plotBox!.height).toBeGreaterThanOrEqual(80);
    expect(plotBox!.height).toBeLessThanOrEqual(200);
    await expect(page.locator(".mo-inspector-tabbed__path")).toBeVisible();
  });

  test("1280px: sources divider resizes the sources column", async ({ page }) => {
    await openInspectorSample(page, "LOOP.wav");
    const sources = page.locator(".mo-app-shell__sources");
    const before = await boxOf(sources);
    await dragSourcesDivider(page, 90);

    const after = await boxOf(sources);
    expect(after.width, "sources width after drag").toBeGreaterThan(before.width + 24);
  });

  test("800x600: narrow workspace hides sources column and uses full list width", async ({ page }, testInfo) => {
    const diagnostics = attachLayoutDiagnostics(page);
    await openInspectorSample(page, "LOOP.wav", "ja", { width: 800, height: 600 });
    await expectNarrowShellClass(page);
    await expectSourcesColumnHidden(page);
    await expectVisiblePaneUsesBodyWidth(page, "list");
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoWorkspaceHorizontalOverflow(page);

    const dialog = await openSourcesDrawer(page, "ja");
    const dialogWidth = await dialog.evaluate((el) => el.getBoundingClientRect().width);
    expect(dialogWidth, "sources drawer width").toBeGreaterThanOrEqual(160);
    await page.getByRole("button", { name: uiText("ja", "workspace.sourcesDrawerCloseAria") }).click();
    await expect(dialog).toBeHidden();

    await showInspectorFromContextBar(page, "ja");
    await expectVisiblePaneUsesBodyWidth(page, "inspector");
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoWorkspaceHorizontalOverflow(page);
    await showListFromStatusBar(page, "ja");
    await expectVisiblePaneUsesBodyWidth(page, "list");

    await attachLayoutScreenshot(page, "after-800-narrow-full-width.png");
    await attachLayoutMetrics(page, testInfo, "after-800-narrow");
    assertNoLayoutDiagnostics(diagnostics);
  });

  for (const width of [841, 840, 839] as const) {
    test(`${width}px: narrow breakpoint matches matchMedia`, async ({ page }, testInfo) => {
      const diagnostics = attachLayoutDiagnostics(page);
      await openInspectorSample(page, "LOOP.wav", "ja", { width, height: 700 });
      await expectNarrowBreakpointMatches(page, width <= 840);
      if (width <= 840) {
        await expectNarrowShellClass(page);
        await expectSourcesColumnHidden(page);
      } else {
        await expectWideShellClass(page);
        await expect(page.getByTestId("app-shell-sources")).toBeVisible();
      }
      await attachLayoutMetrics(page, testInfo, `breakpoint-${width}`);
      await expectNoDocumentHorizontalOverflow(page);
      assertNoLayoutDiagnostics(diagnostics);
    });
  }

  test("1280 to 800 to 1280: sources split percentage restores after narrow overlay", async ({ page }, testInfo) => {
    const diagnostics = attachLayoutDiagnostics(page);
    await openInspectorSample(page, "LOOP.wav", "ja", { width: 1280, height: 800 });
    await dragSourcesDivider(page, 120);
    const wideSourcesWidth = (await boxOf(page.locator(".mo-app-shell__sources"))).width;

    await page.setViewportSize({ width: 800, height: 800 });
    await syncViewportLayout(page);
    await expectNarrowShellClass(page);
    await expectSourcesColumnHidden(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await syncViewportLayout(page);
    await expectWideShellClass(page);
    await expect(page.getByTestId("app-shell-sources")).toBeVisible({ timeout: 20000 });
    const restored = await boxOf(page.locator(".mo-app-shell__sources"));
    expect(Math.abs(restored.width - wideSourcesWidth), "sources width after narrow roundtrip").toBeLessThanOrEqual(
      4,
    );
    await expectNoDocumentHorizontalOverflow(page);
    await attachLayoutMetrics(page, testInfo, "after-narrow-roundtrip");
    assertNoLayoutDiagnostics(diagnostics);
  });

  test("1280 to 800 to 1280: closed sources stay closed after narrow drawer use", async ({ page }, testInfo) => {
    const diagnostics = attachLayoutDiagnostics(page);
    await openInspectorSample(page, "LOOP.wav", "ja", { width: 1280, height: 800 });
    await toggleSourcesNav(page, "ja");
    await expectSourcesColumnHidden(page);

    await page.setViewportSize({ width: 800, height: 800 });
    await syncViewportLayout(page);
    await expectNarrowShellClass(page);
    const dialog = await openSourcesDrawer(page, "ja");
    await page.getByRole("button", { name: uiText("ja", "workspace.sourcesDrawerCloseAria") }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 800 });
    await syncViewportLayout(page);
    await expectWideShellClass(page);
    await expectSourcesColumnHidden(page);
    await expectNoDocumentHorizontalOverflow(page);
    await attachLayoutMetrics(page, testInfo, "after-closed-sources-roundtrip");
    assertNoLayoutDiagnostics(diagnostics);
  });

  test("1280x800 ja: inspector header rename and copy stay clickable", async ({ page }) => {
    await openInspectorSample(page, "LOOP.wav", "ja", { width: 1280, height: 800 });
    const inspectorHost = page.getByTestId("inspector-workspace-host");
    const rename = inspectorHost.getByRole("button", { name: uiText("ja", "inspector.renameAction") });
    const copy = inspectorHost.getByRole("button", { name: uiText("ja", "operations.copyAction") });
    await rename.scrollIntoViewIfNeeded();
    await expect(rename).toBeVisible();
    const renameBox = await rename.boundingBox();
    expect(renameBox, "rename control box").not.toBeNull();
    expect(renameBox!.height, "rename control height").toBeGreaterThan(10);
    await copy.scrollIntoViewIfNeeded();
    await expect(copy).toBeVisible();
    const copyBox = await copy.boundingBox();
    expect(copyBox, "copy control box").not.toBeNull();
  });

  test("1280x600 en: long name header rename stays clickable", async ({ page }) => {
    const displayName = "very_long_disposable_name_for_layout_overflow_acceptance_check.wav";
    await openInspectorSample(page, displayName, "en", { width: 1280, height: 600 });
    const rename = page.getByTestId("inspector-workspace-host").getByRole("button", {
      name: uiText("en", "inspector.renameAction"),
    });
    await rename.scrollIntoViewIfNeeded();
    await expect(rename).toBeVisible();
    const renameBox = await rename.boundingBox();
    expect(renameBox, "rename control box").not.toBeNull();
  });
});
