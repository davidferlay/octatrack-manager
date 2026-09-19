import type { Page, TestInfo } from "@playwright/test";

export type LayoutDiagnosticSink = {
  pageErrors: string[];
  consoleErrors: string[];
};

export function attachLayoutDiagnostics(page: Page): LayoutDiagnosticSink {
  const sink: LayoutDiagnosticSink = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (error) => sink.pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.consoleErrors.push(msg.text());
  });
  return sink;
}

export function assertNoLayoutDiagnostics(sink: LayoutDiagnosticSink) {
  const combined = [...sink.pageErrors, ...sink.consoleErrors];
  if (combined.length > 0) {
    throw new Error(`unexpected page diagnostics: ${combined.join(" | ")}`);
  }
}

export async function readLayoutMetrics(page: Page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    mqNarrow: window.matchMedia("(max-width: 840px)").matches,
    narrowData: document.querySelector(".mo-app-shell")?.getAttribute("data-narrow-layout") ?? null,
    rootChildren: document.getElementById("root")?.childElementCount ?? null,
    scrollWidth: (document.scrollingElement ?? document.documentElement).scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

export async function attachLayoutMetrics(page: Page, testInfo: TestInfo, label: string) {
  const metrics = await readLayoutMetrics(page);
  await testInfo.attach(`${label}-layout-metrics.json`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
}
