import {
  DEFAULT_LOCALE_ID,
  LOCALE_ATTRIBUTE,
  LOCALE_STORAGE_KEY,
  resolveLocaleId,
  type LocaleId,
} from './registry'

export function readStoredLocaleId(): LocaleId {
  try {
    return resolveLocaleId(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_LOCALE_ID
  }
}

export function writeStoredLocaleId(localeId: LocaleId): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, localeId)
  } catch {
    // Persistence is best-effort; locale still applies for the session.
  }
}

export function applyLocaleToDocument(localeId: LocaleId, root: ParentNode = document): void {
  const element =
    root instanceof Document ? root.documentElement : (root as Element).ownerDocument?.documentElement
  if (!element) return
  element.setAttribute(LOCALE_ATTRIBUTE, localeId)
}

/** Call before React mount to avoid a default-locale flash. */
export function applyStoredLocaleBeforePaint(): LocaleId {
  const localeId = readStoredLocaleId()
  applyLocaleToDocument(localeId)
  return localeId
}
