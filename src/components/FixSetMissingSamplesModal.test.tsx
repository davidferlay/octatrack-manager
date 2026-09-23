import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FixSetMissingSamplesModal, type ProjectMissing } from './FixSetMissingSamplesModal'

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
