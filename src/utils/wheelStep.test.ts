import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { installSelectWheelStepping, useWheelStep } from './wheelStep'

/**
 * The app-wide drop-down stepping. The direction is the one judgement call in here -
 * up is more, the way a wheel works over a volume or a zoom - so it is pinned.
 */
describe('stepping a drop-down with the wheel', () => {
  let uninstall: () => void
  let select: HTMLSelectElement

  const build = (values: string[], chosen = 0, attrs: Partial<HTMLSelectElement> = {}) => {
    select = document.createElement('select')
    for (const v of values) {
      const option = document.createElement('option')
      option.value = v
      option.textContent = v
      select.append(option)
    }
    Object.assign(select, attrs)
    select.selectedIndex = chosen
    document.body.append(select)
    return select
  }

  const wheel = (on: HTMLElement, deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
    on.dispatchEvent(event)
    return event
  }

  beforeEach(() => { uninstall = installSelectWheelStepping() })
  afterEach(() => { uninstall(); document.body.innerHTML = '' })

  it('goes to the next value on the way up', () => {
    build(['a', 'b', 'c'], 0)
    wheel(select, -120)
    expect(select.value).toBe('b')
  })

  it('goes back on the way down', () => {
    build(['a', 'b', 'c'], 2)
    wheel(select, 120)
    expect(select.value).toBe('b')
  })

  it('stops at each end rather than wrapping round', () => {
    build(['a', 'b', 'c'], 0)
    wheel(select, 120)
    expect(select.value).toBe('a')
    select.selectedIndex = 2
    wheel(select, -120)
    expect(select.value).toBe('c')
  })

  it('tells the page the value changed, so the app hears it as an ordinary pick', () => {
    build(['a', 'b'], 0)
    let heard: string | null = null
    select.addEventListener('change', e => { heard = (e.target as HTMLSelectElement).value })
    wheel(select, -120)
    expect(heard).toBe('b')
  })

  it('says nothing when the value did not move', () => {
    build(['a', 'b'], 1)
    let fired = 0
    select.addEventListener('change', () => { fired++ })
    wheel(select, -120)
    expect(fired).toBe(0)
  })

  it('keeps the page still while it is stepping a value', () => {
    build(['a', 'b'], 0)
    expect(wheel(select, -120).defaultPrevented).toBe(true)
  })

  /**
   * Once there is nothing left to step to, the wheel goes back to being the page's.
   * Holding it would strand the page whenever a drop-down sat at either end of its
   * list - and on a page made largely of them, that is most of the page.
   */
  it('hands the wheel back at the ends of the list', () => {
    build(['a', 'b'], 1)
    expect(wheel(select, -120).defaultPrevented).toBe(false)
    select.selectedIndex = 0
    expect(wheel(select, 120).defaultPrevented).toBe(false)
  })

  it('leaves the page alone everywhere else', () => {
    const plain = document.createElement('div')
    document.body.append(plain)
    expect(wheel(plain, -120).defaultPrevented).toBe(false)
  })

  it('works from inside the drop-down, where the pointer actually is', () => {
    build(['a', 'b', 'c'], 0)
    wheel(select.options[0], -120)
    expect(select.value).toBe('b')
  })

  it('leaves a disabled drop-down alone', () => {
    build(['a', 'b'], 0, { disabled: true })
    const event = wheel(select, -120)
    expect(select.value).toBe('a')
    expect(event.defaultPrevented).toBe(false)
  })

  /** A list box shows its options already and scrolls through them on its own. */
  it('leaves a list box to scroll itself', () => {
    build(['a', 'b', 'c'], 0, { size: 4 })
    const event = wheel(select, -120)
    expect(select.value).toBe('a')
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves a multiple-choice list alone', () => {
    build(['a', 'b'], 0, { multiple: true })
    wheel(select, -120)
    expect(select.value).toBe('a')
  })

  it('steps over an entry that cannot be chosen', () => {
    build(['a', 'b', 'c'], 0)
    select.options[1].disabled = true
    wheel(select, -120)
    expect(select.value).toBe('c')
  })

  it('does nothing for a list with only one entry', () => {
    build(['a'], 0)
    expect(wheel(select, -120).defaultPrevented).toBe(false)
  })

  it('ignores a wheel event that is not going anywhere', () => {
    build(['a', 'b'], 0)
    wheel(select, 0)
    expect(select.value).toBe('a')
  })

  it('stops stepping once it is taken off again', () => {
    build(['a', 'b'], 0)
    uninstall()
    wheel(select, -120)
    expect(select.value).toBe('a')
  })
})

/**
 * Stepping one parameter cell. What answers the wheel is the whole point: a page made
 * of parameters has to stay scrollable, so by default only the cell's own controls
 * take the wheel and everything else stays ordinary scrolling surface.
 */
