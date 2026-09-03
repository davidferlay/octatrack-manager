import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  THEME_REGISTRY,
  getTheme,
  isThemeId,
  listThemes,
  resolveThemeId,
} from './registry'

describe('theme registry', () => {
  it('registers classic and masterocta', () => {
    expect(THEME_IDS).toEqual(['classic', 'masterocta'])
    expect(listThemes().map((theme) => theme.id)).toEqual(['classic', 'masterocta'])
    expect(THEME_REGISTRY).toHaveLength(2)
  })

  it('resolves known and unknown ids', () => {
    expect(isThemeId('classic')).toBe(true)
    expect(isThemeId('masterocta')).toBe(true)
    expect(isThemeId('neon')).toBe(false)
    expect(resolveThemeId('masterocta')).toBe('masterocta')
    expect(resolveThemeId('nope')).toBe(DEFAULT_THEME_ID)
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME_ID)
  })

  it('returns definition by id', () => {
    expect(getTheme('classic').label).toBe('Classic')
    expect(getTheme('masterocta').label).toBe('Masta-Octa')
  })
})
