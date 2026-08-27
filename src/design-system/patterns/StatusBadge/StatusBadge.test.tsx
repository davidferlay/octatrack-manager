import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('applies root-mode-badge for readonly tone', () => {
    render(<StatusBadge tone="readonly">READ ONLY</StatusBadge>)
    expect(screen.getByText('READ ONLY')).toHaveClass('root-mode-badge')
  })

  it('applies mo-status-badge modifiers for other tones', () => {
    const { rerender } = render(<StatusBadge tone="safe">OK</StatusBadge>)
    expect(screen.getByText('OK')).toHaveClass('mo-status-badge')
    expect(screen.getByText('OK')).toHaveClass('mo-status-badge--safe')

    rerender(<StatusBadge tone="warning">WARN</StatusBadge>)
    expect(screen.getByText('WARN')).toHaveClass('mo-status-badge--warning')

    rerender(<StatusBadge tone="danger">ERR</StatusBadge>)
    expect(screen.getByText('ERR')).toHaveClass('mo-status-badge--danger')

    rerender(<StatusBadge tone="neutral">N</StatusBadge>)
    expect(screen.getByText('N')).toHaveClass('mo-status-badge--neutral')
  })
})
