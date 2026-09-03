import { describe, expect, it } from 'vitest'
import {
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  PRODUCT_WORKSPACE_LABEL,
} from './product'

describe('product branding', () => {
  it('exposes Masta-Octa rename artifacts without absolute paths', () => {
    expect(PRODUCT_NAME).toBe('Masta-Octa')
    expect(PRODUCT_TAGLINE).toContain('Octatrack')
    expect(PRODUCT_WORKSPACE_LABEL).toBe('Masta-Octa workspace')
    expect(PRODUCT_NAME).not.toMatch(/Tauri|React \+|Octatrack Manager/i)
    expect(JSON.stringify({ PRODUCT_NAME, PRODUCT_TAGLINE })).not.toContain(
      '/private/',
    )
  })
})
