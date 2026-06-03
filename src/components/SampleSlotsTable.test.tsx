import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SampleSlotsTable } from './SampleSlotsTable'
import { TablePreferencesProvider } from '../context/TablePreferencesContext'

const mockSlots = [
  {
    slot_id: 1,
    slot_type: 'flex',
    path: 'samples/kick.wav',
    gain: 72,
    loop_mode: 'Off',
    timestretch_mode: 'Off',
    source_location: 'Project',
    file_exists: true,
    compatibility: 'compatible',
    file_format: 'WAV',
    bit_depth: 16,
    sample_rate: 44100,
  },
  {
    slot_id: 2,
    slot_type: 'flex',
    path: null,
    gain: null,
    loop_mode: null,
    timestretch_mode: null,
    source_location: null,
    file_exists: false,
    compatibility: null,
    file_format: null,
    bit_depth: null,
    sample_rate: null,
  },
  {
    slot_id: 3,
    slot_type: 'flex',
    path: 'samples/snare.wav',
    gain: 64,
    loop_mode: 'On',
    timestretch_mode: 'Normal',
    source_location: 'Project',
    file_exists: true,
    compatibility: 'compatible',
    file_format: 'AIFF',
    bit_depth: 24,
    sample_rate: 44100,
  },
]

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <TablePreferencesProvider>{ui}</TablePreferencesProvider>
  )
}

describe('SampleSlotsTable', () => {
  it('renders slot rows from props', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByText('kick.wav')).toBeInTheDocument()
    expect(screen.getByText('snare.wav')).toBeInTheDocument()
  })

  it('renders table with slot and sample columns', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    // Table headers — check for th elements with class names
    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    // Verify slot data renders in the table
    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.getByText('kick.wav')).toBeInTheDocument()
  })

  it('shows slot prefix with slot id', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.getByText('F3')).toBeInTheDocument()
  })

  it('has search input', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('has copy button', () => {
    renderWithProvider(
      <SampleSlotsTable slots={mockSlots} slotPrefix="F" tableType="flex" />
    )
    expect(screen.getByTitle(/copy/i)).toBeInTheDocument()
  })
})
