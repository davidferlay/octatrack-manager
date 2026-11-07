import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, renderHook, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePartCommits, PartSaveControls, PartCommitState } from './PartSaveControls'
import { WriteStatus } from '../types/writeStatus'
import { copy, copiesWith } from '../utils/partDiff.fixtures'
import type { PartCopies } from '../utils/partDiff'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

const NAMES = ['PART 1', 'GROOVE', 'PART 3', 'PART 4']

type Base = Omit<PartCommitState, 'flushEdits' | 'locks' | 'refreshLocks' | 'lockValues' | 'revertValues' | 'reloadTitle'
  | 'fieldMenu' | 'openFieldMenu' | 'closeFieldMenu'>
  & Partial<Pick<PartCommitState, 'locks' | 'flushEdits'>>

/** A hand-made state: the lock fields default to none, and the title follows the wording of the hook. */
function finish(base: Base): PartCommitState {
  const state: PartCommitState = {
    locks: [[], [], [], []],
    flushEdits: () => Promise.resolve(),
    refreshLocks: vi.fn(),
    lockValues: vi.fn(),
    revertValues: vi.fn(),
    fieldMenu: null,
    openFieldMenu: vi.fn(),
    closeFieldMenu: vi.fn(),
    reloadTitle: (i: number) => {
      const n = state.locks[i].length
      if (n > 0) return `Reload puts the Saved values back, except ${n} pinned ${n === 1 ? 'value' : 'values'}`
      if (state.partsSavedState[i] !== 1) return 'No saved state yet: Save part first!'
      return state.modifiedPartIds.has(i) ? `Reload part ${NAMES[i]} from saved state` : 'No changes to reload'
    },
    ...base,
  }
  return state
}

const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1]

function harness(overrides: Partial<Parameters<typeof usePartCommits>[0]> = {}) {
  const statuses: WriteStatus[] = []
  const reloaded: { index: number; part: unknown }[] = []
  const errors: string[] = []
  const hook = renderHook(() => usePartCommits<{ atk: number }>({
    projectPath: '/test/project',
    bankId: 'A',
    partNames: NAMES,
    onWriteStatusChange: (s) => statuses.push(s),
    onReloaded: (index, part) => reloaded.push({ index, part }),
    onError: (m) => errors.push(m),
    ...overrides,
  }))
  return { ...hook, statuses, reloaded, errors }
}

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => vi.useRealTimers())

/**
 * The device keeps two copies of every Part: the one editing changes, and the one its
 * own Reload Part goes back to. Everything here is about keeping the buttons honest
 * about which Parts hold edits and which have a copy to go back to.
 */
describe('what the bank file already says', () => {
  it('starts with nothing edited and nothing saved', () => {
    const { result } = harness()
    expect([...result.current.modifiedPartIds]).toEqual([])
    expect(result.current.partsSavedState).toEqual([0, 0, 0, 0])
  })

  it('reads one edited Part out of the bitmask', () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0010, [1, 1, 0, 0]))
    expect([...result.current.modifiedPartIds]).toEqual([1])
  })

  it('reads every edited Part out of the bitmask', () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b1111, [1, 1, 1, 1]))
    expect([...result.current.modifiedPartIds].sort()).toEqual([0, 1, 2, 3])
  })

  it('ignores bits past the four Parts a bank has', () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b11110000, [0, 0, 0, 0]))
    expect([...result.current.modifiedPartIds]).toEqual([])
  })

  it('takes which Parts have a saved copy as the bank reports it', () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0, [1, 0, 0, 1]))
    expect(result.current.partsSavedState).toEqual([1, 0, 0, 1])
  })

  it('replaces what it had rather than merging, when another bank is opened', () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0001, [1, 0, 0, 0]))
    act(() => result.current.adoptBankState(0b0100, [0, 0, 1, 0]))
    expect([...result.current.modifiedPartIds]).toEqual([2])
    expect(result.current.partsSavedState).toEqual([0, 0, 1, 0])
  })
})

describe('marking a Part as edited', () => {
  it('lights the buttons up for that Part', () => {
    const { result } = harness()
    act(() => result.current.markModified(2))
    expect([...result.current.modifiedPartIds]).toEqual([2])
  })

  it('keeps the Parts already marked', () => {
    const { result } = harness()
    act(() => result.current.markModified(0))
    act(() => result.current.markModified(3))
    expect([...result.current.modifiedPartIds].sort()).toEqual([0, 3])
  })

  it('changes nothing when the Part is already marked', () => {
    const { result } = harness()
    act(() => result.current.markModified(1))
    const before = result.current.modifiedPartIds
    act(() => result.current.markModified(1))
    expect(result.current.modifiedPartIds).toBe(before)
  })
})

describe('saving one Part', () => {
  it('tells the device which Part of which bank', async () => {
    const { result } = harness()
    await act(() => result.current.commitPart(1))
    expect(invokeMock).toHaveBeenCalledWith('commit_part', {
      path: '/test/project', bankId: 'A', partId: 1,
    })
  })

  it('clears the edited marking for that Part only', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0011, [0, 0, 0, 0]))
    await act(() => result.current.commitPart(0))
    expect([...result.current.modifiedPartIds]).toEqual([1])
  })

  it('gives that Part something to reload, since it now has a saved copy', async () => {
    const { result } = harness()
    await act(() => result.current.commitPart(2))
    expect(result.current.partsSavedState).toEqual([0, 0, 1, 0])
  })

  it('says which Part it is saving, by name', async () => {
    const { result, statuses } = harness()
    await act(() => result.current.commitPart(1))
    expect(statuses.map(s => s.message)).toEqual([
      'Saving part GROOVE...', 'Part GROOVE saved',
    ])
  })

  it('falls back to the Part number when the bank has no name for it', async () => {
    const { result, statuses } = harness({ partNames: [] })
    await act(() => result.current.commitPart(3))
    expect(statuses[0].message).toBe('Saving part Part 4...')
  })

  it('goes back to idle once the message has been read', async () => {
    const { result, statuses } = harness()
    await act(() => result.current.commitPart(0))
    expect(last(statuses)?.state).toBe('success')
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(last(statuses)?.state).toBe('idle')
  })

  it('is busy while it writes, and not afterwards', async () => {
    let release = () => {}
    invokeMock.mockImplementation(() => new Promise<void>(r => { release = () => r() }))
    const { result } = harness()
    let done: Promise<void> = Promise.resolve()
    await act(async () => { done = result.current.commitPart(0) })
    expect(result.current.isCommitting).toBe(true)
    await act(async () => { release(); await done })
    expect(result.current.isCommitting).toBe(false)
  })
})

