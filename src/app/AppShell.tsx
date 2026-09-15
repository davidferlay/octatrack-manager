import { type HTMLAttributes, type ReactNode, useEffect } from 'react'
import { SplitPane } from '../design-system'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useTranslate } from '../i18n'
import './AppShell.css'

export type AppShellCenterView = 'list' | 'inspector'

export interface AppShellProps extends HTMLAttributes<HTMLElement> {
  /** Optional top context bar (source / location summary). */
  contextBar?: ReactNode
  /** Left catalog navigation column. */
  sources: ReactNode
  /** Center Library / Project workspace. */
  main: ReactNode
  /** Optional right Inspector (UI4 Notes / waveform / metadata). */
  inspector?: ReactNode
  /** Optional status strip above the change drawer. */
  statusBar?: ReactNode
  /** Optional bottom Change Drawer for Intent → Plan → Apply review. */
  changeDrawer?: ReactNode
  /** Controlled Sources pane width %. Omit for uncontrolled resize. */
  sourcesSize?: number
  /** Uncontrolled initial Sources width % (default 20). */
  defaultSourcesSize?: number
  onSourcesSizeChange?: (percent: number) => void
  /** Controlled main/inspector split (% width of main). Default 62. */
  mainSize?: number
  defaultMainSize?: number
  onMainSizeChange?: (percent: number) => void
  navigationOpen?: boolean
  defaultNavigationOpen?: boolean
  onNavigationOpenChange?: (open: boolean) => void
  centerView?: AppShellCenterView
  defaultCenterView?: AppShellCenterView
  onCenterViewChange?: (view: AppShellCenterView) => void
  /** Render narrow-layout toggles (nav / list / inspector). */
  narrowControls?: ReactNode
}

/**
 * Next-generation workspace shell (Nav | Main | Inspector).
 * Presentation only — feature state stays in callers.
 */
export function AppShell({
  contextBar,
  sources,
  main,
  inspector,
  statusBar,
  changeDrawer,
  sourcesSize,
  defaultSourcesSize = 20,
  onSourcesSizeChange,
  mainSize,
  defaultMainSize = 62,
  onMainSizeChange,
  navigationOpen,
  defaultNavigationOpen = true,
  onNavigationOpenChange,
  centerView,
  defaultCenterView = 'list',
  onCenterViewChange,
  narrowControls,
  className,
  ...rest
}: AppShellProps) {
  const t = useTranslate()
  const narrow = useMediaQuery('(max-width: 840px)')
  const navOpen = navigationOpen ?? defaultNavigationOpen
  const activeCenterView = centerView ?? defaultCenterView
  const showInspector = inspector != null
  const mainHidden = narrow && showInspector && activeCenterView === 'inspector'
  const inspectorHidden = narrow && showInspector && activeCenterView === 'list'
  useEffect(() => {
    if (!narrow && activeCenterView !== 'list') {
      onCenterViewChange?.('list')
    }
  }, [narrow, activeCenterView, onCenterViewChange])

  const merged = ['mo-app-shell', narrow ? 'mo-app-shell--narrow' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={merged} aria-label={t('app.workspaceAria')} {...rest}>
      {contextBar != null && (
        <div className="mo-app-shell__context" data-testid="app-shell-context">
          {contextBar}
          {narrow && narrowControls}
        </div>
      )}
      <SplitPane
        className="mo-app-shell__body"
        primarySize={sourcesSize}
        defaultPrimarySize={defaultSourcesSize}
        onPrimarySizeChange={onSourcesSizeChange}
        minPrimary={18}
        maxPrimary={showInspector ? 36 : 42}
        primaryVisible={navOpen}
      >
        <SplitPane.Primary
          className="mo-app-shell__sources"
          data-testid="app-shell-sources"
        >
          {sources}
        </SplitPane.Primary>
        <SplitPane.Divider
          data-testid="app-shell-divider"
          resizeAriaLabel={t('workspace.splitResizeAria')}
        />
        <SplitPane.Secondary>
          {showInspector ? (
            <SplitPane
              className="mo-app-shell__body mo-app-shell__inner-split"
              primarySize={mainSize}
              defaultPrimarySize={defaultMainSize}
              onPrimarySizeChange={onMainSizeChange}
              minPrimary={55}
              maxPrimary={75}
            >
              <SplitPane.Primary
                className={[
                  'mo-app-shell__main',
                  mainHidden ? 'mo-app-shell__pane--stack-hidden' : '',
                ].filter(Boolean).join(' ')}
                hidden={mainHidden}
                aria-hidden={mainHidden}
              >
                {main}
              </SplitPane.Primary>
              <SplitPane.Divider resizeAriaLabel={t('workspace.splitResizeAria')} />
              <SplitPane.Secondary
                className={[
                  'mo-app-shell__inspector',
                  inspectorHidden ? 'mo-app-shell__pane--stack-hidden' : '',
                ].filter(Boolean).join(' ')}
                hidden={inspectorHidden}
                aria-hidden={inspectorHidden}
              >
                {inspector}
              </SplitPane.Secondary>
            </SplitPane>
          ) : (
            <div className="mo-app-shell__main">
              {main}
            </div>
          )}
        </SplitPane.Secondary>
      </SplitPane>
      {statusBar != null && (
        <div className="mo-app-shell__status" data-testid="app-shell-status">
          {statusBar}
        </div>
      )}
      {changeDrawer != null && (
        <div className="mo-app-shell__change-drawer" data-testid="app-shell-change-drawer">
          {changeDrawer}
        </div>
      )}
    </section>
  )
}
