import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { SampleSlotsTable } from './SampleSlotsTable'
import { TablePreferencesProvider } from '../context/TablePreferencesContext'

const mockInvoke = vi.mocked(invoke)

const mockSlots = [
  {
    slot_id: 1,
    slot_type: 'flex',
    path: 'samples/kick.wav',
    gain: 72,
    loop_mode: 'Off',
    timestretch_mode: 'Off',
    source_location: 'Project',
    file_exists: true,
    compatibility: 'compatible',
    file_format: 'WAV',
    bit_depth: 16,
    sample_rate: 44100,
  },
  {
    slot_id: 2,
    slot_type: 'flex',
    path: null,
    gain: null,
    loop_mode: null,
    timestretch_mode: null,
    source_location: null,
    file_exists: false,
    compatibility: null,
    file_format: null,
    bit_depth: null,
    sample_rate: null,
  },
  {
    slot_id: 3,
    slot_type: 'flex',
    path: 'samples/snare.wav',
    gain: 64,
    loop_mode: 'On',
    timestretch_mode: 'Normal',
    source_location: 'Project',
    file_exists: true,
    compatibility: 'compatible',
    file_format: 'AIFF',
    bit_depth: 24,
    sample_rate: 44100,
  },
]

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <TablePreferencesProvider>{ui}</TablePreferencesProvider>
    </MemoryRouter>
  )
}

describe('SampleSlotsTable', () => {
  it('renders slot rows from props', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByText('kick.wav')).toBeInTheDocument()
    expect(screen.getByText('snare.wav')).toBeInTheDocument()
  })

  it('renders table with slot and sample columns', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    // Table headers — check for th elements with class names
    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    // Verify slot data renders in the table
    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.getByText('kick.wav')).toBeInTheDocument()
  })

  it('shows slot prefix with slot id', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.getByText('F3')).toBeInTheDocument()
  })

  it('has search input', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('has copy button', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByTitle(/copy/i)).toBeInTheDocument()
  })

  it('shows Flex RAM badge when memorySettings is provided', () => {
    renderWithProvider(
      <SampleSlotsTable
        slots={mockSlots}
        slotPrefix="F"
        tableType="flex"
        memorySettings={{ record_24bit: false, reserved_recorder_count: 8, reserved_recorder_length: 16, flex_ram_free_mb: 42.5 }}
      />
    )
    // Default settings: 8 recorders × 16s × 44100 × 2 × 2 = 90,316,800 → exceeds total → 0 MB
    // Actually: 89,652,480 - 90,316,800 = clamped to 0
    // Let's just check the badge exists with "MB RAM"
    expect(screen.getByTitle(/Flex RAM available/i)).toBeInTheDocument()
  })

  it('does not show Flex RAM badge when memorySettings is omitted', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="S" tableType="static" />
    )
    expect(screen.queryByTitle(/Flex RAM available/i)).not.toBeInTheDocument()
  })

  it('shows the OT-calculated Size column only after enabling it in the column menu', async () => {
    const slotsWithSize = [{ ...mockSlots[0], ot_size_bytes: 400 }]
    renderWithProvider(
      <SampleSlotsTable slots={slotsWithSize} slotPrefix="F" tableType="flex" />
    )
    // Hidden by default
    expect(screen.queryByText('400 B')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTitle('Show/Hide Columns'))
    await userEvent.click(screen.getByText('Size'))
    expect(screen.getByText('400 B')).toBeInTheDocument()
  })
})

