import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook } from '@testing-library/react'
import { usePartCommits, PartSaveControls, PartCommitState } from './PartSaveControls'
import { WriteStatus } from '../types/writeStatus'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

const NAMES = ['PART 1', 'GROOVE', 'PART 3', 'PART 4']

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
  it('writes nothing when nothing was edited', async () => {
    const { result } = harness()
    await act(() => result.current.commitAllParts())
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('asks the device once for the whole bank', async () => {
    const { result } = harness()
    act(() => result.current.adoptBankState(0b0101, [0, 0, 0, 0]))
    await act(() => result.current.commitAllParts())
    expect(invokeMock.mock.calls).toEqual([
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

  const idle = (over: Partial<PartCommitState> = {}): PartCommitState => ({
    modifiedPartIds: new Set<number>(),
    partsSavedState: [0, 0, 0, 0],
    isCommitting: false,
    isReloading: false,
    commitPart: vi.fn(),
    commitAllParts: vi.fn(),
    reloadPart: vi.fn(),
    markModified: vi.fn(),
    adoptBankState: vi.fn(),
    ...over,
  })

  const button = (name: 'Reload' | 'Save' | 'Save All') =>
    screen.getByRole('button', { name })

  it('offers all three, in the device order', () => {
    render(<Buttons state={idle()} />)
    expect(screen.getAllByRole('button').map(b => b.textContent))
      .toEqual(['Reload', 'Save', 'Save All'])
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
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('shows itself in Edit mode', () => {
    const { container } = render(<Buttons state={idle()} visible />)
    expect(container.querySelector('.parts-edit-controls')).toHaveClass('visible')
  })
})
