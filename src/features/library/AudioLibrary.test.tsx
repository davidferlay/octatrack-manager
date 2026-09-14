import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { tJa } from '../../i18n/testStrings'
import { AudioLibrary } from './AudioLibrary'

describe('AudioLibrary', () => {
  it('renders Audio Pool scope with relative parent path only', () => {
    render(
      <AudioLibrary scope="audio_pool" parentPath="LIVE_SET" fileCount={3}>
        <div>Library body</div>
      </AudioLibrary>,
    )

    expect(screen.getByText(tJa('audioLibrary.kicker'))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: tJa('audioLibrary.poolTitle') })).toBeInTheDocument()
    expect(screen.getByText('LIVE_SET')).toBeInTheDocument()
    expect(screen.getByText(tJa('audioLibrary.setPool'))).toBeInTheDocument()
    expect(screen.getByText(tJa('audioLibrary.filesInViewPlural', { count: 3 }))).toBeInTheDocument()
    expect(screen.getByText('Library body')).toBeInTheDocument()
    expect(screen.queryByText('/private/')).not.toBeInTheDocument()
  })

  it('renders unclassified scope without a parent path', () => {
    render(<AudioLibrary scope="unclassified" fileCount={0} />)

    expect(screen.getByRole('heading', { name: tJa('audioLibrary.unclassifiedTitle') })).toBeInTheDocument()
    expect(screen.getByText(tJa('audioLibrary.outsideSetProject'))).toBeInTheDocument()
    expect(screen.getByText(tJa('audioLibrary.filesInViewPlural', { count: 0 }))).toBeInTheDocument()
  })
})
