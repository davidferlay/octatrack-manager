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
  it('draws the shapes taken from the hardware', () => {
    // A triangle peaks in the middle, its inverse troughs there
    const tri = render(<WaveGlyph wave="TRI" />).container.querySelector('path')!
    const itri = render(<WaveGlyph wave="ITRI" />).container.querySelector('path')!
    expect(tri.getAttribute('d')).toContain('L8 1')
    expect(itri.getAttribute('d')).toContain('L8 11')
  })

  it('draws every basic waveform the device offers', () => {
    for (const w of ['TRI', 'ITRI', 'SAW', 'ISAW', 'SQR', 'ISQR', 'EXP', 'IEXP', 'RMP', 'IRMP', 'RND']) {
      const { container } = render(<WaveGlyph wave={w} />)
      expect(container.querySelector('path'), w).not.toBeNull()
    }
  })

  it('draws nothing for a designer slot, which has no fixed shape', () => {
    for (const w of ['T1', 'T8']) {
      expect(render(<WaveGlyph wave={w} />).container.firstChild).toBeNull()
    }
  })

  it('draws nothing for a name it does not know', () => {
    expect(render(<WaveGlyph wave="NOPE" />).container.firstChild).toBeNull()
  })
})
