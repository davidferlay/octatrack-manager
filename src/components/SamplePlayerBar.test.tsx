import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SamplePlayerBar } from './SamplePlayerBar'
import type { AudioPreview } from '../hooks/useAudioPreview'

function makePlayer(overrides: Partial<AudioPreview> = {}): AudioPreview {
  return {
    isPlaying: false, currentTime: 0, duration: 4, activeName: 'kick.wav', error: false,
    volume: 0.8, autoPreview: false, loop: false,
    play: vi.fn(), load: vi.fn(), reset: vi.fn(), pause: vi.fn(), togglePlay: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setAutoPreview: vi.fn(), setLoop: vi.fn(), ...overrides,
  }
}

describe('SamplePlayerBar', () => {
  it('disables play when not playable', () => {
    render(<SamplePlayerBar player={makePlayer()} playable={false} />)
    expect(screen.getByLabelText(/play/i)).toBeDisabled()
  })

  it('toggles playback on click', () => {
    const player = makePlayer()
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.click(screen.getByLabelText(/play/i))
    expect(player.togglePlay).toHaveBeenCalled()
  })

  it('seeks on seek-bar change', () => {
    const player = makePlayer()
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.change(screen.getByLabelText(/seek/i), { target: { value: '2' } })
    expect(player.seek).toHaveBeenCalledWith(2)
  })

  it('raises volume on scroll up', () => {
    const player = makePlayer({ volume: 0.8 })
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.wheel(screen.getByLabelText(/volume/i), { deltaY: -100 })
    expect(player.setVolume).toHaveBeenCalledWith(0.85)
  })

  it('lowers volume on scroll down', () => {
    const player = makePlayer({ volume: 0.8 })
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.wheel(screen.getByLabelText(/volume/i), { deltaY: 100 })
    expect(player.setVolume).toHaveBeenCalledWith(0.75)
  })

  it('shows volume as a percentage', () => {
    render(<SamplePlayerBar player={makePlayer({ volume: 0.8 })} playable={true} />)
    expect(screen.getByText(/80%/)).toBeInTheDocument()
  })

  it('raises volume on drag up', () => {
    const player = makePlayer({ volume: 0.5 })
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.pointerDown(screen.getByLabelText(/volume/i), { clientY: 200 })
    fireEvent.pointerMove(window, { clientY: 125 }) // up 75px => +0.5
    expect(player.setVolume).toHaveBeenCalledWith(1)
  })

  it('hides every control when no sample is selected', () => {
    render(<SamplePlayerBar player={makePlayer({ activeName: '' })} playable={false} />)
    expect(screen.queryByText(/no sample selected/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/seek/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/play|pause/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/volume/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/auto-preview/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^loop$/i)).not.toBeInTheDocument()
  })

  it('toggles auto-preview', () => {
    const player = makePlayer()
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.click(screen.getByLabelText(/auto-preview/i))
    expect(player.setAutoPreview).toHaveBeenCalledWith(true)
  })

  it('toggles loop', () => {
    const player = makePlayer()
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.click(screen.getByLabelText(/^loop$/i))
    expect(player.setLoop).toHaveBeenCalledWith(true)
  })

  it('shows full LOOP/AUTO labels and a VOL label by default', () => {
    render(<SamplePlayerBar player={makePlayer()} playable={true} />)
    expect(screen.getByText('LOOP')).toBeInTheDocument()
    expect(screen.getByText('AUTO')).toBeInTheDocument()
    expect(screen.getByText('VOL')).toBeInTheDocument()
  })

  it('shortens LOOP/AUTO to L/A and drops the VOL label in compact mode', () => {
    render(<SamplePlayerBar player={makePlayer()} playable={true} compact={true} />)
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('LOOP')).not.toBeInTheDocument()
    expect(screen.queryByText('AUTO')).not.toBeInTheDocument()
    expect(screen.queryByText('VOL')).not.toBeInTheDocument()
    // The percentage value still renders even without the VOL label.
    expect(screen.getByText(/80%/)).toBeInTheDocument()
  })
})
