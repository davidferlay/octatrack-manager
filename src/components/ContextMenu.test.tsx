import { describe, it, expect, vi } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu, MenuItem } from './ContextMenu'
import { FieldMenu, usePartCommits, type PartCommitState } from './PartSaveControls'
import { copiesWith } from '../utils/partDiff.fixtures'
import type { PartCopies } from '../utils/partDiff'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('ContextMenu', () => {
  /** jsdom lays nothing out: give the menu a size, and the document a window. */
  function sized(width: number, height: number, win = { w: 1024, h: 768 }) {
    const w = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width)
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(height)
    const cw = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(win.w)
    const ch = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(win.h)
    return () => [w, h, cw, ch].forEach(s => s.mockRestore())
  }

  it('stays inside the window when opened near its right and bottom edges', () => {
    const restore = sized(200, 100)
    try {
      render(<ContextMenu x={1004} y={758} onClose={() => {}}><p>inside</p></ContextMenu>)
      const menu = screen.getByRole('menu')
      expect(menu.style.left).toBe('824px')
      expect(menu.style.top).toBe('668px')
    } finally {
      restore()
    }
  })

  it('does not count a scrollbar as room', () => {
    const restore = sized(200, 100, { w: 1009, h: 753 })
    try {
      render(<ContextMenu x={1000} y={700} onClose={() => {}}><p>inside</p></ContextMenu>)
      expect(screen.getByRole('menu').style.left).toBe('809px')
      expect(screen.getByRole('menu').style.top).toBe('653px')
    } finally {
      restore()
    }
  })

  it('opens where the pointer is when there is room, and never past the top left', () => {
    const restore = sized(200, 100)
    try {
      const { unmount } = render(<ContextMenu x={30} y={40} onClose={() => {}}><p>a</p></ContextMenu>)
      expect(screen.getByRole('menu').style.left).toBe('30px')
      expect(screen.getByRole('menu').style.top).toBe('40px')
      unmount()
      restore()
      const big = sized(5000, 5000)
      try {
        render(<ContextMenu x={30} y={40} onClose={() => {}}><p>b</p></ContextMenu>)
        expect(screen.getByRole('menu').style.left).toBe('0px')
        expect(screen.getByRole('menu').style.top).toBe('0px')
      } finally {
        big()
      }
    } finally {
      restore()
    }
  })

  it('Escape closes it and does not reach the page', async () => {
    const onClose = vi.fn()
    const page = vi.fn()
    document.addEventListener('keydown', page)
    render(<ContextMenu x={1} y={2} onClose={onClose}><MenuItem label="One" icon="fa-lock" enabled onSelect={() => {}} /></ContextMenu>)
    await userEvent.setup().keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(page).not.toHaveBeenCalled()
    document.removeEventListener('keydown', page)
  })

  it('a click outside closes it, one inside does not', async () => {
    const onClose = vi.fn()
    render(<><p>page</p><ContextMenu x={1} y={2} onClose={onClose}><p>inside</p></ContextMenu></>)
    const user = userEvent.setup()
    await user.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByText('page'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an entry closes the menu and then acts', async () => {
    const order: string[] = []
    render(<ContextMenu x={1} y={2} onClose={() => order.push('close')}>
      <MenuItem label="Go" icon="fa-lock" enabled onSelect={() => order.push('act')} />
    </ContextMenu>)
    await userEvent.setup().click(screen.getByRole('menuitem', { name: /Go/ }))
    expect(order).toEqual(['close', 'act'])
  })
})

const AMP_VOL = '/part/amps/0/vol'

function stub(copies: PartCopies, over: Partial<PartCommitState> = {}, path = AMP_VOL): PartCommitState {
  return {
    fieldMenu: { partIndex: 0, path, x: 5, y: 6 },
    closeFieldMenu: vi.fn(),
    readCopies: vi.fn().mockResolvedValue(copies),
    flushEdits: () => Promise.resolve(),
    locks: [[], [], [], []],
    lockValues: vi.fn(),
    revertValues: vi.fn(),
    isCommitting: false,
    isReloading: false,
    ...over,
  } as unknown as PartCommitState
}

const vol = (c: { part: { amps: { vol: number }[] } }) => { c.part.amps[0].vol = 70 }