describe('SampleSlotsTable — Audio Pool integration', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    // expand_audio_paths echoes its input (a dropped audio file expands to itself); other commands return [].
    mockInvoke.mockImplementation(async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
      return cmd === 'expand_audio_paths' ? (a.paths ?? []) : []
    })
  })

  it('shows the Audio Pool toggle when audioPoolPath is provided', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" audioPoolPath="/set/AUDIO" />
    )
    expect(screen.getByTitle(/Show Audio Pool/i)).toBeInTheDocument()
  })

  it('hides the Audio Pool toggle when no audioPoolPath is provided', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.queryByTitle(/Show Audio Pool/i)).not.toBeInTheDocument()
  })

  it('keeps the Audio Pool toggle enabled in view mode (browsing allowed without edit mode)', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode={false} audioPoolPath="/set/AUDIO" />
    )
    expect(screen.getByTitle(/Show Audio Pool/i)).toBeEnabled()
  })

  it('reduces the slots table to essential columns when the Audio Pool pane opens, and restores on close', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode audioPoolPath="/set/AUDIO" />
    )
    // Non-essential columns are visible by default
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Gain')).toBeInTheDocument()

    await user.click(screen.getByTitle(/Show Audio Pool/i))

    // After opening: only Slot/Sample/Compat/Status remain
    await waitFor(() => expect(screen.queryByText('Source')).not.toBeInTheDocument())
    expect(screen.queryByText('Gain')).not.toBeInTheDocument()
    expect(screen.getByText('Sample')).toBeInTheDocument()
    expect(screen.getByText('Compat')).toBeInTheDocument()

    // Closing restores the previous column set
    await user.click(screen.getByTitle(/Hide Audio Pool/i))
    await waitFor(() => expect(screen.getByText('Source')).toBeInTheDocument())
    expect(screen.getByText('Gain')).toBeInTheDocument()
  })

  it("keyboard 'a' toggles the Audio Pool pane", async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" audioPoolPath="/set/AUDIO" />
    )
    expect(screen.queryByTitle(/Hide Audio Pool/i)).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'a' })
    await waitFor(() => expect(screen.getByTitle(/Hide Audio Pool/i)).toBeInTheDocument())
  })

  it('Delete clears the selected slot(s) in edit mode', async () => {
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 })
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    await userEvent.click(screen.getByText('kick.wav').closest('tr')!) // select F1
    fireEvent.keyDown(document, { key: 'Delete' })
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('clear_sample_keep_attributes', expect.objectContaining({ slotIndices: [1] }))
    )
  })

  it('does not assign a dropped sample and warns when not in edit mode', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode={false} projectPath="/proj" audioPoolPath="/set/AUDIO" />
    )
    const row = screen.getByText('F1').closest('tr')!
    const dataTransfer = {
      getData: (key: string) =>
        key === 'application/json'
          ? JSON.stringify({ source: 'audio-pool-sidebar', files: ['/set/AUDIO/kick.wav'] })
          : '',
    }
    fireEvent.drop(row, { dataTransfer })

    await waitFor(() => expect(screen.getByText(/Toggle Edit mode to assign samples/i)).toBeInTheDocument())
    expect(mockInvoke).not.toHaveBeenCalledWith('assign_samples_to_slots', expect.anything())
  })

  it('assigns a dropped sample when in edit mode', async () => {
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 })
    const onSlotsUpdated = vi.fn()
    renderWithProvider(
      <SampleSlotsTable
        slots={mockSlots}
        slotPrefix="F"
        tableType="flex"
        isEditMode
        projectPath="/proj"
        audioPoolPath="/set/AUDIO"
        onSlotsUpdated={onSlotsUpdated}
      />
    )
    const row = screen.getByText('F2').closest('tr')! // empty slot
    const dataTransfer = {
      getData: (key: string) =>
        key === 'application/json'
          ? JSON.stringify({ source: 'audio-pool-sidebar', files: ['/set/AUDIO/kick.wav'] })
          : '',
    }
    fireEvent.drop(row, { dataTransfer })

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('assign_samples_to_slots', expect.objectContaining({ path: '/proj' }))
    )
  })
})

