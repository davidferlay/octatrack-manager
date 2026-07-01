import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { invoke } from '@tauri-apps/api/core'
import { FixMissingSamplesModal } from './FixMissingSamplesModal'

const mockInvoke = vi.mocked(invoke)

// Each search step enforces a 400ms minimum duration; searches run 3 steps sequentially
const SEARCH_TIMEOUT = { timeout: 5000 }

const missingSamples = [
  { filename: 'kick.wav', original_path: 'samples/kick.wav', slot_type: 'flex', flex_slot_ids: [1], static_slot_ids: [] },
  { filename: 'snare.wav', original_path: '../AUDIO/snare.wav', slot_type: 'static', flex_slot_ids: [], static_slot_ids: [5] },
  { filename: 'hat.wav', original_path: 'samples/hat.wav', slot_type: 'flex', flex_slot_ids: [3], static_slot_ids: [] },
  { filename: 'lost.wav', original_path: 'samples/lost.wav', slot_type: 'flex', flex_slot_ids: [4], static_slot_ids: [] },
]

// kick found in the project, snare in the pool, hat in a sibling project, lost nowhere
function mockSearchBackend() {
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'search_project_dir':
        return [{ filename: 'kick.wav', found_path: '/set/PROJ/samples/kick.wav', source_project: null }]
      case 'search_audio_pool':
        return [{ filename: 'snare.wav', found_path: '/set/AUDIO/drums/snare.wav', source_project: null }]
      case 'search_other_projects_of_set':
        return [{ filename: 'hat.wav', found_path: '/set/OTHER/hat.wav', source_project: 'OTHER' }]
      case 'backup_project_files':
        return null
      case 'fix_missing_samples':
        return { resolved_count: 3, files_copied: 0, files_moved: 1, projects_updated: ['PROJ', 'OTHER'] }
      default:
        return []
    }
  })
}

function renderModal(overrides?: Partial<Parameters<typeof FixMissingSamplesModal>[0]>) {
  const props = {
    projectPath: '/set/PROJ',
    projectName: 'PROJ',
    missingSamples,
    poolOption: 'use_from_pool' as const,
    otherProjectOption: 'move_to_pool' as const,
    hasAudioPool: true,
    skipReview: false,
    onClose: vi.fn(),
    onApplied: vi.fn(),
    ...overrides,
  }
  render(<FixMissingSamplesModal {...props} />)
  return props
}

async function waitForSearchDone() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Review changes' })).toBeEnabled()
  }, SEARCH_TIMEOUT)
}

describe('FixMissingSamplesModal - search phase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchBackend()
  })

  it('runs project, pool and other-set searches when the project has a pool', async () => {
    renderModal()

    expect(screen.getByText('Project directory')).toBeInTheDocument()
    expect(screen.getByText('Audio Pool')).toBeInTheDocument()
    expect(screen.getByText('Other Set projects')).toBeInTheDocument()

    await waitForSearchDone()

    const searchCalls = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(searchCalls).toContain('search_project_dir')
    expect(searchCalls).toContain('search_audio_pool')
    expect(searchCalls).toContain('search_other_projects_of_set')
    expect(searchCalls).not.toContain('search_parent_projects')
  })

  it('searches the parent directory instead when the project has no pool', async () => {
    renderModal({ hasAudioPool: false })

    expect(screen.getByText('Parent directory')).toBeInTheDocument()
    expect(screen.queryByText('Other Set projects')).not.toBeInTheDocument()

    await waitForSearchDone()

    const searchCalls = mockInvoke.mock.calls.map(([cmd]) => cmd)
    expect(searchCalls).toContain('search_parent_projects')
    // Audio Pool step is skipped, not invoked
    expect(searchCalls).not.toContain('search_audio_pool')
  })

  it('search steps pass only still-missing filenames to each backend call', async () => {
    renderModal()
    await waitForSearchDone()

    const callFor = (cmd: string) => mockInvoke.mock.calls.find(([c]) => c === cmd)?.[1] as any
    expect(callFor('search_project_dir').filenames).toEqual(['kick.wav', 'snare.wav', 'hat.wav', 'lost.wav'])
    expect(callFor('search_audio_pool').filenames).toEqual(['snare.wav', 'hat.wav', 'lost.wav'])
    expect(callFor('search_other_projects_of_set').filenames).toEqual(['hat.wav', 'lost.wav'])
  })
})

