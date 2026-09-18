import { expect, type Page } from "@playwright/test";
import { clickCatalogFileRow } from "./catalogFileRow";
import { uiText } from "./i18n";

const LIBRARY_BOOTSTRAP_WIDTH = 1280;

export async function enableE2eNarrowWorkspace(page: Page) {
  await page.evaluate(() => {
    (window as Window & { __E2E_FORCE_NARROW_WORKSPACE__?: boolean }).__E2E_FORCE_NARROW_WORKSPACE__ = true;
    window.dispatchEvent(new Event("mo-e2e-narrow-change"));
    window.dispatchEvent(new Event("resize"));
  });
}

/** Register root and select a sample, then enter narrow inspector layout (1280 bootstrap). */
export async function bootstrapCatalogSampleForNarrowInspector(
  page: Page,
  locale: "ja" | "en",
  displayName: string,
  viewportHeight = 900,
) {
  await page.setViewportSize({ width: LIBRARY_BOOTSTRAP_WIDTH, height: viewportHeight });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: uiText(locale, "sources.chooseRoot") }).click();
  await clickCatalogFileRow(page, locale, displayName);
  await enableE2eNarrowWorkspace(page);
  await expectNarrowShellClass(page);
  await showInspectorFromContextBar(page, locale);
}

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
    name: uiText(locale, "workspace.showList"),
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
  const metrics = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(
    metrics.scrollWidth,
    `document scrollWidth ${metrics.scrollWidth} vs innerWidth ${metrics.innerWidth}`,
  ).toBeLessThanOrEqual(metrics.innerWidth + tolerancePx);
}

export async function expectNarrowMediaMatches(page: Page, expected: boolean) {
  const matched = await page.evaluate(() => window.matchMedia("(max-width: 840px)").matches);
  expect(matched, "matchMedia (max-width: 840px)").toBe(expected);
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
  const pageErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  try {
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
    throw new Error(
      `narrow layout not applied: ${JSON.stringify(metrics)}; pageErrors=${pageErrors.join(" | ")}`,
    );
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  }
}

export async function expectSourcesColumnHidden(page: Page) {
  await expect(page.getByTestId("app-shell-sources")).toHaveCount(0);
  await expect(page.getByTestId("app-shell-divider")).toHaveCount(0);
}

export async function openSourcesDrawer(page: Page, locale: "ja" | "en" = "ja") {
  const toggle = page.getByTestId("app-shell-context").getByRole("button", {
    name: uiText(locale, "workspace.toggleNav"),
    exact: true,
  });
  await toggle.click();
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
  const paneWidth = await pane.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.abs(paneWidth - bodyWidth), `${mode} pane vs body`).toBeLessThanOrEqual(tolerancePx);
}