describe('when the device refuses the write', () => {
  // A string, which is what Tauri rejects with, built fresh per call: the rejected
  // promise has to come into being inside the call, or nothing has awaited it yet.
  beforeEach(() => {
    invokeMock.mockImplementation(() => Promise.reject('card is write protected'))
  })

  it('says what failed rather than claiming success', async () => {
    const { result, statuses } = harness()
    await act(() => result.current.commitPart(0))
    expect(last(statuses)).toEqual({
      state: 'error', message: 'Saving part PART 1... failed',
    })
  })

  it('passes the device message on', async () => {
    const { result, errors } = harness()
    await act(() => result.current.commitPart(0))
    expect(errors).toEqual(['Saving part PART 1... failed: card is write protected'])
  })

  it('leaves the Part marked as edited, because it still is', async () => {
    const { result } = harness()
    act(() => result.current.markModified(0))
    await act(() => result.current.commitPart(0))
    expect([...result.current.modifiedPartIds]).toEqual([0])
  })

  it('leaves it with nothing to reload, since nothing was saved', async () => {
    const { result } = harness()
    await act(() => result.current.commitPart(0))
    expect(result.current.partsSavedState).toEqual([0, 0, 0, 0])
  })

  it('stops being busy, so the buttons come back', async () => {
    const { result } = harness()
    await act(() => result.current.commitPart(0))
    expect(result.current.isCommitting).toBe(false)
  })

  it('survives an editor that asked for no error reporting', async () => {
    const { result } = harness({ onError: undefined, onWriteStatusChange: undefined })
    await act(() => result.current.commitPart(0))
    expect(result.current.isCommitting).toBe(false)
  })
})

describe('saving every edited Part', () => {
  const commands = (cmd: string) =>
    invokeMock.mock.calls.filter(([name]) => name === cmd)

  it('writes nothing when nothing was edited', async () => {
    const { result } = harness()
    await act(() => result.current.commitAllParts())
    expect(commands('commit_all_parts')).toEqual([])
  })

  it('asks the device once for the whole bank', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0101, [0, 0, 0, 0]))
    await act(() => result.current.commitAllParts())
    expect(commands('commit_all_parts')).toEqual([
      ['commit_all_parts', { path: '/test/project', bankId: 'A' }],
    ])
  })

  it('clears every marking', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b1111, [0, 0, 0, 0]))
    await act(() => result.current.commitAllParts())
    expect([...result.current.modifiedPartIds]).toEqual([])
  })

  it('gives every Part something to reload', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0001, [0, 0, 0, 0]))
    await act(() => result.current.commitAllParts())
    expect(result.current.partsSavedState).toEqual([1, 1, 1, 1])
  })
})

describe('reloading a Part', () => {
  beforeEach(() => invokeMock.mockResolvedValue({ atk: 99 }))

  it('asks the device for the saved copy', async () => {
    const { result } = harness()
    await act(() => result.current.reloadPart(2))
    expect(invokeMock).toHaveBeenCalledWith('reload_part', {
      path: '/test/project', bankId: 'A', partId: 2,
    })
  })

  it('hands the saved copy back to the editor', async () => {
    const { result, reloaded } = harness()
    await act(() => result.current.reloadPart(2))
    expect(reloaded).toEqual([{ index: 2, part: { atk: 99 } }])
  })

  it('clears the edited marking, since the edits are gone', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0110, [1, 1, 1, 1]))
    await act(() => result.current.reloadPart(1))
    expect([...result.current.modifiedPartIds]).toEqual([2])
  })

  it('leaves the saved copies alone', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0010, [1, 1, 0, 0]))
    await act(() => result.current.reloadPart(1))
    expect(result.current.partsSavedState).toEqual([1, 1, 0, 0])
  })

  it('says which Part it is reloading', async () => {
    const { result, statuses } = harness()
    await act(() => result.current.reloadPart(1))
    expect(statuses.map(s => s.message)).toEqual([
      'Reloading part GROOVE...', 'Part GROOVE reloaded',
    ])
  })

})

describe('when the saved copy cannot be read back', () => {
  beforeEach(() => {
    invokeMock.mockImplementation(() => Promise.reject('bank file is unreadable'))
  })

  it('keeps the edits, since nothing was put back', async () => {
    const { result } = harness()
    act(() => result.current.markModified(0))
    await act(() => result.current.reloadPart(0))
    expect([...result.current.modifiedPartIds]).toEqual([0])
  })

  it('says so rather than claiming the Part was reloaded', async () => {
    const { result, errors, statuses } = harness()
    await act(() => result.current.reloadPart(0))
    expect(errors).toEqual(['Reloading part PART 1... failed: bank file is unreadable'])
    expect(last(statuses)?.state).toBe('error')
  })

  it('hands nothing back to the editor', async () => {
    const { result, reloaded } = harness()
    await act(() => result.current.reloadPart(0))
    expect(reloaded).toEqual([])
  })

  it('stops being busy, so the buttons come back', async () => {
    const { result } = harness()
    await act(() => result.current.reloadPart(0))
    expect(result.current.isReloading).toBe(false)
  })
})

