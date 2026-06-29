import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SamplePlayerBar } from './SamplePlayerBar'
import type { AudioPreview } from '../hooks/useAudioPreview'

function makePlayer(overrides: Partial<AudioPreview> = {}): AudioPreview {
  return {
    isPlaying: false, currentTime: 0, duration: 4, activeName: 'kick.wav', error: false,
    volume: 0.8, autoPreview: false,
    play: vi.fn(), load: vi.fn(), pause: vi.fn(), togglePlay: vi.fn(), seek: vi.fn(),
    setVolume: vi.fn(), setAutoPreview: vi.fn(), ...overrides,
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
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('toggles auto-preview', () => {
    const player = makePlayer()
    render(<SamplePlayerBar player={player} playable={true} />)
    fireEvent.click(screen.getByLabelText(/auto-preview/i))
    expect(player.setAutoPreview).toHaveBeenCalledWith(true)
  })
})
