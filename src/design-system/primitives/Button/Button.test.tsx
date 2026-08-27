import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('applies scan-button for primary variant', () => {
    render(<Button variant="primary">Scan</Button>)
    expect(screen.getByRole('button', { name: 'Scan' })).toHaveClass('scan-button')
  })

  it('applies browse classes for secondary variant', () => {
    render(<Button variant="secondary">Browse</Button>)
    const btn = screen.getByRole('button', { name: 'Browse' })
    expect(btn).toHaveClass('scan-button')
    expect(btn).toHaveClass('browse-button')
  })

  it('applies toolbar-button for toolbar variant', () => {
    render(<Button variant="toolbar">Refresh</Button>)
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('toolbar-button')
  })

  it('applies modal danger classes', () => {
    render(<Button variant="danger">Delete</Button>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toHaveClass('modal-button')
    expect(btn).toHaveClass('danger')
  })

  it('forwards click and disabled', () => {
    const onClick = vi.fn()
    render(
      <Button variant="modal" onClick={onClick} disabled>
        Cancel
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Cancel' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})
