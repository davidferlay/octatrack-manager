import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateProjectModal } from './CreateProjectModal'

const baseProps = {
  setPath: '/tmp/SetA',
  setName: 'SetA',
  existingNames: [] as string[],
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('CreateProjectModal', () => {
  it('renders with empty input and 0 / 32 counter', () => {
    render(<CreateProjectModal {...baseProps} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByText(/0\s*\/\s*32/)).toBeInTheDocument()
  })

  it('updates counter as the user types', async () => {
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} />)
    await u.type(screen.getByRole('textbox'), 'HELLO')
    expect(screen.getByText(/5\s*\/\s*32/)).toBeInTheDocument()
  })

  it('caps input at 32 chars', async () => {
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} />)
    await u.type(screen.getByRole('textbox'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567')
    expect(screen.getByRole('textbox')).toHaveValue('ABCDEFGHIJKLMNOPQRSTUVWXYZ123456')
  })

  it('silently filters unsupported OT chars', async () => {
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} />)
    await u.type(screen.getByRole('textbox'), 'EUR€')
    expect(screen.getByRole('textbox')).toHaveValue('EUR')
  })

  it('silently filters filesystem-forbidden chars', async () => {
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} />)
    await u.type(screen.getByRole('textbox'), 'A/B')
    expect(screen.getByRole('textbox')).toHaveValue('AB')
  })

  it('shows conflict error when name already exists', async () => {
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} existingNames={['EXISTS']} />)
    await u.type(screen.getByRole('textbox'), 'EXISTS')
    expect(screen.getByText(/already exists/i)).toBeInTheDocument()
  })

  it('disables submit button when invalid', async () => {
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} />)
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
    await u.type(screen.getByRole('textbox'), 'OK')
    expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
  })

  it('calls onConfirm with name on Enter when valid', async () => {
    const onConfirm = vi.fn()
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} onConfirm={onConfirm} />)
    await u.type(screen.getByRole('textbox'), 'NEW{Enter}')
    expect(onConfirm).toHaveBeenCalledWith('NEW')
  })

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn()
    render(<CreateProjectModal {...baseProps} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows spinner and disables input while submitting', async () => {
    let resolveCreate: () => void
    const onConfirm = () => new Promise<void>((r) => { resolveCreate = r })
    const u = userEvent.setup()
    render(<CreateProjectModal {...baseProps} onConfirm={onConfirm} />)
    await u.type(screen.getByRole('textbox'), 'NEW{Enter}')
    // During submission: input disabled, spinner visible
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByText(/creating\.\.\./i)).toBeInTheDocument()
    resolveCreate!()
  })
})
