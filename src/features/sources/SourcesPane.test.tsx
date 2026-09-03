import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RootSession } from '../../api'
import { SourcesPane } from './SourcesPane'

const session: RootSession = {
  rootId: 'root-opaque',
  displayName: 'Fixture Root',
  deviceFingerprint: '0123456789abcdef',
  mode: 'read_only',
  observedRevision: 1,
  expiresInSeconds: 3600,
  capabilities: {
    read: true,
    write: false,
    stableDeviceIdentity: true,
  },
}

describe('SourcesPane', () => {
  it('shows empty state and register action without a session', () => {
    const onRegister = vi.fn()
    render(
      <SourcesPane
        session={null}
        onRegister={onRegister}
        onClose={vi.fn()}
        onEnableWrite={vi.fn()}
        onDisableWrite={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByText('READ ONLY')).toHaveClass('root-mode-badge')
    expect(screen.getByText('No root registered for this session.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose root...' }))
    expect(onRegister).toHaveBeenCalledOnce()
  })

  it('renders backend display fields and close action for a session', () => {
    const onClose = vi.fn()
    render(
      <SourcesPane
        session={session}
        onRegister={vi.fn()}
        onClose={onClose}
        onEnableWrite={vi.fn()}
        onDisableWrite={vi.fn()}
      />,
    )
    expect(screen.getByText('Fixture Root')).toBeInTheDocument()
    expect(screen.getByText('0123456789ab')).toBeInTheDocument()
    expect(screen.queryByText(session.rootId)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close root' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('surfaces errors without exposing caller-owned raw paths', () => {
    render(
      <SourcesPane
        session={null}
        error="picker unavailable"
        onRegister={vi.fn()}
        onClose={vi.fn()}
        onEnableWrite={vi.fn()}
        onDisableWrite={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('picker unavailable')
  })

  it('toggles between View and Edit modes with explicit actions', () => {
    const onEnableWrite = vi.fn()
    const onDisableWrite = vi.fn()
    const { rerender } = render(
      <SourcesPane
        session={session}
        onRegister={vi.fn()}
        onClose={vi.fn()}
        onEnableWrite={onEnableWrite}
        onDisableWrite={onDisableWrite}
      />,
    )

    const viewButton = screen.getByRole('button', { name: 'View' })
    const editButton = screen.getByRole('button', { name: 'Edit' })
    expect(viewButton).toHaveAttribute('aria-pressed', 'true')
    expect(editButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(editButton)
    expect(onEnableWrite).toHaveBeenCalledOnce()

    rerender(
      <SourcesPane
        session={{
          ...session,
          mode: 'write_enabled',
          writeGrantExpiresInSeconds: 600,
          capabilities: { ...session.capabilities, write: true },
        }}
        onRegister={vi.fn()}
        onClose={vi.fn()}
        onEnableWrite={onEnableWrite}
        onDisableWrite={onDisableWrite}
      />,
    )

    expect(screen.getByText('EDIT ENABLED')).toBeInTheDocument()
    expect(screen.getByText(/Rename apply requires a verified disposable clone/i)).toBeInTheDocument()
    const viewWhenEditing = screen.getByRole('button', { name: 'View' })
    const editWhenEditing = screen.getByRole('button', { name: 'Edit' })
    expect(viewWhenEditing).toHaveAttribute('aria-pressed', 'false')
    expect(editWhenEditing).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(viewWhenEditing)
    expect(onDisableWrite).toHaveBeenCalledOnce()
  })
})
