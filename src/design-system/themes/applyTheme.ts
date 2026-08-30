import {
  DEFAULT_THEME_ID,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  resolveThemeId,
  type ThemeId,
} from './registry'

export function readStoredThemeId(): ThemeId {
  try {
    return resolveThemeId(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_ID
  }
}

export function writeStoredThemeId(themeId: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId)
  } catch {
    // Persistence is best-effort; theme still applies for the session.
  }
}

export function applyThemeToDocument(themeId: ThemeId, root: ParentNode = document): void {
  const element =
    root instanceof Document ? root.documentElement : (root as Element).ownerDocument?.documentElement
  if (!element) return
  element.setAttribute(THEME_ATTRIBUTE, themeId)
}

/** Call before React mount to avoid a classic→selected flash. */
export function applyStoredThemeBeforePaint(): ThemeId {
  const themeId = readStoredThemeId()
  applyThemeToDocument(themeId)
  return themeId
}
