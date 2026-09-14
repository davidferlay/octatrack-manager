import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LibraryProject } from '../../api'
import { tJa } from '../../i18n/testStrings'
import { ProjectWorkspace } from './ProjectWorkspace'

const project: LibraryProject = {
  displayName: 'PROJECT_A',
  relativePath: 'LIVE_SET/PROJECT_A',
  hasProjectFile: true,
  hasBanks: true,
}

describe('ProjectWorkspace', () => {
  it('renders catalog display fields without absolute paths', () => {
    render(
      <ProjectWorkspace project={project} localSampleCount={2}>
        <div>Workspace body</div>
      </ProjectWorkspace>,
    )

    expect(screen.getByRole('heading', { name: 'PROJECT_A' })).toBeInTheDocument()
    expect(screen.getByText('LIVE_SET/PROJECT_A')).toBeInTheDocument()
    expect(screen.getByText(tJa('projectWorkspace.hasProjectFile'))).toBeInTheDocument()
    expect(screen.getByText(tJa('projectWorkspace.hasBanks'))).toBeInTheDocument()
    expect(screen.getByText(tJa('projectWorkspace.localSamplesPlural', { count: 2 }))).toBeInTheDocument()
    expect(screen.getByText('Workspace body')).toBeInTheDocument()
    expect(screen.queryByText('/private/')).not.toBeInTheDocument()
  })

  it('labels missing project file and banks', () => {
    render(
      <ProjectWorkspace
        project={{
          ...project,
          hasProjectFile: false,
          hasBanks: false,
        }}
        localSampleCount={0}
      />,
    )

    expect(screen.getByText(tJa('projectWorkspace.noProjectFile'))).toBeInTheDocument()
    expect(screen.getByText(tJa('projectWorkspace.noBanks'))).toBeInTheDocument()
    expect(screen.getByText(tJa('projectWorkspace.localSamplesPlural', { count: 0 }))).toBeInTheDocument()
  })
})
