import type { ReactNode } from 'react'
import { LocaleProvider } from './LocaleProvider'
import type { LocaleId } from './registry'

export function withLocaleProvider(
  children: ReactNode,
  initialLocaleId?: LocaleId,
): ReactNode {
  return (
    <LocaleProvider initialLocaleId={initialLocaleId}>{children}</LocaleProvider>
  )
}
