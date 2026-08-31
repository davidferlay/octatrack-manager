import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { ClearProjectPanel, describeClear } from './ClearProjectPanel'

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue(undefined as never)
})

const banks = Array.from({ length: 16 }, (_, i) => ({ name: `Bank ${String.fromCharCode(65 + i)}` }))

function renderPanel(props: Partial<React.ComponentProps<typeof ClearProjectPanel>> = {}) {
  const onBankUpdated = vi.fn()
  const onProjectRefresh = vi.fn()
  render(
    <ClearProjectPanel
      projectPath="/set/MyProject"
      banks={banks}
      loadedBankIndices={new Set([0, 1, 2, 3])}
      onBankUpdated={onBankUpdated}
      onProjectRefresh={onProjectRefresh}
      {...props}
    />
  )
  return { onBankUpdated, onProjectRefresh }
}

/** Click through the confirmation the tool always shows before clearing. */
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Execute/ }))
  await user.click(screen.getByRole('button', { name: 'Clear' }))
}

const callsTo = (cmd: string) => mockInvoke.mock.calls.filter(c => c[0] === cmd)

describe('ClearProjectPanel - scopes', () => {
  it('ctrl-click picks out individual banks', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.keyboard('{/Control}')
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(1))
    expect(callsTo('clear_banks')[0][1]).toEqual({ project: '/set/MyProject', bankIndices: [0, 2] })
  })

  it('a plain click replaces the selection rather than adding to it', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: 'C' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(1))
    expect(callsTo('clear_banks')[0][1]).toMatchObject({ bankIndices: [2] })
  })

  it('shift-click takes a range of banks', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.keyboard('{/Shift}')
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(1))
    expect(callsTo('clear_banks')[0][1]).toMatchObject({ bankIndices: [0, 1, 2] })
  })

  it('clears parts of one bank', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Parts' }))
    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_parts')).toHaveLength(1))
    expect(callsTo('clear_parts')[0][1]).toEqual({
      project: '/set/MyProject', bankIndex: 1, partIndices: [1],
    })
  })

  it('clears patterns of one bank', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Patterns' }))
    await user.click(screen.getByRole('button', { name: '3' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_patterns')).toHaveLength(1))
    // Bank falls back to the first loaded one (A) when none was picked.
    expect(callsTo('clear_patterns')[0][1]).toEqual({
      project: '/set/MyProject', bankIndex: 0, patternIndices: [2],
    })
  })

  it('clears every selected part when the Part cross says All', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    // Two "All" buttons in this scope: the Part cross, then the pattern grid.
    await user.click(screen.getAllByRole('button', { name: 'All' })[0])
    await user.click(screen.getByRole('button', { name: 'T1' }))
    await user.click(screen.getAllByRole('button', { name: 'All' })[1])
    await confirm(user)

    // One call per part - the command takes a single part at a time.
    await waitFor(() => expect(callsTo('clear_tracks')).toHaveLength(4))
    expect(callsTo('clear_tracks').map(c => (c[1] as { partIndex: number }).partIndex)).toEqual([0, 1, 2, 3])
  })

  it('clears tracks in the chosen patterns', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    await user.click(screen.getByRole('button', { name: 'T1' }))
    await user.click(screen.getByRole('button', { name: 'M3' }))
    await user.click(screen.getByRole('button', { name: '5' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_tracks')).toHaveLength(1))
    expect(callsTo('clear_tracks')[0][1]).toEqual({
      project: '/set/MyProject',
      bankIndex: 0,
      partIndex: 0,
      trackIndices: [0, 10],
      mode: 'both',
      patternIndices: [4],
    })
  })

  it('sends null rather than all sixteen when the whole pattern grid is picked', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    await user.click(screen.getByRole('button', { name: 'T1' }))
    await user.click(screen.getAllByRole('button', { name: 'All' })[1])
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_tracks')).toHaveLength(1))
    // One backend call that walks every pattern, not sixteen calls.
    expect(callsTo('clear_tracks')[0][1]).toMatchObject({ patternIndices: null })
  })

  it('blocks a trigger-mode clear until patterns are chosen', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    await user.click(screen.getByRole('button', { name: 'T1' }))

    const execute = screen.getByRole('button', { name: /Execute/ })
    expect(execute).toBeDisabled()
    expect(execute).toHaveAttribute('title', 'Select at least one pattern')
  })

  it('never asks for patterns in Part Parameters mode', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    await user.click(screen.getByRole('button', { name: 'T1' }))
    await user.click(screen.getByRole('button', { name: 'Part Parameters' }))
    // Sound design is pattern-independent, so the grid disappears entirely.
    expect(screen.queryByText('Pattern')).not.toBeInTheDocument()
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_tracks')).toHaveLength(1))
    expect(callsTo('clear_tracks')[0][1]).toMatchObject({ mode: 'part_params', patternIndices: null })
  })

  it('clears a range of sample slots of the chosen type', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Sample Slots' }))
    await user.click(screen.getByRole('button', { name: 'Static' }))
    await user.clear(screen.getByLabelText('First slot to clear'))
    await user.type(screen.getByLabelText('First slot to clear'), '3{Enter}')
    await user.clear(screen.getByLabelText('Last slot to clear'))
    await user.type(screen.getByLabelText('Last slot to clear'), '5{Enter}')
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_sample_slots')).toHaveLength(1))
    // 1-based on the wire, as the backend expects.
    expect(callsTo('clear_sample_slots')[0][1]).toEqual({
      path: '/set/MyProject', slotType: 'STATIC', slotIndices: [3, 4, 5],
    })
  })
})

