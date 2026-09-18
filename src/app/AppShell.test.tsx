import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { tJa } from '../i18n/testStrings'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders Sources and Main regions', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
      />,
    )
    expect(screen.getByLabelText(tJa("app.workspaceAria"))).toHaveClass('mo-app-shell')
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

  it('renders an optional context bar above the workspace regions', () => {
    render(
      <AppShell
        contextBar={<div>Context summary</div>}
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
      />,
    )

    expect(screen.getByTestId('app-shell-context')).toHaveTextContent('Context summary')
  })

  it('renders an optional status bar above the change drawer', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        statusBar={<div>Connection OK</div>}
        changeDrawer={<div>Review additive copy</div>}
      />,
    )

    expect(screen.getByTestId('app-shell-status')).toHaveTextContent('Connection OK')
  })

  it('renders the Change Drawer below the workspace regions', () => {
    render(
      <AppShell
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        changeDrawer={<div>Review additive copy</div>}
      />,
    )

    expect(screen.getByText('Review additive copy')).toBeInTheDocument()
  })

  it('hides inspector pane in narrow list view without unmounting', () => {
    render(
      <AppShell
        narrowLayout
        centerView="list"
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        inspector={<div>Inspector content</div>}
      />,
    )
    expect(screen.getByText('Main content')).toBeVisible()
    expect(screen.getByText('Inspector content')).not.toBeVisible()
    const inspectorPane = screen.getByText('Inspector content').closest('.mo-app-shell__inspector')
    expect(inspectorPane).toHaveClass('mo-app-shell__pane--stack-hidden')
    expect(inspectorPane).toHaveAttribute('inert')
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

    const shell = screen.getByLabelText(tJa("app.workspaceAria"))
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

  it('adds an explicit inner-split class while slice workspace is expanded', () => {
    const { rerender } = render(
      <AppShell
        className="mo-app-shell--workspace"
        sliceWorkspaceExpanded
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        inspector={<div>Inspector content</div>}
      />,
    )
    expect(document.querySelector('.mo-app-shell__inner-split--slice-expanded')).not.toBeNull()

    rerender(
      <AppShell
        className="mo-app-shell--workspace"
        sliceWorkspaceExpanded={false}
        sources={<div>Sources content</div>}
        main={<div>Main content</div>}
        inspector={<div>Inspector content</div>}
      />,
    )
    expect(document.querySelector('.mo-app-shell__inner-split--slice-expanded')).toBeNull()
  })
})
