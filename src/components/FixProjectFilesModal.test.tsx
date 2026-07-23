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

  it('shows a minimalist, centered "Converting N / M" line with a spinner and the current file name below it, not a percent bar', async () => {
    // Regression test for a UI cleanup: the previous design showed the raw
    // current file path inline in orange plus a percent-fill bar - replaced
    // with the same minimalist "Converting N / M" + spinner row Fix Missing
    // Samples uses, with the current file name as its own grey line below.
    let resolveInvoke: (v: unknown) => void = () => {}
    invokeMock.mockImplementation(() => new Promise(resolve => { resolveInvoke = resolve }))
    render(<FixProjectFilesModal projectPath="/set/MyProject" files={files} skipReview onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Converting 1 / 2')).toBeInTheDocument())
    expect(document.querySelector('.loading-spinner-small')).toBeTruthy()
    expect(document.querySelector('.copy-progress-bar')).toBeFalsy()
    expect(document.querySelector('.fix-pool-progress-file')?.textContent).toBe('kick.mp3')
    // Narrower, centered modal for this phase rather than the wide review layout.
    expect(document.querySelector('.modal-content.fix-pool-modal-narrow')).toBeTruthy()

    resolveInvoke({ outcomes: [], projects_updated: [], slots_updated: 0 })
    await waitFor(() => expect(screen.getByText(/files converted/)).toBeInTheDocument())
  })

  it('lists failed conversions in a dedicated, independently-scrollable table instead of an inline list', async () => {
    // Regression test: reusing .fix-done-error (display:flex on a <p>+<ul> pair)
    // put the "N files could not be converted" label and the error list side
    // by side instead of stacked. Now a dedicated section with its own
    // height-capped, scrollable <table> (File / Error columns).
    invokeMock.mockResolvedValue({
      outcomes: [
        { old_path: '/set/MyProject/kick.mp3', new_path: null, error: 'boom' },
        { old_path: '/set/AUDIO/snare48.wav', new_path: '/set/AUDIO/snare48.wav', error: null },
      ],
      projects_updated: [],
      slots_updated: 0,
    })
    render(<FixProjectFilesModal projectPath="/set/MyProject" files={files} skipReview onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('1 file could not be converted')).toBeInTheDocument())
    const wrapper = document.querySelector('.fix-done-failures-table-wrapper')
    expect(wrapper).toBeTruthy()
    const table = wrapper?.querySelector('table.fix-done-failures-table')
    expect(table).toBeTruthy()
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(1)
    const cells = table?.querySelectorAll('tbody tr td')
    expect(cells?.[0].textContent).toBe('kick.mp3')
    expect(cells?.[1].textContent).toBe('boom')
    // Only the failed file is listed, not the successfully-converted one.
    expect(screen.queryByText('snare48.wav')).not.toBeInTheDocument()
  })

  it('narrows the done screen too, and keeps its Close button compact rather than the big Execute-sized CTA', async () => {
    invokeMock.mockResolvedValue({ outcomes: [], projects_updated: [], slots_updated: 0 })
    render(<FixProjectFilesModal projectPath="/set/MyProject" files={files} skipReview onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/files converted/)).toBeInTheDocument())
    expect(document.querySelector('.modal-content.fix-pool-modal-narrow')).toBeTruthy()
    const closeBtn = screen.getByRole('button', { name: 'Close' })
    expect(closeBtn).toHaveClass('tools-execute-btn')
    // Not asserting computed style (jsdom doesn't load CSS), just that it's
    // the same button element the scoped .fix-pool-summary override targets
    // (which also centers this whole screen's content, message included).
    expect(closeBtn.closest('.fix-pool-summary')).toBeTruthy()
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
