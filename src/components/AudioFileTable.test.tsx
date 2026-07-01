import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AudioFileTable } from './AudioFileTable'
import type { AudioFile } from '../types/audioFile'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

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
})
