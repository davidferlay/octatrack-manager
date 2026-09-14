import type { ReactNode } from 'react'
import { useTranslate } from '../../i18n'
import './InspectorPane.css'

export interface InspectorPaneProps {
  /** Selected asset display name (opaque catalog identity only). */
  assetLabel?: string | null
  /** Root-relative path for the selected asset, if any. */
  relativePath?: string | null
  emptyMessage?: string
  children?: ReactNode
}

/**
 * AppShell Inspector region chrome for waveform, tags/notes, and file details.
 * Presentation only — domain editors stay in feature children.
 */
export function InspectorPane({
  assetLabel = null,
  relativePath = null,
  emptyMessage,
  children,
}: InspectorPaneProps) {
  const t = useTranslate()
  const hasAsset = assetLabel != null && assetLabel !== ''
  const resolvedEmpty = emptyMessage ?? t('inspector.empty')

  return (
    <aside className="mo-inspector-pane" aria-label={t('inspector.aria')}>
      <header className="mo-inspector-pane__header">
        <p className="mo-inspector-pane__kicker">{t('inspector.kicker')}</p>
        <h2 className="mo-inspector-pane__title">{t('inspector.title')}</h2>
        {hasAsset ? (
          <>
            <p className="mo-inspector-pane__asset">{assetLabel}</p>
            {relativePath != null && relativePath !== '' && (
              <code className="mo-inspector-pane__path">{relativePath}</code>
            )}
          </>
        ) : (
          <p className="mo-inspector-pane__empty">{resolvedEmpty}</p>
        )}
      </header>
      {hasAsset && children != null && (
        <div className="mo-inspector-pane__body">{children}</div>
      )}
    </aside>
  )
}
