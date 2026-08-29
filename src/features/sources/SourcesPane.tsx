import type { ReactNode } from 'react'
import type { RootSession } from '../../api'
import { Button, StatusBadge } from '../../design-system'
import './SourcesPane.css'

export interface SourcesPaneProps {
  session: RootSession | null
  busy?: boolean
  error?: string | null
  onRegister: () => void
  onClose: () => void
  /** Optional Set/Project tree or saved views (UI1+). */
  children?: ReactNode
}

/**
 * AppShell Sources column: root session chrome only.
 * Does not own catalog browsing — that stays in Library (UI3 / CatalogLibraryBrowser).
 */
export function SourcesPane({
  session,
  busy = false,
  error = null,
  onRegister,
  onClose,
  children,
}: SourcesPaneProps) {
  return (
    <div className="mo-sources-pane" aria-labelledby="mo-sources-title">
      <div className="mo-sources-pane__title-row">
        <h2 id="mo-sources-title">Sources</h2>
        <StatusBadge tone="readonly">READ ONLY</StatusBadge>
      </div>
      <p className="mo-sources-pane__lede">
        Registered Octatrack roots. Only the native picker may submit an absolute path.
      </p>

      <div className="mo-sources-pane__actions">
        {session === null ? (
          <Button variant="secondary" disabled={busy} onClick={onRegister}>
            {busy ? 'Registering...' : 'Choose root...'}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {busy ? 'Closing...' : 'Close root'}
          </Button>
        )}
      </div>

      {error !== null && (
        <p className="mo-sources-pane__error" role="alert">
          {error}
        </p>
      )}

      {session === null ? (
        <p className="mo-sources-pane__empty">No root registered for this session.</p>
      ) : (
        <dl className="mo-sources-pane__summary">
          <div>
            <dt>Source</dt>
            <dd>{session.displayName}</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd>{session.deviceFingerprint.slice(0, 12)}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>Read only</dd>
          </div>
        </dl>
      )}

      {children}
    </div>
  )
}
