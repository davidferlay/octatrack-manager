import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LibraryProject } from '../../api'
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
    expect(screen.getByText('Project file')).toBeInTheDocument()
    expect(screen.getByText('Banks present')).toBeInTheDocument()
    expect(screen.getByText('2 local samples')).toBeInTheDocument()
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

    expect(screen.getByText('No project file')).toBeInTheDocument()
    expect(screen.getByText('No banks')).toBeInTheDocument()
    expect(screen.getByText('0 local samples')).toBeInTheDocument()
  })
})
