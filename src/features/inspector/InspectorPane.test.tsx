import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InspectorPane } from './InspectorPane'

describe('InspectorPane', () => {
  it('shows empty guidance when no asset is selected', () => {
    render(<InspectorPane />)
    expect(screen.getByLabelText('Inspector')).toBeInTheDocument()
    expect(screen.getByText('Notes & details')).toBeInTheDocument()
    expect(
      screen.getByText('Select an audio file to inspect waveform, usage, and notes.'),
    ).toBeInTheDocument()
  })

  it('renders asset label, relative path, and children without absolute paths', () => {
    render(
      <InspectorPane assetLabel="KICK.wav" relativePath="LIVE_SET/AUDIO/KICK.wav">
        <div>Waveform and notes</div>
      </InspectorPane>,
    )
    expect(screen.getByText('KICK.wav')).toBeInTheDocument()
    expect(screen.getByText('LIVE_SET/AUDIO/KICK.wav')).toBeInTheDocument()
    expect(screen.getByText('Waveform and notes')).toBeInTheDocument()
    expect(screen.queryByText('/private/')).not.toBeInTheDocument()
  })
})
