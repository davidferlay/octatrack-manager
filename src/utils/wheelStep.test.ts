import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { installSelectWheelStepping, installRangeWheelStepping, useWheelStep } from './wheelStep'

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

  /**
   * Dragging up and down, which is how a knob is turned everywhere else. Up is more,
   * as the wheel is.
   */
  describe('dragging a value', () => {
    const press = (on: HTMLElement, y: number) => {
      const event = new MouseEvent('pointerdown', {
        clientY: y, button: 0, bubbles: true, cancelable: true,
      }) as PointerEvent
      Object.defineProperty(event, 'pointerId', { value: 1 })
      on.dispatchEvent(event)
      return event
    }
    const moveTo = (on: HTMLElement, y: number) => {
      const event = new MouseEvent('pointermove', {
        clientY: y, bubbles: true, cancelable: true,
      }) as PointerEvent
      Object.defineProperty(event, 'pointerId', { value: 1 })
      on.dispatchEvent(event)
      return event
    }
    const release = (on: HTMLElement, y: number) => {
      const event = new MouseEvent('pointerup', {
        clientY: y, bubbles: true, cancelable: true,
      }) as PointerEvent
      Object.defineProperty(event, 'pointerId', { value: 1 })
      on.dispatchEvent(event)
    }

    it('asks for the next value on the way up', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 96)
      expect(step).toHaveBeenCalledWith(1)
    })

    it('asks for the previous value on the way down', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 104)
      expect(step).toHaveBeenCalledWith(-1)
    })

    it('takes a step for every few pixels, not one per drag', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 88)
      expect(step).toHaveBeenCalledTimes(3)
    })

    it('carries on as the drag goes, without drifting', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 96)
      moveTo(control, 92)
      moveTo(control, 88)
      expect(step).toHaveBeenCalledTimes(3)
      expect(step).toHaveBeenNthCalledWith(3, 1)
    })

    it('answers a change of direction at once', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 92)
      step.mockClear()
      moveTo(control, 96)
      expect(step).toHaveBeenCalledWith(-1)
    })

    it('ignores a movement too small to be a step', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 98)
      expect(step).not.toHaveBeenCalled()
    })

    it('does nothing until the pointer goes down', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      moveTo(control, 50)
      expect(step).not.toHaveBeenCalled()
    })

    it('stops when the pointer comes up', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 96)
      release(control, 96)
      step.mockClear()
      moveTo(control, 50)
      expect(step).not.toHaveBeenCalled()
    })

    it('keeps the readout from being selected while it drags', () => {
      const { node } = attach(vi.fn())
      const value = node.querySelector('.param-value') as HTMLElement
      press(value, 100)
      expect(moveTo(value, 92).defaultPrevented).toBe(true)
    })

    it('leaves the name and the gaps alone', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const label = node.querySelector('.param-label') as HTMLElement
      press(label, 100)
      moveTo(label, 80)
      expect(step).not.toHaveBeenCalled()
    })

    it('leaves a read-only field alone', () => {
      const step = vi.fn()
      const { node } = attach(null)
      const control = node.querySelector('.param-control') as HTMLElement
      press(control, 100)
      moveTo(control, 80)
      expect(step).not.toHaveBeenCalled()
    })

    it('leaves a drop-down to its own stepping', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      control.innerHTML = '<select><option>a</option></select>'
      const select = control.querySelector('select') as HTMLElement
      press(select, 100)
      moveTo(select, 80)
      expect(step).not.toHaveBeenCalled()
    })

    it('ignores a button that is not the main one', () => {
      const step = vi.fn()
      const { node } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      const event = new MouseEvent('pointerdown', {
        clientY: 100, button: 2, bubbles: true, cancelable: true,
      }) as PointerEvent
      Object.defineProperty(event, 'pointerId', { value: 1 })
      control.dispatchEvent(event)
      moveTo(control, 80)
      expect(step).not.toHaveBeenCalled()
    })

    /**
     * A region that is one control - a row of cards - is a surface the pointer may be
     * dragged across, so a swipe there must not quietly move the selection.
     */
    it('is not offered where the whole element is the control', () => {
      const step = vi.fn()
      const { node } = attach(step, null)
      press(node, 100)
      moveTo(node, 80)
      expect(step).not.toHaveBeenCalled()
      // The wheel still works there
      wheel(node, -120)
      expect(step).toHaveBeenCalledWith(1)
    })

    it('stops dragging once the element goes away', () => {
      const step = vi.fn()
      const { node, detach } = attach(step)
      const control = node.querySelector('.param-control') as HTMLElement
      detach?.()
      press(control, 100)
      moveTo(control, 80)
      expect(step).not.toHaveBeenCalled()
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


/**
 * The app's sliders. They already drag - that is what a slider is - but they ignored
 * the wheel, so the two ways of changing a value disagreed depending on the control.
 */
describe('stepping a slider with the wheel', () => {
  let uninstall: () => void
  let slider: HTMLInputElement

  const build = (attrs: Partial<HTMLInputElement> = {}) => {
    slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '1'
    slider.max = '128'
    slider.value = '10'
    Object.assign(slider, attrs)
    document.body.append(slider)
    return slider
  }

  const wheel = (on: HTMLElement, deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
    on.dispatchEvent(event)
    return event
  }

  beforeEach(() => { uninstall = installRangeWheelStepping() })
  afterEach(() => { uninstall(); document.body.innerHTML = '' })

  it('goes up on the way up', () => {
    build()
    wheel(slider, -120)
    expect(slider.value).toBe('11')
  })

  it('goes down on the way down', () => {
    build()
    wheel(slider, 120)
    expect(slider.value).toBe('9')
  })

  it('moves by the slider own step', () => {
    build({ step: '5' })
    wheel(slider, -120)
    expect(slider.value).toBe('15')
  })

  it('stops at the top rather than running off', () => {
    build({ value: '128' })
    wheel(slider, -120)
    expect(slider.value).toBe('128')
  })

  it('stops at the bottom', () => {
    build({ value: '1' })
    wheel(slider, 120)
    expect(slider.value).toBe('1')
  })

  it('hands the wheel back at the ends, so the page is not stranded', () => {
    build({ value: '128' })
    expect(wheel(slider, -120).defaultPrevented).toBe(false)
  })

  it('keeps the page still while it is stepping', () => {
    build()
    expect(wheel(slider, -120).defaultPrevented).toBe(true)
  })

  /** React skips a change whose value matches what it last wrote, so the tracker has
   *  to be bypassed or the component never hears about it. */
  it('tells the page the value changed', () => {
    build()
    const heard: string[] = []
    slider.addEventListener('input', () => heard.push(slider.value))
    slider.addEventListener('change', () => heard.push(slider.value))
    wheel(slider, -120)
    expect(heard).toEqual(['11', '11'])
  })

  it('says nothing when the value did not move', () => {
    build({ value: '128' })
    const heard: string[] = []
    slider.addEventListener('input', () => heard.push(slider.value))
    wheel(slider, -120)
    expect(heard).toEqual([])
  })

  it('leaves a disabled slider alone', () => {
    build({ disabled: true })
    wheel(slider, -120)
    expect(slider.value).toBe('10')
  })

  it('leaves everything that is not a slider alone', () => {
    const text = document.createElement('input')
    text.type = 'text'
    text.value = '10'
    document.body.append(text)
    wheel(text, -120)
    expect(text.value).toBe('10')
  })

  it('ignores a wheel event that is not going anywhere', () => {
    build()
    wheel(slider, 0)
    expect(slider.value).toBe('10')
  })

  it('works from inside the slider, where the pointer actually is', () => {
    build()
    const wrap = document.createElement('div')
    document.body.append(wrap)
    wrap.append(slider)
    wheel(slider, -120)
    expect(slider.value).toBe('11')
  })

  it('stops stepping once it is taken off again', () => {
    build()
    uninstall()
    wheel(slider, -120)
    expect(slider.value).toBe('10')
  })

  /**
   * Two sliders sharing one track are stacked and let the pointer through to their
   * handles, so the wheel arrives at the container. What is under the pointer is what
   * it has to find - and of a stacked pair, the handle the hand is reaching for.
   */
  describe('a pair sharing one track', () => {
    let low: HTMLInputElement
    let high: HTMLInputElement
    let shell: HTMLDivElement

    const at = (el: HTMLElement, left: number, width: number) => {
      el.getBoundingClientRect = () => ({
        left, width, right: left + width, top: 0, bottom: 20, height: 20,
        x: left, y: 0, toJSON: () => ({}),
      }) as DOMRect
    }

    beforeEach(() => {
      shell = document.createElement('div')
      low = build({ value: '10' })
      high = build({ value: '120' })
      shell.append(low, high)
      document.body.append(shell)
      // The track runs 0 to 400, so the handles sit near 28 and 374
      for (const el of [shell, low, high]) at(el, 0, 400)
      // jsdom has no hit testing, so what the pointer is over is stated
      ;(document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] })
        .elementsFromPoint = () => [shell]
    })

    afterEach(() => {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
    })

    const wheelAt = (x: number, deltaY: number) => {
      const event = new WheelEvent('wheel', {
        deltaY, clientX: x, clientY: 10, bubbles: true, cancelable: true,
      })
      shell.dispatchEvent(event)
    }

    it('moves the near handle when the pointer is by it', () => {
      wheelAt(20, -120)
      expect(low.value).toBe('11')
      expect(high.value).toBe('120')
    })

    it('moves the far handle when the pointer is by that one', () => {
      wheelAt(380, -120)
      expect(high.value).toBe('121')
      expect(low.value).toBe('10')
    })

    it('still steps although the event landed on the container', () => {
      // Neither input is the target: the pointer goes through to the handles
      wheelAt(20, 120)
      expect(low.value).toBe('9')
    })
  })
})
