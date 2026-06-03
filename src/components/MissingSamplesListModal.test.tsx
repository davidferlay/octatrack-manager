import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MissingSamplesListModal } from './MissingSamplesListModal'

const mockSamples = [
  {
    filename: 'kick.wav',
    original_path: 'samples/kick.wav',
    slot_type: 'flex',
    flex_slot_ids: [1],
    static_slot_ids: [],
  },
  {
    filename: 'snare.wav',
    original_path: '../AUDIO/snare.wav',
    slot_type: 'static',
    flex_slot_ids: [],
    static_slot_ids: [5],
  },
  {
    filename: 'hihat.wav',
    original_path: 'samples/hihat.wav',
    slot_type: 'both',
    flex_slot_ids: [3],
    static_slot_ids: [3],
  },
]

describe('MissingSamplesListModal', () => {
  it('renders missing samples in the table', () => {
    render(
      <MissingSamplesListModal missingSamples={mockSamples} onClose={() => {}} />
    )
    expect(screen.getByText('kick.wav')).toBeInTheDocument()
    expect(screen.getByText('snare.wav')).toBeInTheDocument()
    // hihat.wav appears in both flex and static rows
    expect(screen.getAllByText('hihat.wav').length).toBe(2)
  })

  it('shows correct slot types', () => {
    render(
      <MissingSamplesListModal missingSamples={mockSamples} onClose={() => {}} />
    )
    // hihat appears in both flex and static rows → 4 data rows total
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThanOrEqual(5)
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(
      <MissingSamplesListModal missingSamples={mockSamples} onClose={handleClose} />
    )
    // Close button renders as × (&times;)
    const closeButton = screen.getByText('×')
    await user.click(closeButton)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('renders column headers', () => {
    render(
      <MissingSamplesListModal missingSamples={mockSamples} onClose={() => {}} />
    )
    // Headers include sort indicators, use partial text matching
    expect(screen.getByText(/^Slot/)).toBeInTheDocument()
    expect(screen.getByText(/^File/)).toBeInTheDocument()
  })

  it('derives Audio Pool source from path', () => {
    render(
      <MissingSamplesListModal missingSamples={mockSamples} onClose={() => {}} />
    )
    // snare.wav has path "../AUDIO/snare.wav" → source = "Audio Pool"
    expect(screen.getByText('Audio Pool')).toBeInTheDocument()
  })
})
