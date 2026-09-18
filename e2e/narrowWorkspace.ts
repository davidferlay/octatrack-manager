import { expect, type Page } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";

/** Narrow layout: inspector toggle in the context bar (not the status bar). */
export async function showInspectorFromContextBar(
  page: Page,
  locale: "ja" | "en",
): Promise<void> {
  const toggle = page.getByTestId("app-shell-context").getByRole("button", {
    name: uiText(locale, "workspace.showInspector"),
    exact: true,
  });
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await toggle.click();
}

export async function showListFromContextBar(
  page: Page,
  locale: "ja" | "en",
): Promise<void> {
  const toggle = page.getByTestId("app-shell-context").getByRole("button", {
    name: uiText(locale, "workspace.showList"),
    exact: true,
  });
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await toggle.click();
}

export async function showListFromStatusBar(
  page: Page,
  locale: "ja" | "en",
): Promise<void> {
  const toggle = page.getByTestId("app-shell-status").getByRole("button", {
    name: uiText(locale, "workspace.showListStatusAria"),
    exact: true,
  });
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await toggle.click();
}

export async function expectEditEnabledInContextBar(
  page: Page,
  locale: "ja" | "en",
): Promise<void> {
  await expect(
    page.getByTestId("app-shell-context").getByText(uiText(locale, "context.editEnabled"), {
      exact: true,
    }),
  ).toBeVisible();
}

export async function expectNoDocumentHorizontalOverflow(page: Page, tolerancePx = 1) {
  const metrics = await page.evaluate((tolerance) => {
    const root = document.scrollingElement ?? document.documentElement;
    const limit = window.innerWidth + tolerance;
    const offenders: Array<{
      tag: string;
      className: string;
      right: number;
      width: number;
      minWidth: string;
      whiteSpace: string;
    }> = [];
    for (const node of document.querySelectorAll("body *")) {
      if (!(node instanceof HTMLElement)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.right <= limit) continue;
      const style = getComputedStyle(node);
      offenders.push({
        tag: node.tagName.toLowerCase(),
        className: typeof node.className === "string" ? node.className.slice(0, 120) : "",
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        minWidth: style.minWidth,
        whiteSpace: style.whiteSpace,
      });
      if (offenders.length >= 12) break;
    }
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  }, tolerancePx);
  expect(
    metrics.scrollWidth,
    `document overflow: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.innerWidth + tolerancePx);
}

/** Workspace shell only (legacy Home chrome above the shell may widen the document). */
export async function expectNoWorkspaceHorizontalOverflow(page: Page, tolerancePx = 1) {
  const shell = page.locator(".mo-app-shell--workspace");
  await expect(shell).toBeVisible();
  const metrics = await shell.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `workspace scrollWidth ${metrics.scrollWidth} vs clientWidth ${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth + tolerancePx);
}

/** Matches RootRegistryPanel / useMediaQuery max-width handling (innerWidth, not matchMedia alone). */
export async function expectNarrowBreakpointMatches(page: Page, expectedNarrow: boolean) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    mq: window.matchMedia("(max-width: 840px)").matches,
    narrowData: document.querySelector(".mo-app-shell")?.getAttribute("data-narrow-layout") ?? null,
  }));
  const layoutNarrow = metrics.innerWidth <= 840;
  expect(layoutNarrow, `innerWidth ${metrics.innerWidth} narrow`).toBe(expectedNarrow);
  expect(metrics.narrowData, "data-narrow-layout").toBe(expectedNarrow ? "true" : "false");
}

/** Playwright viewport changes do not always emit matchMedia "change"; nudge React listeners. */
export async function syncViewportLayout(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

async function readNarrowLayoutMetrics(page: Page) {
  return page.evaluate(() => ({
    href: window.location.href,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    mq: window.matchMedia("(max-width: 840px)").matches,
    narrowData: document.querySelector(".mo-app-shell")?.getAttribute("data-narrow-layout") ?? null,
    shellClass: document.querySelector(".mo-app-shell")?.className ?? null,
    rootChildren: document.getElementById("root")?.childElementCount ?? null,
  }));
}

export async function expectNarrowShellClass(page: Page) {
  await page.waitForSelector(".mo-app-shell", { timeout: 30000 });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await syncViewportLayout(page);
    const metrics = await readNarrowLayoutMetrics(page);
    if (metrics.narrowData === "true") {
      return;
    }
    await page.waitForTimeout(250);
  }
  const metrics = await readNarrowLayoutMetrics(page);
  throw new Error(`narrow layout not applied: ${JSON.stringify(metrics)}`);
}

export async function expectWideShellClass(page: Page) {
  await page.waitForSelector(".mo-app-shell", { timeout: 30000 });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await syncViewportLayout(page);
    const metrics = await readNarrowLayoutMetrics(page);
    if (metrics.narrowData === "false") {
      return;
    }
    await page.waitForTimeout(250);
  }
  const metrics = await readNarrowLayoutMetrics(page);
  throw new Error(`wide layout not applied: ${JSON.stringify(metrics)}`);
}

export async function expectSourcesColumnHidden(page: Page) {
  await expect(page.getByTestId("app-shell-sources")).toHaveCount(0);
  await expect(page.getByTestId("app-shell-divider")).toHaveCount(0);
}

export async function toggleSourcesNav(page: Page, locale: "ja" | "en") {
  const toggle = page.getByTestId("app-shell-context").getByRole("button", {
    name: uiText(locale, "workspace.toggleNav"),
    exact: true,
  });
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
}

export async function openSourcesDrawer(page: Page, locale: "ja" | "en" = "ja") {
  await toggleSourcesNav(page, locale);
  const dialog = page.getByRole("dialog", { name: uiText(locale, "sources.title") });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function expectVisiblePaneUsesBodyWidth(
  page: Page,
  mode: "list" | "inspector",
  tolerancePx = 4,
) {
  const body = page.locator(".mo-app-shell__body.mo-app-shell__outer-split");
  const bodyWidth = await body.evaluate((el) => el.getBoundingClientRect().width);
  const pane = mode === "list"
    ? page.locator(".mo-app-shell__main")
    : page.locator(".mo-app-shell__inspector");
  await expect(pane).toBeVisible();
  const paneWidth = await pane.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(paneWidth - bodyWidth), `${mode} pane vs body`).toBeLessThanOrEqual(tolerancePx);
}
