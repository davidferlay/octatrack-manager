import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
} from './registry'
import { ThemeProvider, useTheme } from './ThemeProvider'
import { ThemeSwitcher } from './ThemeSwitcher'
import { applyThemeToDocument, applyStoredThemeBeforePaint } from './applyTheme'

function ThemeProbe() {
  const { themeId, theme } = useTheme()
  return (
    <span data-testid="theme-probe">
      {themeId}:{theme.label}
    </span>
  )
}

describe('ThemeProvider and ThemeSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  })

  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  })

  it('applies initial classic theme to the document', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme-probe')).toHaveTextContent('classic:Classic')
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('classic')
    })
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('classic')
  })

  it('switches to masterocta via ThemeSwitcher and persists', async () => {
    render(
      <ThemeProvider>
        <ThemeSwitcher />
        <ThemeProbe />
      </ThemeProvider>,
    )

    fireEvent.change(screen.getByLabelText('Design system appearance theme'), {
      target: { value: 'masterocta' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('theme-probe')).toHaveTextContent('masterocta:MasterOCTa')
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('masterocta')
    })
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('masterocta')
  })

  it('restores stored theme before paint', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'masterocta')
    expect(applyStoredThemeBeforePaint()).toBe('masterocta')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('masterocta')
  })

  it('applyThemeToDocument sets the attribute', () => {
    applyThemeToDocument('classic')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('classic')
    applyThemeToDocument('masterocta')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('masterocta')
  })
})
