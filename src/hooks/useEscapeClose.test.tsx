import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useEscapeClose, isModalOpen } from './useEscapeClose'

function Modal({ onClose, enabled = true, children }: { onClose: () => void; enabled?: boolean; children?: React.ReactNode }) {
  useEscapeClose(onClose, enabled)
  return <div className="modal-overlay">{children}</div>
}

describe('useEscapeClose', () => {
  it('closes the modal on Escape', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes only the topmost modal, one layer per press', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(<><Modal onClose={outer} /><Modal onClose={inner} /></>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('stays silent while disabled, so a run in progress is not dismissed', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} enabled={false} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves Escape to a context menu opened inside the modal', () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose}><div className="context-menu">menu</div></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves Escape to a focused field, so it clears a search box before closing', () => {
    const onClose = vi.fn()
    const { getByRole } = render(<Modal onClose={onClose}><input aria-label="search" /></Modal>)
    const input = getByRole('textbox')
    input.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    input.blur()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops the event so page-level handlers never see it', () => {
    const pageHandler = vi.fn()
    document.addEventListener('keydown', pageHandler)
    try {
      render(<Modal onClose={vi.fn()} />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(pageHandler).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', pageHandler)
    }
  })

  it('unregisters on unmount, handing Escape back to the page', () => {
    const onClose = vi.fn()
    const pageHandler = vi.fn()
    const { unmount } = render(<Modal onClose={onClose} />)
    unmount()
    document.addEventListener('keydown', pageHandler)
    try {
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
      expect(pageHandler).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', pageHandler)
    }
  })
})

describe('isModalOpen', () => {
  it('reports whether any overlay is on screen', () => {
    expect(isModalOpen()).toBe(false)
    const { unmount } = render(<Modal onClose={vi.fn()} />)
    expect(isModalOpen()).toBe(true)
    unmount()
    expect(isModalOpen()).toBe(false)
  })
})
