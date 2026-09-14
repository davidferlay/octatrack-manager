import { describe, expect, it } from 'vitest'
import { assertCatalogParity, createTranslate } from './messages'

describe('i18n catalogs', () => {
  it('keeps ja/en keys and interpolation variables aligned', () => {
    expect(() => assertCatalogParity()).not.toThrow()
  })

  it('interpolates matching counts as full sentences', () => {
    const tJa = createTranslate('ja')
    const tEn = createTranslate('en')
    expect(tJa('library.fileCountSearch', { matching: 3, total: 10 })).toContain('3')
    expect(tEn('library.fileCountSearch', { matching: 3, total: 10 })).toContain('3')
  })
})
