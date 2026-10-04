import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RotaryKnob } from './RotaryKnob'

/** The filled arc, which is the part that shows the value. */
const valueArc = (c: HTMLElement) =>
  c.querySelector('path.knob-value')?.getAttribute('d') ?? ''
/** Where an arc path begins, as "x y". */
const startOf = (d: string) => d.replace(/^M\s*/, '').split(/\s+A\s+/)[0]

describe('RotaryKnob', () => {
  it('fills from the minimum when it has no centre', () => {
    const atMin = render(<RotaryKnob value={0} min={0} max={127} />).container
    const atMid = render(<RotaryKnob value={64} min={0} max={127} />).container
    // At the floor there is nothing to fill
    expect(valueArc(atMin)).toBe('')
    // Above it the arc starts where the track does
    expect(valueArc(atMid)).not.toBe('')
  })

  it('grows out of the centre when it has one', () => {
    const below = render(<RotaryKnob value={0} min={0} max={127} center={64} />).container
    const above = render(<RotaryKnob value={127} min={0} max={127} center={64} />).container
    // Both arcs leave from the same place - the centre - and travel opposite ways
    expect(startOf(valueArc(below))).toBe(startOf(valueArc(above)))
    expect(valueArc(below)).not.toBe(valueArc(above))
  })

  it('draws nothing at the centre, so no change reads as no fill', () => {
    const { container } = render(<RotaryKnob value={64} min={0} max={127} center={64} />)
    expect(valueArc(container)).toBe('')
  })

  it('sweeps one way below the centre and the other way above it', () => {
    const sweep = (d: string) => d.split(/\s+/).slice(-3)[0]
    const below = valueArc(render(<RotaryKnob value={10} min={0} max={127} center={64} />).container)
    const above = valueArc(render(<RotaryKnob value={120} min={0} max={127} center={64} />).container)
    expect(sweep(below)).not.toBe(sweep(above))
  })

  it('handles a range that does not start at zero', () => {
    const { container } = render(<RotaryKnob value={4} min={4} max={124} center={64} />)
    expect(valueArc(container)).not.toBe('')
  })
})
