import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RenameProjectModal } from './RenameProjectModal'

const baseProps = {
  projectName: 'MY_PROJ',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('RenameProjectModal', () => {
  it('renders with current name pre-filled', () => {
    render(<RenameProjectModal {...baseProps} />)
    expect(screen.getByRole('textbox')).toHaveValue('MY_PROJ')
  })

  it('shows Rename Project in header', () => {
    render(<RenameProjectModal {...baseProps} />)
    expect(screen.getByText(/Rename Project/)).toBeInTheDocument()
  })

  it('disables Rename button when name is unchanged', () => {
    render(<RenameProjectModal {...baseProps} />)
    expect(screen.getByRole('button', { name: /^rename$/i })).toBeDisabled()
  })

  it('enables Rename button when name is changed to valid value', async () => {
    const u = userEvent.setup()
    render(<RenameProjectModal {...baseProps} />)
    const input = screen.getByRole('textbox')
    await u.clear(input)
    await u.type(input, 'NEW_NAME')
    expect(screen.getByRole('button', { name: /^rename$/i })).toBeEnabled()
  })

  it('calls onConfirm with new name on Enter', async () => {
    const onConfirm = vi.fn()
    const u = userEvent.setup()
    render(<RenameProjectModal {...baseProps} onConfirm={onConfirm} />)
    const input = screen.getByRole('textbox')
    await u.clear(input)
    await u.type(input, 'RENAMED{Enter}')
    expect(onConfirm).toHaveBeenCalledWith('RENAMED')
  })

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn()
    render(<RenameProjectModal {...baseProps} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('caps input at 12 chars', async () => {
    const u = userEvent.setup()
    render(<RenameProjectModal {...baseProps} />)
    const input = screen.getByRole('textbox')
    await u.clear(input)
    await u.type(input, 'ABCDEFGHIJKLMNO')
    expect(input).toHaveValue('ABCDEFGHIJKL')
  })

  it('silently filters invalid OT characters', async () => {
    const u = userEvent.setup()
    render(<RenameProjectModal {...baseProps} />)
    const input = screen.getByRole('textbox')
    await u.clear(input)
    await u.type(input, 'BAD€')
    expect(input).toHaveValue('BAD')
  })
})
