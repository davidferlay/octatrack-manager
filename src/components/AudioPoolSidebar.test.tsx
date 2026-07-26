import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import { AudioPoolSidebar, parentDir } from './AudioPoolSidebar'

describe('parentDir', () => {
  it('climbs one level but never above the pool root', () => {
    expect(parentDir('/set/AUDIO/drums', '/set/AUDIO')).toBe('/set/AUDIO')
    expect(parentDir('/set/AUDIO/drums/909', '/set/AUDIO')).toBe('/set/AUDIO/drums')
    expect(parentDir('/set/AUDIO', '/set/AUDIO')).toBe('/set/AUDIO') // already at root: no move
    expect(parentDir('/set/AUDIO/drums/', '/set/AUDIO')).toBe('/set/AUDIO') // trailing slash
  })
})

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

  it('right-click on a file → "Open in file explorer" reveals it (works in view mode)', async () => {
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode={false} />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText(/Open in file explorer/i))
    expect(mockInvoke).toHaveBeenCalledWith('reveal_in_file_manager', { path: '/set/AUDIO/kick.wav' })
  })

  it('right-click on a file → "Copy path to clipboard" writes the path', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode={false} />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText('kick.wav').closest('tr')!)
    await userEvent.click(screen.getByText(/Copy path to clipboard/i))
    expect(writeText).toHaveBeenCalledWith('/set/AUDIO/kick.wav')
  })

  it('right-click on a directory shows only "Open in file explorer" (no assign items)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'list_audio_directory'
        ? [{ name: 'drums', size: 0, channels: null, bit_rate: null, sample_rate: null, is_directory: true, path: '/set/AUDIO/drums' }]
        : undefined
    )
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode hasSelectedSlot onAssignToFirstEmpty={vi.fn()} onAssignToSelected={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('drums')).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText('drums').closest('tr')!)
    expect(screen.getByText(/Open in file explorer/i)).toBeInTheDocument()
    expect(screen.queryByText(/Assign to first empty slot/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Assign to selected slot/i)).not.toBeInTheDocument()
  })

  it('path row: shows path then Reset-to-AUDIO then Go-up, both disabled at root and enabled once inside a subfolder', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd !== 'list_audio_directory') return undefined
      const path = args?.path ?? '/set/AUDIO'
      return path === '/set/AUDIO'
        ? [{ name: 'drums', size: 0, channels: null, bit_rate: null, sample_rate: null, is_directory: true, path: '/set/AUDIO/drums' }]
        : [{ name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: '/set/AUDIO/drums/kick.wav' }]
    })
    render(<AudioPoolSidebar audioPoolPath="/set/AUDIO" isEditMode={false} />)
    await waitFor(() => expect(screen.getByText('drums')).toBeInTheDocument())

    const resetBtn = screen.getByTitle('Reset to AUDIO directory')
    const upBtn = screen.getByTitle('Go up (Backspace)')
    expect(resetBtn).toBeDisabled()
    expect(upBtn).toBeDisabled()
    // Path renders before the buttons (buttons live at the right of the path row).
    const pathRow = resetBtn.closest('.sidebar-path-row')!
    const children = Array.from(pathRow.children)
    expect(children.indexOf(screen.getByText('AUDIO/'))).toBeLessThan(children.indexOf(resetBtn))
    expect(children.indexOf(resetBtn)).toBeLessThan(children.indexOf(upBtn))

    await userEvent.click(screen.getByText('drums'))
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())
    expect(resetBtn).not.toBeDisabled()
    expect(upBtn).not.toBeDisabled()
    expect(screen.getByText('AUDIO/drums/')).toBeInTheDocument()

    await userEvent.click(resetBtn)
    await waitFor(() => expect(screen.getByText('drums')).toBeInTheDocument())
    expect(resetBtn).toBeDisabled()
    expect(screen.getByText('AUDIO/')).toBeInTheDocument()
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

  it('scopes the Usage badge to the current project when projectName is set, unlike the Set-wide Audio Pool page', async () => {
    // Dedicated pool path so this test's get_pool_usage response can't be served
    // from another test's cached entry for '/set/AUDIO' (usePoolUsage caches per path).
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_audio_directory') return files
      if (cmd === 'get_pool_usage') {
        return {
          '/set/audio/kick.wav': [
            { project: 'ThisProject', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true, slot: null },
            { project: 'OtherProject', bank: 1, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true, slot: null },
            { project: 'OtherProject', bank: 2, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true, slot: null },
          ],
        }
      }
      return undefined
    })
    render(<AudioPoolSidebar audioPoolPath="/set2/AUDIO" isEditMode={false} projectName="ThisProject" />)
    await waitFor(() => expect(screen.getByText('kick.wav')).toBeInTheDocument())
    // Only ThisProject's single entry counts, not the 3 total across both projects.
    await waitFor(() => expect(screen.getByText('✓ 1')).toBeInTheDocument())
  })
})
