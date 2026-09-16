import type { Page } from "@playwright/test";
import { uiText } from "./i18n";

export async function clickCatalogFileRow(
  page: Page,
  locale: "ja" | "en",
  displayName: string,
) {
  await page
    .getByLabel(uiText(locale, "library.audioFilesAria"))
    .locator(".catalog-file-table__row", { hasText: displayName })
    .click();
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