/** The three buttons. Each one has to refuse what the device would refuse. */
describe('the buttons', () => {
  function Buttons({ state, activePartIndex = 0, visible = true }: {
    state: PartCommitState
    activePartIndex?: number
    visible?: boolean
  }) {
    return (
      <PartSaveControls
        state={state}
        activePartIndex={activePartIndex}
        partNames={NAMES}
        visible={visible}
      />
    )
  }

  const idle = (over: Partial<PartCommitState> = {}): PartCommitState => finish({
    modifiedPartIds: new Set<number>(),
    partsSavedState: [0, 0, 0, 0],
    isCommitting: false,
    isReloading: false,
    commitPart: vi.fn(),
    commitAllParts: vi.fn(),
    reloadPart: vi.fn(),
    markModified: vi.fn(),
    adoptBankState: vi.fn(),
    readCopies: vi.fn(),
    diffsFor: null,
    showDiffs: vi.fn(),
    hideDiffs: vi.fn(),
    tabMenu: null,
    openTabMenu: vi.fn(),
    closeTabMenu: vi.fn(),
    ...over,
  })

  const button = (name: 'See diffs' | 'Reload' | 'Save' | 'Save All') =>
    screen.getByRole('button', { name })

  it('offers the device\'s three in its order, then See diffs', () => {
    render(<Buttons state={idle()} />)
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent))
      .toEqual(['Reload', 'Save', 'Save All', 'See diffs'])
  })

  it('refuses everything on a Part with no changes', () => {
    render(<Buttons state={idle()} />)
    expect(button('Reload')).toBeDisabled()
    expect(button('Save')).toBeDisabled()
    expect(button('Save All')).toBeDisabled()
  })

  it('offers Save once the Part holds changes', () => {
    render(<Buttons state={idle({ modifiedPartIds: new Set([0]) })} />)
    expect(button('Save')).toBeEnabled()
  })

  it('refuses Reload on a Part the device has never saved', () => {
    render(<Buttons state={idle({ modifiedPartIds: new Set([0]) })} />)
    expect(button('Reload')).toBeDisabled()
    expect(button('Reload')).toHaveAttribute('title', 'No saved state yet: Save part first!')
  })

  it('offers Reload once the Part has a saved copy and holds changes', () => {
    render(<Buttons state={idle({
      modifiedPartIds: new Set([0]), partsSavedState: [1, 0, 0, 0],
    })} />)
    expect(button('Reload')).toBeEnabled()
    expect(button('Reload')).toHaveAttribute('title', 'Reload part PART 1 from saved state')
  })

  it('refuses Reload with nothing to reload, even with a saved copy', () => {
    render(<Buttons state={idle({ partsSavedState: [1, 1, 1, 1] })} />)
    expect(button('Reload')).toBeDisabled()
    expect(button('Reload')).toHaveAttribute('title', 'No changes to reload')
  })

  it('judges each button by the Part on screen', () => {
    render(<Buttons state={idle({ modifiedPartIds: new Set([1]) })} activePartIndex={0} />)
    expect(button('Save')).toBeDisabled()
    expect(button('Save All')).toBeEnabled()
  })

  it('says how many Parts Save All would write', () => {
    render(<Buttons state={idle({ modifiedPartIds: new Set([1, 2]) })} />)
    expect(button('Save All')).toHaveAttribute('title', 'Save all 2 modified parts')
  })

  it('refuses everything while a write is in flight', () => {
    render(<Buttons state={idle({
      modifiedPartIds: new Set([0]), partsSavedState: [1, 0, 0, 0], isCommitting: true,
    })} />)
    expect(button('Reload')).toBeDisabled()
    expect(button('Save')).toBeDisabled()
    expect(button('Save All')).toBeDisabled()
  })

  it('refuses everything while a reload is in flight', () => {
    render(<Buttons state={idle({
      modifiedPartIds: new Set([0]), partsSavedState: [1, 0, 0, 0], isReloading: true,
    })} />)
    expect(button('Save')).toBeDisabled()
  })

  it('acts on the Part on screen', async () => {
    const state = idle({ modifiedPartIds: new Set([2]), partsSavedState: [0, 0, 1, 0] })
    render(<Buttons state={state} activePartIndex={2} />)
    const user = userEvent.setup()
    await user.click(button('Save'))
    await user.click(button('Reload'))
    await user.click(button('Save All'))
    expect(state.commitPart).toHaveBeenCalledWith(2)
    expect(state.reloadPart).toHaveBeenCalledWith(2)
    expect(state.commitAllParts).toHaveBeenCalled()
  })

  it('names a Part the bank left unnamed by its number', () => {
    render(
      <PartSaveControls
        state={idle({ modifiedPartIds: new Set([1]), partsSavedState: [0, 1, 0, 0] })}
        activePartIndex={1}
        partNames={[]}
        visible
      />,
    )
    expect(button('Save')).toHaveAttribute('title', 'Save part Part 2')
  })

  it('keeps its space outside Edit mode, so the header does not resize', () => {
    const { container } = render(<Buttons state={idle()} visible={false} />)
    expect(container.querySelector('.parts-edit-controls')).toHaveClass('hidden')
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('shows itself in Edit mode', () => {
    const { container } = render(<Buttons state={idle()} visible />)
    expect(container.querySelector('.parts-edit-controls')).toHaveClass('visible')
  })
})