describe('stepping a parameter with the wheel', () => {
  const cell = () => {
    const node = document.createElement('div')
    node.innerHTML = '<span class="param-label">ATK</span>'
      + '<div class="param-control"><span class="knob"></span></div>'
      + '<input class="param-value" />'
    document.body.append(node)
    return node
  }

  const wheel = (on: HTMLElement, deltaY: number, deltaX = 0) => {
    const event = new WheelEvent('wheel', { deltaY, deltaX, bubbles: true, cancelable: true })
    on.dispatchEvent(event)
    return event
  }

  const attach = (
    step: ((by: 1 | -1) => void) | null,
    within?: string | null,
  ) => {
    const node = cell()
    const { result } = renderHook(
      () => (within === undefined ? useWheelStep(step) : useWheelStep(step, within)),
    )
    const detach = result.current(node) as (() => void) | undefined
    return { node, detach }
  }

  afterEach(() => { document.body.innerHTML = '' })

  it('asks for the next value on the way up', () => {
    const step = vi.fn()
    const { node } = attach(step)
    wheel(node.querySelector('.param-control')!, -120)
    expect(step).toHaveBeenCalledWith(1)
  })

  it('asks for the previous value on the way down', () => {
    const step = vi.fn()
    const { node } = attach(step)
    wheel(node.querySelector('.param-control')!, 120)
    expect(step).toHaveBeenCalledWith(-1)
  })

  it('answers over the readout as well as the knob', () => {
    const step = vi.fn()
    const { node } = attach(step)
    wheel(node.querySelector('.param-value')!, -120)
    expect(step).toHaveBeenCalledWith(1)
  })

  it('answers from inside a control, where the pointer actually is', () => {
    const step = vi.fn()
    const { node } = attach(step)
    wheel(node.querySelector('.knob')!, -120)
    expect(step).toHaveBeenCalledWith(1)
  })

  it('leaves the name and the gaps as ordinary scrolling surface', () => {
    const step = vi.fn()
    const { node } = attach(step)
    const event = wheel(node.querySelector('.param-label')!, -120)
    expect(step).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps the page still while it is stepping a value', () => {
    const { node } = attach(vi.fn())
    expect(wheel(node.querySelector('.param-control')!, -120).defaultPrevented).toBe(true)
  })

  it('leaves a read-only field alone', () => {
    const { node } = attach(null)
    const event = wheel(node.querySelector('.param-control')!, -120)
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves a drop-down to the app-wide stepping, which knows its options', () => {
    const step = vi.fn()
    const { node } = attach(step)
    const control = node.querySelector('.param-control')!
    control.innerHTML = '<select><option>a</option><option>b</option></select>'
    wheel(control.querySelector('select')!, -120)
    expect(step).not.toHaveBeenCalled()
  })

  it('ignores a wheel event that is not going anywhere', () => {
    const step = vi.fn()
    const { node } = attach(step)
    wheel(node.querySelector('.param-control')!, 0)
    expect(step).not.toHaveBeenCalled()
  })

  it('reads a sideways wheel too, for a trackpad', () => {
    const step = vi.fn()
    const { node } = attach(step)
    wheel(node.querySelector('.param-control')!, 0, -120)
    expect(step).toHaveBeenCalledWith(1)
  })

  it('stops stepping once the element goes away', () => {
    const step = vi.fn()
    const { node, detach } = attach(step)
    detach?.()
    wheel(node.querySelector('.param-control')!, -120)
    expect(step).not.toHaveBeenCalled()
  })

  it('does nothing at all without an element', () => {
    const { result } = renderHook(() => useWheelStep(vi.fn()))
    expect(result.current(null)).toBeUndefined()
  })

  describe('a region that is one control', () => {
    it('answers anywhere inside, since there is nothing else there', () => {
      const step = vi.fn()
      const { node } = attach(step, null)
      wheel(node.querySelector('.param-label')!, -120)
      expect(step).toHaveBeenCalledWith(1)
    })

    it('answers over its own padding, not only over a child', () => {
      const step = vi.fn()
      const { node } = attach(step, null)
      wheel(node, -120)
      expect(step).toHaveBeenCalledWith(1)
    })

    it('still leaves a drop-down inside it alone', () => {
      const step = vi.fn()
      const { node } = attach(step, null)
      node.innerHTML = '<select><option>a</option></select>'
      wheel(node.querySelector('select')!, -120)
      expect(step).not.toHaveBeenCalled()
    })

    it('still keeps the page still', () => {
      const { node } = attach(vi.fn(), null)
      expect(wheel(node, -120).defaultPrevented).toBe(true)
    })
  })

  it('uses the newest step function without being rebound', () => {
    const first = vi.fn()
    const second = vi.fn()
    const node = cell()
    const { result, rerender } = renderHook(
      ({ step }: { step: (by: 1 | -1) => void }) => useWheelStep(step),
      { initialProps: { step: first } },
    )
    const bound = result.current
    bound(node)
    rerender({ step: second })
    expect(result.current).toBe(bound)
    wheel(node.querySelector('.param-control')!, -120)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(1)
  })
})
