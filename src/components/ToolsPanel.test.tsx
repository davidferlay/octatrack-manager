import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolsPanel } from './ToolsPanel'
import { ProjectsProvider } from '../context/ProjectsContext'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

function baseProps() {
  return {
    projectPath: '/set/MyProject',
    projectName: 'MyProject',
    banks: [],
    loadedBankIndices: new Set<number>(),
    sampleSlots: {
      flex_slots: [
        { path: 'kick.mp3', compatibility: 'unknown' },
        { path: null, compatibility: null },
      ],
      static_slots: [
        { path: '../AUDIO/snare48.wav', compatibility: 'wrong_rate' },
      ],
    },
  }
}

function renderPanel(props: Partial<React.ComponentProps<typeof ToolsPanel>> = {}) {
  return render(
    <ProjectsProvider>
      <ToolsPanel {...baseProps()} {...props} />
    </ProjectsProvider>
  )
}

describe('ToolsPanel - Fix Project Samples', () => {
  it('lists "Fix Project Samples" as an operation option', async () => {
    invokeMock.mockResolvedValue(null)
    renderPanel()
    expect(screen.getByRole('option', { name: 'Fix Project Samples' })).toBeInTheDocument()
    // Flush the unrelated mount-time audio-pool-status effect so its state
    // update settles inside an act() boundary before the test ends.
    await waitFor(() => {})
  })

  it('pre-selects the operation when initialOperation is set', async () => {
    invokeMock.mockResolvedValue(null)
    renderPanel({ initialOperation: 'fix_project_samples' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: /operation/i })).toHaveValue('fix_project_samples'))
  })

  it('scans referenced-incompatible slots and unreferenced project files, and shows a combined count', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return Promise.resolve(['/set/MyProject/loop.aif'])
      if (cmd === 'inspect_audio_files') return Promise.resolve([{ path: '/set/MyProject/loop.aif', compatibility: 'unknown' }])
      return Promise.resolve(null)
    })
    renderPanel({ initialOperation: 'fix_project_samples' })
    // 2 referenced-incompatible slots (kick.mp3, snare48.wav) + 1 unreferenced file (loop.aif) = 3
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /incompatible audio file/ })).toBeInTheDocument()
  })

  it('opens FixProjectFilesModal on Execute', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return Promise.resolve([])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      return Promise.resolve(null)
    })
    renderPanel({ initialOperation: 'fix_project_samples' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Execute' }))
    expect(screen.getByText(/Review planned changes/)).toBeInTheDocument()
  })
})
