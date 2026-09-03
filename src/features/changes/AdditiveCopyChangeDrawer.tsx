import { useEffect, useState } from "react";
import {
  changeApi,
  type ChangeApi,
  type ChangePlan,
  type ChangeRecoveryStatus,
  type ChangeStatus,
  type RenameRecoveryStatus,
  type RootSession,
} from "../../api";
import { Button, StatusBadge } from "../../design-system";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";
import "./AdditiveCopyChangeDrawer.css";

interface AdditiveCopyChangeDrawerProps {
  session: RootSession;
  selectedAsset: CatalogAssetSelection | null;
  recovery: ChangeRecoveryStatus | null;
  renameRecovery?: RenameRecoveryStatus | null;
  api?: ChangeApi;
  disabled?: boolean;
  refreshSession: () => Promise<RootSession>;
  onCommitted: () => Promise<void> | void;
  onRecovered: () => Promise<void> | void;
  onBusyChange?: (busy: boolean) => void;
  onRecoveryChange?: (recovery: ChangeRecoveryStatus) => void;
}

function messageFrom(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

const preservedUnidentifiedPartial = "RECOVERY_PRESERVED_UNIDENTIFIED_PARTIAL";

function isPreservedRecovery(status: ChangeStatus): boolean {
  return status.state === "failed" && status.failureCode === preservedUnidentifiedPartial;
}

function isResolvedRecovery(status: ChangeStatus): boolean {
  return status.state === "rolled_back" || isPreservedRecovery(status);
}

function preservedRecoveryMessage(prefix: string): string {
  return `${prefix} The unidentified partial was preserved for manual inspection and edit mode was disabled.`;
}

export function AdditiveCopyChangeDrawer({
  session,
  selectedAsset,
  recovery,
  renameRecovery = null,
  api = changeApi,
  disabled = false,
  refreshSession,
  onCommitted,
  onRecovered,
  onBusyChange,
  onRecoveryChange,
}: AdditiveCopyChangeDrawerProps) {
  const [destination, setDestination] = useState("");
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [status, setStatus] = useState<ChangeStatus | null>(null);
  const [approved, setApproved] = useState(false);
  const [approvedRecoveryOperationId, setApprovedRecoveryOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDestination("");
    setPlan(null);
    setStatus(null);
    setApproved(false);
    setApprovedRecoveryOperationId(null);
    setError(null);
  }, [session.rootId, selectedAsset?.fileInstanceId]);

  const recoveryRequired = (recovery?.recoveryRequired ?? true)
    || (renameRecovery?.recoveryRequired ?? false)
    || status?.recoveryRequired === true;
  const writeEnabled = session.mode === "write_enabled" && session.capabilities.write;
  const interactionBusy = busy || disabled;

  function setChangeBusy(nextBusy: boolean) {
    setBusy(nextBusy);
    onBusyChange?.(nextBusy);
  }

  async function createPlan() {
    if (disabled || selectedAsset === null || destination.trim() === "") return;
    setChangeBusy(true);
    setError(null);
    setStatus(null);
    setApproved(false);
    try {
      const created = await api.planAdditiveCopy(
        session.rootId,
        selectedAsset.fileInstanceId,
        destination,
      );
      setPlan(created);
    } catch (reason) {
      setPlan(null);
      setError(messageFrom(reason));
    } finally {
      setChangeBusy(false);
    }
  }

  async function applyPlan() {
    if (disabled || plan === null || !approved || !writeEnabled || recoveryRequired) return;
    setChangeBusy(true);
    setError(null);
    setApproved(false);
    let applyAttempted = false;
    try {
      const currentSession = await refreshSession();
      if (
        currentSession.mode !== "write_enabled"
        || !currentSession.capabilities.write
      ) {
        throw new Error("The session write grant expired. Enable edit mode again before Apply.");
      }
      const current = await api.getPlan(session.rootId, plan.planId);
      if (
        current.planId !== plan.planId
        || current.sourceRelativePath !== plan.sourceRelativePath
        || current.destinationRelativePath !== plan.destinationRelativePath
      ) {
        throw new Error("The displayed plan no longer matches the backend plan.");
      }
      applyAttempted = true;
      const applied = await api.applyChange(session.rootId, plan.planId, plan.planId);
      setStatus(applied);
      if (applied.state === "committed") {
        try {
          await onCommitted();
        } catch (refreshReason) {
          setError(`The operation committed, but the catalog refresh failed: ${messageFrom(refreshReason)}`);
        }
      }
    } catch (reason) {
      const primaryError = messageFrom(reason);
      setError(primaryError);
      if (applyAttempted) {
        let recoveredStatus: ChangeStatus | null = null;
        try {
          recoveredStatus = await api.changeStatus(session.rootId, plan.operationId);
          setStatus(recoveredStatus);
        } catch {
          // The apply may have failed before an operation was started. Keep the primary error.
        }
        if (recoveredStatus?.state === "committed") {
          try {
            await onCommitted();
            setStatus({ ...recoveredStatus, catalogRefreshRequired: false });
            setError(`Apply response was interrupted: ${primaryError}. Backend status confirms that the operation committed.`);
          } catch (refreshReason) {
            setError(`Backend status confirms that the operation committed, but the catalog refresh failed: ${messageFrom(refreshReason)}`);
          }
        }
        try {
          onRecoveryChange?.(await api.recoveryStatus(session.rootId));
        } catch {
          // Local status still fails closed when recovery status cannot be refreshed.
        }
      }
    } finally {
      setChangeBusy(false);
    }
  }

  async function recoverOperation(operation: ChangeStatus) {
    if (disabled || approvedRecoveryOperationId !== operation.operationId) return;
    setChangeBusy(true);
    setError(null);
    setApprovedRecoveryOperationId(null);
    let recoveryAttempted = false;
    try {
      const currentSession = await refreshSession();
      if (!currentSession.capabilities.stableDeviceIdentity) {
        throw new Error("Recovery requires the same live root with a stable device identity.");
      }
      recoveryAttempted = true;
      const recovered = await api.recoverChange(
        session.rootId,
        operation.operationId,
        operation.operationId,
      );
      setStatus(recovered);
      if (!isResolvedRecovery(recovered)) {
        throw new Error("The backend did not confirm that the incomplete copy was rolled back.");
      }
      try {
        await onRecovered();
        if (isPreservedRecovery(recovered)) {
          setError(preservedRecoveryMessage("Recovery reached a safe terminal state."));
        }
      } catch (refreshReason) {
        const outcome = isPreservedRecovery(recovered)
          ? "Recovery safely preserved the unidentified partial"
          : "The rollback completed";
        setError(`${outcome}, but the session refresh failed: ${messageFrom(refreshReason)}`);
      }
    } catch (reason) {
      const primaryError = messageFrom(reason);
      setError(primaryError);
      if (recoveryAttempted) {
        let recoveredStatus: ChangeStatus | null = null;
        try {
          recoveredStatus = await api.changeStatus(session.rootId, operation.operationId);
          setStatus(recoveredStatus);
        } catch {
          // Keep the primary error when no operation status can be recovered.
        }
        if (recoveredStatus !== null && isResolvedRecovery(recoveredStatus)) {
          try {
            await onRecovered();
            setStatus({ ...recoveredStatus, catalogRefreshRequired: false });
            setError(isPreservedRecovery(recoveredStatus)
              ? preservedRecoveryMessage(
                `Recovery response was interrupted: ${primaryError}. Backend status confirms a safe terminal state.`,
              )
              : `Recovery response was interrupted: ${primaryError}. Backend status confirms that rollback completed.`);
          } catch (refreshReason) {
            const outcome = isPreservedRecovery(recoveredStatus)
              ? "Backend status confirms that the unidentified partial was safely preserved"
              : "Backend status confirms that rollback completed";
            setError(`${outcome}, but the session refresh failed: ${messageFrom(refreshReason)}`);
          }
        } else {
          // Backend revokes the write grant before recovery mutates media. Refresh
          // the parent session even when recovery remains required or fails closed.
          try {
            await onRecovered();
          } catch {
            // Keep the primary recovery error when session refresh fails.
          }
        }
        try {
          onRecoveryChange?.(await api.recoveryStatus(session.rootId));
        } catch {
          // The UI remains fail closed when recovery status cannot be refreshed.
        }
      }
    } finally {
      setChangeBusy(false);
    }
  }

  return (
    <section className="mo-change-drawer" aria-labelledby="mo-change-drawer-title">
      <div className="mo-change-drawer__heading">
        <div>
          <p className="mo-change-drawer__eyebrow">Intent → Plan → Apply</p>
          <h3 id="mo-change-drawer-title">Change Drawer</h3>
        </div>
        <StatusBadge tone={recoveryRequired ? "danger" : writeEnabled ? "warning" : "readonly"}>
          {recoveryRequired ? "RECOVERY REQUIRED" : writeEnabled ? "EDIT ENABLED" : "READ ONLY"}
        </StatusBadge>
      </div>

      {recovery === null && (
        <p className="mo-change-drawer__blocking" role="alert">
          Write safety status is unavailable. Applying changes is disabled.
        </p>
      )}
      {(recovery?.recoveryRequired || renameRecovery?.recoveryRequired || status?.recoveryRequired) && (
        <p className="mo-change-drawer__blocking" role="alert">
          An incomplete operation exists. Do not write to this root until recovery is resolved.
        </p>
      )}

      {renameRecovery?.recoveryRequired && (
        <p className="mo-change-drawer__blocking" role="alert">
          An incomplete rename operation exists. Additive copy apply is disabled until rename recovery is resolved.
        </p>
      )}

      {recovery?.recoveryRequired && (
        <div className="mo-change-drawer__recovery" aria-label="Incomplete operation recovery">
          <h4>Rollback required</h4>
          <p>
            Recovery can only remove the exact file recorded by the operation journal after its
            identity and verified local backup are checked again.
          </p>
          {recovery.operations.map((operation) => (
            <div className="mo-change-drawer__recovery-operation" key={operation.operationId}>
              <dl>
                <div>
                  <dt>Operation</dt>
                  <dd><code>{operation.operationId}</code></dd>
                </div>
                <div>
                  <dt>Failure</dt>
                  <dd>{operation.failureCode ?? "INCOMPLETE_OPERATION"}</dd>
                </div>
              </dl>
              <label className="mo-change-drawer__approval">
                <input
                  type="checkbox"
                  checked={approvedRecoveryOperationId === operation.operationId}
                  disabled={interactionBusy}
                  onChange={(event) => setApprovedRecoveryOperationId(
                    event.target.checked ? operation.operationId : null,
                  )}
                />
                <span>
                  I approve rollback of this exact incomplete additive-copy operation.
                </span>
              </label>
              <Button
                variant="danger"
                disabled={
                  interactionBusy
                  || approvedRecoveryOperationId !== operation.operationId
                }
                onClick={() => recoverOperation(operation)}
              >
                {busy ? "Recovering..." : "Roll back incomplete copy"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {selectedAsset === null ? (
        <p className="mo-change-drawer__empty">
          Select an indexed audio file to prepare an additive copy plan.
        </p>
      ) : (
        <div className="mo-change-drawer__composer">
          <div className="mo-change-drawer__source">
            <span>Source</span>
            <strong>{selectedAsset.displayName}</strong>
            <code>{selectedAsset.relativePath}</code>
          </div>
          <label className="mo-change-drawer__destination">
            <span>Destination relative path</span>
            <input
              value={destination}
              disabled={interactionBusy}
              placeholder="LIVE_SET/PROJECT_A/KICK_COPY.wav"
              onChange={(event) => {
                setDestination(event.target.value);
                setPlan(null);
                setStatus(null);
                setApproved(false);
              }}
            />
          </label>
          <Button
            variant="secondary"
            disabled={interactionBusy || destination.trim() === "" || recoveryRequired}
            onClick={createPlan}
          >
            {busy ? "Checking..." : "Review plan"}
          </Button>
        </div>
      )}

      {plan !== null && (
        <div className="mo-change-drawer__plan" aria-label="Additive copy plan">
          <div className="mo-change-drawer__diff">
            <span className="mo-change-drawer__diff-action">CREATE</span>
            <code>{plan.destinationRelativePath}</code>
            <span>{formatBytes(plan.byteSize)}</span>
          </div>
          <dl>
            <div>
              <dt>Copy from</dt>
              <dd><code>{plan.sourceRelativePath}</code></dd>
            </div>
            <div>
              <dt>Verified backup</dt>
              <dd>{plan.backupRelativePaths.length} source file</dd>
            </div>
            <div>
              <dt>Overwrite / delete</dt>
              <dd>Forbidden / {plan.deleteCount}</dd>
            </div>
          </dl>
          <ul className="mo-change-drawer__warnings">
            {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
          {!writeEnabled && (
            <p className="mo-change-drawer__hint">
              Review is available in read-only mode. Enable edit mode in Sources before Apply.
            </p>
          )}
          <label className="mo-change-drawer__approval">
            <input
              type="checkbox"
              checked={approved}
              disabled={interactionBusy || !writeEnabled || recoveryRequired}
              onChange={(event) => setApproved(event.target.checked)}
            />
            <span>
              I reviewed this exact plan and approve creating one new file on cloned/test media.
            </span>
          </label>
          <Button
            variant="modalPrimary"
            disabled={interactionBusy || !approved || !writeEnabled || recoveryRequired}
            onClick={applyPlan}
          >
            {busy ? "Applying..." : "Apply approved plan"}
          </Button>
        </div>
      )}

      {status !== null && (
        <p
          className={`mo-change-drawer__status mo-change-drawer__status--${status.state}`}
          role="status"
        >
          Operation {status.state.replace(/_/g, " ")}.
          {status.catalogRefreshRequired && " Re-register the root to refresh the catalog."}
        </p>
      )}
      {error !== null && <p className="mo-change-drawer__error" role="alert">{error}</p>}
    </section>
  );
}
