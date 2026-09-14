import { startTransition } from 'react'
import { useLocale } from './LocaleProvider'
import type { LocaleId } from './registry'
import './LanguageSwitcher.css'

export interface LanguageSwitcherProps {
  className?: string
  disabled?: boolean
}

export function LanguageSwitcher({ className, disabled = false }: LanguageSwitcherProps) {
  const { localeId, locales, setLocaleId, t } = useLocale()
  const merged = ['mo-language-switcher', className].filter(Boolean).join(' ')

  return (
    <div className={merged}>
      <label className="mo-language-switcher__label" htmlFor="mo-language-switcher-select">
        {t('language.label')}
      </label>
      <select
        id="mo-language-switcher-select"
        className="mo-language-switcher__select"
        value={localeId}
        disabled={disabled}
        aria-label={t('language.selectAria')}
        onChange={(event) => {
          const next = event.target.value as LocaleId
          startTransition(() => {
            setLocaleId(next)
          })
        }}
      >
        {locales.map((locale) => (
          <option key={locale.id} value={locale.id}>
            {locale.label}
          </option>
        ))}
      </select>
    </div>
  )
}