describe('the diffs window', () => {
  const idle = (over: Partial<PartCommitState> = {}): PartCommitState => finish({
    modifiedPartIds: new Set<number>(),
    partsSavedState: [1, 1, 1, 1],
    isCommitting: false,
    isReloading: false,
    commitPart: vi.fn(),
    commitAllParts: vi.fn(),
    reloadPart: vi.fn(),
    markModified: vi.fn(),
    adoptBankState: vi.fn(),
    readCopies: vi.fn(),
    diffsFor: null,
    showDiffs: vi.fn(),
    hideDiffs: vi.fn(),
    tabMenu: null,
    openTabMenu: vi.fn(),
    closeTabMenu: vi.fn(),
    ...over,
  })

  /** Part copies where the edited one has T1's VOL moved from 100 to 108. */
  const volMoved = (): PartCopies => {
    const saved = copy()
    const edited = copy()
    saved.part.amps[0].vol = 100
    edited.part.amps[0].vol = 108
    return { saved, edited, identical: false }
  }

  const controls = (state: PartCommitState, activePartIndex = 0) =>
    render(<PartSaveControls state={state} activePartIndex={activePartIndex} partNames={NAMES} visible />)

  it('is opened by See diffs, for the Part on screen', async () => {
    const state = idle({ modifiedPartIds: new Set([2]) })
    controls(state, 2)
    await userEvent.setup().click(screen.getByRole('button', { name: 'See diffs' }))
    expect(state.showDiffs).toHaveBeenCalledWith(2)
  })

  it('is refused while the Part on screen holds no edits, whatever the others hold', () => {
    controls(idle({ modifiedPartIds: new Set([1]) }), 0)
    expect(screen.getByRole('button', { name: 'See diffs' })).toBeDisabled()
  })

  it('lists each value that differs, saved against current', async () => {
    const state = idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(volMoved()) })
    controls(state)
    const dialog = await screen.findByRole('dialog', { name: 'Edited params against saved' })
    const row = await within(dialog).findByRole('row', { name: /VOL/ })
    expect(within(row).getAllByRole('cell').map(c => c.textContent))
      .toEqual(['T1', 'AMP', 'VOL', '36', '44', ''])
    expect(within(dialog).getByText(/- 1 diff$/)).toBeInTheDocument()
  })

  it('lists only the Part it was opened for', async () => {
    const state = idle({ modifiedPartIds: new Set([0, 2]), diffsFor: 2, readCopies: vi.fn().mockResolvedValue(volMoved()) })
    controls(state, 0)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: /PART 3/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('heading', { name: /PART 1/ })).not.toBeInTheDocument()
    expect(state.readCopies).toHaveBeenCalledTimes(1)
    expect(state.readCopies).toHaveBeenCalledWith(2)
  })

  it('says a Part never saved has no saved copy to compare with', async () => {
    const copies: PartCopies = { saved: null, edited: copy(), identical: false }
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(copies) }))
    expect(await screen.findByText(/No saved copy yet/)).toBeInTheDocument()
  })

  it('says when edits were turned back by hand and nothing differs any more', async () => {
    const copies: PartCopies = { saved: copy(), edited: copy(), identical: true }
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(copies) }))
    expect(await screen.findByText(/Nothing differs/)).toBeInTheDocument()
  })

  it('says when the copies differ only where the editors do not look', async () => {
    const copies: PartCopies = { saved: copy(), edited: copy(), identical: false }
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(copies) }))
    expect(await screen.findByText(/not shown by the editor/)).toBeInTheDocument()
  })

  it('saves or reloads that Part, each button saying which column it keeps', async () => {
    const state = idle({ modifiedPartIds: new Set([2]), diffsFor: 2, readCopies: vi.fn().mockResolvedValue(volMoved()) })
    controls(state, 0)
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save PART 3' })
    const reload = within(dialog).getByRole('button', { name: 'Reload PART 3' })
    expect(save).toHaveAttribute('title', expect.stringMatching(/Current values the saved ones/))
    expect(reload).toHaveAttribute('title', expect.stringMatching(/Saved values back/))
    const user = userEvent.setup()
    await user.click(save)
    expect(state.commitPart).toHaveBeenCalledWith(2)
    await user.click(reload)
    expect(state.reloadPart).toHaveBeenCalledWith(2)
  })

  it('opens only once both copies are read, so it does not change size as it fills', () => {
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockReturnValue(new Promise(() => {})) }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names each track once, in one cell spanning its rows', async () => {
    const saved = copy()
    const edited = copy()
    edited.part.amps[0].vol = 70
    edited.part.amps[0].bal = 70
    edited.part.amps[1].vol = 70
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue({ saved, edited, identical: false }) }))
    const dialog = await screen.findByRole('dialog')
    const [first, second, third] = within(dialog).getAllByRole('row').slice(1)
    const t1 = within(first).getAllByRole('cell')[0]
    expect(t1).toHaveTextContent('T1')
    expect(t1).toHaveAttribute('rowspan', '2')
    // The second T1 row has no track cell of its own: it starts with the page
    expect(within(second).getAllByRole('cell').map(c => c.textContent)).toEqual(['AMP', 'BAL', '0', '6', ''])
    expect(within(third).getAllByRole('cell')[0]).toHaveTextContent('T2')
  })

  it('closes with Close', async () => {
    const state = idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(volMoved()) })
    controls(state)
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(state.hideDiffs).toHaveBeenCalled()
  })

  it('says when there is no diff to display', () => {
    controls(idle({ modifiedPartIds: new Set() }))
    expect(screen.getByRole('button', { name: 'See diffs' })).toHaveAttribute('title', 'No diff to display')
  })

  it('names its Part in the header, beside the title', async () => {
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(volMoved()) }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('row', { name: /VOL/ })
    expect(dialog.querySelector('.modal-header')).toHaveTextContent(/Edited params against saved.*Part 1: PART 1 - 1 diff/)
  })

  it('draws Save like Reload and Close, not as the primary action', async () => {
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(volMoved()) }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save PART 1' })).not.toHaveClass('primary')
  })

  it('shows the track as the app\'s track badge, and the parameter\'s help on hover', async () => {
    controls(idle({ modifiedPartIds: new Set([0]), diffsFor: 0, readCopies: vi.fn().mockResolvedValue(volMoved()) }))
    const row = await within(await screen.findByRole('dialog')).findByRole('row', { name: /VOL/ })
    const [track, , param] = within(row).getAllByRole('cell')
    expect(track.querySelector('.track-badge.audio')).toHaveTextContent('T1')
    // On the parameter's name, not across the whole row
    expect(param).toHaveAttribute('title', expect.stringMatching(/^VOL - Track volume before the effects/))
    expect(row).not.toHaveAttribute('title')
  })
})

describe('the d key', () => {
  const idle = (over: Partial<PartCommitState> = {}): PartCommitState => finish({
    modifiedPartIds: new Set([0]),
    partsSavedState: [1, 1, 1, 1],
    isCommitting: false,
    isReloading: false,
    commitPart: vi.fn(),
    commitAllParts: vi.fn(),
    reloadPart: vi.fn(),
    markModified: vi.fn(),
    adoptBankState: vi.fn(),
    readCopies: vi.fn().mockReturnValue(new Promise(() => {})),
    diffsFor: null,
    showDiffs: vi.fn(),
    hideDiffs: vi.fn(),
    tabMenu: null,
    openTabMenu: vi.fn(),
    closeTabMenu: vi.fn(),
    ...over,
  })
  const controls = (state: PartCommitState, visible = true) =>
    render(<PartSaveControls state={state} activePartIndex={0} partNames={NAMES} visible={visible} />)
  const press = (key = 'd', target: Element = document.body) =>
    act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })

  it('opens the diffs of the Part on screen', () => {
    const state = idle()
    controls(state)
    press()
    expect(state.showDiffs).toHaveBeenCalledWith(0)
  })

  it('closes them again', () => {
    const state = idle({ diffsFor: 0 })
    controls(state)
    press()
    expect(state.hideDiffs).toHaveBeenCalled()
  })

  it('does nothing when there is no diff to display', () => {
    const state = idle({ modifiedPartIds: new Set() })
    controls(state)
    press()
    expect(state.showDiffs).not.toHaveBeenCalled()
  })

  it('does nothing outside Edit mode', () => {
    const state = idle()
    controls(state, false)
    press()
    expect(state.showDiffs).not.toHaveBeenCalled()
  })

  it('types a d into a text field rather than opening anything', () => {
    const state = idle()
    controls(state)
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('d', input)
    expect(state.showDiffs).not.toHaveBeenCalled()
    input.remove()
  })
})

