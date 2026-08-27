import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toolbar } from './Toolbar'

describe('Toolbar', () => {
  it('renders role=toolbar with mo-toolbar class', () => {
    render(
      <Toolbar aria-label="Actions">
        <button type="button">One</button>
      </Toolbar>,
    )
    const bar = screen.getByRole('toolbar', { name: 'Actions' })
    expect(bar).toHaveClass('mo-toolbar')
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument()
  })

  it('renders separator with toolbar-separator class', () => {
    render(
      <Toolbar>
        <button type="button">A</button>
        <Toolbar.Separator />
        <button type="button">B</button>
      </Toolbar>,
    )
    expect(screen.getByRole('separator')).toHaveClass('toolbar-separator')
  })
})
