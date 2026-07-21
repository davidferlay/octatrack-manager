import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext } from '@dnd-kit/core'
import { AudioFileTable } from './AudioFileTable'
import type { AudioFile, PoolUsageEntry } from '../types/audioFile'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

// invokeMock is module-scoped: without a reset, a mockResolvedValue set by one test
// (e.g. the recursive-search test below) leaks into every later test that renders
// with poolRoot set, resolving the unrelated compat-inspection effect with stale
// data and triggering an unawaited setState outside act().
beforeEach(() => { invokeMock.mockReset(); })

const files: AudioFile[] = [
  { name: 'kick.wav', size: 1024, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: '/AUDIO/kick.wav' },
  { name: 'snare.wav', size: 2048, channels: 1, bit_rate: 24, sample_rate: 48000, is_directory: false, path: '/AUDIO/snare.wav' },
]

function renderTable(props: Partial<React.ComponentProps<typeof AudioFileTable>> = {}) {
  return render(
    <AudioFileTable
      files={files}
      selectedFiles={new Set()}
      onFileClick={vi.fn()}
      isLoading={false}
      emptyMessage="No audio files"
      tableId="test-table"
      {...props}
    />
  )
}

describe('AudioFileTable', () => {
  it('renders all columns by default (Name, Format, Bit, kHz, Size)', () => {
    renderTable()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Format')).toBeInTheDocument()
    expect(screen.getByText('Bit')).toBeInTheDocument()
    expect(screen.getByText('kHz')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
  })

  it('honors initialColumnVisibility — only Name and Size when others are hidden', () => {
    renderTable({ initialColumnVisibility: { format: false, bitrate: false, samplerate: false } })
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.queryByText('Format')).not.toBeInTheDocument()
    expect(screen.queryByText('Bit')).not.toBeInTheDocument()
    expect(screen.queryByText('kHz')).not.toBeInTheDocument()
  })

  it('renders the file rows', () => {
    renderTable()
    expect(screen.getByText('kick.wav')).toBeInTheDocument()
    expect(screen.getByText('snare.wav')).toBeInTheDocument()
  })

  it('shows the Show/Hide Columns control', () => {
    renderTable()
    expect(screen.getByTitle(/Show\/Hide Columns/i)).toBeInTheDocument()
  })

  it('shows the pool-relative path on hover when poolRoot is set', () => {
    renderTable({ poolRoot: '/AUDIO' })
    expect(screen.getByText('kick.wav').closest('td')?.getAttribute('title')).toBe('AUDIO/kick.wav')
  })

  it('falls back to the plain name as hover title when poolRoot is absent', () => {
    renderTable()
    expect(screen.getByText('kick.wav').closest('td')?.getAttribute('title')).toBe('kick.wav')
  })

  it('searches recursively from the current directory when searchRoot is set', async () => {
    // A match that lives in a subfolder — not in the current-directory `files`.
    invokeMock.mockResolvedValue([
      { name: 'deep-hat.wav', size: 10, channels: 2, bit_rate: 16, sample_rate: 44100, is_directory: false, path: '/AUDIO/Drums/hats/deep-hat.wav' },
    ] satisfies AudioFile[])
    renderTable({ poolRoot: '/AUDIO', searchRoot: '/AUDIO/Drums' })

    await userEvent.type(screen.getByPlaceholderText('Search...'), 'deep')

    // Recursion roots at the current directory, not the pool root.
    expect(invokeMock).toHaveBeenCalledWith('list_audio_directory_recursive', { path: '/AUDIO/Drums' })
    expect(await screen.findByText('deep-hat.wav')).toBeInTheDocument()
    expect(screen.queryByText('kick.wav')).not.toBeInTheDocument()
  })

  it('makes a selected directory row draggable so it can be dropped on the pool', () => {
    const dirFiles: AudioFile[] = [
      { name: 'Drums', size: 0, channels: 0, bit_rate: null, sample_rate: null, is_directory: true, path: '/src/Drums' },
    ]
    renderTable({ files: dirFiles, draggable: true, selectedFiles: new Set(['/src/Drums']) })
    const row = screen.getByText('Drums').closest('tr')!
    expect(row.getAttribute('draggable')).toBe('true')
  })

  it('does not make an unselected directory row draggable', () => {
    const dirFiles: AudioFile[] = [
      { name: 'Drums', size: 0, channels: 0, bit_rate: null, sample_rate: null, is_directory: true, path: '/src/Drums' },
    ]
    renderTable({ files: dirFiles, draggable: true, selectedFiles: new Set() })
    const row = screen.getByText('Drums').closest('tr')!
    expect(row.getAttribute('draggable')).toBe('false')
  })

  it('fires onFileDoubleClick when a row is double-clicked', async () => {
    const onDouble = vi.fn()
    const dirFiles: AudioFile[] = [
      { name: 'Drums', size: 0, channels: 0, bit_rate: null, sample_rate: null, is_directory: true, path: '/src/Drums' },
    ]
    renderTable({ files: dirFiles, onFileDoubleClick: onDouble })
    await userEvent.dblClick(screen.getByText('Drums'))
    expect(onDouble).toHaveBeenCalledWith(dirFiles[0], 0, expect.anything())
  })

  it('fires onFileDoubleClick from a dnd-kit (pointer-drag) row too', async () => {
    const onDouble = vi.fn()
    const dirFiles: AudioFile[] = [
      { name: 'Drums', size: 0, channels: 0, bit_rate: null, sample_rate: null, is_directory: true, path: '/src/Drums' },
    ]
    // dndMode rows (used by the Source pane so macOS drag works) live inside a DndContext.
    render(
      <DndContext>
        <AudioFileTable
          files={dirFiles}
          selectedFiles={new Set()}
          onFileClick={vi.fn()}
          onFileDoubleClick={onDouble}
          isLoading={false}
          emptyMessage="No audio files"
          tableId="dnd-table"
          draggable
          dndMode
        />
      </DndContext>
    )
    await userEvent.dblClick(screen.getByText('Drums'))
    expect(onDouble).toHaveBeenCalledWith(dirFiles[0], 0, expect.anything())
  })

  // usageMap keys are normalized-lowercase (as produced by the Rust get_pool_usage
  // command), while file.path ('/AUDIO/kick.wav') keeps its original case - these
  // tests use lowercase keys throughout to prove the case-insensitive lookup works.
  it('shows Usage badges (audible and referenced) and a dash for unreferenced files, only when usageMap is set', () => {
    const usageMap: Record<string, PoolUsageEntry[]> = {
      '/audio/kick.wav': [
        { project: 'PROJ1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
        { project: 'PROJ2', bank: 1, kind: 'lock', track: 2, part: null, pattern: 3, step: 5, audible: false },
      ],
    }
    renderTable({ poolRoot: '/AUDIO', usageMap })
    expect(screen.getByText('Usage')).toBeInTheDocument()
    expect(screen.getByText('✓ 1')).toBeInTheDocument()
    expect(screen.getByText('○ 1')).toBeInTheDocument()
    // snare.wav has no usageMap entry
    const snareRow = screen.getByText('snare.wav').closest('tr')!
    expect(snareRow.querySelector('.usage-none')?.textContent).toBe('—')
  })

  it('does not show a Usage column when usageMap is absent', () => {
    renderTable({ poolRoot: '/AUDIO' })
    expect(screen.queryByText('Usage')).not.toBeInTheDocument()
  })

  it('opens a project-prefixed usage popover when a badge is clicked', async () => {
    const usageMap: Record<string, PoolUsageEntry[]> = {
      '/audio/kick.wav': [
        { project: 'PROJ1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
      ],
    }
    renderTable({ poolRoot: '/AUDIO', usageMap })
    await userEvent.click(screen.getByText('✓ 1'))
    expect(screen.getByText('PROJ1 · Bank A · Part 1 · T1 · Machine')).toBeInTheDocument()
  })

  it('sorts by Usage (audible-weighted total) when the Usage header is clicked', async () => {
    const usageMap: Record<string, PoolUsageEntry[]> = {
      '/audio/kick.wav': [
        { project: 'PROJ1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
      ],
      '/audio/snare.wav': [],
    }
    renderTable({ poolRoot: '/AUDIO', usageMap })
    await userEvent.click(screen.getByText('Usage'))
    const names = screen.getAllByText(/\.wav$/).map(el => el.textContent)
    expect(names[0]).toBe('snare.wav') // ascending: 0 usage first
  })

  it('filters rows via the Usage dropdown (Used / Referenced / Unused)', async () => {
    const usageMap: Record<string, PoolUsageEntry[]> = {
      '/audio/kick.wav': [
        { project: 'PROJ1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
      ],
    }
    renderTable({ poolRoot: '/AUDIO', usageMap })
    const usageHeader = screen.getByText('Usage').closest('.header-content')!
    await userEvent.click(usageHeader.querySelector('.filter-icon')!)
    await userEvent.click(screen.getByText('Unused'))
    expect(screen.queryByText('kick.wav')).not.toBeInTheDocument()
    expect(screen.getByText('snare.wav')).toBeInTheDocument()
  })

  it('re-filters rows when usageMap arrives after mount with a Used filter already active', async () => {
    const { rerender } = renderTable({ poolRoot: '/AUDIO', usageMap: {} })

    const usageHeader = screen.getByText('Usage').closest('.header-content')!
    await userEvent.click(usageHeader.querySelector('.filter-icon')!)
    await userEvent.click(screen.getByText('Used (plays)'))

    // usageMap is empty — nothing is used yet, so both files are filtered out.
    expect(screen.queryByText('kick.wav')).not.toBeInTheDocument()
    expect(screen.queryByText('snare.wav')).not.toBeInTheDocument()

    const usageMap: Record<string, PoolUsageEntry[]> = {
      '/audio/kick.wav': [
        { project: 'PROJ1', bank: 0, kind: 'machine', track: 0, part: 0, pattern: null, step: null, audible: true },
      ],
    }
    rerender(
      <AudioFileTable
        files={files}
        selectedFiles={new Set()}
        onFileClick={vi.fn()}
        isLoading={false}
        emptyMessage="No audio files"
        tableId="test-table"
        poolRoot="/AUDIO"
        usageMap={usageMap}
      />
    )

    expect(await screen.findByText('kick.wav')).toBeInTheDocument()
    expect(screen.queryByText('snare.wav')).not.toBeInTheDocument()
  })
})
