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

  it('normalizes a "../" slot path so a pool-referenced file is attributed to the Audio Pool, not the project', async () => {
    // baseProps() already has a static slot at '../AUDIO/snare48.wav' (wrong_rate).
    // Use a project path distinct from the other tests' so this test's mount-time
    // "copy_bank" default (before initialOperation flips it to fix_project_samples)
    // is the one that populates audioPoolStatus via get_audio_pool_status, with no
    // sessionStorage leakage from earlier tests sharing the same projectPath key.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_audio_pool_status') return Promise.resolve({ exists: true, path: '/set/AUDIO', set_path: '/set' })
      if (cmd === 'list_audio_files_recursive') return Promise.resolve([])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      return Promise.resolve(null)
    })
    renderPanel({ projectPath: '/set/OtherProject', initialOperation: 'fix_project_samples' })
    await waitFor(() => expect(screen.getByRole('button', { name: /incompatible audio file/ })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /incompatible audio file/ }))

    // `source` itself isn't rendered anywhere yet (coverage limitation - see report),
    // but the underlying normalized path IS what the list modal's Location column
    // renders, so the fix is observable there: a correctly-normalized pool path
    // ('/set/OtherProject/../AUDIO/snare48.wav' -> '/set/AUDIO/snare48.wav') should
    // show as "AUDIO/", not the un-normalized "OtherProject/../AUDIO".
    expect(await screen.findByTitle('AUDIO/')).toBeInTheDocument()
    expect(screen.queryByTitle('OtherProject/../AUDIO')).not.toBeInTheDocument()
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

  it('dedupes multiple slots referencing the same resolved file into a single incompatible entry', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return Promise.resolve([])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      return Promise.resolve(null)
    })
    renderPanel({
      initialOperation: 'fix_project_samples',
      sampleSlots: {
        // Two Flex slots and one Static slot all resolve to the SAME physical
        // file ('kick.mp3' in the project root). Without dedup by resolved
        // path, this would inflate the count to 3 and list the file 3 times.
        flex_slots: [
          { path: 'kick.mp3', compatibility: 'unknown' },
          { path: 'kick.mp3', compatibility: 'unsupported_format' },
        ],
        static_slots: [
          { path: 'kick.mp3', compatibility: 'unknown' },
        ],
      },
    })
    // Only one incompatible file should be counted, not three, despite three
    // slots referencing the same resolved path.
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /incompatible audio file/ })).toHaveTextContent('1')
    expect(screen.queryByText(/^3$/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /incompatible audio file/ }))
    // The list modal must also show a single row for this file, not three.
    expect(await screen.findByText('Showing 1 of 1 files')).toBeInTheDocument()
  })

  it('dedupes a referenced Windows-path slot against the same file returned with native backslashes by the recursive scan', async () => {
    // Windows-only bug: referencedSlotEntries resolves 'kick.mp3' by joining
    // `${projectPath}/${slot.path}` (a forward slash), then normalizePath() only
    // rewrites '/'-separated segments and never touches '\', so with a backslash
    // projectPath the resolved referenced path keeps mixed separators
    // ('C:\Project/kick.mp3'). Meanwhile list_audio_files_recursive (Rust, native)
    // returns the SAME file with all-backslash separators ('C:\Project\kick.mp3').
    // Pre-fix, the plain Set.has() comparison treated these as two different files,
    // so the file showed up in BOTH the referenced bucket and the unreferenced
    // bucket (duplicate row, count of 2). Post-fix, comparing via usageKey()
    // (lowercase + backslash-to-forward-slash) recognizes them as the same file.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return Promise.resolve(['C:\\Project\\kick.mp3'])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      return Promise.resolve(null)
    })
    renderPanel({
      projectPath: 'C:\\Project',
      initialOperation: 'fix_project_samples',
      sampleSlots: {
        flex_slots: [{ path: 'kick.mp3', compatibility: 'unknown' }],
        static_slots: [],
      },
    })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /incompatible audio file/ })).toHaveTextContent('1')
    expect(screen.queryByText(/^2$/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /incompatible audio file/ }))
    // The list modal must also show a single row for this file, not two.
    expect(await screen.findByText('Showing 1 of 1 files')).toBeInTheDocument()
  })

  it('does not double-count usage for a pool-resident file this project itself references (dedup by project name)', async () => {
    // '../AUDIO/kick48.wav' resolves (from '/set/DedupUsageProject') to
    // '/set/AUDIO/kick48.wav', which lives under the mocked Audio Pool path
    // '/set/AUDIO'. This project's own static slot references it, producing
    // one entry in projectUsageMap tagged with this project's own name
    // ('MyProject', from baseProps). get_pool_usage is mocked to return the
    // IDENTICAL usage entry for the SAME resolved path, tagged with the SAME
    // project name - exactly what compute_pool_usage would report for a
    // pool file the current project references itself. Pre-fix, the naive
    // merge concatenates both and shows "✓ 2"; post-fix, the pool-side
    // duplicate (same project) is dropped and it shows "✓ 1".
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_audio_pool_status') return Promise.resolve({ exists: true, path: '/set/AUDIO', set_path: '/set' })
      if (cmd === 'list_audio_files_recursive') return Promise.resolve([])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      if (cmd === 'get_pool_usage') return Promise.resolve({
        '/set/audio/kick48.wav': [
          { project: 'MyProject', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
        ],
      })
      return Promise.resolve(null)
    })
    renderPanel({
      projectPath: '/set/DedupUsageProject',
      initialOperation: 'fix_project_samples',
      sampleSlots: {
        flex_slots: [],
        static_slots: [{ path: '../AUDIO/kick48.wav', compatibility: 'wrong_rate' }],
      },
      slotUsage: {
        static_usage: [
          [{ bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true }],
        ],
        flex_usage: [],
      },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /incompatible audio file/ })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /incompatible audio file/ }))

    expect(await screen.findByTitle('Played in 1 place - click for details')).toBeInTheDocument()
    expect(screen.queryByTitle(/Played in 2 places/)).not.toBeInTheDocument()
  })

  it('collects which slot(s) reference each incompatible file, deduped by resolved path', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return Promise.resolve([])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      if (cmd === 'get_pool_usage') return Promise.resolve({})
      return Promise.resolve(null)
    })
    renderPanel({
      initialOperation: 'fix_project_samples',
      sampleSlots: {
        flex_slots: [{ path: 'kick.mp3', compatibility: 'unknown' }],
        static_slots: [{ path: 'kick.mp3', compatibility: 'unknown' }],
      },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Execute' }))
    // one row for the one physical file, tagged with both slots that reference it
    expect(await screen.findByText('F1, S1')).toBeInTheDocument()
  })

  it('shows "Computing usage…" (not "Not referenced") while this project\'s own slotUsage prop has not resolved yet, even though poolUsageLoading is already false', async () => {
    // baseProps() passes no slotUsage prop, so it defaults to null ("not yet
    // arrived"), while poolUsageLoading resolves to false almost immediately here
    // since get_audio_pool_status/get_pool_usage aren't mocked to report a pool.
    // Pre-fix, usageLoading was poolUsageLoading alone, so the incompatible
    // kick.mp3 row (no usage entries yet) would flash "Not referenced" even
    // though slotUsage genuinely hasn't loaded. Post-fix, usageLoading also
    // factors in `!slotUsage`, so it shows the loading state instead.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_audio_files_recursive') return Promise.resolve([])
      if (cmd === 'inspect_audio_files') return Promise.resolve([])
      return Promise.resolve(null)
    })
    renderPanel({ initialOperation: 'fix_project_samples' })
    await waitFor(() => expect(screen.getByRole('button', { name: /incompatible audio file/ })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /incompatible audio file/ }))
    // Both incompatible slots from baseProps() (kick.mp3, snare48.wav) have no
    // usage entries yet, so both should show the loading state.
    expect((await screen.findAllByTitle('Computing usage…')).length).toBe(2)
    expect(screen.queryByTitle('Not referenced in any project of this set')).not.toBeInTheDocument()
  })
})

describe('ToolsPanel - initialOperation one-shot consumption', () => {
  it('calls onInitialOperationConsumed exactly once when initialOperation is applied', async () => {
    invokeMock.mockResolvedValue(null)
    const onInitialOperationConsumed = vi.fn()
    renderPanel({ initialOperation: 'fix_project_samples', onInitialOperationConsumed })

    await waitFor(() => expect(screen.getByRole('combobox', { name: /operation/i })).toHaveValue('fix_project_samples'))
    expect(onInitialOperationConsumed).toHaveBeenCalledTimes(1)

    // Flush any remaining mount-time effects so state updates settle inside
    // an act() boundary before the test ends.
    await waitFor(() => {})
    expect(onInitialOperationConsumed).toHaveBeenCalledTimes(1)
  })

  it('does not call onInitialOperationConsumed when initialOperation is not set', async () => {
    invokeMock.mockResolvedValue(null)
    const onInitialOperationConsumed = vi.fn()
    renderPanel({ onInitialOperationConsumed })

    await waitFor(() => {})
    expect(onInitialOperationConsumed).not.toHaveBeenCalled()
  })
})
