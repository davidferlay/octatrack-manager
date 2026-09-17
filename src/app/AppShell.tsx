import { type HTMLAttributes, type ReactNode, useEffect } from 'react'
import { SplitPane } from '../design-system'
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
  /** Uncontrolled initial Sources width % (default 16). */
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
  /** When true, stack main/inspector by centerView (840px layout). Owned by caller. */
  narrowLayout?: boolean
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
  defaultSourcesSize = 16,
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
  narrowLayout = false,
  className,
  ...rest
}: AppShellProps) {
  const t = useTranslate()
  const navOpen = navigationOpen ?? defaultNavigationOpen
  const activeCenterView = centerView ?? defaultCenterView
  const showInspector = inspector != null
  const mainHidden = narrowLayout && showInspector && activeCenterView === 'inspector'
  const inspectorHidden = narrowLayout && showInspector && activeCenterView === 'list'
  const innerStackMode = narrowLayout && showInspector
    ? mainHidden
      ? 'inspector-only'
      : inspectorHidden
        ? 'list-only'
        : 'both'
    : 'both'
  const innerDividerHidden = innerStackMode !== 'both'
  useEffect(() => {
    if (!narrowLayout && activeCenterView !== 'list') {
      onCenterViewChange?.('list')
    }
  }, [narrowLayout, activeCenterView, onCenterViewChange])

  const merged = ['mo-app-shell', narrowLayout ? 'mo-app-shell--narrow' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={merged} aria-label={t('app.workspaceAria')} {...rest}>
      {contextBar != null && (
        <div className="mo-app-shell__context" data-testid="app-shell-context">
          {contextBar}
          {narrowControls}
        </div>
      )}
      <SplitPane
        className="mo-app-shell__body mo-app-shell__outer-split"
        primarySize={sourcesSize}
        defaultPrimarySize={defaultSourcesSize}
        onPrimarySizeChange={onSourcesSizeChange}
        minPrimary={12}
        maxPrimary={showInspector ? 42 : 50}
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
              className={[
                'mo-app-shell__inner-split',
                innerStackMode === 'list-only' ? 'mo-app-shell__inner-split--list-only' : '',
                innerStackMode === 'inspector-only'
                  ? 'mo-app-shell__inner-split--inspector-only'
                  : '',
              ].filter(Boolean).join(' ')}
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
                inert={mainHidden ? true : undefined}
              >
                {main}
              </SplitPane.Primary>
              <SplitPane.Divider
                className={innerDividerHidden ? 'mo-split-pane__divider--stack-hidden' : undefined}
                resizeAriaLabel={t('workspace.splitResizeAria')}
                aria-hidden={innerDividerHidden}
                tabIndex={innerDividerHidden ? -1 : undefined}
              />
              <SplitPane.Secondary
                className={[
                  'mo-app-shell__inspector',
                  inspectorHidden ? 'mo-app-shell__pane--stack-hidden' : '',
                ].filter(Boolean).join(' ')}
                hidden={inspectorHidden}
                aria-hidden={inspectorHidden}
                inert={inspectorHidden ? true : undefined}
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
