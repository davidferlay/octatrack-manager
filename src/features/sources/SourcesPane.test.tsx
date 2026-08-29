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
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('picker unavailable')
  })
})
