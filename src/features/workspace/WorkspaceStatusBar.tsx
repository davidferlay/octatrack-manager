import type { ChangeRecoveryStatus, RenameRecoveryStatus } from "../../api";
import { Button } from "../../design-system";
import { useTranslate } from "../../i18n";
import {
  deriveOperationsStatus,
  type OperationsStatusKind,
} from "./operationsStatus";
import "./WorkspaceStatusBar.css";

export interface WorkspaceStatusBarProps {
  connected: boolean;
  busy: boolean;
  changeBusy: boolean;
  error: string | null;
  recovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
  onOpenOperations?: () => void;
  onShowInspector?: () => void;
  inspectorHidden?: boolean;
}

function statusLabel(kind: OperationsStatusKind, t: ReturnType<typeof useTranslate>): string | null {
  switch (kind) {
    case "processing":
      return t("workspace.statusProcessing");
    case "continuation":
      return t("workspace.statusContinuation");
    case "recovery":
      return t("workspace.statusRecovery");
    case "status_unavailable":
      return t("workspace.statusSafetyUnavailable");
    default:
      return null;
  }
}

export function WorkspaceStatusBar({
  connected,
  busy,
  changeBusy,
  error,
  recovery,
  renameRecovery,
  onOpenOperations,
  onShowInspector,
  inspectorHidden = false,
}: WorkspaceStatusBarProps) {
  const t = useTranslate();
  const operationsStatus = deriveOperationsStatus({
    connected,
    busy,
    changeBusy,
    recovery,
    renameRecovery,
  });
  const statusDetail = statusLabel(operationsStatus, t);
  const showOperationsButton = connected
    && onOpenOperations !== undefined
    && operationsStatus !== "idle";

  return (
    <div className="workspace-status-bar" role="status" aria-label={t("workspace.statusAria")}>
      <span className="workspace-status-bar__item">
        {connected ? t("workspace.statusConnected") : t("workspace.statusDisconnected")}
      </span>
      {statusDetail !== null && (
        <span
          className={[
            "workspace-status-bar__item",
            operationsStatus === "recovery" || operationsStatus === "status_unavailable"
              ? "workspace-status-bar__item--attention"
              : operationsStatus === "processing"
                ? "workspace-status-bar__item--busy"
                : "",
          ].filter(Boolean).join(" ")}
        >
          {statusDetail}
        </span>
      )}
      {error !== null && (
        <span className="workspace-status-bar__error" title={error}>
          {t("workspace.statusErrorSummary")}
        </span>
      )}
      <div className="workspace-status-bar__actions">
        {showOperationsButton && (
          <Button
            variant="secondary"
            aria-label={t("workspace.openOperationsAria")}
            onClick={onOpenOperations}
          >
            {t("workspace.openOperations")}
          </Button>
        )}
        {inspectorHidden && onShowInspector !== undefined && (
          <Button
            variant="secondary"
            aria-label={t("workspace.showInspectorStatusAria")}
            onClick={onShowInspector}
          >
            {t("workspace.showInspector")}
          </Button>
        )}
      </div>
    </div>
  );
}
