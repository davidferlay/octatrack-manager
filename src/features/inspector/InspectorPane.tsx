import type { ReactNode } from 'react'
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
        emptyMessage = 'Select an audio file to inspect waveform, usage, and notes.',
  children,
}: InspectorPaneProps) {
  const hasAsset = assetLabel != null && assetLabel !== ''

  return (
    <aside className="mo-inspector-pane" aria-label="Inspector">
      <header className="mo-inspector-pane__header">
        <p className="mo-inspector-pane__kicker">Inspector</p>
        <h2 className="mo-inspector-pane__title">Notes & details</h2>
        {hasAsset ? (
          <>
            <p className="mo-inspector-pane__asset">{assetLabel}</p>
            {relativePath != null && relativePath !== '' && (
              <code className="mo-inspector-pane__path">{relativePath}</code>
            )}
          </>
        ) : (
          <p className="mo-inspector-pane__empty">{emptyMessage}</p>
        )}
      </header>
      {hasAsset && children != null && (
        <div className="mo-inspector-pane__body">{children}</div>
      )}
    </aside>
  )
}