describe('SampleSlotsTable — slot context menu & Audio Pool page button', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 })
  })

  it('shows the Open-Audio-Pool-page button inside the pane only when audioPoolPath is set', async () => {
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'list_audio_directory' ? [] : { assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 }
    )
    const user = userEvent.setup()
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" audioPoolPath="/set/AUDIO" />
    )
    // Button lives inside the Audio Pool pane — open it first
    await user.click(screen.getByTitle(/Show Audio Pool/i))
    await waitFor(() => expect(screen.getByTitle(/Open the Audio Pool page/i)).toBeInTheDocument())
  })

  it('does not show the Audio Pool pane (nor its page button) without audioPoolPath', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.queryByTitle(/Show Audio Pool/i)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Open the Audio Pool page/i)).not.toBeInTheDocument()
  })

  it('right-clicking a slot opens the context menu; clear/reset disabled in view mode', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode={false} projectPath="/proj" />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    fireEvent.contextMenu(row)
    const clear = screen.getByText('Clear sample')
    expect(clear).toBeDisabled()
    expect(screen.getByText('Reset attributes to defaults')).toBeDisabled()
    expect(clear.getAttribute('title')).toMatch(/Toggle Edit mode/i)
  })

  it('reveals a slot sample in the file explorer via the context menu (allowed in view mode)', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode={false} projectPath="/proj" />
    )
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText(/Open in file explorer/i))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('reveal_in_file_manager', { path: '/proj/samples/kick.wav' })
    )
  })

  it('disables "Open in file explorer" for an empty slot', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    // mockSlots[1] (F2) is empty
    fireEvent.contextMenu(screen.getByText('F2').closest('tr')!)
    expect(screen.getByText(/Open in file explorer/i)).toBeDisabled()
  })

  it('enables "Reset attributes" for an empty slot in edit mode (attributes are slot-tied)', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    fireEvent.contextMenu(screen.getByText('F2').closest('tr')!) // empty slot
    expect(screen.getByText('Reset attributes to defaults')).not.toBeDisabled()
  })

  it('clears a slot sample via the context menu in edit mode', async () => {
    const onSlotsUpdated = vi.fn()
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [{ ...mockSlots[1] }], flex_ram_free_mb: 90 })
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" onSlotsUpdated={onSlotsUpdated} />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    fireEvent.contextMenu(row)
    await userEvent.click(screen.getByText('Clear sample'))

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('clear_sample_keep_attributes', expect.objectContaining({ path: '/proj', slotType: 'FLEX', slotIndices: [1] }))
    )
  })

  it('resets slot attributes via the context menu (reset_slot_attributes by slot index)', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    fireEvent.contextMenu(row)
    await userEvent.click(screen.getByText('Reset attributes to defaults'))

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('reset_slot_attributes', expect.objectContaining({
        path: '/proj',
        slotType: 'FLEX',
        slotIndices: [1],
      }))
    )
  })

  it('clears all selected slots from the context menu when multiple are selected', async () => {
    mockInvoke.mockResolvedValue({ assigned_count: 2, updated_slots: [], flex_ram_free_mb: 90 })
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    fireEvent.click(screen.getByText('kick.wav').closest('tr')!) // select F1
    fireEvent.click(screen.getByText('snare.wav').closest('tr')!, { ctrlKey: true }) // add F3
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText('Clear samples')) // plural label when multi-selected
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('clear_sample_keep_attributes', expect.objectContaining({ slotIndices: [1, 3] }))
    )
  })

  it('resets attributes for all selected slots from the context menu', async () => {
    mockInvoke.mockResolvedValue({ assigned_count: 2, updated_slots: [], flex_ram_free_mb: 90 })
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    fireEvent.click(screen.getByText('kick.wav').closest('tr')!)
    fireEvent.click(screen.getByText('snare.wav').closest('tr')!, { ctrlKey: true })
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText('Reset attributes to defaults'))
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('reset_slot_attributes', expect.objectContaining({
        slotIndices: [1, 3],
      }))
    )
  })

  it('offers "Clear sample & reset attributes" only for a slot with a sample (edit mode)', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!) // filled slot
    expect(screen.getByText('Clear sample & reset attributes')).not.toBeDisabled()
    fireEvent.contextMenu(screen.getByText('F2').closest('tr')!) // empty slot
    expect(screen.getByText('Clear sample & reset attributes')).toBeDisabled()
  })

  it('"Clear sample & reset attributes" resets attributes then removes the slot block', async () => {
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [], flex_ram_free_mb: 90 })
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText('Clear sample & reset attributes'))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('reset_slot_attributes', expect.objectContaining({ slotIndices: [1] }))
      expect(mockInvoke).toHaveBeenCalledWith('clear_sample_slots', expect.objectContaining({ slotIndices: [1] }))
    })
  })

  it('Delete on a slot without a sample resets its attributes (instead of clearing)', async () => {
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 })
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    await userEvent.click(screen.getByText('F2').closest('tr')!) // select empty F2
    fireEvent.keyDown(document, { key: 'Delete' })
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('reset_slot_attributes', expect.objectContaining({ slotIndices: [2] }))
    )
  })
})

