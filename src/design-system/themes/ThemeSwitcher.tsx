import { startTransition } from 'react'
import { useTheme } from './ThemeProvider'
import type { ThemeId } from './registry'
import './ThemeSwitcher.css'

export interface ThemeSwitcherProps {
  className?: string
  disabled?: boolean
}

/**
 * Registers-and-switches appearance themes from THEME_REGISTRY.
 * Affects --mo-* token consumers; legacy hardcoded CSS may lag.
 */
export function ThemeSwitcher({ className, disabled = false }: ThemeSwitcherProps) {
  const { themeId, themes, setThemeId } = useTheme()
  const merged = ['mo-theme-switcher', className].filter(Boolean).join(' ')

  return (
    <div className={merged}>
      <label className="mo-theme-switcher__label" htmlFor="mo-theme-switcher-select">
        Appearance
      </label>
      <select
        id="mo-theme-switcher-select"
        className="mo-theme-switcher__select"
        value={themeId}
        disabled={disabled}
        aria-label="Design system appearance theme"
        onChange={(event) => {
          const next = event.target.value as ThemeId
          startTransition(() => {
            setThemeId(next)
          })
        }}
      >
        {themes.map((theme) => (
          <option key={theme.id} value={theme.id} title={theme.description}>
            {theme.label}
          </option>
        ))}
      </select>
    </div>
  )
}
