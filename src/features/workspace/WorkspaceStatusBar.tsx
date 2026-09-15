import type { ChangeRecoveryStatus, RenameRecoveryStatus } from "../../api";
import { Button } from "../../design-system";
import { useTranslate } from "../../i18n";
import "./WorkspaceStatusBar.css";

export interface WorkspaceStatusBarProps {
  connected: boolean;
  busy: boolean;
  changeBusy: boolean;
  error: string | null;
  recovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
  onFocusChangeDrawer?: () => void;
  onShowInspector?: () => void;
  inspectorHidden?: boolean;
}

export function WorkspaceStatusBar({
  connected,
  busy,
  changeBusy,
  error,
  recovery,
  renameRecovery,
  onFocusChangeDrawer,
  onShowInspector,
  inspectorHidden = false,
}: WorkspaceStatusBarProps) {
  const t = useTranslate();
  const attention = recovery?.recoveryRequired === true
    || renameRecovery?.recoveryRequired === true;
  const processing = busy || changeBusy;

  return (
    <div className="workspace-status-bar" role="status" aria-label={t("workspace.statusAria")}>
      <span className="workspace-status-bar__item">
        {connected ? t("workspace.statusConnected") : t("workspace.statusDisconnected")}
      </span>
      {processing && (
        <span className="workspace-status-bar__item workspace-status-bar__item--busy">
          {t("workspace.statusProcessing")}
        </span>
      )}
      {attention && (
        <span className="workspace-status-bar__item workspace-status-bar__item--attention">
          {t("workspace.statusAttention")}
        </span>
      )}
      {error !== null && (
        <span className="workspace-status-bar__error" title={error}>
          {t("workspace.statusErrorSummary")}
        </span>
      )}
      <div className="workspace-status-bar__actions">
        {attention && onFocusChangeDrawer !== undefined && (
          <Button variant="secondary" onClick={onFocusChangeDrawer}>
            {t("workspace.openChangeDrawer")}
          </Button>
        )}
        {inspectorHidden && onShowInspector !== undefined && (
          <Button variant="secondary" onClick={onShowInspector}>
            {t("workspace.showInspector")}
          </Button>
        )}
      </div>
    </div>
  );
}