describe('FieldMenu', () => {
  it('offers the saved value and pins a differing value', async () => {
    const state = stub(copiesWith(vol))
    render(<FieldMenu state={state} />)
    const reset = await screen.findByRole('menuitem', { name: /Reload saved value \(0\)/ })
    expect(reset).toBeEnabled()
    const user = userEvent.setup()
    await user.click(screen.getByRole('menuitem', { name: /Pin value/ }))
    expect(state.lockValues).toHaveBeenCalledWith(0, [AMP_VOL], [])
    expect(state.closeFieldMenu).toHaveBeenCalled()
  })

  it('Reload saved sends the row revert with its undo label', async () => {
    const state = stub(copiesWith(vol))
    render(<FieldMenu state={state} />)
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: /Reload saved/ }))
    expect(state.revertValues).toHaveBeenCalledWith(0, [AMP_VOL], 'Reload saved T1 AMP VOL')
  })

  it('disables both entries on a value matching the saved copy', async () => {
    render(<FieldMenu state={stub(copiesWith(vol), {}, '/part/amps/0/atk')} />)
    const lock = await screen.findByRole('menuitem', { name: /Pin value/ })
    expect(lock).toBeDisabled()
    expect(lock).toHaveAttribute('title', 'Matches the saved copy')
    expect(screen.getByRole('menuitem', { name: /Reload saved/ })).toBeDisabled()
  })

  it('says so when there is no saved copy', async () => {
    const copies = { ...copiesWith(vol), saved: null }
    render(<FieldMenu state={stub(copies)} />)
    const lock = await screen.findByRole('menuitem', { name: /Pin value/ })
    expect(lock).toHaveAttribute('title', 'No saved copy yet')
  })

  it('acts on the whole group when the type changed', async () => {
    const state = stub(
      copiesWith(c => { c.part.fxs[0].fx1_type = 18; c.part.fxs[0].fx1_param3 = 10 }),
      {}, '/part/fxs/0/fx1_param3',
    )
    render(<FieldMenu state={state} />)
    const reset = await screen.findByRole('menuitem', { name: /Reload saved FX1/ })
    expect(reset.textContent).toMatch(/Reload saved FX1 \(.+\)/)
    await userEvent.setup().click(reset)
    const [, paths, label] = (state.revertValues as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(paths).toContain('/part/fxs/0/fx1_type')
    expect(label).toBe('Reload saved T1 FX1')
  })

  it('offers Unpin on a pinned value, and no reload of it', async () => {
    const state = stub(copiesWith(vol), { locks: [[AMP_VOL], [], [], []] })
    render(<FieldMenu state={state} />)
    const unpin = await screen.findByRole('menuitem', { name: /Unpin value/ })
    const reload = screen.getByRole('menuitem', { name: /Reload saved/ })
    expect(reload).toBeDisabled()
    expect(reload).toHaveAttribute('title', 'Pinned: unpin it to reload the saved value')
    await userEvent.setup().click(unpin)
    expect(state.lockValues).toHaveBeenCalledWith(0, [], [AMP_VOL])
  })

  it('offers Unpin on a member of a pinned group, whose own value is not held', async () => {
    const state = stub(
      copiesWith(c => { c.part.fxs[0].fx1_type = 18; c.part.fxs[0].fx1_param3 = 10 }),
      { locks: [['/part/fxs/0/fx1_type'], [], [], []] }, '/part/fxs/0/fx1_param3',
    )
    render(<FieldMenu state={state} />)
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: /Unpin value/ }))
    const [, add, remove] = (state.lockValues as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(add).toEqual([])
    expect(remove).toContain('/part/fxs/0/fx1_type')
  })

  it('writes pending edits before reading the copies', async () => {
    const order: string[] = []
    const state = stub(copiesWith(vol), {
      flushEdits: () => { order.push('flush'); return Promise.resolve() },
      readCopies: vi.fn(async () => { order.push('read'); return copiesWith(vol) }),
    })
    render(<FieldMenu state={state} />)
    await screen.findByRole('menuitem', { name: /Pin value/ })
    expect(order).toEqual(['flush', 'read'])
  })

  it('refuses every entry while a write is in flight', async () => {
    render(<FieldMenu state={stub(copiesWith(vol), { isCommitting: true })} />)
    expect(await screen.findByRole('menuitem', { name: /Pin value/ })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /Reload saved/ })).toBeDisabled()
  })
})

describe('openFieldMenu', () => {
  const open = (el: Element) => {
    const { result } = renderHook(() => usePartCommits({ projectPath: '/p', bankId: 'A', partNames: [] }))
    const e = { target: el, clientX: 3, clientY: 4, preventDefault: vi.fn() }
    act(() => result.current.openFieldMenu(e as never, 2))
    return { e, result }
  }

  it('takes the path from the nearest marked ancestor and swallows the browser menu', () => {
    const cell = document.createElement('div')
    cell.setAttribute('data-lock-path', AMP_VOL)
    const inner = cell.appendChild(document.createElement('span'))
    const { e, result } = open(inner)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(result.current.fieldMenu).toEqual({ partIndex: 2, path: AMP_VOL, x: 3, y: 4 })
  })

  it('leaves the browser menu alone elsewhere', () => {
    const { e, result } = open(document.createElement('div'))
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(result.current.fieldMenu).toBeNull()
  })
})
