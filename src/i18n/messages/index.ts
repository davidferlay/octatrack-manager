export { enMessages, type MessageKey } from './en'
export { jaMessages } from './ja'

import { enMessages, type MessageKey } from './en'
import { jaMessages } from './ja'

export type MessageParams = {
  'context.matchingInLocation': { matching: number; total: number }
  'context.samplesInLocation': { count: number }
  'sources.writeGrantRemaining': { seconds: number }
  'library.snapshotFileCount': { count: number }
  'library.fileCountSearch': { matching: number; total: number }
  'library.fileCountLocation': { total: number }
  'library.paginationPage': { current: number; last: number }
  'audioLibrary.filesInView': { count: number }
  'audioLibrary.filesInViewPlural': { count: number }
  'projectWorkspace.localSamples': { count: number }
  'projectWorkspace.localSamplesPlural': { count: number }
  'usage.usedCount': { count: number }
  'usage.referencedCount': { count: number }
  'usage.missingCount': { count: number }
  'waveform.ariaFor': { displayName: string }
  'waveform.selectedSpan': { duration: string }
  'waveform.previewAria': { displayName: string }
  'waveform.rangePreviewAria': { displayName: string }
  'duration.approxMs': { value: string }
  'duration.seconds': { seconds: number }
  'duration.minutesSeconds': { minutes: number; seconds: string }
  'legacy.toastWithFallback': { fallback: string; detail: string }
  'common.errorWithDetail': { summary: string; detail: string }
  'waveform.error.detail': { detail: string }
  'waveform.viewportFrames': { start: string; end: string }
}

export type MessageKeyWithParams = keyof MessageParams

export type MessageKeyWithoutParams = Exclude<MessageKey, MessageKeyWithParams>

const catalogs = {
  en: enMessages,
  ja: jaMessages,
} as const

export function getMessageCatalog(locale: 'ja' | 'en') {
  return catalogs[locale]
}

/** Ensures ja and en expose the same keys (compile-time via Record + runtime smoke). */
export function assertCatalogParity(): void {
  const enKeys = Object.keys(enMessages).sort()
  const jaKeys = Object.keys(jaMessages).sort()
  if (enKeys.join('\0') !== jaKeys.join('\0')) {
    throw new Error('i18n catalog key mismatch between en and ja')
  }
  for (const key of enKeys) {
    const enText = enMessages[key as MessageKey]
    const jaText = jaMessages[key as MessageKey]
    const enVars = [...enText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const jaVars = [...jaText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    if (enVars.join(',') !== jaVars.join(',')) {
      throw new Error(`i18n interpolation mismatch for ${key}`)
    }
  }
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export type TranslateFn = {
  (key: MessageKeyWithoutParams): string
  <K extends MessageKeyWithParams>(key: K, vars: MessageParams[K]): string
  /** Dynamic keys (e.g. error code mapping) — prefer static keys at call sites. */
  (key: MessageKey): string
}

export function createTranslate(locale: 'ja' | 'en'): TranslateFn {
  const primary = getMessageCatalog(locale)
  const fallback = enMessages

  const translate = ((key: MessageKey, vars?: Record<string, string | number>) => {
    const template = primary[key] ?? fallback[key] ?? key
    if (vars === undefined) return template
    return interpolate(template, vars)
  }) as TranslateFn

  return translate
}
