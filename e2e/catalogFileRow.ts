import { expect, type Page } from "@playwright/test";
import { uiText } from "./i18n";

export async function clickCatalogFileRow(
  page: Page,
  locale: "ja" | "en",
  displayName: string,
) {
  const row = catalogFileRowLocator(page, locale, displayName);
  await expect(row).toBeVisible({ timeout: 60000 });
  await row.scrollIntoViewIfNeeded();
  await row.click();
}

export function catalogFileRowLocator(
  page: Page,
  locale: "ja" | "en",
  displayName: string,
) {
  return page
    .getByLabel(uiText(locale, "library.audioFilesAria"))
    .locator(".catalog-file-table__row", { hasText: displayName });
}

/** Rename via catalog sample ops menu (Operations Drawer), not Inspector duplicate. */
export async function openSampleRenameFromCatalog(page: Page, locale: "ja" | "en") {
  await page
    .getByLabel(uiText(locale, "library.audioFilesAria"))
    .getByRole("group", { name: uiText(locale, "operations.sampleMenuAria") })
    .getByRole("button", { name: uiText(locale, "inspector.renameAction") })
    .click();
}
