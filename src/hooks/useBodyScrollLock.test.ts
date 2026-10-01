import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBodyScrollLock } from './useBodyScrollLock'

/** jsdom reports 0 for both widths, so a scrollbar has to be simulated. */
function withScrollbar(width: number) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000 - width)
}

beforeEach(() => {
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
})
afterEach(() => vi.restoreAllMocks())

describe('useBodyScrollLock', () => {
  it('locks the page while the modal is up', () => {
    renderHook(() => useBodyScrollLock())
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('gives the page back its scrolling on unmount', () => {
    const { unmount } = renderHook(() => useBodyScrollLock())
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores what the page had set, rather than assuming it was unset', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = renderHook(() => useBodyScrollLock())
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('pads the width the scrollbar leaves behind, so the page does not jump sideways', () => {
    withScrollbar(15)
    const { unmount } = renderHook(() => useBodyScrollLock())
    expect(document.body.style.paddingRight).toBe('15px')
    unmount()
    expect(document.body.style.paddingRight).toBe('')
  })

  it('adds no padding when there is no scrollbar to replace', () => {
    withScrollbar(0)
    renderHook(() => useBodyScrollLock())
    expect(document.body.style.paddingRight).toBe('')
  })

  it('does nothing while disabled', () => {
    renderHook(() => useBodyScrollLock(false))
    expect(document.body.style.overflow).toBe('')
  })

  it('locks and unlocks as the flag flips', () => {
    const { rerender } = renderHook(({ on }) => useBodyScrollLock(on), {
      initialProps: { on: false },
    })
    expect(document.body.style.overflow).toBe('')
    rerender({ on: true })
    expect(document.body.style.overflow).toBe('hidden')
    rerender({ on: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps the page locked while a second modal sits on top of the first', () => {
    const outer = renderHook(() => useBodyScrollLock())
    const inner = renderHook(() => useBodyScrollLock())
    inner.unmount()
    // The outer modal is still open, so the page must stay locked
    expect(document.body.style.overflow).toBe('hidden')
    outer.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
