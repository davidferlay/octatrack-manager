import { useEffect, useState } from "react";
import {
  changeApi,
  type ChangeApi,
  type ChangePlan,
  type ChangeRecoveryStatus,
  type ChangeStatus,
  type RootSession,
} from "../../api";
import { Button, StatusBadge } from "../../design-system";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";
import "./AdditiveCopyChangeDrawer.css";

interface AdditiveCopyChangeDrawerProps {
  session: RootSession;
  selectedAsset: CatalogAssetSelection | null;
  recovery: ChangeRecoveryStatus | null;
  api?: ChangeApi;
  refreshSession: () => Promise<RootSession>;
  onCommitted: () => Promise<void> | void;
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

export function AdditiveCopyChangeDrawer({
  session,
  selectedAsset,
  recovery,
  api = changeApi,
  refreshSession,
  onCommitted,
}: AdditiveCopyChangeDrawerProps) {
  const [destination, setDestination] = useState("");
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [status, setStatus] = useState<ChangeStatus | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDestination("");
    setPlan(null);
    setStatus(null);
    setApproved(false);
    setError(null);
  }, [session.rootId, selectedAsset?.fileInstanceId]);

  const recoveryRequired = recovery?.recoveryRequired ?? true;
  const writeEnabled = session.mode === "write_enabled" && session.capabilities.write;

  async function createPlan() {
    if (selectedAsset === null || destination.trim() === "") return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function applyPlan() {
    if (plan === null || !approved || !writeEnabled || recoveryRequired) return;
    setBusy(true);
    setError(null);
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
      setApproved(false);
      if (applied.state === "committed") {
        await onCommitted();
      }
    } catch (reason) {
      setError(messageFrom(reason));
      if (applyAttempted) {
        try {
          setStatus(await api.changeStatus(session.rootId, plan.operationId));
        } catch {
          // The apply may have failed before an operation was started. Keep the primary error.
        }
      }
    } finally {
      setBusy(false);
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
      {recovery?.recoveryRequired && (
        <p className="mo-change-drawer__blocking" role="alert">
          An incomplete operation exists. Do not write to this root until recovery is resolved.
        </p>
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
              disabled={busy}
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
            disabled={busy || destination.trim() === "" || recoveryRequired}
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
              disabled={busy || !writeEnabled || recoveryRequired}
              onChange={(event) => setApproved(event.target.checked)}
            />
            <span>
              I reviewed this exact plan and approve creating one new file on cloned/test media.
            </span>
          </label>
          <Button
            variant="modalPrimary"
            disabled={busy || !approved || !writeEnabled || recoveryRequired}
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