describe('SampleSlotsTable — selection & transfers toggle', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue({ assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 })
  })

  it('selects a slot row on click (no count badge shown)', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" projectPath="/proj" />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    expect(row.className).not.toMatch(/selected/)
    await userEvent.click(row)
    expect(row.className).toMatch(/selected/)
    // No "N selected" count badge in the toolbar
    expect(screen.queryByText(/\d+ selected/i)).not.toBeInTheDocument()
  })

  it('renders the transfers toggle with a count and fires the callback', async () => {
    const onToggleTransfers = vi.fn()
    renderWithProvider(
      <SampleSlotsTable
        slots={mockSlots}
        slotPrefix="F"
        tableType="flex"
        projectPath="/proj"
        transferCount={3}
        onToggleTransfers={onToggleTransfers}
      />
    )
    const btn = screen.getByTitle(/transfers/i)
    expect(btn).toHaveTextContent('3')
    await userEvent.click(btn)
    expect(onToggleTransfers).toHaveBeenCalled()
  })

  it('does not render the transfers toggle without an onToggleTransfers handler', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" projectPath="/proj" />
    )
    expect(screen.queryByTitle(/transfers/i)).not.toBeInTheDocument()
  })

  it('imports a directory to a slot through the transfer pipeline (onImportToProject)', async () => {
    const openModule = await import('@tauri-apps/plugin-dialog')
    vi.mocked(openModule.open).mockResolvedValue('/ext/drums')
    // list_audio_files_recursive returns the folder's audio files
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return ['/ext/drums/a.wav', '/ext/drums/b.wav']
      return { assigned_count: 2, updated_slots: [], flex_ram_free_mb: 70 }
    })
    const onImportToProject = vi.fn(async () => ['/proj/a.wav', '/proj/b.wav'])
    renderWithProvider(
      <SampleSlotsTable
        slots={mockSlots}
        slotPrefix="F"
        tableType="flex"
        isEditMode
        projectPath="/proj"
        onImportToProject={onImportToProject}
      />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    fireEvent.contextMenu(row)
    await userEvent.click(screen.getByText(/Import audio directory from system/i))

    // Files are copied via the transfer pipeline, then assigned
    await waitFor(() => expect(onImportToProject).toHaveBeenCalledWith(['/ext/drums/a.wav', '/ext/drums/b.wav']))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('assign_samples_to_slots', expect.anything()))
  })
})

