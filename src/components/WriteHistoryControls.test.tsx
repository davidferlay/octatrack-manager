import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWriteHistory, WriteHistoryControls, HistoryState } from './WriteHistoryControls'
import { WriteStatus } from '../types/writeStatus'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

const NOTHING: HistoryState = {
  can_undo: false, can_redo: false, undo_label: null, redo_label: null,
}
const SOMETHING: HistoryState = {
  can_undo: true, can_redo: true, undo_label: 'Change scene 3', redo_label: 'Save part 1',
}

/** The backend answers `write_history_state`; everything else resolves to nothing. */
function backend(state: HistoryState, answers: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'write_history_state') return Promise.resolve(state)
    if (cmd in answers) return Promise.resolve(answers[cmd])
    return Promise.resolve(null)
  })
}

function harness(projectPath: string | null = '/test/project') {
  const statuses: WriteStatus[] = []
  let restored = 0
  const hook = renderHook(() => useWriteHistory({
    projectPath,
    onWriteStatusChange: s => statuses.push(s),
    onRestored: () => { restored += 1 },
  }))
  return { ...hook, statuses, restored: () => restored }
}

const commands = (cmd: string) => invokeMock.mock.calls.filter(([name]) => name === cmd)

beforeEach(() => {
  invokeMock.mockReset()
  backend(NOTHING)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => vi.useRealTimers())

describe('what the backend says is there', () => {
  it('asks for the project it was given', async () => {
    const { result } = harness()
    await act(async () => {})
    expect(commands('write_history_state')[0][1]).toEqual({ path: '/test/project' })
    expect(result.current.state).toEqual(NOTHING)
  })

  it('takes what the backend reports', async () => {
    backend(SOMETHING)
    const { result } = harness()
    await act(async () => {})
    expect(result.current.state).toEqual(SOMETHING)
  })

  it('asks nothing without a project, and offers nothing', async () => {
    const { result } = harness(null)
    await act(async () => {})
    expect(commands('write_history_state')).toEqual([])
    expect(result.current.state).toEqual(NOTHING)
  })

  it('asks again when another project is opened', async () => {
    const { rerender } = renderHook(
      ({ projectPath }: { projectPath: string }) => useWriteHistory({ projectPath }),
      { initialProps: { projectPath: '/one' } },
    )
    await act(async () => {})
    rerender({ projectPath: '/other' })
    await act(async () => {})
    expect(commands('write_history_state').map(([, args]) => args))
      .toEqual([{ path: '/one' }, { path: '/other' }])
  })

  /** A backend that answers nothing is one with no history, not a crash. */
  it('offers nothing when the backend answers nothing', async () => {
    backend(null as unknown as HistoryState)
    const { result } = harness()
    await act(async () => {})
    expect(result.current.state).toEqual(NOTHING)
  })

  it('offers nothing when the backend fails', async () => {
    invokeMock.mockImplementation(() => Promise.reject('no such project'))
    const { result } = harness()
    await act(async () => {})
    expect(result.current.state).toEqual(NOTHING)
  })
})

describe('taking a write back', () => {
  beforeEach(() => backend(SOMETHING, { undo_write: 'Change scene 3' }))

  it('asks the backend, for this project', async () => {
    const { result } = harness()
    await act(async () => {})
    await act(async () => { result.current.undo() })
    expect(commands('undo_write')).toEqual([['undo_write', { path: '/test/project' }]])
  })

  it('tells the page everything has to be read again', async () => {
    const h = harness()
    await act(async () => {})
    await act(async () => { h.result.current.undo() })
    expect(h.restored()).toBe(1)
  })

  it('says what it took back', async () => {
    const { result, statuses } = harness()
    await act(async () => {})
    await act(async () => { result.current.undo() })
    expect(statuses.map(s => s.message)).toEqual([
      'Undoing the last change...', 'Undone: Change scene 3',
    ])
  })

  it('goes back to idle once the message has been read', async () => {
    const { result, statuses } = harness()
    await act(async () => {})
    await act(async () => { result.current.undo() })
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(statuses[statuses.length - 1].state).toBe('idle')
  })

  it('re-reads what is left to take back', async () => {
    const { result } = harness()
    await act(async () => {})
    const before = commands('write_history_state').length
    await act(async () => { result.current.undo() })
    expect(commands('write_history_state').length).toBeGreaterThan(before)
  })

  it('does nothing without a project', async () => {
    const { result } = harness(null)
    await act(async () => {})
    await act(async () => { result.current.undo() })
    expect(commands('undo_write')).toEqual([])
  })

  /** Nothing to take back: no re-read of the panels, and no claim that it happened. */
  it('leaves the page alone when there was nothing to take back', async () => {
    backend(SOMETHING, { undo_write: null })
    const h = harness()
    await act(async () => {})
    await act(async () => { h.result.current.undo() })
    expect(h.restored()).toBe(0)
    expect(h.statuses[h.statuses.length - 1].state).toBe('idle')
  })

  it('says so when the backend refuses', async () => {
    invokeMock.mockImplementation((cmd: string) => (cmd === 'write_history_state'
      ? Promise.resolve(SOMETHING)
      : Promise.reject('card is write protected')))
    const h = harness()
    await act(async () => {})
    await act(async () => { h.result.current.undo() })
    expect(h.statuses[h.statuses.length - 1]).toEqual({
      state: 'error', message: 'Undoing failed',
    })
    expect(h.restored()).toBe(0)
  })

  it('is busy while it works, and not afterwards', async () => {
    let release = () => {}
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'write_history_state') return Promise.resolve(SOMETHING)
      return new Promise(resolve => { release = () => resolve('Change scene 3') })
    })
    const { result } = harness()
    await act(async () => {})
    await act(async () => { result.current.undo() })
    expect(result.current.busy).toBe(true)
    await act(async () => { release(); await Promise.resolve() })
    expect(result.current.busy).toBe(false)
  })
})

