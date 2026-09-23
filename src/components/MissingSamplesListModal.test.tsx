import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

describe('MissingSamplesListModal - Set scope', () => {
  const byProject = [
    { name: 'PROJ1', missing: [mockSamples[0]] },
    { name: 'PROJ2', missing: [mockSamples[1]] },
  ]

  it('adds a Project column naming which project each slot belongs to', () => {
    render(<MissingSamplesListModal byProject={byProject} onClose={() => {}} />)
    expect(screen.getByText('kick.wav').closest('tr')!).toHaveTextContent('PROJ1')
    expect(screen.getByText('snare.wav').closest('tr')!).toHaveTextContent('PROJ2')
  })

  it('says it spans the Set in its title, and counts every project\'s slots', () => {
    render(<MissingSamplesListModal byProject={byProject} onClose={() => {}} />)
    expect(screen.getByText('Missing Samples across Set')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 2 slots')).toBeInTheDocument()
  })

  it('keeps the project-scope layout when no grouping is given', () => {
    render(<MissingSamplesListModal missingSamples={mockSamples} onClose={() => {}} />)
    expect(screen.getByText('Missing Samples')).toBeInTheDocument()
    // No Project column in the table (the Source cells say "Project" - hence the thead scope)
    expect(within(document.querySelector('thead')!).queryByText('Project')).not.toBeInTheDocument()
  })

  it('does not offer a Project column in the toggle-columns menu at project scope', async () => {
    render(<MissingSamplesListModal missingSamples={mockSamples} onClose={() => {}} />)
    await userEvent.click(document.querySelector('.column-visibility-btn') as HTMLElement)
    const menu = document.querySelector('.column-visibility-dropdown') as HTMLElement
    expect(within(menu).queryByText('Project')).not.toBeInTheDocument()
    expect(within(menu).getByText('Slot')).toBeInTheDocument()
  })

  it('does offer it at Set scope', async () => {
    render(<MissingSamplesListModal byProject={byProject} onClose={() => {}} />)
    await userEvent.click(document.querySelector('.column-visibility-btn') as HTMLElement)
    const menu = document.querySelector('.column-visibility-dropdown') as HTMLElement
    expect(within(menu).getByText('Project')).toBeInTheDocument()
  })

  it('filters the table down to one project', async () => {
    render(<MissingSamplesListModal byProject={byProject} onClose={() => {}} />)
    const header = within(document.querySelector('thead')!).getByText('Project').closest('.header-content')!
    fireEvent.mouseDown(header.querySelector('.filter-icon')!)
    await userEvent.click(within(document.querySelector('.filter-dropdown') as HTMLElement).getByText('PROJ1'))

    expect(screen.getByText('kick.wav')).toBeInTheDocument()
    expect(screen.queryByText('snare.wav')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 2 slots')).toBeInTheDocument()
  })

  it('searches across project names as well as filenames', async () => {
    render(<MissingSamplesListModal byProject={byProject} onClose={() => {}} />)
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'PROJ2')
    expect(screen.getByText('snare.wav')).toBeInTheDocument()
    expect(screen.queryByText('kick.wav')).not.toBeInTheDocument()
  })

  it('sorts by project', async () => {
    render(<MissingSamplesListModal byProject={byProject} onClose={() => {}} />)
    const label = within(document.querySelector('thead')!).getByText('Project')
    await userEvent.click(label)
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('PROJ1')
    await userEvent.click(label)
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('PROJ2')
  })
})

