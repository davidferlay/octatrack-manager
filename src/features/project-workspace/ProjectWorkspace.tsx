import type { ReactNode } from 'react'
import type { LibraryProject } from '../../api'
import './ProjectWorkspace.css'

export interface ProjectWorkspaceProps {
  project: LibraryProject
  /** Count of project-local audio files from the catalog snapshot. */
  localSampleCount: number
  children?: ReactNode
}

/**
 * AppShell Main region chrome for a catalog-backed Project.
 * Read-only summary only — does not open legacy ProjectDetail or write paths.
 */
export function ProjectWorkspace({
  project,
  localSampleCount,
  children,
}: ProjectWorkspaceProps) {
  return (
    <section
      className="mo-project-workspace"
      aria-labelledby="mo-project-workspace-title"
    >
      <header className="mo-project-workspace__header">
        <div>
          <p className="mo-project-workspace__kicker">Project workspace</p>
          <h3 id="mo-project-workspace-title" className="mo-project-workspace__title">
            {project.displayName}
          </h3>
          <code className="mo-project-workspace__path">{project.relativePath}</code>
        </div>
        <ul className="mo-project-workspace__meta" aria-label="Project catalog flags">
          <li data-present={project.hasProjectFile}>
            {project.hasProjectFile ? 'Project file' : 'No project file'}
          </li>
          <li data-present={project.hasBanks}>
            {project.hasBanks ? 'Banks present' : 'No banks'}
          </li>
          <li data-present={localSampleCount > 0}>
            {localSampleCount} local sample{localSampleCount === 1 ? '' : 's'}
          </li>
        </ul>
      </header>
      {children != null && (
        <div className="mo-project-workspace__body">{children}</div>
      )}
    </section>
  )
}
