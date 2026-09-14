import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  applyLocaleToDocument,
  readStoredLocaleId,
  writeStoredLocaleId,
} from './applyLocale'
import { createTranslate, type TranslateFn } from './messages'
import {
  DEFAULT_LOCALE_ID,
  getLocale,
  listLocales,
  type LocaleDefinition,
  type LocaleId,
} from './registry'

export interface LocaleContextValue {
  localeId: LocaleId
  locale: LocaleDefinition
  locales: readonly LocaleDefinition[]
  t: TranslateFn
  setLocaleId: (localeId: LocaleId) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export interface LocaleProviderProps {
  children: ReactNode
  /** Override initial locale (tests). Defaults to stored / ja. */
  initialLocaleId?: LocaleId
}

export function LocaleProvider({ children, initialLocaleId }: LocaleProviderProps) {
  const [localeId, setLocaleIdState] = useState<LocaleId>(
    () => initialLocaleId ?? readStoredLocaleId(),
  )

  useEffect(() => {
    applyLocaleToDocument(localeId)
    writeStoredLocaleId(localeId)
  }, [localeId])

  const setLocaleId = useCallback((next: LocaleId) => {
    setLocaleIdState(next)
  }, [])

  const t = useMemo(() => createTranslate(localeId), [localeId])

  const value = useMemo<LocaleContextValue>(
    () => ({
      localeId,
      locale: getLocale(localeId),
      locales: listLocales(),
      t,
      setLocaleId,
    }),
    [localeId, setLocaleId, t],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext)
  if (value === null) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return value
}

export function useOptionalLocale(): LocaleContextValue | null {
  return useContext(LocaleContext)
}

export function useTranslate(): TranslateFn {
  return useLocale().t
}

/** Safe fallback when a leaf renders outside the provider (should be rare). */
export function useLocaleOrDefault(): LocaleContextValue {
  const value = useOptionalLocale()
  if (value) return value
  const localeId = DEFAULT_LOCALE_ID
  return {
    localeId,
    locale: getLocale(localeId),
    locales: listLocales(),
    t: createTranslate(localeId),
    setLocaleId: () => undefined,
  }
}