describe('SampleSlotsTable — slot drop validation', () => {
  // Build a 128-slot flex array; only `emptyIds` are empty, every other slot is filled.
  function makeSlots(emptyIds: number[], sizeEach = 1000) {
    return Array.from({ length: 128 }, (_, i) => {
      const id = i + 1
      const empty = emptyIds.includes(id)
      return {
        slot_id: id, slot_type: 'flex', path: empty ? null : `s${id}.wav`,
        gain: empty ? null : 72, loop_mode: null, timestretch_mode: null,
        source_location: empty ? null : 'Project', file_exists: !empty,
        compatibility: empty ? null : 'compatible', file_format: empty ? null : 'WAV',
        bit_depth: empty ? null : 16, sample_rate: empty ? null : 44100,
        ot_size_bytes: empty ? null : sizeEach,
      }
    })
  }

  function dropFilesOn(rowLabel: string, files: string[]) {
    const row = screen.getByText(rowLabel).closest('tr')!
    const dataTransfer = {
      getData: (key: string) =>
        key === 'application/json' ? JSON.stringify({ source: 'audio-pool-sidebar', files }) : '',
    }
    fireEvent.drop(row, { dataTransfer })
  }

  function assignCall() {
    return mockInvoke.mock.calls.find(c => c[0] === 'assign_samples_to_slots')
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
      if (cmd === 'expand_audio_paths') return a.paths ?? []
      if (cmd === 'inspect_audio_files') {
        return ((a.paths as string[]) ?? []).map(p => ({ path: p, ot_size_bytes: 1000, compatibility: 'compatible' }))
      }
      if (cmd === 'assign_samples_to_slots') return { assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 }
      return []
    })
  })

  it('assigns what fits and warns when there are fewer empty slots than files', async () => {
    // Only slot 100 is empty; dropping 2 files there → 1 assigned, 1 skipped.
    renderWithProvider(
      <SampleSlotsTable slots={makeSlots([100])} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    dropFilesOn('F100', ['/p/a.wav', '/p/b.wav'])
    await waitFor(() => expect(assignCall()).toBeTruthy())
    expect((assignCall()![1] as { assignments: unknown[] }).assignments).toHaveLength(1)
    expect(await screen.findByText(/not enough empty slots/i)).toBeInTheDocument()
  })

  it('blocks files that would exceed Flex RAM and warns', async () => {
    // Two empty slots, but only ~1 KB of Flex RAM free; each file is 1000 bytes.
    const memorySettings = { record_24bit: false, reserved_recorder_count: 8, reserved_recorder_length: 16, flex_ram_free_mb: 0.001 }
    renderWithProvider(
      <SampleSlotsTable slots={makeSlots([100, 101])} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" memorySettings={memorySettings} />
    )
    dropFilesOn('F100', ['/p/a.wav', '/p/b.wav'])
    await waitFor(() => expect(assignCall()).toBeTruthy())
    expect((assignCall()![1] as { assignments: unknown[] }).assignments).toHaveLength(1)
    expect(await screen.findByText(/not enough Flex RAM/i)).toBeInTheDocument()
  })

  it('warns when an assigned sample is not OT-compatible', async () => {
    mockInvoke.mockImplementation(async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
      if (cmd === 'expand_audio_paths') return a.paths ?? []
      if (cmd === 'inspect_audio_files') {
        return ((a.paths as string[]) ?? []).map(p => ({ path: p, ot_size_bytes: 1000, compatibility: 'wrong_rate' }))
      }
      if (cmd === 'assign_samples_to_slots') return { assigned_count: 1, updated_slots: [], flex_ram_free_mb: 80 }
      return []
    })
    renderWithProvider(
      <SampleSlotsTable slots={makeSlots([100])} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    dropFilesOn('F100', ['/p/a.wav'])
    await waitFor(() => expect(assignCall()).toBeTruthy())
    expect(await screen.findByText(/not OT-compatible/i)).toBeInTheDocument()
  })
})

describe('SampleSlotsTable — selection is exclusive with the Audio Pool pane', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_audio_directory') {
        return [{ name: 'poolsample.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: '/set/AUDIO/poolsample.wav' }]
      }
      return []
    })
  })

  it('selecting a slot clears the pane selection and vice versa', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode audioPoolPath="/set/AUDIO" projectPath="/proj" />
    )
    await userEvent.click(screen.getByTitle(/Show Audio Pool/i)) // open the pane

    const sidebar = document.querySelector('.audio-pool-sidebar') as HTMLElement
    const slotsTable = document.querySelector('.samples-table') as HTMLElement

    // Select a pool file
    const poolRow = (await within(sidebar).findByText('poolsample.wav')).closest('tr')!
    await userEvent.click(poolRow)
    expect(poolRow).toHaveClass('selected')

    // Selecting a slot clears the pane selection
    const slotRow = within(slotsTable).getByText('F2').closest('tr')!
    await userEvent.click(slotRow)
    expect(slotRow).toHaveClass('selected')
    expect(poolRow).not.toHaveClass('selected')

    // Selecting a pool file again clears the slot selection
    await userEvent.click(poolRow)
    expect(poolRow).toHaveClass('selected')
    expect(slotRow).not.toHaveClass('selected')
  })
})
