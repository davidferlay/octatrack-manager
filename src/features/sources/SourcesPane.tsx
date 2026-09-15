import type { ReactNode } from 'react'
import type { RootSession } from '../../api'
import { Button, StatusBadge } from '../../design-system'
import { useTranslate } from '../../i18n'
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
  const t = useTranslate()
  const writeEnabled = session?.mode === 'write_enabled' && session.capabilities.write
  const editDisabled =
    busy || writeBlocked || session === null || !session.capabilities.stableDeviceIdentity

  return (
    <div className="mo-sources-pane" aria-labelledby="mo-sources-title">
      <div className="mo-sources-pane__title-row">
        <h2 id="mo-sources-title">{t('sources.title')}</h2>
        <StatusBadge tone={writeEnabled ? 'warning' : 'readonly'}>
          {writeEnabled ? t('sources.editEnabledBadge') : t('sources.readOnlyBadge')}
        </StatusBadge>
      </div>
      <p className="mo-sources-pane__lede">{t('sources.lede')}</p>

      <div className="mo-sources-pane__actions">
        {session === null ? (
          <Button variant="secondary" disabled={busy} onClick={onRegister}>
            {busy ? t('sources.registering') : t('sources.chooseRoot')}
          </Button>
        ) : (
          <>
            <div
              className="mo-sources-pane__mode-toggle"
              role="group"
              aria-label={t('sources.sessionModeAria')}
            >
              <button
                type="button"
                className={`mo-sources-pane__mode-btn${!writeEnabled ? ' is-active' : ''}`}
                disabled={busy || !writeEnabled}
                aria-pressed={!writeEnabled}
                title={t('sources.viewModeTitle')}
                onClick={onDisableWrite}
              >
                {t('sources.viewMode')}
              </button>
              <button
                type="button"
                className={`mo-sources-pane__mode-btn${writeEnabled ? ' is-active' : ''}`}
                disabled={editDisabled || writeEnabled}
                aria-pressed={writeEnabled}
                title={
                  writeBlocked
                    ? t('sources.editModeTitleBlockedRecovery')
                    : !session.capabilities.stableDeviceIdentity
                      ? t('sources.editModeTitleUnstableIdentity')
                      : t('sources.editModeTitle')
                }
                onClick={onEnableWrite}
              >
                {t('sources.editMode')}
              </button>
            </div>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {busy ? t('sources.working') : t('sources.closeRoot')}
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
        <p className="mo-sources-pane__empty">{t('sources.empty')}</p>
      ) : (
        <dl className="mo-sources-pane__summary">
          <div>
            <dt>{t('sources.summarySource')}</dt>
            <dd>{session.displayName}</dd>
          </div>
          <div>
            <dt>{t('sources.summaryFingerprint')}</dt>
            <dd>{session.deviceFingerprint.slice(0, 12)}</dd>
          </div>
          <div>
            <dt>{t('sources.summaryMode')}</dt>
            <dd>{writeEnabled ? t('sources.modeSessionWrites') : t('sources.modeReadOnly')}</dd>
          </div>
          {writeEnabled && (
            <div>
              <dt>{t('sources.summaryWriteGrant')}</dt>
              <dd>
                {t('sources.writeGrantRemaining', {
                  seconds: session.writeGrantExpiresInSeconds ?? 0,
                })}
              </dd>
            </div>
          )}
        </dl>
      )}

      {writeEnabled && (
        <p className="mo-sources-pane__write-warning">{t('sources.writeWarning')}</p>
      )}

      {children}
    </div>
  )
}
