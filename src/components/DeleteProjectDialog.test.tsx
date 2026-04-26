import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteProjectDialog } from './DeleteProjectDialog'

const baseProps = {
  projectName: 'MY_PROJ',
  setName: 'SetA',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('DeleteProjectDialog', () => {
  it('shows project name and set name', () => {
    render(<DeleteProjectDialog {...baseProps} />)
    expect(screen.getByText(/MY_PROJ/)).toBeInTheDocument()
    expect(screen.getByText(/SetA/)).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })

  it('focuses Cancel by default (safe default)', () => {
    render(<DeleteProjectDialog {...baseProps} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus()
  })

  it('calls onCancel when Cancel clicked', async () => {
    const onCancel = vi.fn()
    const u = userEvent.setup()
    render(<DeleteProjectDialog {...baseProps} onCancel={onCancel} />)
    await u.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onConfirm when Delete button is clicked', async () => {
    const onConfirm = vi.fn()
    const u = userEvent.setup()
    render(<DeleteProjectDialog {...baseProps} onConfirm={onConfirm} />)
    await u.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('Escape key cancels', () => {
    const onCancel = vi.fn()
    render(<DeleteProjectDialog {...baseProps} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('Enter does NOT confirm by default (Cancel focused)', () => {
    const onConfirm = vi.fn()
    render(<DeleteProjectDialog {...baseProps} onConfirm={onConfirm} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    // Cancel is focused by default — Enter on focused Cancel should not confirm.
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter confirms when Delete button is focused', async () => {
    const onConfirm = vi.fn()
    const u = userEvent.setup()
    render(<DeleteProjectDialog {...baseProps} onConfirm={onConfirm} />)
    await u.tab() // Cancel → Delete
    fireEvent.keyDown(screen.getByRole('button', { name: /^delete$/i }), { key: 'Enter' })
    // Activate via click semantics (userEvent.keyboard would also work).
    await u.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalled()
  })
})
