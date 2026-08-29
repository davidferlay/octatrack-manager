import type { ReactNode } from 'react'
import './AudioLibrary.css'

export type AudioLibraryScope = 'audio_pool' | 'unclassified'

export interface AudioLibraryProps {
  scope: AudioLibraryScope
  /** Optional set-relative parent path for Audio Pool scope. */
  parentPath?: string
  fileCount: number
  children?: ReactNode
}

function scopeTitle(scope: AudioLibraryScope): string {
  return scope === 'audio_pool' ? 'Audio Pool' : 'Unclassified audio'
}

/**
 * AppShell Main region chrome for catalog Audio Library browsing
 * (Set Audio Pool / unclassified). Parallel to ProjectWorkspace.
 */
export function AudioLibrary({
  scope,
  parentPath,
  fileCount,
  children,
}: AudioLibraryProps) {
  return (
    <section
      className="mo-audio-library"
      aria-labelledby="mo-audio-library-title"
      data-scope={scope}
    >
      <header className="mo-audio-library__header">
        <div>
          <p className="mo-audio-library__kicker">Audio library</p>
          <h3 id="mo-audio-library-title" className="mo-audio-library__title">
            {scopeTitle(scope)}
          </h3>
          {parentPath != null && parentPath !== '' && (
            <code className="mo-audio-library__path">{parentPath}</code>
          )}
        </div>
        <ul className="mo-audio-library__meta" aria-label="Audio library summary">
          <li data-present={scope === 'audio_pool'}>
            {scope === 'audio_pool' ? 'Set audio pool' : 'Outside set/project'}
          </li>
          <li data-present={fileCount > 0}>
            {fileCount} file{fileCount === 1 ? '' : 's'} in view
          </li>
        </ul>
      </header>
      {children != null && (
        <div className="mo-audio-library__body">{children}</div>
      )}
    </section>
  )
}