describe('ClearProjectPanel - guards', () => {
  it('will not execute before anything is selected', () => {
    renderPanel()
    const execute = screen.getByRole('button', { name: /Execute/ })
    expect(execute).toBeDisabled()
    // The reason lives on the tooltip, not as a label under the button.
    expect(execute).toHaveAttribute('title', 'Select at least one bank to clear')
  })

  it('asks for confirmation and does nothing when it is declined', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: /Execute/ }))
    expect(screen.getByText(/factory-default state/)).toBeInTheDocument()
    // The backup reassurance lives with the decision, not in the pane.
    expect(screen.getByText(/Rewritten files are backed up/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(callsTo('clear_banks')).toHaveLength(0)
    expect(callsTo('backup_project_files')).toHaveLength(0)
  })

  it('keeps the backup note out of the pane until the confirmation', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(screen.queryByText(/Rewritten files are backed up/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: /Execute/ }))
    expect(screen.getByText(/Rewritten files are backed up/)).toBeInTheDocument()
  })

  it('cannot target a bank that is not on disk', () => {
    renderPanel({ loadedBankIndices: new Set([0]) })
    expect(screen.getByRole('button', { name: 'B' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'A' })).toBeEnabled()
  })

  it('reorders an inverted slot range instead of blocking on it', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Sample Slots' }))
    await user.clear(screen.getByLabelText('Last slot to clear'))
    await user.type(screen.getByLabelText('Last slot to clear'), '4{Enter}')
    await user.clear(screen.getByLabelText('First slot to clear'))
    await user.type(screen.getByLabelText('First slot to clear'), '9{Enter}')

    expect(screen.getByRole('button', { name: /Execute/ })).toBeEnabled()
    await confirm(user)
    await waitFor(() => expect(callsTo('clear_sample_slots')).toHaveLength(1))
    expect(callsTo('clear_sample_slots')[0][1]).toMatchObject({ slotIndices: [4, 5, 6, 7, 8, 9] })
  })
})

describe('ClearProjectPanel - side effects', () => {
  it('backs up the bank files it is about to rewrite', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.keyboard('{/Shift}')
    await confirm(user)

    await waitFor(() => expect(callsTo('backup_project_files')).toHaveLength(1))
    expect(callsTo('backup_project_files')[0][1]).toEqual({
      projectPath: '/set/MyProject',
      files: ['bank02.work', 'bank03.work'],
      label: 'clear_banks',
    })
  })

  it('backs up project.work when clearing sample slots', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Sample Slots' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('backup_project_files')).toHaveLength(1))
    expect(callsTo('backup_project_files')[0][1]).toMatchObject({
      files: ['project.work'], label: 'clear_sample_slots',
    })
  })

  it('reloads just the affected bank for a part clear', async () => {
    const user = userEvent.setup()
    const { onBankUpdated, onProjectRefresh } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'Parts' }))
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await confirm(user)

    await waitFor(() => expect(onBankUpdated).toHaveBeenCalledWith(2))
    expect(onProjectRefresh).not.toHaveBeenCalled()
  })

  it('reloads the whole project after clearing banks', async () => {
    const user = userEvent.setup()
    const { onBankUpdated, onProjectRefresh } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await confirm(user)

    await waitFor(() => expect(onProjectRefresh).toHaveBeenCalled())
    expect(onBankUpdated).not.toHaveBeenCalled()
  })

  it('reports a backend failure instead of claiming success', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'clear_banks') throw 'Bank 1 not found'
      return undefined as never
    })
    const { onProjectRefresh } = renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await confirm(user)

    expect(await screen.findByText(/Bank 1 not found/)).toBeInTheDocument()
    expect(onProjectRefresh).not.toHaveBeenCalled()
  })
})

