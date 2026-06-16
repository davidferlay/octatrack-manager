import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
})

describe('SampleSlotsTable — Audio Pool integration', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue([])
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

  it('shows the Open-Audio-Pool-page button only when audioPoolPath is set', () => {
    const { rerender } = render(
      <MemoryRouter><TablePreferencesProvider>
        <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" audioPoolPath="/set/AUDIO" />
      </TablePreferencesProvider></MemoryRouter>
    )
    expect(screen.getByTitle(/Open the Audio Pool page/i)).toBeInTheDocument()

    rerender(
      <MemoryRouter><TablePreferencesProvider>
        <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
      </TablePreferencesProvider></MemoryRouter>
    )
    expect(screen.queryByTitle(/Open the Audio Pool page/i)).not.toBeInTheDocument()
  })

  it('right-clicking a slot opens the context menu; clear/reset disabled in view mode', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode={false} projectPath="/proj" />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    fireEvent.contextMenu(row)
    expect(screen.getByText('Clear sample')).toBeDisabled()
    expect(screen.getByText(/Reset attributes/i)).toBeDisabled()
    expect(screen.getByText(/Toggle Edit mode/i)).toBeInTheDocument()
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
      expect(mockInvoke).toHaveBeenCalledWith('clear_sample_slots', expect.objectContaining({ path: '/proj', slotType: 'FLEX', slotIndices: [1] }))
    )
  })

  it('resets slot attributes via the context menu (assign with set_defaults, keeps path)', async () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" isEditMode projectPath="/proj" />
    )
    const row = screen.getByText('kick.wav').closest('tr')!
    fireEvent.contextMenu(row)
    await userEvent.click(screen.getByText(/Reset attributes/i))

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('assign_samples_to_slots', expect.objectContaining({
        path: '/proj',
        slotType: 'FLEX',
        assignments: [expect.objectContaining({ slot_index: 1, audio_path: 'samples/kick.wav', set_defaults: true })],
      }))
    )
  })
})
