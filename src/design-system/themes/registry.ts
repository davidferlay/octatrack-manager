/**
 * Registered design-system appearance themes.
 * Adding a theme requires:
 * 1. a `[data-mo-theme="…"]` token pack in themes.css
 * 2. an entry in THEME_REGISTRY below
 */

export const THEME_ATTRIBUTE = 'data-mo-theme'
export const THEME_STORAGE_KEY = 'masterocta.ui-theme'
export const DEFAULT_THEME_ID = 'classic' as const

export const THEME_IDS = ['classic', 'masterocta'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
}

export const THEME_REGISTRY: readonly ThemeDefinition[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Elektron-compatible orange accent on near-black surfaces.',
  },
  {
    id: 'masterocta',
    label: 'MasterOCTa',
    description: 'Cool graphite surfaces with a teal signal accent.',
  },
] as const

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value)
}

export function listThemes(): readonly ThemeDefinition[] {
  return THEME_REGISTRY
}

export function getTheme(id: ThemeId): ThemeDefinition {
  const theme = THEME_REGISTRY.find((entry) => entry.id === id)
  if (!theme) {
    throw new Error(`Unknown theme id: ${id}`)
  }
  return theme
}

export function resolveThemeId(value: string | null | undefined): ThemeId {
  if (typeof value === 'string' && isThemeId(value)) {
    return value
  }
  return DEFAULT_THEME_ID
}
