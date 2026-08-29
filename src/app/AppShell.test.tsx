import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders Sources and Main regions', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
      />,
    )
    expect(screen.getByLabelText('MasterOCTa workspace')).toHaveClass('mo-app-shell')
    expect(screen.getByText('Sources content')).toBeInTheDocument()
    expect(screen.getByText('Main content')).toBeInTheDocument()
    expect(screen.queryByText('Inspector content')).not.toBeInTheDocument()
  })

  it('renders Inspector when provided', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        inspector={<div>Inspector content</div>}
      />,
    )
    expect(screen.getByText('Inspector content')).toBeInTheDocument()
  })

  it('resizes Sources width in uncontrolled mode by default', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        defaultSourcesSize={30}
      />,
    )

    const sources = screen.getByTestId('app-shell-sources')
    expect(sources).toHaveStyle({ width: '30%' })

    const shell = screen.getByLabelText('MasterOCTa workspace')
    const split = shell.querySelector('.mo-split-pane') as HTMLElement
    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.mouseDown(screen.getByTestId('app-shell-divider'))
    fireEvent.mouseMove(document, { clientX: 50 })
    fireEvent.mouseUp(document)

    expect(sources).toHaveStyle({ width: '25%' })
  })
})