describe('putting it back', () => {
  beforeEach(() => backend(SOMETHING, { redo_write: 'Save part 1' }))

  it('asks the backend to redo', async () => {
    const { result } = harness()
    await act(async () => {})
    await act(async () => { result.current.redo() })
    expect(commands('redo_write')).toEqual([['redo_write', { path: '/test/project' }]])
    expect(commands('undo_write')).toEqual([])
  })

  it('says what it put back', async () => {
    const { result, statuses } = harness()
    await act(async () => {})
    await act(async () => { result.current.redo() })
    expect(statuses.map(s => s.message)).toEqual([
      'Redoing the last change...', 'Redone: Save part 1',
    ])
  })
})

describe('the two buttons', () => {
  const state = (over: Partial<HistoryState> = {}) => ({
    state: { ...NOTHING, ...over },
    busy: false,
    refresh: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  })

  const button = (name: 'Undo' | 'Redo') => screen.getByRole('button', { name })

  it('is not there at all outside Edit mode', () => {
    const { container } = render(
      <WriteHistoryControls history={state()} visible={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('offers both, in order', () => {
    render(<WriteHistoryControls history={state()} visible />)
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label')))
      .toEqual(['Undo', 'Redo'])
  })

  it('refuses both with nothing to take back', () => {
    render(<WriteHistoryControls history={state()} visible />)
    expect(button('Undo')).toBeDisabled()
    expect(button('Redo')).toBeDisabled()
    expect(button('Undo')).toHaveAttribute('title', 'Nothing to undo in this project')
  })

  it('names what each would do', () => {
    render(<WriteHistoryControls history={state(SOMETHING)} visible />)
    expect(button('Undo')).toHaveAttribute('title', 'Undo: Change scene 3')
    expect(button('Redo')).toHaveAttribute('title', 'Redo: Save part 1')
  })

  it('offers one without the other', () => {
    render(<WriteHistoryControls
      history={state({ can_undo: true, undo_label: 'Change scene 3' })}
      visible
    />)
    expect(button('Undo')).toBeEnabled()
    expect(button('Redo')).toBeDisabled()
  })

  it('refuses both while one is in flight', () => {
    const busy = { ...state(SOMETHING), busy: true }
    render(<WriteHistoryControls history={busy} visible />)
    expect(button('Undo')).toBeDisabled()
    expect(button('Redo')).toBeDisabled()
  })

  it('acts when pressed', async () => {
    const history = state(SOMETHING)
    render(<WriteHistoryControls history={history} visible />)
    const user = userEvent.setup()
    await user.click(button('Undo'))
    await user.click(button('Redo'))
    expect(history.undo).toHaveBeenCalledTimes(1)
    expect(history.redo).toHaveBeenCalledTimes(1)
  })
})
