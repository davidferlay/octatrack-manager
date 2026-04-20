import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrackSelector, ALL_AUDIO_TRACKS, ALL_MIDI_TRACKS } from './TrackSelector'

describe('TrackSelector', () => {
  it('renders with label', () => {
    render(
      <TrackSelector id="test-track" value={0} onChange={() => {}} />
    )
    expect(screen.getByText('Track:')).toBeInTheDocument()
  })

  it('renders select element with correct id', () => {
    render(
      <TrackSelector id="test-track" value={0} onChange={() => {}} />
    )
    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'test-track')
  })

  it('shows All Audio Tracks option', () => {
    render(
      <TrackSelector id="test-track" value={ALL_AUDIO_TRACKS} onChange={() => {}} />
    )
    expect(screen.getByText('All Audio Tracks')).toBeInTheDocument()
  })

  it('shows All MIDI Tracks option', () => {
    render(
      <TrackSelector id="test-track" value={ALL_MIDI_TRACKS} onChange={() => {}} />
    )
    expect(screen.getByText('All MIDI Tracks')).toBeInTheDocument()
  })

  it('renders 8 audio track options', () => {
    render(
      <TrackSelector id="test-track" value={0} onChange={() => {}} />
    )
    const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
    const options = within(audioGroup).getAllByRole('option')
    expect(options).toHaveLength(8)
  })

  it('renders 8 MIDI track options', () => {
    render(
      <TrackSelector id="test-track" value={0} onChange={() => {}} />
    )
    const midiGroup = screen.getByRole('group', { name: 'MIDI Tracks' })
    const options = within(midiGroup).getAllByRole('option')
    expect(options).toHaveLength(8)
  })

  it('calls onChange when selection changes', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <TrackSelector id="test-track" value={0} onChange={handleChange} />
    )

    await user.selectOptions(screen.getByRole('combobox'), '3')
    expect(handleChange).toHaveBeenCalledWith(3)
  })

  it('calls onChange with MIDI track index', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <TrackSelector id="test-track" value={0} onChange={handleChange} />
    )

    await user.selectOptions(screen.getByRole('combobox'), '10')
    expect(handleChange).toHaveBeenCalledWith(10)
  })

  it('calls onChange with ALL_AUDIO_TRACKS', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <TrackSelector id="test-track" value={0} onChange={handleChange} />
    )

    await user.selectOptions(screen.getByRole('combobox'), String(ALL_AUDIO_TRACKS))
    expect(handleChange).toHaveBeenCalledWith(ALL_AUDIO_TRACKS)
  })

  describe('constants', () => {
    it('exports ALL_AUDIO_TRACKS as -1', () => {
      expect(ALL_AUDIO_TRACKS).toBe(-1)
    })

    it('exports ALL_MIDI_TRACKS as -2', () => {
      expect(ALL_MIDI_TRACKS).toBe(-2)
    })
  })

  describe('currentTrack indicator', () => {
    it('marks audio track as Active', () => {
      render(
        <TrackSelector id="test-track" value={0} onChange={() => {}} currentTrack={2} />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      expect(options[2].textContent).toContain('(Active)')
    })

    it('does not mark non-current tracks as Active', () => {
      render(
        <TrackSelector id="test-track" value={0} onChange={() => {}} currentTrack={2} />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      expect(options[0].textContent).not.toContain('(Active)')
      expect(options[1].textContent).not.toContain('(Active)')
      expect(options[3].textContent).not.toContain('(Active)')
    })

    it('does not show Active when currentTrack is undefined', () => {
      render(
        <TrackSelector id="test-track" value={0} onChange={() => {}} />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      options.forEach(option => {
        expect(option.textContent).not.toContain('(Active)')
      })
    })
  })

  describe('machine type display', () => {
    const machineTypes: Record<number, string> = {
      0: 'Flex',
      1: 'Flex',
      2: 'Static',
      3: 'Thru',
      4: 'Neighbor',
      5: 'Pickup',
      6: 'Flex',
      7: 'Static',
    }

    it('shows machine type for each audio track', () => {
      render(
        <TrackSelector
          id="test-track"
          value={0}
          onChange={() => {}}
          audioTrackMachineTypes={machineTypes}
        />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      expect(options[0].textContent).toContain('T1 (Flex)')
      expect(options[1].textContent).toContain('T2 (Flex)')
      expect(options[2].textContent).toContain('T3 (Static)')
      expect(options[3].textContent).toContain('T4 (Thru)')
      expect(options[4].textContent).toContain('T5 (Neighbor)')
      expect(options[5].textContent).toContain('T6 (Pickup)')
      expect(options[6].textContent).toContain('T7 (Flex)')
      expect(options[7].textContent).toContain('T8 (Static)')
    })

    it('falls back to "Audio" when no machine types provided', () => {
      render(
        <TrackSelector id="test-track" value={0} onChange={() => {}} />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      options.forEach(option => {
        expect(option.textContent).toContain('(Audio)')
      })
    })

    it('falls back to "Audio" when audioTrackMachineTypes is empty', () => {
      render(
        <TrackSelector
          id="test-track"
          value={0}
          onChange={() => {}}
          audioTrackMachineTypes={{}}
        />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      options.forEach(option => {
        expect(option.textContent).toContain('(Audio)')
      })
    })

    it('falls back to "Audio" for tracks missing from the map', () => {
      const partial: Record<number, string> = { 0: 'Flex', 3: 'Thru' }
      render(
        <TrackSelector
          id="test-track"
          value={0}
          onChange={() => {}}
          audioTrackMachineTypes={partial}
        />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      expect(options[0].textContent).toContain('T1 (Flex)')
      expect(options[1].textContent).toContain('T2 (Audio)')
      expect(options[2].textContent).toContain('T3 (Audio)')
      expect(options[3].textContent).toContain('T4 (Thru)')
      expect(options[4].textContent).toContain('T5 (Audio)')
    })

    it('does not affect MIDI track labels', () => {
      render(
        <TrackSelector
          id="test-track"
          value={0}
          onChange={() => {}}
          audioTrackMachineTypes={machineTypes}
        />
      )
      const midiGroup = screen.getByRole('group', { name: 'MIDI Tracks' })
      const options = within(midiGroup).getAllByRole('option')
      options.forEach(option => {
        expect(option.textContent).toContain('(MIDI)')
        expect(option.textContent).not.toContain('(Flex)')
        expect(option.textContent).not.toContain('(Static)')
      })
    })

    it('shows machine type together with Active indicator', () => {
      render(
        <TrackSelector
          id="test-track"
          value={0}
          onChange={() => {}}
          currentTrack={2}
          audioTrackMachineTypes={{ 2: 'Thru' }}
        />
      )
      const audioGroup = screen.getByRole('group', { name: 'Audio Tracks' })
      const options = within(audioGroup).getAllByRole('option')
      expect(options[2].textContent).toBe('T3 (Thru) (Active)')
    })
  })
})