describe('describeClear', () => {
  const base = {
    scope: 'banks' as const, bankIndices: [0, 1], bankIndex: 0, partIndices: [0],
    patternIndices: [0], trackIndices: [0], trackParts: [0],
    trackMode: 'both' as const,
    slotType: 'flex' as const, slotFrom: 1, slotTo: 128,
  }

  it('names the banks', () => {
    expect(describeClear(base)).toBe('2 banks (A, B)')
  })

  it('singularises', () => {
    expect(describeClear({ ...base, bankIndices: [3] })).toBe('1 bank (D)')
  })

  it('spells out what a track clear touches', () => {
    const all16 = Array.from({ length: 16 }, (_, i) => i)
    expect(describeClear({ ...base, scope: 'tracks', trackIndices: [0, 9], patternIndices: all16 }))
      .toBe('part parameters and pattern triggers of 2 tracks (T1, M2) in Bank A Part 1, all 16 patterns')
  })

  it('lists the patterns when it is not the whole grid', () => {
    expect(describeClear({ ...base, scope: 'tracks', patternIndices: [0, 4] }))
      .toBe('part parameters and pattern triggers of 1 track (T1) in Bank A Part 1, 2 patterns (1, 5)')
  })

  it('leaves patterns out of a part-parameters clear', () => {
    expect(describeClear({ ...base, scope: 'tracks', trackMode: 'part_params' }))
      .toBe('part parameters of 1 track (T1) in Bank A Part 1')
  })

  it('names the slot type and range', () => {
    expect(describeClear({ ...base, scope: 'sample_slots', slotType: 'static', slotFrom: 3, slotTo: 5 }))
      .toBe('3 Static sample slots (3-5)')
  })
})

describe('ClearProjectPanel - select all / none', () => {
  it('the bank None/All row covers only the banks that exist on disk', async () => {
    const user = userEvent.setup()
    renderPanel({ loadedBankIndices: new Set([0, 1, 2]) })
    await user.click(screen.getByRole('button', { name: 'All' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(1))
    expect(callsTo('clear_banks')[0][1]).toMatchObject({ bankIndices: [0, 1, 2] })
  })

  it('None clears the bank selection again', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: /Execute/ })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.getByRole('button', { name: /Execute/ })).toBeDisabled()
  })

  it('All Audio and All MIDI each fill their own half of the track grid', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    await user.click(screen.getByRole('button', { name: 'All Audio' }))
    await user.click(screen.getAllByRole('button', { name: 'All' })[1])
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_tracks')).toHaveLength(1))
    expect(callsTo('clear_tracks')[0][1]).toMatchObject({ trackIndices: [0, 1, 2, 3, 4, 5, 6, 7] })
  })

  it('track None empties the selection', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    await user.click(screen.getByRole('button', { name: 'All MIDI' }))
    expect(screen.getByRole('button', { name: /Execute/ }))
      .not.toHaveAttribute('title', 'Select at least one track')

    await user.click(screen.getAllByRole('button', { name: 'None' })[0])
    const execute = screen.getByRole('button', { name: /Execute/ })
    expect(execute).toBeDisabled()
    expect(execute).toHaveAttribute('title', 'Select at least one track')
  })

  it('the pattern All row selects all 16', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Patterns' }))
    // Only the multi-select Banks scope carries a bank None/All row.
    await user.click(screen.getByRole('button', { name: 'All' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_patterns')).toHaveLength(1))
    expect(callsTo('clear_patterns')[0][1]).toMatchObject({
      patternIndices: Array.from({ length: 16 }, (_, i) => i),
    })
  })
})

