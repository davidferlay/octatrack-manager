import type { ReactNode } from 'react'
import { useTranslate } from '../../i18n'
import './AudioLibrary.css'

export type AudioLibraryScope = 'audio_pool' | 'unclassified'

export interface AudioLibraryProps {
  scope: AudioLibraryScope
  /** Optional set-relative parent path for Audio Pool scope. */
  parentPath?: string
  fileCount: number
  children?: ReactNode
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
  const t = useTranslate()
  const scopeTitle =
    scope === 'audio_pool' ? t('audioLibrary.poolTitle') : t('audioLibrary.unclassifiedTitle')
  const filesInView =
    fileCount === 1
      ? t('audioLibrary.filesInView', { count: fileCount })
      : t('audioLibrary.filesInViewPlural', { count: fileCount })

  return (
    <section
      className="mo-audio-library"
      aria-labelledby="mo-audio-library-title"
      data-scope={scope}
    >
      <header className="mo-audio-library__header">
        <div>
          <p className="mo-audio-library__kicker">{t('audioLibrary.kicker')}</p>
          <h3 id="mo-audio-library-title" className="mo-audio-library__title">
            {scopeTitle}
          </h3>
          {parentPath != null && parentPath !== '' && (
            <code className="mo-audio-library__path">{parentPath}</code>
          )}
        </div>
        <ul className="mo-audio-library__meta" aria-label={t('audioLibrary.summaryAria')}>
          <li data-present={scope === 'audio_pool'}>
            {scope === 'audio_pool'
              ? t('audioLibrary.setPool')
              : t('audioLibrary.outsideSetProject')}
          </li>
          <li data-present={fileCount > 0}>{filesInView}</li>
        </ul>
      </header>
      {children != null && (
        <div className="mo-audio-library__body">{children}</div>
      )}
    </section>
  )
}
