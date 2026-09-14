export const LOCALE_ATTRIBUTE = 'lang'
export const LOCALE_STORAGE_KEY = 'masterocta.ui-locale'
export const DEFAULT_LOCALE_ID = 'ja' as const

export const LOCALE_IDS = ['ja', 'en'] as const

export type LocaleId = (typeof LOCALE_IDS)[number]

export interface LocaleDefinition {
  id: LocaleId
  label: string
}

export const LOCALE_REGISTRY: readonly LocaleDefinition[] = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
] as const

export function isLocaleId(value: string): value is LocaleId {
  return (LOCALE_IDS as readonly string[]).includes(value)
}

export function resolveLocaleId(value: string | null | undefined): LocaleId {
  if (typeof value === 'string' && isLocaleId(value)) {
    return value
  }
  return DEFAULT_LOCALE_ID
}

export function listLocales(): readonly LocaleDefinition[] {
  return LOCALE_REGISTRY
}

export function getLocale(id: LocaleId): LocaleDefinition {
  const locale = LOCALE_REGISTRY.find((entry) => entry.id === id)
  if (!locale) {
    throw new Error(`Unknown locale id: ${id}`)
  }
  return locale
}
