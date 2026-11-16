import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LfoDesignWindow from './LfoDesignWindow'
import type { WriteHistory } from './WriteHistoryControls'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { toShareText, parseShareText, clearShape, invertShape, randomShape, setAllModes, toRaw, toSigned, type LfoShape } from '../utils/lfoDesign'

const T1 = [127, 0, 64, -64, 100, -100, 1, -1, 0, 5, -5, 7, -7, 9, -128, 0]
const shape: LfoShape = {
  values: T1.map(toRaw),
  interpolation: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
}

function setup(props: Partial<React.ComponentProps<typeof LfoDesignWindow>> = {}) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  const user = userEvent.setup()
  const utils = render(
    <LfoDesignWindow
      title="LFO design - Part 1: ONE, T3"
      fileName="lfo-design-part1-T3"
      shape={shape}
      editable
      onChange={onChange}
      onClose={onClose}
      {...props}
    />,
  )
  return { onChange, onClose, user, ...utils }
}

const input = (n: number) => screen.getByLabelText(`Step ${n} value`) as HTMLInputElement
const tag = (n: number) => screen.getByLabelText(`Step ${n} mode`)

describe('LfoDesignWindow', () => {
  it('renders the title, 16 signed values and the step modes', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'LFO design - Part 1: ONE, T3' })).toBeInTheDocument()
    expect(document.querySelector('svg.lfo-design-canvas')).not.toBeNull()
    expect(document.querySelectorAll('.lfo-design-cell')).toHaveLength(16)
    T1.forEach((v, i) => expect(input(i + 1).value).toBe(String(v)))
    expect(tag(1)).toHaveTextContent('smooth')
    expect(tag(2)).toHaveTextContent('step')
  })

  it('types a step value and saves it now', async () => {
    const { onChange, user } = setup()
    await user.clear(input(9))
    await user.type(input(9), '-39{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    const [next, save] = onChange.mock.calls[0]
    expect(next.values[8]).toBe(217)
    expect(save).toBe('now')
  })

  it('clamps a typed value to the range', async () => {
    const { onChange, user } = setup()
    await user.clear(input(9))
    await user.type(input(9), '200{Enter}')
    expect(onChange.mock.calls[0][0].values[8]).toBe(127)
  })

  it('ignores Escape and garbage', async () => {
    const { onChange, user } = setup()
    await user.clear(input(9))
    await user.type(input(9), 'abc{Enter}')
    expect(input(9).value).toBe('0')
    await user.clear(input(3))
    await user.type(input(3), '-5{Escape}')
    expect(input(3).value).toBe('64')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('flips a step mode', async () => {
    const { onChange, user } = setup()
    await user.click(tag(1))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [next, save] = onChange.mock.calls[0]
    expect(next.interpolation[0]).toBe(0)
    expect(save).toBe('now')
  })

  it('applies each tool', async () => {
    const random = () => 0
    const cases: [string, LfoShape][] = [
      ['All smooth', setAllModes(shape, 1)],
      ['All stepped', setAllModes(shape, 0)],
      ['Invert', invertShape(shape)],
      ['Clear', clearShape()],
      ['Random', randomShape(random)],
    ]
    for (const [name, expected] of cases) {
      const { onChange, user, unmount } = setup({ random })
      await user.click(screen.getByRole('button', { name }))
      expect(onChange).toHaveBeenCalledWith(expected, 'now')
      unmount()
    }
  })

  it('is read-only outside Edit mode', () => {
    setup({ editable: false })
    expect(input(1).readOnly).toBe(true)
    expect(tag(1)).toBeDisabled()
    for (const name of ['All smooth', 'All stepped', 'Invert', 'Random', 'Clear', 'Paste', 'Import']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('marks what differs from the saved copy', () => {
    const saved: LfoShape = { values: [...shape.values], interpolation: [...shape.interpolation] }
    saved.values[2] = 10
    saved.interpolation[5] = 1
    setup({ saved })
    expect(input(3)).toHaveClass('param-changed')
    expect(input(3)).toHaveAttribute('title', 'Saved: 10')
    expect(tag(6)).toHaveClass('param-changed')
    expect(tag(6)).toHaveAttribute('title', 'Saved: smooth')
    expect(document.querySelectorAll('.param-changed')).toHaveLength(2)
  })

  it('has no marks without a saved copy', () => {
    setup()
    expect(document.querySelectorAll('.param-changed')).toHaveLength(0)
  })

  it('shows Undo and Redo in Edit mode', async () => {
    const history: WriteHistory = {
      state: { can_undo: true, can_redo: false, undo_label: 'LFO', redo_label: null },
      busy: false, refresh: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    }
    const { user } = setup({ history })
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(history.undo).toHaveBeenCalledTimes(1)
  })

  it('selects a step from its number, in both modes, without changing it', () => {
    for (const editable of [true, false]) {
      const { onChange, unmount } = setup({ editable })
      const cell = (n: number) => screen.getByRole('button', { name: `Select step ${n}` }).closest('.lfo-design-cell')
      fireEvent.click(screen.getByRole('button', { name: 'Select step 7' }))
      expect(cell(7)).toHaveClass('selected')
      expect(cell(1)).not.toHaveClass('selected')
      expect(document.activeElement).toBe(document.querySelector('svg.lfo-design-canvas'))
      expect(onChange).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('selects the clicked column in View mode and draws nothing', () => {
    const { onChange } = setup({ editable: false })
    const el = document.querySelector('svg.lfo-design-canvas') as SVGSVGElement
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 160, height: 255, right: 160, bottom: 255, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    // x 125 is in the 13th of 16 columns of 10 px
    fireEvent.pointerDown(el, { clientX: 125, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(el, { pointerId: 1 })
    expect(screen.getByRole('button', { name: 'Select step 13' }).closest('.lfo-design-cell')).toHaveClass('selected')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('has no View / Edit badge', () => {
    setup()
    expect(document.querySelector('.lfo-design-badge')).toBeNull()
  })

  it('groups the toolbar as the spec lays it out', () => {
    const history: WriteHistory = {
      state: { can_undo: true, can_redo: true, undo_label: 'a', redo_label: 'b' },
      busy: false, refresh: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    }
    setup({ history })
    const groups = [...document.querySelectorAll('.lfo-design-toolbar > .lfo-design-group')]
      .map(g => [...g.querySelectorAll('button')].map(b => b.getAttribute('aria-label') ?? b.textContent))
    expect(groups).toEqual([
      ['All smooth', 'All stepped'], ['Invert', 'Random', 'Clear'], ['Copy', 'Paste'],
      ['Export', 'Import'], ['Undo', 'Redo'],
    ])
  })

  it('skips a tool that changes nothing', async () => {
    const { onChange, user } = setup({ shape: setAllModes(shape, 1) })
    await user.click(screen.getByRole('button', { name: 'All smooth' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'All stepped' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape after a typed value is committed', async () => {
    const { onChange, onClose, user } = setup()
    await user.clear(input(3))
    await user.type(input(3), '5{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.querySelector('svg.lfo-design-canvas'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reverts on Escape in a field without committing, and a second Escape closes', async () => {
    const { onChange, onClose, user } = setup()
    await user.clear(input(3))
    await user.type(input(3), '-5')
    await user.keyboard('{Escape}')
    expect(input(3).value).toBe('64')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stays open when a press inside ends on the backdrop', () => {
    const { onClose } = setup()
    const overlay = document.querySelector('.modal-overlay')!
    fireEvent.pointerDown(input(9))
    fireEvent.mouseDown(input(9))
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })

  describe('focus', () => {
    // Stand-ins for the editor behind the backdrop, one before the window and one after
    function outsideButtons() {
      const before = document.createElement('button')
      const after = document.createElement('button')
      before.textContent = 'behind 1'
      after.textContent = 'behind 2'
      document.body.prepend(before)
      document.body.append(after)
      return { before, after, remove: () => { before.remove(); after.remove() } }
    }
    const inDialog = () => screen.getByRole('dialog').contains(document.activeElement)

    it('starts on the drawing', () => {
      setup()
      expect(document.activeElement).toBe(document.querySelector('svg.lfo-design-canvas'))
    })

    it('wraps Tab and Shift+Tab inside the window', async () => {
      const { user } = setup()
      const outside = outsideButtons()
      const close = screen.getByRole('button', { name: 'Close' })
      act(() => tag(16).focus())
      await user.tab()
      expect(document.activeElement).toBe(close)
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(tag(16))
      outside.remove()
    })

    it('ends on the last value field in View mode, where the tags are off', async () => {
      const { user } = setup({ editable: false })
      const outside = outsideButtons()
      act(() => screen.getByRole('button', { name: 'Close' }).focus())
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(input(16))
      await user.tab()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
      outside.remove()
    })

    it('brings a Tab from behind the backdrop back in', async () => {
      const { user } = setup()
      const outside = outsideButtons()
      act(() => outside.before.focus())
      await user.tab()
      expect(inDialog()).toBe(true)
      act(() => outside.after.focus())
      await user.tab({ shift: true })
      expect(inDialog()).toBe(true)
      outside.remove()
    })

    it('never leaves the window over a full round of Tab', async () => {
      const { user } = setup()
      const outside = outsideButtons()
      for (let i = 0; i < 50; i++) {
        await user.tab()
        expect(inDialog()).toBe(true)
      }
      outside.remove()
    })
  })

  it('closes on Escape, the close button and a click outside', async () => {
    const { onClose, user } = setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    await user.click(document.querySelector('.modal-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(3)
    // a click inside does not close
    await user.click(within(screen.getByRole('dialog')).getByText('Invert'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  describe('canvas', () => {
    const canvas = () => document.querySelector('svg.lfo-design-canvas') as SVGSVGElement
    const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1]
    const nowCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(c => c[1] === 'now')

    function setupCanvas(props: Partial<React.ComponentProps<typeof LfoDesignWindow>> = {}) {
      const utils = setup(props)
      const el = canvas()
      el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 160, height: 255, right: 160, bottom: 255, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
      ;(el as unknown as { setPointerCapture: () => void }).setPointerCapture = vi.fn()
      return { ...utils, el }
    }
    const ptr = { pointerId: 1 }

    it('draws while dragging and saves once on release', () => {
      const { onChange, el } = setupCanvas()
      // step 1 holds 127: start at the bottom so the press itself changes it
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 255 })
      expect(lastCall(onChange)[0].values[0]).toBe(128)
      expect(lastCall(onChange)[1]).toBe('none')
      fireEvent.pointerMove(el, { ...ptr, clientX: 5, clientY: 127 })
      expect(lastCall(onChange)[0].values[0]).toBe(0)
      expect(lastCall(onChange)[1]).toBe('none')
      fireEvent.pointerUp(el, ptr)
      expect(nowCalls(onChange)).toHaveLength(1)
      expect(nowCalls(onChange)[0][0].values[0]).toBe(0)
    })

    it('draws with the main button only', () => {
      const { onChange, el } = setupCanvas()
      fireEvent.pointerDown(el, { ...ptr, button: 2, clientX: 5, clientY: 255 })
      fireEvent.pointerMove(el, { ...ptr, button: 2, clientX: 25, clientY: 255 })
      fireEvent.pointerUp(el, { ...ptr, button: 2 })
      fireEvent.pointerDown(el, { ...ptr, button: 1, clientX: 5, clientY: 255 })
      fireEvent.pointerUp(el, { ...ptr, button: 1 })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('skips a press that changes nothing', () => {
      const { onChange, el } = setupCanvas()
      // step 1 already holds 127
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 0 })
      fireEvent.pointerMove(el, { ...ptr, clientX: 6, clientY: 0 })
      fireEvent.pointerUp(el, ptr)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('skips a nudge past the end of the range', () => {
      const { onChange, el } = setupCanvas()
      // step 1 holds 127
      fireEvent.keyDown(el, { key: 'ArrowUp' })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('saves a stroke cut short by closing the window', () => {
      const { onChange, el, unmount } = setupCanvas()
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 255 })
      fireEvent.pointerMove(el, { ...ptr, clientX: 15, clientY: 255 })
      expect(nowCalls(onChange)).toHaveLength(0)
      unmount()
      expect(nowCalls(onChange)).toHaveLength(1)
      const values = nowCalls(onChange)[0][0].values
      expect([values[0], values[1]]).toEqual([128, 128])
    })

    it('highlights the selected step in the strip too', () => {
      const { el } = setupCanvas()
      const selectedCells = () => [...document.querySelectorAll('.lfo-design-cell')]
        .flatMap((c, i) => (c.classList.contains('selected') ? [i] : []))
      expect(selectedCells()).toEqual([0])
      fireEvent.keyDown(el, { key: 'ArrowRight' })
      expect(selectedCells()).toEqual([1])
      fireEvent.keyDown(el, { key: 'ArrowRight' })
      expect(selectedCells()).toEqual([2])
    })

    it('selects a step when its value field gets the focus', () => {
      const { onChange, el } = setupCanvas()
      act(() => input(6).focus())
      expect(document.querySelectorAll('.lfo-design-cell')[5]).toHaveClass('selected')
      expect(document.querySelector('rect.lfo-design-selected')).toHaveAttribute('x', String((5 * 640) / 16))
      act(() => el.focus())
      fireEvent.keyDown(el, { key: 'ArrowUp' })
      expect(toSigned(lastCall(onChange)[0].values[5])).toBe(-100 + 1)
    })

    it('keeps drawing past the edges', () => {
      const { onChange, el } = setupCanvas()
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 0 })
      fireEvent.pointerMove(el, { ...ptr, clientX: 400, clientY: 900 })
      const last = lastCall(onChange)[0]
      expect(last.values[15]).toBe(128)
      for (let i = 0; i < 16; i++) {
        expect(toSigned(last.values[i])).toBe(Math.round(127 + (-128 - 127) * i / 15))
      }
    })

    it('ends the stroke when the capture is lost', () => {
      const { onChange, el } = setupCanvas()
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 255 })
      fireEvent.lostPointerCapture(el, ptr)
      expect(nowCalls(onChange)).toHaveLength(1)
      fireEvent.pointerUp(el, ptr)
      expect(nowCalls(onChange)).toHaveLength(1)
    })

    it('draws finely with Shift', () => {
      const { onChange, el } = setupCanvas()
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 127 })
      expect(toSigned(lastCall(onChange)[0].values[0])).toBe(0)
      fireEvent.pointerMove(el, { ...ptr, clientX: 5, clientY: 87, shiftKey: true })
      expect(toSigned(lastCall(onChange)[0].values[0])).toBe(10)
    })

    it('does not draw outside Edit mode', () => {
      const { onChange, el } = setupCanvas({ editable: false })
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 0 })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('ignores pointer events on an unmeasured canvas', () => {
      const { onChange, el } = setupCanvas()
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect
      fireEvent.pointerDown(el, { ...ptr, clientX: 5, clientY: 0 })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('moves and nudges the selected step with the keys', () => {
      const { onChange, el, rerender } = setupCanvas()
      el.focus()
      fireEvent.keyDown(el, { key: 'ArrowRight' })
      fireEvent.keyDown(el, { key: 'ArrowRight' })
      fireEvent.keyDown(el, { key: 'ArrowUp' })
      let [next, save] = lastCall(onChange)
      expect(toSigned(next.values[2])).toBe(toSigned(shape.values[2]) + 1)
      expect(save).toBe('settle')
      const props = {
        title: 'LFO design - Part 1: ONE, T3', fileName: 'f', editable: true, onChange, onClose: vi.fn(),
      }
      rerender(<LfoDesignWindow {...props} shape={next} />)
      fireEvent.keyDown(canvas(), { key: 'ArrowDown', shiftKey: true })
      ;[next, save] = lastCall(onChange)
      expect(toSigned(next.values[2])).toBe(toSigned(shape.values[2]) + 1 - 8)
      expect(save).toBe('settle')
      // step 1 holds 127: Up leaves it
      fireEvent.keyDown(canvas(), { key: 'ArrowLeft' })
      fireEvent.keyDown(canvas(), { key: 'ArrowLeft' })
      fireEvent.keyDown(canvas(), { key: 'ArrowUp' })
      expect(toSigned(lastCall(onChange)[0].values[0])).toBe(127)
    })

    it('keeps the keys to itself', () => {
      const { el } = setupCanvas()
      const seen = vi.fn()
      document.addEventListener('keydown', seen)
      fireEvent.keyDown(el, { key: 'ArrowRight' })
      document.removeEventListener('keydown', seen)
      expect(seen).not.toHaveBeenCalled()
    })
  })
})

describe('LfoDesignWindow copy, paste, export, import', () => {
  const other: LfoShape = { values: Array(16).fill(5), interpolation: Array(16).fill(1) }
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const stubClipboard = (c: Partial<Clipboard> | undefined) =>
    Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true })
  const flush = () => act(async () => { await Promise.resolve() })
  // The floating badge, as copying a project shows; amber (warning) for a refusal or a failure
  const expectBadge = (text: string, error = false) => {
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent(text)
    expect(badge.classList.contains('warning')).toBe(error)
  }

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(open).mockReset()
    vi.mocked(save).mockReset()
  })

  it('copies the shape as share text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setup()
    stubClipboard({ writeText })
    click('Copy')
    await flush()
    expect(writeText).toHaveBeenCalledWith(toShareText(shape))
    expectBadge('LFO design copied')
  })

  it('pastes from the clipboard', async () => {
    const { onChange } = setup()
    stubClipboard({ readText: vi.fn().mockResolvedValue(toShareText(other)) })
    click('Paste')
    await flush()
    expect(onChange).toHaveBeenCalledWith(parseShareText(toShareText(other)), 'now')
    expectBadge('LFO design pasted')
  })

  // Copied on one track's window, pasted on another's: pasting a shape onto itself writes nothing
  it('pastes from the app when the clipboard cannot be read', async () => {
    const first = setup({ shape: other })
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('no')), readText: vi.fn().mockRejectedValue(new Error('no')) })
    click('Copy')
    await flush()
    expectBadge('LFO design copied')
    first.unmount()
    const { onChange } = setup()
    click('Paste')
    await flush()
    expect(onChange).toHaveBeenCalledWith(other, 'now')
  })

  it('pastes from the app when the clipboard is missing or empty', async () => {
    const first = setup({ shape: other })
    stubClipboard(undefined)
    click('Copy')
    await flush()
    first.unmount()
    const { onChange } = setup()
    stubClipboard({ readText: vi.fn().mockResolvedValue('') })
    click('Paste')
    await flush()
    expect(onChange).toHaveBeenCalledWith(other, 'now')
  })

  it('refuses a malformed paste', async () => {
    const { onChange } = setup()
    stubClipboard({ readText: vi.fn().mockResolvedValue('hello') })
    click('Paste')
    await flush()
    expectBadge('Not an LFO design', true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('exports to the chosen file', async () => {
    setup()
    vi.mocked(save).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockResolvedValue(undefined)
    click('Export')
    await flush()
    expect(save).toHaveBeenCalledWith({
      defaultPath: 'lfo-design-part1-T3.json',
      filters: [{ name: 'LFO design', extensions: ['json'] }],
    })
    expect(invoke).toHaveBeenCalledWith('write_text_file', { path: '/x/a.json', contents: toShareText(shape) })
    expectBadge('LFO design exported')
  })

  it('does nothing when the export is cancelled', async () => {
    setup()
    vi.mocked(save).mockResolvedValue(null)
    click('Export')
    await flush()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports a failed export without the OS text', async () => {
    setup()
    vi.mocked(save).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockRejectedValue('Permission denied (os error 13)')
    click('Export')
    await flush()
    expectBadge('Export failed', true)
  })

  it('imports a file', async () => {
    const { onChange } = setup()
    vi.mocked(open).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockResolvedValue(toShareText(other))
    click('Import')
    await flush()
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: 'LFO design', extensions: ['json'] }],
    })
    expect(invoke).toHaveBeenCalledWith('read_text_file', { path: '/x/a.json' })
    expect(onChange).toHaveBeenCalledWith(other, 'now')
    expectBadge('LFO design imported')
  })

  it('refuses a file that is not an LFO design', async () => {
    const { onChange } = setup()
    vi.mocked(open).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockResolvedValue('{"type":"x"}')
    click('Import')
    await flush()
    expectBadge('Not an LFO design', true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('maps read errors to Import failed, keeping File too large', async () => {
    const { onChange } = setup()
    vi.mocked(open).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockRejectedValueOnce('No such file (os error 2)')
    click('Import')
    await flush()
    expectBadge('Import failed', true)
    vi.mocked(invoke).mockRejectedValueOnce('File too large')
    click('Import')
    await flush()
    expectBadge('File too large', true)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('LfoDesignWindow values by wheel and drag, and Edit mode changes', () => {
  it('steps a value with the wheel in Edit mode only', () => {
    const { onChange, unmount } = setup()
    fireEvent.wheel(input(3), { deltaY: -100 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(toSigned(onChange.mock.calls[0][0].values[2])).toBe(65)
    expect(onChange.mock.calls[0][1]).toBe('settle')
    unmount()
    const view = setup({ editable: false })
    fireEvent.wheel(input(3), { deltaY: -100 })
    expect(view.onChange).not.toHaveBeenCalled()
  })

  it('steps a value by dragging up, each step building on the last', () => {
    const { onChange } = setup()
    fireEvent.pointerDown(input(3), { button: 0, clientY: 100, pointerId: 1 })
    // 8 px is two steps, taken before the panel can render the first back
    fireEvent.pointerMove(window, { clientY: 92, pointerId: 1 })
    fireEvent.pointerUp(window, { clientY: 92, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(toSigned(onChange.mock.calls[1][0].values[2])).toBe(66)
    expect(onChange.mock.calls[1][1]).toBe('settle')
  })

  it('saves a stroke once when Edit mode is left mid-drag, and draws no more', () => {
    const onChange = vi.fn()
    const props = {
      title: 'LFO design - Part 1: ONE, T3', fileName: 'f', shape, onChange, onClose: vi.fn(),
    }
    const { rerender } = render(<LfoDesignWindow {...props} editable />)
    const el = document.querySelector('svg.lfo-design-canvas') as SVGSVGElement
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 160, height: 255, right: 160, bottom: 255, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(el as unknown as { setPointerCapture: () => void }).setPointerCapture = vi.fn()
    fireEvent.pointerDown(el, { clientX: 5, clientY: 255, pointerId: 1 })
    rerender(<LfoDesignWindow {...props} editable={false} />)
    const now = onChange.mock.calls.filter(c => c[1] === 'now')
    expect(now).toHaveLength(1)
    expect(toSigned(now[0][0].values[0])).toBe(-128)
    const calls = onChange.mock.calls.length
    fireEvent.pointerMove(el, { clientX: 20, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(el, { pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(calls)
  })

  it('draws the wave in the preview colours, even when it is flat', () => {
    setup({ shape: clearShape() })
    const gradient = document.querySelector('#lfoDesignGradient')
    expect(gradient?.getAttribute('gradientUnits')).toBe('userSpaceOnUse')
    expect(Array.from(gradient!.querySelectorAll('stop')).map(s => s.getAttribute('stop-color')))
      .toEqual(['#4ac8ff', '#7b68ee', '#ff6b9d'])
  })

  it('marks the drawing and the values editable in Edit mode only', () => {
    const { unmount } = setup()
    expect(document.querySelector('svg.lfo-design-canvas')).toHaveClass('editable')
    expect(input(1)).toHaveClass('editable')
    unmount()
    setup({ editable: false })
    expect(document.querySelector('svg.lfo-design-canvas')).not.toHaveClass('editable')
    expect(input(1)).not.toHaveClass('editable')
  })
})

describe('LfoDesignWindow more cases', () => {
  const canvasEl = () => document.querySelector('svg.lfo-design-canvas') as SVGSVGElement
  const selectedStep = () =>
    Array.from(document.querySelectorAll('.lfo-design-cell')).findIndex(c => c.classList.contains('selected')) + 1

  it('keeps the selection between step 1 and step 16', () => {
    setup()
    fireEvent.keyDown(canvasEl(), { key: 'ArrowLeft' })
    expect(selectedStep()).toBe(1)
    for (let i = 0; i < 20; i++) fireEvent.keyDown(canvasEl(), { key: 'ArrowRight' })
    expect(selectedStep()).toBe(16)
  })

  it('moves the selection in View mode, and Up / Down change nothing there', () => {
    const { onChange } = setup({ editable: false })
    fireEvent.keyDown(canvasEl(), { key: 'ArrowRight' })
    fireEvent.keyDown(canvasEl(), { key: 'ArrowUp' })
    fireEvent.keyDown(canvasEl(), { key: 'ArrowDown', shiftKey: true })
    expect(selectedStep()).toBe(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the selected step number as pressed', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Select step 4' }))
    expect(screen.getByRole('button', { name: 'Select step 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Select step 1' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies a typed value when the field loses the focus', async () => {
    const { onChange, user } = setup()
    await user.clear(input(5))
    await user.type(input(5), '-77')
    fireEvent.blur(input(5))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(toSigned(onChange.mock.calls[0][0].values[4])).toBe(-77)
    expect(onChange.mock.calls[0][1]).toBe('now')
  })

  it('does not write a typed value equal to the current one', async () => {
    const { onChange, user } = setup()
    await user.clear(input(3))
    await user.type(input(3), '64{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a new shape in an idle field, as after an Undo', () => {
    const props = {
      title: 'LFO design - Part 1: ONE - T3', fileName: 'f', editable: true, onChange: vi.fn(), onClose: vi.fn(),
    }
    const { rerender } = render(<LfoDesignWindow {...props} shape={shape} />)
    expect(input(1).value).toBe('127')
    const next = { ...shape, values: [toRaw(-5), ...shape.values.slice(1)] }
    rerender(<LfoDesignWindow {...props} shape={next} />)
    expect(input(1).value).toBe('-5')
  })

  it('runs Redo from its own button', async () => {
    const history: WriteHistory = {
      state: { can_undo: false, can_redo: true, undo_label: null, redo_label: 'LFO' },
      busy: false, refresh: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    }
    const { user } = setup({ history })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(history.redo).toHaveBeenCalledTimes(1)
  })

  it('hides Undo and Redo in View mode', () => {
    const history: WriteHistory = {
      state: { can_undo: true, can_redo: true, undo_label: 'a', redo_label: 'b' },
      busy: false, refresh: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    }
    setup({ history, editable: false })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull()
  })

  it('tells the tools that read from the ones that write, for their hover colour', () => {
    setup()
    for (const name of ['Copy', 'Export']) {
      expect(screen.getByRole('button', { name })).toHaveClass('reads')
    }
    for (const name of ['All smooth', 'All stepped', 'Invert', 'Random', 'Clear', 'Paste', 'Import']) {
      expect(screen.getByRole('button', { name })).toHaveClass('writes')
    }
  })

  it('gives All smooth and All stepped the colour of the tag each sets', () => {
    setup()
    expect(screen.getByRole('button', { name: 'All smooth' })).toHaveClass('smooth')
    expect(screen.getByRole('button', { name: 'All stepped' })).toHaveClass('step')
    expect(screen.getByRole('button', { name: 'Invert' })).not.toHaveClass('smooth')
  })

  it('colours each tag by its mode', () => {
    setup()
    expect(tag(1)).toHaveClass('smooth')
    expect(tag(2)).toHaveClass('step')
  })

  it('steps a value down with the wheel and stops at -128', () => {
    const { onChange } = setup({ shape: { ...shape, values: [toRaw(-128), ...shape.values.slice(1)] } })
    fireEvent.wheel(input(2), { deltaY: 100 })
    expect(toSigned(onChange.mock.calls[0][0].values[1])).toBe(-1)
    onChange.mockClear()
    fireEvent.wheel(input(1), { deltaY: 100 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('steps a value down by dragging down', () => {
    const { onChange } = setup()
    fireEvent.pointerDown(input(3), { button: 0, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 112, pointerId: 1 })
    fireEvent.pointerUp(window, { clientY: 112, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(toSigned(onChange.mock.calls[2][0].values[2])).toBe(61)
  })

  it('clears the badge once its fade is over', () => {
    vi.useFakeTimers()
    try {
      setup()
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      act(() => { vi.advanceTimersByTime(0) })
      expect(screen.getByRole('status')).toHaveTextContent('LFO design copied')
      act(() => { vi.advanceTimersByTime(1600) })
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
