import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { SplitPane } from './SplitPane'

function ControlledSplit() {
  const [size, setSize] = useState(40)
  return (
    <SplitPane
      data-testid="split"
      primarySize={size}
      onPrimarySizeChange={setSize}
      style={{ width: 200, height: 100 }}
    >
      <SplitPane.Primary data-testid="primary">Left</SplitPane.Primary>
      <SplitPane.Divider data-testid="divider" />
      <SplitPane.Secondary data-testid="secondary">Right</SplitPane.Secondary>
    </SplitPane>
  )
}

describe('SplitPane', () => {
  it('renders primary, divider, and secondary', () => {
    render(<ControlledSplit />)
    expect(screen.getByTestId('split')).toHaveClass('mo-split-pane')
    expect(screen.getByTestId('primary')).toHaveStyle({ width: '40%' })
    expect(screen.getByTestId('primary')).toHaveClass('mo-split-pane__primary')
    expect(screen.getByTestId('divider')).toHaveClass('panel-divider')
    expect(screen.getByTestId('secondary')).toHaveTextContent('Right')
    expect(screen.getByTestId('secondary')).toHaveClass('mo-split-pane__secondary')
  })

  it('hides primary and divider when primaryVisible is false', () => {
    render(
      <SplitPane primaryVisible={false} primarySize={50}>
        <SplitPane.Primary>Left</SplitPane.Primary>
        <SplitPane.Divider data-testid="divider" />
        <SplitPane.Secondary data-testid="secondary">Right</SplitPane.Secondary>
      </SplitPane>,
    )
    expect(screen.queryByText('Left')).not.toBeInTheDocument()
    expect(screen.queryByTestId('divider')).not.toBeInTheDocument()
    const secondary = screen.getByTestId('secondary')
    expect(secondary).toHaveTextContent('Right')
    // Secondary must remain the flex-growing pane when primary is hidden.
    expect(secondary).toHaveClass('mo-split-pane__secondary')
  })

  it('updates size while dragging the divider', () => {
    const onChange = vi.fn()
    render(
      <SplitPane
        data-testid="split"
        primarySize={50}
        onPrimarySizeChange={onChange}
        style={{ width: 200, height: 100 }}
      >
        <SplitPane.Primary>Left</SplitPane.Primary>
        <SplitPane.Divider data-testid="divider" />
        <SplitPane.Secondary>Right</SplitPane.Secondary>
      </SplitPane>,
    )

    const split = screen.getByTestId('split')
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

    fireEvent.mouseDown(screen.getByTestId('divider'))
    fireEvent.mouseMove(document, { clientX: 60 })
    fireEvent.mouseUp(document)

    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as number
    expect(last).toBeGreaterThanOrEqual(20)
    expect(last).toBeLessThanOrEqual(80)
    expect(last).toBeCloseTo(30, 0)
  })
})