describe('the Part tab menu', () => {
  const state = (over: Partial<PartCommitState> = {}): PartCommitState => finish({
    modifiedPartIds: new Set([1]),
    partsSavedState: [1, 1, 1, 1],
    isCommitting: false,
    isReloading: false,
    commitPart: vi.fn(),
    commitAllParts: vi.fn(),
    reloadPart: vi.fn(),
    markModified: vi.fn(),
    adoptBankState: vi.fn(),
    readCopies: vi.fn(),
    diffsFor: null,
    showDiffs: vi.fn(),
    hideDiffs: vi.fn(),
    tabMenu: { partIndex: 1, x: 10, y: 20 },
    openTabMenu: vi.fn(),
    closeTabMenu: vi.fn(),
    ...over,
  })
  const menu = (s: PartCommitState) => {
    render(<PartSaveControls state={s} activePartIndex={0} partNames={NAMES} visible />)
    return screen.getByRole('menu')
  }

  it('offers Reload, Save and See diffs for the Part right-clicked', () => {
    expect(within(menu(state())).getAllByRole('menuitem').map(i => i.textContent?.trim()))
      .toEqual(['Reload', 'Save', 'See diffs'])
  })

  it('acts on that Part, not the one on screen, and closes', async () => {
    const s = state()
    const user = userEvent.setup()
    await user.click(within(menu(s)).getByRole('menuitem', { name: 'Save' }))
    expect(s.commitPart).toHaveBeenCalledWith(1)
    expect(s.closeTabMenu).toHaveBeenCalled()
  })

  it('opens the diffs of that Part', async () => {
    const s = state()
    await userEvent.setup().click(within(menu(s)).getByRole('menuitem', { name: 'See diffs' }))
    expect(s.showDiffs).toHaveBeenCalledWith(1)
  })

  it('refuses everything on a Part holding no edits', () => {
    const items = within(menu(state({ modifiedPartIds: new Set() }))).getAllByRole('menuitem')
    items.forEach(item => expect(item).toBeDisabled())
  })

  it('refuses Reload on a Part never saved', () => {
    const m = menu(state({ partsSavedState: [1, 0, 1, 1] }))
    expect(within(m).getByRole('menuitem', { name: 'Reload' })).toBeDisabled()
    expect(within(m).getByRole('menuitem', { name: 'Save' })).toBeEnabled()
  })
})

describe('reading both copies', () => {
  it('asks the backend for the saved and the edited copy of a Part', async () => {
    const copies = { saved: null, edited: copy(), identical: false }
    invokeMock.mockResolvedValue(copies)
    const { result } = harness()
    expect(await result.current.readCopies(3)).toBe(copies)
    expect(invokeMock).toHaveBeenCalledWith('read_part_copies', { path: '/test/project', bankId: 'A', partId: 3 })
  })
})

describe('which diffs and which menu are open', () => {
  it('opens and closes the diffs of a Part', () => {
    const { result } = harness()
    act(() => result.current.showDiffs(2))
    expect(result.current.diffsFor).toBe(2)
    act(() => result.current.hideDiffs())
    expect(result.current.diffsFor).toBeNull()
  })

  it('opens the tab menu where the pointer is, in place of the browser\'s own', () => {
    const { result } = harness()
    const preventDefault = vi.fn()
    act(() => result.current.openTabMenu({ preventDefault, clientX: 40, clientY: 60 } as never, 3))
    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.tabMenu).toEqual({ partIndex: 3, x: 40, y: 60 })
    act(() => result.current.closeTabMenu())
    expect(result.current.tabMenu).toBeNull()
  })
})

/** The hook's state as the buttons, the window and the menu see it, with every action a spy. */
const commitState = (over: Partial<PartCommitState> = {}): PartCommitState => finish({
  modifiedPartIds: new Set([0]),
  partsSavedState: [1, 1, 1, 1],
  isCommitting: false,
  isReloading: false,
  commitPart: vi.fn().mockResolvedValue(undefined),
  commitAllParts: vi.fn(),
  reloadPart: vi.fn().mockResolvedValue(undefined),
  markModified: vi.fn(),
  adoptBankState: vi.fn(),
  readCopies: vi.fn(),
  diffsFor: null,
  showDiffs: vi.fn(),
  hideDiffs: vi.fn(),
  tabMenu: null,
  openTabMenu: vi.fn(),
  closeTabMenu: vi.fn(),
  ...over,
})

const renderControls = (state: PartCommitState, activePartIndex = 0) =>
  render(<PartSaveControls state={state} activePartIndex={activePartIndex} partNames={NAMES} visible />)


describe('the diffs window, further', () => {
  const opened = (copies: PartCopies | Promise<PartCopies>, over: Partial<PartCommitState> = {}) => {
    const state = commitState({
      diffsFor: 0,
      readCopies: vi.fn().mockReturnValue(copies instanceof Promise ? copies : Promise.resolve(copies)),
      ...over,
    })
    renderControls(state)
    return state
  }

  it('says why when the Part cannot be read', async () => {
    opened(Promise.reject(new Error('bank file locked')))
    expect(await screen.findByText(/Could not read the Part: Error: bank file locked/)).toBeInTheDocument()
  })

  it('closes once its Save has run', async () => {
    const state = opened(copiesWith(c => { c.part.amps[0].vol = 70 }))
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save PART 1' }))
    expect(state.commitPart).toHaveBeenCalledWith(0)
    expect(state.hideDiffs).toHaveBeenCalled()
  })

  it('closes once its Reload has run', async () => {
    const state = opened(copiesWith(c => { c.part.amps[0].vol = 70 }))
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reload PART 1' }))
    expect(state.reloadPart).toHaveBeenCalledWith(0)
    expect(state.hideDiffs).toHaveBeenCalled()
  })

  it('stays open after its Reload while values are pinned, and reads both copies again', async () => {
    const state = opened(copiesWith(c => { c.part.amps[0].vol = 70 }), { locks: [['/part/amps/0/vol'], [], [], []] })
    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reload PART 1' }))
    expect(state.reloadPart).toHaveBeenCalledWith(0)
    expect(state.hideDiffs).not.toHaveBeenCalled()
    await waitFor(() => expect(state.readCopies).toHaveBeenCalledTimes(2))
  })

  it('refuses Save and Reload while a write is in flight', async () => {
    opened(copiesWith(c => { c.part.amps[0].vol = 70 }), { isCommitting: true })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Save PART 1' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Reload PART 1' })).toBeDisabled()
  })

  it('refuses Reload, but not Save, on a Part never saved', async () => {
    opened({ saved: null, edited: copy(), identical: false }, { partsSavedState: [0, 1, 1, 1] })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Reload PART 1' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Save PART 1' })).toBeEnabled()
  })

  it('counts several differences in the plural', async () => {
    opened(copiesWith(c => { c.part.amps[0].vol = 70; c.part.amps[1].vol = 70 }))
    expect(await screen.findByText(/- 2 diffs$/)).toBeInTheDocument()
  })

  it('shows a MIDI track with the MIDI badge, numbered as elsewhere in the app', async () => {
    opened(copiesWith(c => { c.part.midi_notes[2].note = 60 }))
    const row = await within(await screen.findByRole('dialog')).findByRole('row', { name: /NOTE/ })
    expect(row.querySelector('.track-badge.midi')).toHaveTextContent('T3')
  })

  it('leaves the track empty for the crossfader, which belongs to no track', async () => {
    opened(copiesWith(c => { c.scenes.scene_a = 3 }))
    const row = await within(await screen.findByRole('dialog')).findByRole('row', { name: /CROSSFADER/ })
    const [track] = within(row).getAllByRole('cell')
    expect(track).toHaveTextContent('')
    expect(track.querySelector('.track-badge')).toBeNull()
  })
})

