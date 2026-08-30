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
  onEnableWrite: () => void
  onDisableWrite: () => void
  writeBlocked?: boolean
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
  onEnableWrite,
  onDisableWrite,
  writeBlocked = false,
  children,
}: SourcesPaneProps) {
  const writeEnabled = session?.mode === 'write_enabled' && session.capabilities.write
  const editDisabled =
    busy || writeBlocked || session === null || !session.capabilities.stableDeviceIdentity

  return (
    <div className="mo-sources-pane" aria-labelledby="mo-sources-title">
      <div className="mo-sources-pane__title-row">
        <h2 id="mo-sources-title">Sources</h2>
        <StatusBadge tone={writeEnabled ? 'warning' : 'readonly'}>
          {writeEnabled ? 'EDIT ENABLED' : 'READ ONLY'}
        </StatusBadge>
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
          <>
            <div
              className="mo-sources-pane__mode-toggle"
              role="group"
              aria-label="Session UI mode"
            >
              <button
                type="button"
                className={`mo-sources-pane__mode-btn${!writeEnabled ? ' is-active' : ''}`}
                disabled={busy || !writeEnabled}
                aria-pressed={!writeEnabled}
                title="Switch to read-only View mode"
                onClick={onDisableWrite}
              >
                View
              </button>
              <button
                type="button"
                className={`mo-sources-pane__mode-btn${writeEnabled ? ' is-active' : ''}`}
                disabled={editDisabled || writeEnabled}
                aria-pressed={writeEnabled}
                title={
                  writeBlocked
                    ? 'Resolve recovery before enabling Edit mode'
                    : !session.capabilities.stableDeviceIdentity
                      ? 'Stable device identity is required for Edit mode'
                      : 'Switch to session Edit mode (additive copy only)'
                }
                onClick={onEnableWrite}
              >
                Edit
              </button>
            </div>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {busy ? 'Working...' : 'Close root'}
            </Button>
          </>
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
            <dd>{writeEnabled ? 'Edit enabled (session only)' : 'Read only'}</dd>
          </div>
          {writeEnabled && (
            <div>
              <dt>Write grant</dt>
              <dd>
                {session.writeGrantExpiresInSeconds ?? 0} seconds remaining
              </dd>
            </div>
          )}
        </dl>
      )}

      {writeEnabled && (
        <p className="mo-sources-pane__write-warning">
          Additive copy only. Use a cloned or test root, never original media.
        </p>
      )}

      {children}
    </div>
  )
}
