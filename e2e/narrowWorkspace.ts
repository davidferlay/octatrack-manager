import { expect, type Page } from "@playwright/test";
import { uiText } from "./i18n";

/** Narrow layout: inspector toggle in the context bar (not the status bar). */
export async function showInspectorFromContextBar(
  page: Page,
  locale: "ja" | "en",
): Promise<void> {
  await page.waitForFunction(() => window.matchMedia("(max-width: 840px)").matches);
  const toggle = page.getByTestId("app-shell-context").getByRole("button", {
    name: uiText(locale, "workspace.showInspector"),
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
