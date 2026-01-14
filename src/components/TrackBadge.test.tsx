import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrackBadge } from './TrackBadge'

describe('TrackBadge', () => {
  describe('audio tracks (0-7)', () => {
    it('renders audio track 0 as T1', () => {
      render(<TrackBadge trackId={0} />)
      expect(screen.getByText('T1')).toBeInTheDocument()
    })

    it('applies audio class for audio tracks', () => {
      render(<TrackBadge trackId={0} />)
      const badge = screen.getByText('T1')
      expect(badge).toHaveClass('audio')
    })

    it('has Audio Track title for audio tracks', () => {
      render(<TrackBadge trackId={3} />)
      const badge = screen.getByText('T4')
      expect(badge).toHaveAttribute('title', 'Audio Track')
    })
  })

  describe('MIDI tracks (8-15)', () => {
    it('renders MIDI track 8 as T1', () => {
      render(<TrackBadge trackId={8} />)
      expect(screen.getByText('T1')).toBeInTheDocument()
    })

    it('applies midi class for MIDI tracks', () => {
      render(<TrackBadge trackId={8} />)
      const badge = screen.getByText('T1')
      expect(badge).toHaveClass('midi')
    })

    it('has MIDI Track title for MIDI tracks', () => {
      render(<TrackBadge trackId={10} />)
      const badge = screen.getByText('T3')
      expect(badge).toHaveAttribute('title', 'MIDI Track')
    })
  })

  describe('className prop', () => {
    it('applies additional className', () => {
      render(<TrackBadge trackId={0} className="custom-class" />)
      const badge = screen.getByText('T1')
      expect(badge).toHaveClass('custom-class')
    })

    it('includes base classes with custom className', () => {
      render(<TrackBadge trackId={0} className="custom" />)
      const badge = screen.getByText('T1')
      expect(badge).toHaveClass('pattern-track-indicator')
      expect(badge).toHaveClass('track-badge')
      expect(badge).toHaveClass('audio')
      expect(badge).toHaveClass('custom')
    })
  })
})
