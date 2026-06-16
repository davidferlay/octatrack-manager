import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AudioFileTable } from './AudioFileTable'
import type { AudioFile } from '../types/audioFile'

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
})