describe('ClearProjectPanel - sample slot widget', () => {
  async function slotsScope(user: ReturnType<typeof userEvent.setup>) {
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Sample Slots' }))
  }

  it('clears both pools when Slot Type is Both', async () => {
    const user = userEvent.setup()
    await slotsScope(user)
    await user.click(screen.getByRole('button', { name: 'Both' }))
    await user.click(screen.getByRole('button', { name: 'One' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_sample_slots')).toHaveLength(2))
    expect(callsTo('clear_sample_slots').map(c => (c[1] as { slotType: string }).slotType))
      .toEqual(['FLEX', 'STATIC'])
  })

  it('One pins the range to a single slot', async () => {
    const user = userEvent.setup()
    await slotsScope(user)
    expect(screen.getByText('128')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'One' }))
    expect(screen.getByText('1')).toBeInTheDocument()
    // The second field goes away: there is no "to" in One mode.
    expect(screen.queryByLabelText('Last slot to clear')).not.toBeInTheDocument()

    await confirm(user)
    await waitFor(() => expect(callsTo('clear_sample_slots')).toHaveLength(1))
    expect(callsTo('clear_sample_slots')[0][1]).toMatchObject({ slotIndices: [1] })
  })

  it('Range brings the second handle back', async () => {
    const user = userEvent.setup()
    await slotsScope(user)
    await user.click(screen.getByRole('button', { name: 'One' }))
    await user.click(screen.getByRole('button', { name: 'Range' }))
    expect(screen.getByLabelText('Last slot to clear')).toBeInTheDocument()
  })

  it('the sliders drive the same range as the inputs', async () => {
    const user = userEvent.setup()
    await slotsScope(user)
    fireEvent.change(screen.getByLabelText('First slot to clear (slider)'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Last slot to clear (slider)'), { target: { value: '12' } })

    expect(screen.getByLabelText('First slot to clear')).toHaveValue('10')
    expect(screen.getByLabelText('Last slot to clear')).toHaveValue('12')
    await confirm(user)
    await waitFor(() => expect(callsTo('clear_sample_slots')).toHaveLength(1))
    expect(callsTo('clear_sample_slots')[0][1]).toMatchObject({ slotIndices: [10, 11, 12] })
  })

  it('a slider handle cannot cross the other', async () => {
    const user = userEvent.setup()
    await slotsScope(user)
    fireEvent.change(screen.getByLabelText('Last slot to clear (slider)'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('First slot to clear (slider)'), { target: { value: '20' } })

    // Rejected: 20 is past the max handle, so the range stays 1-5.
    expect(screen.getByLabelText('First slot to clear')).toHaveValue('1')
    expect(screen.getByLabelText('Last slot to clear')).toHaveValue('5')
  })
})

describe('ClearProjectPanel - bank targeting', () => {
  it('falls back to the first bank that exists, not to Bank A', async () => {
    const user = userEvent.setup()
    // A project whose first four banks were never created.
    renderPanel({ loadedBankIndices: new Set([4, 5]) })
    await user.click(screen.getByRole('button', { name: 'Patterns' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_patterns')).toHaveLength(1))
    expect(callsTo('clear_patterns')[0][1]).toMatchObject({ bankIndex: 4 })
  })

  it('blocks every bank-scoped clear when the project has no banks at all', async () => {
    const user = userEvent.setup()
    renderPanel({ loadedBankIndices: new Set() })
    await user.click(screen.getByRole('button', { name: 'Patterns' }))

    const execute = screen.getByRole('button', { name: /Execute/ })
    expect(execute).toBeDisabled()
    expect(execute).toHaveAttribute('title', 'Select a bank')
  })

  it('clicking the selected bank again deselects it', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Parts' }))
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.click(screen.getByRole('button', { name: 'C' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await confirm(user)

    // Back to the fallback bank, not stuck on C.
    await waitFor(() => expect(callsTo('clear_parts')).toHaveLength(1))
    expect(callsTo('clear_parts')[0][1]).toMatchObject({ bankIndex: 0 })
  })

  it('backs up only the targeted bank for a scoped clear', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Patterns' }))
    await user.click(screen.getByRole('button', { name: 'D' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('backup_project_files')).toHaveLength(1))
    expect(callsTo('backup_project_files')[0][1]).toEqual({
      projectPath: '/set/MyProject',
      files: ['bank04.work'],
      label: 'clear_patterns',
    })
  })
})

describe('ClearProjectPanel - scope isolation', () => {
  it('switching scope does not carry the previous selection into the call', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: 'Parts' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_parts')).toHaveLength(1))
    // The banks-scope selection must not have leaked into a parts clear.
    expect(callsTo('clear_banks')).toHaveLength(0)
    expect(callsTo('clear_parts')[0][1]).toMatchObject({ partIndices: [0] })
  })

  it('sends exactly one command per Execute', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await confirm(user)

    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(1))
    const clears = mockInvoke.mock.calls.filter(c => String(c[0]).startsWith('clear_'))
    expect(clears).toHaveLength(1)
  })

  it('leaves the selection alone after a run so it can be repeated', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'B' }))
    await confirm(user)
    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(1))

    // Still armed on Bank B: a second Execute clears the same target.
    await confirm(user)
    await waitFor(() => expect(callsTo('clear_banks')).toHaveLength(2))
    expect(callsTo('clear_banks')[1][1]).toMatchObject({ bankIndices: [1] })
  })

  it('does not run the command when the backup fails', async () => {
    const user = userEvent.setup()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'backup_project_files') throw 'disk full'
      return undefined as never
    })
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'A' }))
    await confirm(user)

    expect(await screen.findByText(/disk full/)).toBeInTheDocument()
    expect(callsTo('clear_banks')).toHaveLength(0)
  })
})
