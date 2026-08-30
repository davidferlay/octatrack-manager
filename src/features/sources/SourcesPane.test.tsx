import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { RootSession } from '../../api'
import { ThemeProvider } from '../../design-system'
import { SourcesPane } from './SourcesPane'

function renderSources(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

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
    renderSources(
      <SourcesPane
        session={null}
        onRegister={onRegister}
        onClose={vi.fn()}
        onEnableWrite={vi.fn()}
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
    renderSources(
      <SourcesPane
        session={session}
        onRegister={vi.fn()}
        onClose={onClose}
        onEnableWrite={vi.fn()}
      />,
    )
    expect(screen.getByText('Fixture Root')).toBeInTheDocument()
    expect(screen.getByText('0123456789ab')).toBeInTheDocument()
    expect(screen.queryByText(session.rootId)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close root' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('surfaces errors without exposing caller-owned raw paths', () => {
    renderSources(
      <SourcesPane
        session={null}
        error="picker unavailable"
        onRegister={vi.fn()}
        onClose={vi.fn()}
        onEnableWrite={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('picker unavailable')
  })

  it('requires an explicit action before showing edit-enabled mode', () => {
    const onEnableWrite = vi.fn()
    const { rerender } = renderSources(
      <SourcesPane
        session={session}
        onRegister={vi.fn()}
        onClose={vi.fn()}
        onEnableWrite={onEnableWrite}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enable edit mode' }))
    expect(onEnableWrite).toHaveBeenCalledOnce()

    rerender(
      <ThemeProvider>
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
        />
      </ThemeProvider>,
    )

    expect(screen.getByText('EDIT ENABLED')).toBeInTheDocument()
    expect(screen.getByText('Additive copy only. Use a cloned or test root, never original media.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable edit mode' })).not.toBeInTheDocument()
  })

  it('exposes appearance theme switcher', () => {
    renderSources(
      <SourcesPane
        session={null}
        onRegister={vi.fn()}
        onClose={vi.fn()}
        onEnableWrite={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Design system appearance theme')).toBeInTheDocument()
    expect(screen.getByText('Appearance')).toBeInTheDocument()
  })
})
