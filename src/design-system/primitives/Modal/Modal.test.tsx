import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders dialog chrome when open', () => {
    render(
      <Modal open onClose={() => {}}>
        <Modal.Header>
          <h3>Title</h3>
        </Modal.Header>
        <Modal.Body>
          <p>Body</p>
        </Modal.Body>
        <Modal.Footer>
          <button type="button">Ok</button>
        </Modal.Footer>
      </Modal>,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('returns null when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>
        <Modal.Body>Hidden</Modal.Body>
      </Modal>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onClose on Escape when unlocked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <Modal.Body>Content</Modal.Body>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on Escape when locked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} locked>
        <Modal.Body>Content</Modal.Body>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on backdrop click when enabled', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open onClose={onClose} closeOnBackdrop>
        <Modal.Body>Content</Modal.Body>
      </Modal>,
    )
    fireEvent.click(container.querySelector('.modal-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on content click', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} closeOnBackdrop>
        <Modal.Body>Content</Modal.Body>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders modal-close when showCloseButton is set', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} showCloseButton>
        <Modal.Header>
          <h3>Closable</h3>
        </Modal.Header>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps tab focus within the dialog', async () => {
    const user = userEvent.setup()
    render(
      <Modal open onClose={() => {}}>
        <Modal.Body>
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal.Body>
      </Modal>,
    )
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    expect(document.activeElement).toBe(first)
    await user.tab()
    expect(document.activeElement).toBe(last)
    await user.tab()
    expect(document.activeElement).toBe(first)
  })
})
