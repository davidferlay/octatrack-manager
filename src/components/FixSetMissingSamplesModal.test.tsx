import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FixSetMissingSamplesModal, type ProjectMissing } from './FixSetMissingSamplesModal'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

function missing(filename: string) {
  return { filename, original_path: filename, slot_type: 'flex', flex_slot_ids: [1], static_slot_ids: [] }
}

const projects: ProjectMissing[] = [
  { name: 'PROJ1', path: '/set/PROJ1', missing: [missing('kick.wav')] },
  { name: 'PROJ2', path: '/set/PROJ2', missing: [missing('snare.wav')] },
]

/** Answers the three search commands; `hits` maps project path -> what that project's own dir holds. */
function mockSearch(hits: Record<string, { filename: string; found_path: string; source_project: string | null }[]>) {
  invokeMock.mockImplementation((cmd: string, args: { projectPath?: string }) => {
    if (cmd === 'search_project_dir') return Promise.resolve(hits[args.projectPath ?? ''] ?? [])
    if (cmd === 'search_audio_pool' || cmd === 'search_other_projects_of_set') return Promise.resolve([])
    if (cmd === 'backup_project_files') return Promise.resolve(null)
    if (cmd === 'fix_missing_samples') return Promise.resolve({ resolved_count: 1, files_copied: 0, files_moved: 0, projects_updated: [] })
    return Promise.resolve([])
  })
}

function renderModal(props: Partial<Parameters<typeof FixSetMissingSamplesModal>[0]> = {}) {
  return render(
    <FixSetMissingSamplesModal
      projects={projects}
      poolOption="use_from_pool"
      otherProjectOption="copy_to_project"
      skipReview={false}
      onClose={vi.fn()}
      onApplied={vi.fn()}
      {...props}
    />
  )
}

beforeEach(() => invokeMock.mockReset())

/** Waits for the search to finish, then steps into the review table. */
async function goToReview() {
  const review = await screen.findByRole('button', { name: 'Review changes' })
  await waitFor(() => expect(review).toBeEnabled())
  await userEvent.click(review)
  expect(screen.getByText(/Review planned changes/)).toBeInTheDocument()
}

describe('FixSetMissingSamplesModal', () => {
  it('searches every project of the Set, not just the first', async () => {
    mockSearch({})
    renderModal()
    await goToReview()

    const searched = invokeMock.mock.calls
      .filter(([cmd]) => cmd === 'search_project_dir')
      .map(([, args]) => (args as { projectPath: string }).projectPath)
    expect(searched).toEqual(['/set/PROJ1', '/set/PROJ2'])
  })

  it('lists one review row per project, naming where each file was found', async () => {
    mockSearch({
      '/set/PROJ1': [{ filename: 'kick.wav', found_path: '/set/PROJ1/kick.wav', source_project: null }],
      '/set/PROJ2': [{ filename: 'snare.wav', found_path: '/set/PROJ2/snare.wav', source_project: null }],
    })
    renderModal()
    await goToReview()

    expect(screen.getByText('kick.wav').closest('tr')!).toHaveTextContent('PROJ1')
    expect(screen.getByText('kick.wav').closest('tr')!).toHaveTextContent('/set/PROJ1/kick.wav')
    expect(screen.getByText('snare.wav').closest('tr')!).toHaveTextContent('PROJ2')
    expect(screen.getByText(/missing files found across 2 projects/)).toBeInTheDocument()
  })

  it('fixes each project separately, with only that project\'s own resolutions', async () => {
    mockSearch({
      '/set/PROJ1': [{ filename: 'kick.wav', found_path: '/set/PROJ1/kick.wav', source_project: null }],
      '/set/PROJ2': [{ filename: 'snare.wav', found_path: '/set/PROJ2/snare.wav', source_project: null }],
    })
    renderModal()
    await goToReview()
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))

    await waitFor(() => {
      const fixes = invokeMock.mock.calls.filter(([cmd]) => cmd === 'fix_missing_samples')
      expect(fixes).toHaveLength(2)
      expect(fixes[0][1]).toEqual({
        projectPath: '/set/PROJ1',
        resolutions: [{ filename: 'kick.wav', found_path: '/set/PROJ1/kick.wav', action: 'update_path', new_slot_path: 'kick.wav' }],
      })
      expect(fixes[1][1]).toEqual({
        projectPath: '/set/PROJ2',
        resolutions: [{ filename: 'snare.wav', found_path: '/set/PROJ2/snare.wav', action: 'update_path', new_slot_path: 'snare.wav' }],
      })
    })
  })

  it('backs up each project before touching it', async () => {
    mockSearch({ '/set/PROJ1': [{ filename: 'kick.wav', found_path: '/set/PROJ1/kick.wav', source_project: null }] })
    renderModal()
    await goToReview()
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('backup_project_files', {
      projectPath: '/set/PROJ1',
      files: ['project.work'],
      label: 'fix_missing_samples',
    }))
    // PROJ2 resolved nothing, so it is never backed up or fixed
    const touched = invokeMock.mock.calls.filter(([cmd]) => cmd === 'fix_missing_samples')
    expect(touched).toHaveLength(1)
  })

  it('marks what no location turned up as Not found, and refuses to apply when nothing was found', async () => {
    mockSearch({})
    renderModal()
    // The search screen already says what is still missing, before any review
    expect(await screen.findByText(/2 still missing/)).toBeInTheDocument()

    await goToReview()
    expect(screen.getAllByText('Not found')).toHaveLength(2)
    // Nothing to apply: the button is not offered at all
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).not.toBeInTheDocument()
  })

  it('skips the review screen and applies straight away when asked', async () => {
    mockSearch({ '/set/PROJ1': [{ filename: 'kick.wav', found_path: '/set/PROJ1/kick.wav', source_project: null }] })
    renderModal({ skipReview: true })
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('fix_missing_samples', expect.anything()))
    expect(screen.queryByText(/Review planned changes/)).not.toBeInTheDocument()
  })
})

