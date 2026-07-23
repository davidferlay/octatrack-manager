import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectIncompatibleListModal, FixProjectFilesModal } from './FixProjectFilesModal'
import { usePoolTable, PoolFilesTable, type IncompatibleFile } from './FixPoolFilesModal'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))

const files: IncompatibleFile[] = [
  { path: '/set/MyProject/kick.mp3', compatibility: 'unknown', source: 'project' },
  { path: '/set/AUDIO/snare48.wav', compatibility: 'wrong_rate', source: 'pool' },
]

describe('ProjectIncompatibleListModal', () => {
  it('shows the project-scoped title and one row per file', () => {
    render(<ProjectIncompatibleListModal projectPath="/set/MyProject" files={files} onClose={vi.fn()} />)
    expect(screen.getByText('Incompatible Project Samples')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(files.length + 1) // +1 header row
  })
})

describe('FixProjectFilesModal', () => {
  it('shows the review screen listing planned changes before applying', () => {
    render(<FixProjectFilesModal projectPath="/set/MyProject" files={files} onClose={vi.fn()} />)
    expect(screen.getByText(/Review planned changes/)).toBeInTheDocument()
    expect(screen.getByText(/2 incompatible audio files/)).toBeInTheDocument()
  })

  it('calls fix_project_samples (not fix_pool_files) with projectPath on Apply Changes', async () => {
    invokeMock.mockResolvedValue({ outcomes: [], projects_updated: [], slots_updated: 0 })
    const onFixed = vi.fn()
    render(<FixProjectFilesModal projectPath="/set/MyProject" files={files} onClose={vi.fn()} onFixed={onFixed} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('fix_project_samples', {
      projectPath: '/set/MyProject',
      filePaths: files.map(f => f.path),
      transferId: expect.any(String),
    }))
    await waitFor(() => expect(onFixed).toHaveBeenCalled())
  })

  it('skips the review screen and starts converting immediately when skipReview is set', async () => {
    invokeMock.mockResolvedValue({ outcomes: [], projects_updated: [], slots_updated: 0 })
    render(<FixProjectFilesModal projectPath="/set/MyProject" files={files} skipReview onClose={vi.fn()} />)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('fix_project_samples', expect.anything()))
  })
})

function TestHarness({ files, usageMap, withSlot }: { files: IncompatibleFile[]; usageMap?: Record<string, any>; withSlot?: boolean }) {
  const table = usePoolTable(files, '/proj', true, [], usageMap, false, withSlot)
  return <PoolFilesTable table={table} />
}

describe('usePoolTable/PoolFilesTable - Usage and Slot columns', () => {
  it('shows a Usage badge and a Slot column with comma-joined labels', () => {
    const files: IncompatibleFile[] = [
      { path: '/proj/kick.mp3', compatibility: 'unknown', source: 'project', slots: ['F1', 'S3'] },
    ]
    const usageMap = {
      '/proj/kick.mp3': [
        { project: 'MyProject', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
      ],
    }
    render(<TestHarness files={files} usageMap={usageMap} withSlot />)
    expect(screen.getByText('✓ 1')).toBeInTheDocument()
    expect(screen.getByText('F1, S3')).toBeInTheDocument()
  })

  it('shows a dash for the Slot column when a file has no referencing slot', () => {
    const files: IncompatibleFile[] = [
      { path: '/proj/loop.wav', compatibility: 'unknown', source: 'project', slots: [] },
    ]
    render(<TestHarness files={files} withSlot />)
    const row = screen.getByText('loop.wav').closest('tr')!
    expect(row.querySelector('.col-slot')?.textContent).toBe('—')
  })

  it('does not show a Usage or Slot column when usageMap/withSlot are not provided', () => {
    const files: IncompatibleFile[] = [{ path: '/proj/kick.mp3', compatibility: 'unknown', source: 'project' }]
    render(<TestHarness files={files} />)
    expect(screen.queryByText('Usage')).not.toBeInTheDocument()
    expect(screen.queryByText('Slot')).not.toBeInTheDocument()
  })
})