describe('the Part tab menu, further', () => {
  const menuFor = (over: Partial<PartCommitState> = {}) => {
    const state = commitState({ modifiedPartIds: new Set([1]), tabMenu: { partIndex: 1, x: 40, y: 60 }, ...over })
    renderControls(state)
    return { state, menu: screen.getByRole('menu') }
  }

  it('opens where the pointer was', () => {
    const { menu } = menuFor()
    expect(menu).toHaveStyle({ left: '40px', top: '60px' })
  })

  it('closes on Escape', () => {
    const { state } = menuFor()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(state.closeTabMenu).toHaveBeenCalled()
  })

  it('closes on a click outside it, and not on a click inside', () => {
    const { state, menu } = menuFor()
    act(() => { menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(state.closeTabMenu).not.toHaveBeenCalled()
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(state.closeTabMenu).toHaveBeenCalled()
  })

  it('refuses Reload and Save while a write is in flight, but still shows the diffs', () => {
    const { menu } = menuFor({ isReloading: true })
    expect(within(menu).getByRole('menuitem', { name: 'Reload' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Save' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'See diffs' })).toBeEnabled()
  })

  it('reloads the Part right-clicked', async () => {
    const { state, menu } = menuFor()
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Reload' }))
    expect(state.reloadPart).toHaveBeenCalledWith(1)
    expect(state.closeTabMenu).toHaveBeenCalled()
  })
})

describe('the d key, further', () => {
  const press = (init: KeyboardEventInit) =>
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })) })

  it('takes an upper-case D too', () => {
    const state = commitState()
    renderControls(state)
    press({ key: 'D', shiftKey: true })
    expect(state.showDiffs).toHaveBeenCalledWith(0)
  })

  it('leaves Ctrl, Cmd and Alt with D to whatever else they do', () => {
    const state = commitState()
    renderControls(state)
    press({ key: 'd', ctrlKey: true })
    press({ key: 'd', metaKey: true })
    press({ key: 'd', altKey: true })
    expect(state.showDiffs).not.toHaveBeenCalled()
  })

  it('leaves D to another window that is open', () => {
    const state = commitState()
    renderControls(state)
    const other = document.createElement('div')
    other.className = 'modal-overlay'
    document.body.appendChild(other)
    press({ key: 'd' })
    expect(state.showDiffs).not.toHaveBeenCalled()
    other.remove()
  })

  it('does nothing while more than one bank is on screen, as there is no one Part to mean', () => {
    const state = commitState()
    render(
      <>
        <PartSaveControls state={state} activePartIndex={0} partNames={NAMES} visible />
        <PartSaveControls state={state} activePartIndex={0} partNames={NAMES} visible />
      </>,
    )
    press({ key: 'd' })
    expect(state.showDiffs).not.toHaveBeenCalled()
  })

  it('types a d into a text area or an editable field rather than opening anything', () => {
    const state = commitState()
    renderControls(state)
    const area = document.createElement('textarea')
    document.body.appendChild(area)
    act(() => { area.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })) })
    expect(state.showDiffs).not.toHaveBeenCalled()
    area.remove()
  })
})

/**
 * A lock keeps one value through Reload. The device knows nothing of them: the app
 * keeps them next to the project, and this state is how every editor sees them.
 */
describe('locks', () => {
  const L = (...xs: string[][]) => [xs[0] ?? [], xs[1] ?? [], xs[2] ?? [], xs[3] ?? []]
  const reads = () => invokeMock.mock.calls.filter(c => c[0] === 'read_part_locks')

  function withLocks(locks: string[][], extra: (cmd: string, args: unknown) => unknown = () => undefined) {
    invokeMock.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'read_part_locks') return locks
      return extra(cmd, args)
    })
  }

  it('reads the locks of the bank on mount and again when reloadKey changes', async () => {
    withLocks(L(['/part/fxs/0/fx1_param3']))
    let key = 0
    const hook = renderHook(() => usePartCommits({
      projectPath: '/test/project', bankId: 'A', partNames: NAMES, reloadKey: key,
    }))
    await act(async () => {})
    expect(reads()).toEqual([['read_part_locks', { path: '/test/project', bankId: 'A' }]])
    expect(hook.result.current.locks[0]).toEqual(['/part/fxs/0/fx1_param3'])
    key = 1
    hook.rerender()
    await act(async () => {})
    expect(reads()).toHaveLength(2)
  })

  it('drops a locks reply for the previous bank that lands after a bank change', async () => {
    let lateA!: (v: string[][]) => void
    invokeMock.mockImplementation((cmd: string, args: { bankId: string }) => {
      if (cmd !== 'read_part_locks') return Promise.resolve(undefined)
      return args.bankId === 'A'
        ? new Promise<string[][]>(res => { lateA = res })
        : Promise.resolve(L([], ['/part/fxs/0/b']))
    })
    let bank = 'A'
    const hook = renderHook(() => usePartCommits({
      projectPath: '/test/project', bankId: bank, partNames: NAMES,
    }))
    bank = 'B'
    hook.rerender()
    await act(async () => {})
    expect(hook.result.current.locks[1]).toEqual(['/part/fxs/0/b'])
    await act(async () => { lateA(L(['/part/fxs/0/a'])) })
    expect(hook.result.current.locks).toEqual(L([], ['/part/fxs/0/b']))
  })

  it('refreshLocks reads again only when the bank holds a lock', async () => {
    withLocks(L())
    const { result } = harness()
    await act(async () => {})
    expect(reads()).toHaveLength(1)
    act(() => result.current.refreshLocks())
    await act(async () => {})
    expect(reads()).toHaveLength(1)

    withLocks(L([], ['/part/fxs/0/fx1_param3']))
    const second = harness()
    await act(async () => {})
    const before = reads().length
    act(() => second.result.current.refreshLocks())
    await act(async () => {})
    expect(reads()).toHaveLength(before + 1)
  })

  it('Reload keeps the Part marked when it holds locks, and clears it otherwise', async () => {
    withLocks(L([], ['/part/fxs/0/fx1_param3']), cmd => (cmd === 'reload_part' ? { atk: 1 } : undefined))
    const { result } = harness()
    await act(async () => {})
    act(() => result.current.adoptBankState(0b0011, [1, 1, 1, 1]))
    await act(() => result.current.reloadPart(1))
    await act(() => result.current.reloadPart(0))
    expect([...result.current.modifiedPartIds]).toEqual([1])
  })

  it('the Reload title names the pinned count', async () => {
    withLocks(L(['/part/a/0/x', '/part/a/0/y'], ['/part/a/0/x']))
    const { result } = harness()
    await act(async () => {})
    act(() => result.current.adoptBankState(0b0011, [1, 1, 0, 0]))
    expect(result.current.reloadTitle(0)).toBe('Reload puts the Saved values back, except 2 pinned values')
    expect(result.current.reloadTitle(1)).toBe('Reload puts the Saved values back, except 1 pinned value')
    expect(result.current.reloadTitle(2)).toBe('No saved state yet: Save part first!')
    act(() => result.current.adoptBankState(0b0001, [1, 1, 0, 0]))
    withLocks(L())
    const none = harness()
    await act(async () => {})
    act(() => none.result.current.adoptBankState(0b0001, [1, 1, 0, 0]))
    expect(none.result.current.reloadTitle(0)).toBe('Reload part PART 1 from saved state')
    expect(none.result.current.reloadTitle(1)).toBe('No changes to reload')
  })

  it('lockValues sends the change and adopts the returned locks, silently', async () => {
    const after = L(['/part/fxs/0/fx1_param3'])
    withLocks(L(), cmd => (cmd === 'set_part_locks' ? after : undefined))
    const { result, statuses } = harness()
    await act(async () => {})
    await act(() => result.current.lockValues(0, ['/part/fxs/0/fx1_param3'], []))
    expect(invokeMock).toHaveBeenCalledWith('set_part_locks', {
      path: '/test/project', bankId: 'A', partId: 0,
      add: ['/part/fxs/0/fx1_param3'], remove: [],
    })
    expect(result.current.locks).toEqual(after)
    // No status and no busy flag: pinning must not flash the header's write buttons
    expect(statuses).toHaveLength(0)
    expect(result.current.isCommitting).toBe(false)
  })

  it('revertValues hands the rewritten Part to onReloaded and reads the locks again', async () => {
    withLocks(L(['/part/fxs/0/fx1_param3']), cmd => (cmd === 'revert_part_values' ? { atk: 5 } : undefined))
    const { result, reloaded } = harness()
    await act(async () => {})
    const before = reads().length
    await act(() => result.current.revertValues(2, ['/part/fxs/0/fx1_param3'], 'Reload saved T1 FX1 FREQ'))
    expect(invokeMock).toHaveBeenCalledWith('revert_part_values', {
      path: '/test/project', bankId: 'A', partId: 2,
      paths: ['/part/fxs/0/fx1_param3'], label: 'Reload saved T1 FX1 FREQ',
    })
    expect(reloaded).toEqual([{ index: 2, part: { atk: 5 } }])
    expect([...result.current.modifiedPartIds]).toEqual([2])
    expect(reads().length).toBe(before + 1)
  })
})

