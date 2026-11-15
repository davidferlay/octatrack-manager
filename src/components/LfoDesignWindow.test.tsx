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

  it('shows Edit or View beside the title', () => {
    const { unmount } = setup()
    const badge = () => document.querySelector('.lfo-design-modal .modal-header .lfo-design-badge')
    expect(badge()).toHaveTextContent(/^Edit$/)
    unmount()
    setup({ editable: false })
    expect(badge()).toHaveTextContent(/^View$/)
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

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(open).mockReset()
    vi.mocked(save).mockReset()
  })

  it('copies the shape as share text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const onStatus = vi.fn()
    setup({ onStatus })
    stubClipboard({ writeText })
    click('Copy')
    await flush()
    expect(writeText).toHaveBeenCalledWith(toShareText(shape))
    expect(onStatus).toHaveBeenCalledWith('LFO design copied', 'success')
  })

  it('pastes from the clipboard', async () => {
    const onStatus = vi.fn()
    const { onChange } = setup({ onStatus })
    stubClipboard({ readText: vi.fn().mockResolvedValue(toShareText(other)) })
    click('Paste')
    await flush()
    expect(onChange).toHaveBeenCalledWith(parseShareText(toShareText(other)), 'now')
    expect(onStatus).toHaveBeenCalledWith('LFO design pasted', 'success')
  })

  // Copied on one track's window, pasted on another's: pasting a shape onto itself writes nothing
  it('pastes from the app when the clipboard cannot be read', async () => {
    const onStatus = vi.fn()
    const first = setup({ shape: other, onStatus })
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('no')), readText: vi.fn().mockRejectedValue(new Error('no')) })
    click('Copy')
    await flush()
    expect(onStatus).toHaveBeenCalledWith('LFO design copied', 'success')
    first.unmount()
    const { onChange } = setup({ onStatus })
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
    const onStatus = vi.fn()
    const { onChange } = setup({ onStatus })
    stubClipboard({ readText: vi.fn().mockResolvedValue('hello') })
    click('Paste')
    await flush()
    expect(onStatus).toHaveBeenCalledWith('Not an LFO design', 'error')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('exports to the chosen file', async () => {
    const onStatus = vi.fn()
    setup({ onStatus })
    vi.mocked(save).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockResolvedValue(undefined)
    click('Export')
    await flush()
    expect(save).toHaveBeenCalledWith({
      defaultPath: 'lfo-design-part1-T3.json',
      filters: [{ name: 'LFO design', extensions: ['json'] }],
    })
    expect(invoke).toHaveBeenCalledWith('write_text_file', { path: '/x/a.json', contents: toShareText(shape) })
    expect(onStatus).toHaveBeenCalledWith('LFO design exported', 'success')
  })

  it('does nothing when the export is cancelled', async () => {
    setup()
    vi.mocked(save).mockResolvedValue(null)
    click('Export')
    await flush()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports a failed export without the OS text', async () => {
    const onStatus = vi.fn()
    setup({ onStatus })
    vi.mocked(save).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockRejectedValue('Permission denied (os error 13)')
    click('Export')
    await flush()
    expect(onStatus).toHaveBeenCalledWith('Export failed', 'error')
  })

  it('imports a file', async () => {
    const onStatus = vi.fn()
    const { onChange } = setup({ onStatus })
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
    expect(onStatus).toHaveBeenCalledWith('LFO design imported', 'success')
  })

  it('refuses a file that is not an LFO design', async () => {
    const onStatus = vi.fn()
    const { onChange } = setup({ onStatus })
    vi.mocked(open).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockResolvedValue('{"type":"x"}')
    click('Import')
    await flush()
    expect(onStatus).toHaveBeenCalledWith('Not an LFO design', 'error')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('maps read errors to Import failed, keeping File too large', async () => {
    const onStatus = vi.fn()
    const { onChange } = setup({ onStatus })
    vi.mocked(open).mockResolvedValue('/x/a.json')
    vi.mocked(invoke).mockRejectedValueOnce('No such file (os error 2)')
    click('Import')
    await flush()
    expect(onStatus).toHaveBeenLastCalledWith('Import failed', 'error')
    vi.mocked(invoke).mockRejectedValueOnce('File too large')
    click('Import')
    await flush()
    expect(onStatus).toHaveBeenLastCalledWith('File too large', 'error')
    expect(onChange).not.toHaveBeenCalled()
  })
})
