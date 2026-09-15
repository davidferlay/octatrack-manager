import type { RootSession } from "../../api";
import { Button, StatusBadge, ThemeSwitcher } from "../../design-system";
import { LanguageSwitcher, useTranslate } from "../../i18n";
import type { CatalogBrowseContext } from "../library/CatalogLibraryBrowser";
import "./WorkspaceTopBar.css";

export interface WorkspaceTopBarProps {
  session: RootSession | null;
  writeEnabled: boolean;
  writeBlocked: boolean;
  busy: boolean;
  search: string;
  onSearchChange: (next: string) => void;
  searchDisabled?: boolean;
  browseContext?: CatalogBrowseContext | null;
  onChooseRoot: () => void;
  onRefreshCatalog: () => void;
  onCloseRoot: () => void;
  onEnableWrite: () => void;
  onDisableWrite: () => void;
  catalogReady: boolean;
  onOpenClone?: () => void;
}

export function WorkspaceTopBar({
  session,
  writeEnabled,
  writeBlocked,
  busy,
  search,
  onSearchChange,
  searchDisabled = false,
  onChooseRoot,
  onRefreshCatalog,
  onCloseRoot,
  onEnableWrite,
  onDisableWrite,
  catalogReady,
  browseContext = null,
  onOpenClone,
}: WorkspaceTopBarProps) {
  const t = useTranslate();
  const editDisabled =
    busy || writeBlocked || session === null || !session.capabilities.stableDeviceIdentity;

  return (
    <div className="workspace-top-bar" aria-label={t("context.libraryAria")}>
      <div className="workspace-top-bar__cluster">
        {session === null ? (
          <span className="workspace-top-bar__disconnected">{t("workspace.disconnected")}</span>
        ) : (
          <>
            <span className="workspace-top-bar__root">{session.displayName}</span>
            <StatusBadge tone={writeEnabled ? "warning" : "readonly"}>
              {writeEnabled ? t("context.editEnabled") : t("context.readOnly")}
            </StatusBadge>
          </>
        )}
      </div>

      <label className="workspace-top-bar__search">
        <span className="workspace-top-bar__search-label">{t("library.searchLabel")}</span>
        <input
          type="search"
          aria-label={t("library.searchAria")}
          value={search}
          disabled={searchDisabled || !catalogReady}
          placeholder={t("library.searchPlaceholder")}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      <div className="workspace-top-bar__actions" role="group" aria-label={t("workspace.topActionsAria")}>
        {session === null ? (
          <Button variant="secondary" disabled={busy} onClick={onChooseRoot}>
            {busy ? t("sources.registering") : t("sources.chooseRoot")}
          </Button>
        ) : (
          <>
            <div
              className="workspace-top-bar__mode-toggle"
              role="group"
              aria-label={t("sources.sessionModeAria")}
            >
              <button
                type="button"
                className={`workspace-top-bar__mode-btn${!writeEnabled ? " is-active" : ""}`}
                disabled={busy || !writeEnabled}
                aria-pressed={!writeEnabled}
                title={t("sources.viewModeTitle")}
                onClick={onDisableWrite}
              >
                {t("sources.viewMode")}
              </button>
              <button
                type="button"
                className={`workspace-top-bar__mode-btn${writeEnabled ? " is-active" : ""}`}
                disabled={editDisabled || writeEnabled}
                aria-pressed={writeEnabled}
                title={
                  writeBlocked
                    ? t("sources.editModeTitleBlockedRecovery")
                    : !session.capabilities.stableDeviceIdentity
                      ? t("sources.editModeTitleUnstableIdentity")
                      : t("sources.editModeTitle")
                }
                onClick={onEnableWrite}
              >
                {t("sources.editMode")}
              </button>
            </div>
            {onOpenClone !== undefined && (
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={t("operations.openCloneAria")}
                onClick={onOpenClone}
              >
                {t("operations.openClone")}
              </Button>
            )}
            <Button variant="secondary" disabled={busy || !catalogReady} onClick={onRefreshCatalog}>
              {t("workspace.refreshCatalog")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCloseRoot}>
              {busy ? t("sources.working") : t("sources.closeRoot")}
            </Button>
          </>
        )}
        <LanguageSwitcher disabled={busy} />
        <ThemeSwitcher />
      </div>
      {browseContext !== null && (
        <div className="workspace-top-bar__trail" aria-live="polite">
          <span>
            {browseContext.sourceLabel} {t("workspace.trailSeparator")}{" "}
            {browseContext.locationLabel}
          </span>
          <span className="workspace-top-bar__counts">
            {browseContext.hasSearch
              ? t("context.matchingInLocation", {
                  matching: browseContext.matchingCount,
                  total: browseContext.locationCount,
                })
              : t("context.samplesInLocation", { count: browseContext.locationCount })}
          </span>
        </div>
      )}
    </div>
  );
}
