import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LOCALE_STORAGE_KEY } from './registry'
import { LocaleProvider, useLocale } from './LocaleProvider'
import { LanguageSwitcher } from './LanguageSwitcher'
import { applyStoredLocaleBeforePaint } from './applyLocale'

function LocaleProbe() {
  const { localeId } = useLocale()
  return <span data-testid="locale-probe">{localeId}</span>
}

describe('LocaleProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('lang')
  })

  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('lang')
  })

  it('defaults to ja and persists explicit selection', async () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <LocaleProbe />
      </LocaleProvider>,
    )
    expect(screen.getByTestId('locale-probe')).toHaveTextContent('ja')
    fireEvent.change(screen.getByLabelText('表示言語'), { target: { value: 'en' } })
    await waitFor(() => {
      expect(screen.getByTestId('locale-probe')).toHaveTextContent('en')
      expect(document.documentElement.getAttribute('lang')).toBe('en')
    })
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })

  it('applies stored locale before paint', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    expect(applyStoredLocaleBeforePaint()).toBe('en')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })
})
