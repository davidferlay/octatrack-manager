import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PositionBar, WaveGlyph } from './ParamWidgets'

const marker = (c: HTMLElement) => c.querySelector('.param-position-marker') as HTMLElement

describe('PositionBar', () => {
  it('puts the marker at the left for the first choice', () => {
    const { container } = render(<PositionBar count={4} index={0} />)
    expect(marker(container).style.left).toBe('0%')
  })

  it('puts it at the right for the last, without overflowing the track', () => {
    const { container } = render(<PositionBar count={4} index={3} />)
    const m = marker(container)
    const left = parseFloat(m.style.left)
    const width = parseFloat(m.style.width)
    expect(left + width).toBeCloseTo(100, 5)
  })

  it('moves across in step with the index', () => {
    const at = (i: number) => {
      const { container } = render(<PositionBar count={5} index={i} />)
      return parseFloat(marker(container).style.left)
    }
    expect(at(0)).toBeLessThan(at(2))
    expect(at(2)).toBeLessThan(at(4))
  })

  it('keeps the marker visible even on a long list', () => {
    const { container } = render(<PositionBar count={30} index={10} />)
    expect(parseFloat(marker(container).style.width)).toBeGreaterThanOrEqual(8)
  })

  it('draws nothing when there is no choice to show', () => {
    const { container } = render(<PositionBar count={1} index={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('survives an index outside the list rather than drawing off the end', () => {
    const { container } = render(<PositionBar count={4} index={99} />)
    const left = parseFloat(marker(container).style.left)
    expect(left).toBeLessThanOrEqual(100)
    expect(left).toBeGreaterThanOrEqual(0)
  })
})

describe('WaveGlyph', () => {
  const pathOf = (wave: string) =>
    render(<WaveGlyph wave={wave} />).container.querySelector('path')!.getAttribute('d')!

  it('draws the shapes taken from the hardware', () => {
    // A triangle peaks in the middle, its inverse troughs there
    expect(pathOf('TRI')).toContain('L8 1')
    expect(pathOf('ITRI')).toContain('L8 11')
  })

  it('keeps SAW a plain line and RMP a ramp that resets', () => {
    // The device draws these differently, so they must not be the same glyph
    expect(pathOf('SAW')).toBe('M1 11 L15 1')
    expect(pathOf('RMP')).not.toBe(pathOf('SAW'))
    // The ramp returns to where it began, which the plain line never does
    expect(pathOf('RMP')).toContain('L9 11')
  })

  it('mirrors each waveform against its inverse', () => {
    for (const [up, down] of [['SAW', 'ISAW'], ['TRI', 'ITRI'], ['SQR', 'ISQR'],
      ['EXP', 'IEXP'], ['RMP', 'IRMP']]) {
      expect(pathOf(up), `${up} vs ${down}`).not.toBe(pathOf(down))
    }
  })

  it('draws every basic waveform the device offers', () => {
    for (const w of ['TRI', 'ITRI', 'SAW', 'ISAW', 'SQR', 'ISQR', 'EXP', 'IEXP', 'RMP', 'IRMP', 'RND']) {
      const { container } = render(<WaveGlyph wave={w} />)
      expect(container.querySelector('path'), w).not.toBeNull()
    }
  })

  it('stands in for a designer slot, which has no fixed shape of its own', () => {
    for (const w of ['T1', 'T4', 'T8']) {
      const { container } = render(<WaveGlyph wave={w} />)
      // Drawn, so the slot is not an empty space, but marked as a stand-in for the
      // shape on that track's DESIGN page rather than passed off as a fixed one
      expect(container.querySelector('path'), w).not.toBeNull()
      expect(container.querySelector('svg')?.getAttribute('class'), w)
        .toContain('designed')
    }
  })

  it('does not mark a fixed shape as a stand-in', () => {
    const { container } = render(<WaveGlyph wave="TRI" />)
    expect(container.querySelector('svg')?.getAttribute('class')).not.toContain('designed')
  })

  it('draws nothing for a name it does not know', () => {
    expect(render(<WaveGlyph wave="NOPE" />).container.firstChild).toBeNull()
  })
})
