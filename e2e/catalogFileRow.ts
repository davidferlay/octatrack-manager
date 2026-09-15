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
