import type { ReactNode } from 'react'
import type { LibraryProject } from '../../api'
import { useTranslate } from '../../i18n'
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
  const t = useTranslate()
  const localSamplesLabel =
    localSampleCount === 1
      ? t('projectWorkspace.localSamples', { count: localSampleCount })
      : t('projectWorkspace.localSamplesPlural', { count: localSampleCount })

  return (
    <section
      className="mo-project-workspace"
      aria-labelledby="mo-project-workspace-title"
    >
      <header className="mo-project-workspace__header">
        <div>
          <p className="mo-project-workspace__kicker">{t('projectWorkspace.kicker')}</p>
          <h3 id="mo-project-workspace-title" className="mo-project-workspace__title">
            {project.displayName}
          </h3>
          <code className="mo-project-workspace__path">{project.relativePath}</code>
        </div>
        <ul className="mo-project-workspace__meta" aria-label={t('projectWorkspace.flagsAria')}>
          <li data-present={project.hasProjectFile}>
            {project.hasProjectFile
              ? t('projectWorkspace.hasProjectFile')
              : t('projectWorkspace.noProjectFile')}
          </li>
          <li data-present={project.hasBanks}>
            {project.hasBanks ? t('projectWorkspace.hasBanks') : t('projectWorkspace.noBanks')}
          </li>
          <li data-present={localSampleCount > 0}>{localSamplesLabel}</li>
        </ul>
      </header>
      {children != null && (
        <div className="mo-project-workspace__body">{children}</div>
      )}
    </section>
  )
}
