import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import {
  applyThemeToDocument,
  readStoredThemeId,
  writeStoredThemeId,
} from './applyTheme'
import {
  DEFAULT_THEME_ID,
  getTheme,
  listThemes,
  type ThemeDefinition,
  type ThemeId,
} from './registry'

export interface ThemeContextValue {
  themeId: ThemeId
  theme: ThemeDefinition
  themes: readonly ThemeDefinition[]
  setThemeId: (themeId: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export interface ThemeProviderProps {
  children: ReactNode
  /** Override initial theme (tests). Defaults to stored / classic. */
  initialThemeId?: ThemeId
}

export function ThemeProvider({ children, initialThemeId }: ThemeProviderProps) {
  const [themeId, setThemeIdState] = useState<ThemeId>(
    () => initialThemeId ?? readStoredThemeId(),
  )

  useEffect(() => {
    applyThemeToDocument(themeId)
    writeStoredThemeId(themeId)
  }, [themeId])

  const setThemeId = useCallback((next: ThemeId) => {
    setThemeIdState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId,
      theme: getTheme(themeId),
      themes: listThemes(),
      setThemeId,
    }),
    [themeId, setThemeId],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (value === null) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return value
}

export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext)
}

/** Safe fallback when a leaf renders outside the provider (should be rare). */
export function useThemeOrDefault(): ThemeContextValue {
  const value = useOptionalTheme()
  if (value) return value
  return {
    themeId: DEFAULT_THEME_ID,
    theme: getTheme(DEFAULT_THEME_ID),
    themes: listThemes(),
    setThemeId: () => undefined,
  }
}