describe('FixMissingSamplesModal - review and apply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchBackend()
  })

  it('applies resolutions with the correct action and slot path per source', async () => {
    const props = renderModal()
    await waitForSearchDone()

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))

    await waitFor(() => {
      expect(props.onApplied).toHaveBeenCalled()
    }, SEARCH_TIMEOUT)

    const fixCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'fix_missing_samples')
    expect(fixCall).toBeDefined()
    const { projectPath, resolutions } = fixCall![1] as any
    expect(projectPath).toBe('/set/PROJ')
    expect(resolutions).toEqual([
      // Found in the project itself: only the slot path is updated (project-relative)
      { filename: 'kick.wav', found_path: '/set/PROJ/samples/kick.wav', action: 'update_path', new_slot_path: 'samples/kick.wav' },
      // Found in the pool with use_from_pool: path rewritten relative to the Set
      { filename: 'snare.wav', found_path: '/set/AUDIO/drums/snare.wav', action: 'update_path', new_slot_path: '../AUDIO/drums/snare.wav' },
      // Found in a sibling project with move_to_pool: moved into the pool
      { filename: 'hat.wav', found_path: '/set/OTHER/hat.wav', action: 'move_to_pool', new_slot_path: '../AUDIO/hat.wav' },
    ])
  })

  it('backs up the project and the affected sibling project before applying', async () => {
    const props = renderModal()
    await waitForSearchDone()

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    await waitFor(() => {
      expect(props.onApplied).toHaveBeenCalled()
    }, SEARCH_TIMEOUT)

    const backupPaths = mockInvoke.mock.calls
      .filter(([cmd]) => cmd === 'backup_project_files')
      .map(([, args]) => (args as any).projectPath)
    expect(backupPaths).toContain('/set/PROJ')
    expect(backupPaths).toContain('/set/OTHER') // hat.wav moves out of sibling project OTHER
  })

  it('copies instead of updating paths when both options are copy_to_project', async () => {
    const props = renderModal({ poolOption: 'copy_to_project', otherProjectOption: 'copy_to_project' })
    await waitForSearchDone()

    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    await waitFor(() => {
      expect(props.onApplied).toHaveBeenCalled()
    }, SEARCH_TIMEOUT)

    const fixCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'fix_missing_samples')
    const { resolutions } = fixCall![1] as any
    expect(resolutions.map((r: any) => [r.filename, r.action, r.new_slot_path])).toEqual([
      ['kick.wav', 'update_path', 'samples/kick.wav'],
      ['snare.wav', 'copy_to_project', 'snare.wav'],
      ['hat.wav', 'copy_to_project', 'hat.wav'],
    ])

    // No sibling project backup needed when nothing moves out of it
    const backupPaths = mockInvoke.mock.calls
      .filter(([cmd]) => cmd === 'backup_project_files')
      .map(([, args]) => (args as any).projectPath)
    expect(backupPaths).toEqual(['/set/PROJ'])
  })

  it('auto-applies without review when skipReview is set', async () => {
    const props = renderModal({ skipReview: true })

    await waitFor(() => {
      expect(props.onApplied).toHaveBeenCalled()
    }, SEARCH_TIMEOUT)

    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'fix_missing_samples')).toBe(true)
    // Done phase offers a close button
    await userEvent.click(screen.getByRole('button', { name: /Done|Close/ }))
    expect(props.onClose).toHaveBeenCalled()
  })
})
