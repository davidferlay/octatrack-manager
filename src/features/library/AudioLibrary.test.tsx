import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AudioLibrary } from './AudioLibrary'

describe('AudioLibrary', () => {
  it('renders Audio Pool scope with relative parent path only', () => {
    render(
      <AudioLibrary scope="audio_pool" parentPath="LIVE_SET" fileCount={3}>
        <div>Library body</div>
      </AudioLibrary>,
    )

    expect(screen.getByText('Audio library')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Audio Pool' })).toBeInTheDocument()
    expect(screen.getByText('LIVE_SET')).toBeInTheDocument()
    expect(screen.getByText('Set audio pool')).toBeInTheDocument()
    expect(screen.getByText('3 files in view')).toBeInTheDocument()
    expect(screen.getByText('Library body')).toBeInTheDocument()
    expect(screen.queryByText('/private/')).not.toBeInTheDocument()
  })

  it('renders unclassified scope without a parent path', () => {
    render(<AudioLibrary scope="unclassified" fileCount={0} />)

    expect(screen.getByRole('heading', { name: 'Unclassified audio' })).toBeInTheDocument()
    expect(screen.getByText('Outside set/project')).toBeInTheDocument()
    expect(screen.getByText('0 files in view')).toBeInTheDocument()
  })
})