describe('FixSetMissingSamplesModal - Browse', () => {
  it('scans a chosen directory once for the whole Set, then routes hits to the projects that need them', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'search_directory') {
        return Promise.resolve([
          { filename: 'kick.wav', found_path: '/elsewhere/kick.wav', source_project: null },
          { filename: 'snare.wav', found_path: '/elsewhere/snare.wav', source_project: null },
        ])
      }
      return Promise.resolve([])
    })
    vi.mocked(openDialog).mockResolvedValue('/elsewhere' as never)
    renderModal()

    await userEvent.click(await screen.findByRole('button', { name: /Browse/ }))

    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'search_directory')
      // One scan for the Set, carrying the union of what is still missing
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toEqual({ dirPath: '/elsewhere', filenames: ['kick.wav', 'snare.wav'] })
    })

    // The directory becomes its own search step, and both projects are resolved from it
    expect(await screen.findByText(/User selection:/)).toBeInTheDocument()
    await goToReview()
    expect(screen.getByText('kick.wav').closest('tr')!).toHaveTextContent('PROJ1')
    expect(screen.getByText('snare.wav').closest('tr')!).toHaveTextContent('PROJ2')
    expect(screen.queryByText('Not found')).not.toBeInTheDocument()
  })

  it('does nothing when the directory picker is dismissed', async () => {
    mockSearch({})
    vi.mocked(openDialog).mockResolvedValue(null as never)
    renderModal()
    await userEvent.click(await screen.findByRole('button', { name: /Browse/ }))
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'search_directory')).toHaveLength(0)
  })
})

describe('FixSetMissingSamplesModal - apply edge cases', () => {
  it('backs up the sibling a Move to Pool will repoint, on top of the project being fixed', async () => {
    invokeMock.mockImplementation((cmd: string, args: { projectPath?: string }) => {
      if (cmd === 'search_other_projects_of_set' && args.projectPath === '/set/PROJ1') {
        return Promise.resolve([{ filename: 'kick.wav', found_path: '/set/OTHER/kick.wav', source_project: 'OTHER' }])
      }
      if (cmd === 'fix_missing_samples') return Promise.resolve({ resolved_count: 1, files_copied: 0, files_moved: 1, projects_updated: [] })
      return Promise.resolve([])
    })
    renderModal({ otherProjectOption: 'move_to_pool' })
    await goToReview()
    expect(screen.getByText('kick.wav').closest('tr')!).toHaveTextContent('Move to Pool')

    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    await waitFor(() => {
      const backups = invokeMock.mock.calls
        .filter(([cmd]) => cmd === 'backup_project_files')
        .map(([, a]) => (a as { projectPath: string }).projectPath)
      expect(backups).toContain('/set/PROJ1')
      expect(backups).toContain('/set/OTHER')
    })
  })

  it('keeps going when one project fails, and reports which one', async () => {
    invokeMock.mockImplementation((cmd: string, args: { projectPath?: string }) => {
      if (cmd === 'search_project_dir') {
        return Promise.resolve([{ filename: args.projectPath === '/set/PROJ1' ? 'kick.wav' : 'snare.wav', found_path: `${args.projectPath}/found.wav`, source_project: null }])
      }
      if (cmd === 'fix_missing_samples') {
        if (args.projectPath === '/set/PROJ1') return Promise.reject('disk full')
        return Promise.resolve({ resolved_count: 1, files_copied: 0, files_moved: 0, projects_updated: [] })
      }
      return Promise.resolve([])
    })
    renderModal()
    await goToReview()
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))

    // PROJ2 still ran, and the failure names the project it came from
    await waitFor(() => expect(screen.getByText(/PROJ1: disk full/)).toBeInTheDocument())
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'fix_missing_samples')).toHaveLength(2)
    expect(screen.getByText(/1 samples resolved in 1 project/)).toBeInTheDocument()
  })
})

describe('FixSetMissingSamplesModal - Escape', () => {
  it('ignores Escape while the search is still running', async () => {
    const onClose = vi.fn()
    let release: (v: unknown) => void = () => {}
    const pending = new Promise(r => { release = r })
    invokeMock.mockImplementation((cmd: string) => (cmd === 'search_project_dir' ? pending : Promise.resolve([])))
    renderModal({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    // "Review changes" is on screen during the search too, just disabled - the
    // modal only becomes dismissible once the search actually finishes.
    release([])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review changes' })).toBeEnabled())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