describe('edits the editor still holds back', () => {
  /** A flush that stays pending until released, and the commands seen meanwhile. */
  function held() {
    let release!: () => void
    const flush = vi.fn(() => new Promise<void>(r => { release = r }))
    const commands = () => invokeMock.mock.calls.map(c => c[0]).filter(c => c !== 'read_part_locks')
    return { flush, release: () => release(), commands }
  }

  const calls: [string, (r: { current: ReturnType<typeof usePartCommits<{ atk: number }>> }) => Promise<void>, string][] = [
    ['Revert', r => r.current.revertValues(1, ['/part/amps/0/atk'], 'Reload saved T1 AMP ATK'), 'revert_part_values'],
    ['Lock', r => r.current.lockValues(1, ['/part/amps/0/atk'], []), 'set_part_locks'],
    ['Reload', r => r.current.reloadPart(1), 'reload_part'],
    ['Save', r => r.current.commitPart(1), 'commit_part'],
  ]

  for (const [name, act_, command] of calls) {
    it(`${name} writes the pending edits first, and only then goes to the file`, async () => {
      const h = held()
      const { result } = harness({ flush: h.flush })
      await act(async () => {})
      let done!: Promise<void>
      await act(async () => { done = act_(result) })
      expect(h.flush).toHaveBeenCalledTimes(1)
      expect(h.commands()).not.toContain(command)
      await act(async () => { h.release(); await done })
      expect(h.commands()).toContain(command)
    })
  }

  it('Save All writes the pending edits first', async () => {
    const h = held()
    const { result } = harness({ flush: h.flush })
    act(() => result.current.adoptBankState(0b0001, [1, 0, 0, 0]))
    let done!: Promise<void>
    await act(async () => { done = result.current.commitAllParts() })
    expect(h.commands()).not.toContain('commit_all_parts')
    await act(async () => { h.release(); await done })
    expect(h.commands()).toContain('commit_all_parts')
  })

  it('works for an editor that has nothing to flush', async () => {
    const { result } = harness()
    await act(() => result.current.revertValues(0, ['/part/amps/0/atk'], 'Reload saved T1 AMP ATK'))
    expect(invokeMock).toHaveBeenCalledWith('revert_part_values', expect.anything())
  })
})

