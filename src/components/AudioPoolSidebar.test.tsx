import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { AudioPoolSidebar } from './AudioPoolSidebar'

const mockInvoke = vi.mocked(invoke)
const mockOpen = vi.mocked(openFileDialog)

const files = [
  { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: '/set/AUDIO/kick.wav' },
  { name: 'snare.wav', size: 2048, channels: 1, bit_rate: 24, sample_rate: 48000, is_directory: false, path: '/set/AUDIO/snare.wav' },
]

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string) =>
    cmd === 'list_audio_directory' ? files : undefined
  )
  mockOpen.mockReset()
})

describe('AudioPoolSidebar', () => {
  it('lists pool files', async () => {
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode={false} />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())
  })

  it('shows an Import dropdown that opens the file dialog and reports the chosen files', async () => {
    mockOpen.mockResolvedValue(['/ext/clap.wav'])
    const onImport = vi.fn()
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode={false} onImport={onImport} />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())

    await userEvent.click(screen.getByTitle(/Import audio/i))
    await userEvent.click(screen.getByText(/Files…/i))
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(['/ext/clap.wav'], '/set/AUDIO'))
  })

  it('right-click → "Assign to first empty slot" calls back (enabled in edit mode)', async () => {
    const onAssignToFirstEmpty = vi.fn()
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode onAssignToFirstEmpty={onAssignToFirstEmpty} />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    const assign = screen.getByText(/Assign to first empty slot/i)
    expect(assign).toBeEnabled()
    await userEvent.click(assign)
    expect(onAssignToFirstEmpty).toHaveBeenCalledWith(['/set/AUDIO/kick.wav'])
  })

  it('disables "Assign to first empty slot" in view mode', async () => {
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode={false} onAssignToFirstEmpty={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    const assign = screen.getByText(/Assign to first empty slot/i)
    expect(assign).toBeDisabled()
    expect(assign.getAttribute('title')).toMatch(/Toggle Edit mode/i)
  })

  it('shows "Assign to selected slot" only when a slot is selected', async () => {
    const onAssignToSelected = vi.fn()
    const { rerender } = render(
      <AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode hasSelectedSlot={false} onAssignToSelected={onAssignToSelected} />
    )
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    expect(screen.queryByText(/Assign to selected slot/i)).not.toBeInTheDocument()

    // With a slot selected, the item appears and calls back
    rerender(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode hasSelectedSlot onAssignToSelected={onAssignToSelected} />)
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText(/Assign to selected slot/i))
    expect(onAssignToSelected).toHaveBeenCalledWith(['/set/AUDIO/kick.wav'])
  })
})