describe('the diffs window actions', () => {
  /** An FX1 type change on T1 plus an AMP ATK edit on T1. */
  const typeAndAmp = () => copiesWith(c => { c.part.fxs[0].fx1_type = 18; c.part.amps[0].atk = 40 })

  const open = (over: Partial<PartCommitState> = {}) => {
    const state = commitState({
      diffsFor: 0,
      modifiedPartIds: new Set([0]),
      readCopies: vi.fn().mockResolvedValue(typeAndAmp()),
      ...over,
    })
    renderControls(state)
    return state
  }
  const dialog = () => screen.findByRole('dialog')

  it('a type change reads as one group, its parameters under it', async () => {
    open()
    const d = await dialog()
    await within(d).findByRole('button', { name: 'Reload saved T1 FX1' })
    expect(d.querySelectorAll('tr.part-changes-head')).toHaveLength(1)
    const members = d.querySelectorAll('tr.part-changes-member')
    expect(members.length).toBeGreaterThan(0)
    // Only the head and the plain row carry actions
    expect(within(d).getAllByRole('button', { name: /^Reload saved / })).toHaveLength(2)
    expect(within(d).getAllByRole('button', { name: /^Pin / })).toHaveLength(2)
    expect(d.querySelector('.part-changes-member .fa-rotate-left')).toBeNull()
  })

  it('Reload saved on the group sends the type and every saved position', async () => {
    const state = open()
    const d = await dialog()
    const btn = within(d).getByRole('button', { name: 'Reload saved T1 FX1' })
    await userEvent.setup().click(btn)
    const [part, paths, label] = (state.revertValues as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(part).toBe(0)
    expect(label).toBe('Reload saved T1 FX1')
    expect(paths).toContain('/part/fxs/0/fx1_type')
    expect(paths).toContain('/part/fxs/0/fx1_param1')
  })

  it('no value is pinned until asked: every pin starts off', async () => {
    open()
    const d = await dialog()
    for (const pin of within(d).getAllByRole('button', { name: /^Pin / })) {
      expect(pin).toHaveAttribute('aria-pressed', 'false')
    }
    expect(d.querySelectorAll('.fa-lock, .part-changes-action.pinned')).toHaveLength(0)
  })

  it('Pin on a plain row sends its value', async () => {
    const state = open()
    const d = await dialog()
    await userEvent.setup().click(within(d).getByRole('button', { name: 'Pin T1 AMP ATK' }))
    expect(state.lockValues).toHaveBeenCalledWith(0, ['/part/amps/0/atk'], [])
  })

  it('a pinned row lights its one pin, which unpins it, and cannot be reloaded', async () => {
    const state = open({ locks: [['/part/amps/0/atk'], [], [], []] })
    const d = await dialog()
    const pin = await within(d).findByRole('button', { name: 'Unpin T1 AMP ATK' })
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(pin.closest('tr')!.querySelectorAll('.fa-thumbtack')).toHaveLength(1)
    expect(within(d).queryByRole('button', { name: 'Pin T1 AMP ATK' })).toBeNull()
    expect(within(d).getByRole('button', { name: 'Reload saved T1 AMP ATK' })).toBeDisabled()
    await userEvent.setup().click(pin)
    expect(state.lockValues).toHaveBeenCalledWith(0, [], ['/part/amps/0/atk'])
  })

  it('the cross above the pins unpins every value of the Part', async () => {
    const locks = [['/part/amps/0/atk', '/part/fxs/0/fx1_param3'], [], [], []]
    const state = open({ locks })
    const d = await dialog()
    await userEvent.setup().click(within(d).getByRole('button', { name: 'Unpin all values of PART 1' }))
    expect(state.lockValues).toHaveBeenCalledWith(0, [], locks[0])
  })

  it('the cross is only there while something is pinned', async () => {
    open()
    expect(within(await dialog()).queryByRole('button', { name: 'Unpin all values of PART 1' })).toBeNull()
  })

  it('a row put back as saved stays listed, both sides alike, until the window closes', async () => {
    const readCopies = vi.fn()
      .mockResolvedValueOnce(typeAndAmp())
      // Re-read after the revert: only the FX1 change is left
      .mockResolvedValueOnce(copiesWith(c => { c.part.fxs[0].fx1_type = 18 }))
    open({ readCopies })
    const d = await dialog()
    await userEvent.setup().click(within(d).getByRole('button', { name: 'Reload saved T1 AMP ATK' }))
    await waitFor(() => expect(d.querySelector('tr.part-changes-settled')).not.toBeNull())
    const row = d.querySelector('tr.part-changes-settled') as HTMLElement
    expect(row.querySelector('.part-changes-current')!.textContent)
      .toBe(row.querySelector('.part-changes-saved')!.textContent)
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('right-clicking a row offers Go to param, which closes the window and goes there', async () => {
    const goTo = vi.fn()
    const state = open({ goTo })
    const d = await dialog()
    const row = within(d).getByRole('button', { name: 'Pin T1 AMP ATK' }).closest('tr')!
    fireEvent.contextMenu(row)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent?.trim()))
      .toEqual(['Go to param', 'Reload saved value', 'Pin value - Exclude it from Part reload'])
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Go to param' }))
    expect(state.hideDiffs).toHaveBeenCalled()
    expect(goTo).toHaveBeenCalledWith(0, ['/part/amps/0/atk'])
  })

  it('the row menu pins and reloads like the row buttons, and Go to param waits for an editor', async () => {
    const state = open()
    const d = await dialog()
    fireEvent.contextMenu(within(d).getByRole('button', { name: 'Pin T1 AMP ATK' }).closest('tr')!)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Go to param' })).toBeDisabled()
    await userEvent.setup().click(within(menu).getByRole('menuitem', { name: /Pin value/ }))
    expect(state.lockValues).toHaveBeenCalledWith(0, ['/part/amps/0/atk'], [])
  })

  it('the window\'s Reload names the pinned count', async () => {
    open({ locks: [['/part/amps/0/atk', '/part/amps/0/hold'], [], [], []] })
    expect(within(await dialog()).getByRole('button', { name: 'Reload PART 1' }))
      .toHaveAttribute('title', 'Reload puts the Saved values back, except 2 pinned values')
  })

  it('reads both copies again after an action', async () => {
    const state = open()
    const d = await dialog()
    await userEvent.setup().click(within(d).getByRole('button', { name: 'Pin T1 AMP ATK' }))
    expect(state.readCopies).toHaveBeenCalledTimes(2)
  })

  it('writes pending edits before reading the copies it lists', async () => {
    const order: string[] = []
    open({
      flushEdits: () => { order.push('flush'); return Promise.resolve() },
      readCopies: vi.fn(async () => { order.push('read'); return typeAndAmp() }),
    })
    await dialog()
    expect(order).toEqual(['flush', 'read'])
  })

  it('refuses Reload saved and Pin while a write is in flight', async () => {
    open({ isCommitting: true })
    const d = await dialog()
    expect(within(d).getByRole('button', { name: 'Reload saved T1 AMP ATK' })).toBeDisabled()
    expect(within(d).getByRole('button', { name: 'Pin T1 AMP ATK' })).toBeDisabled()
  })

  it('refuses Unpin and Unpin all while a write is in flight', async () => {
    open({ isReloading: true, locks: [['/part/amps/0/atk'], [], [], []] })
    const d = await dialog()
    expect(within(d).getByRole('button', { name: 'Unpin T1 AMP ATK' })).toBeDisabled()
    expect(within(d).getByRole('button', { name: 'Unpin all values of PART 1' })).toBeDisabled()
  })

  it('refuses every action between an action and the end of its re-read', async () => {
    let finishRead!: (c: PartCopies) => void
    const readCopies = vi.fn()
      .mockResolvedValueOnce(typeAndAmp())
      .mockReturnValueOnce(new Promise<PartCopies>(r => { finishRead = r }))
    open({ readCopies, locks: [['/part/amps/0/atk'], [], [], []] })
    const d = await dialog()
    await userEvent.setup().click(within(d).getByRole('button', { name: 'Reload saved T1 FX1' }))
    expect(within(d).getByRole('button', { name: 'Reload saved T1 FX1' })).toBeDisabled()
    expect(within(d).getByRole('button', { name: 'Unpin T1 AMP ATK' })).toBeDisabled()
    expect(within(d).getByRole('button', { name: 'Unpin all values of PART 1' })).toBeDisabled()
    await act(async () => { finishRead(typeAndAmp()) })
    expect(within(d).getByRole('button', { name: 'Reload saved T1 FX1' })).toBeEnabled()
  })
})
