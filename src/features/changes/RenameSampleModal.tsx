import { useEffect, useRef, useState } from "react";
import {
  renameApi,
  type ChangeRecoveryStatus,
  type RenameApi,
  type RenamePlan,
  type RenameRecoveryStatus,
  type RenameStatus,
  type RootSession,
} from "../../api";
import { Button, Input, Modal, Spinner, StatusBadge } from "../../design-system";
import type { CatalogAssetSelection } from "../library/CatalogLibraryBrowser";
import {
  combineBasename,
  splitRelativePath,
  validateBasename,
} from "./renameBasename";
import {
  formatSlotKind,
  formatStateDocumentRole,
  renameBlockReasonMessage,
  renameErrorMessage,
} from "./renameMessages";
import "./RenameSampleModal.css";

type WorkflowStage =
  | "input"
  | "planning"
  | "planned"
  | "blocked"
  | "authorizing"
  | "backing_up"
  | "preparing"
  | "prepared"
  | "error";

interface ReviewBinding {
  rootId: string;
  fileInstanceId: string;
  planId: string;
  observedRevision: number;
}

export interface RenameSampleModalProps {
  open: boolean;
  session: RootSession;
  selectedAsset: CatalogAssetSelection;
  changeRecovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
  api?: RenameApi;
  onClose: () => void;
  refreshSession: () => Promise<RootSession>;
  onPrepared: () => Promise<void> | void;
  onRenameRecoveryChange?: (recovery: RenameRecoveryStatus) => void;
}

function formatBytes(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function basenameFromPath(relativePath: string): string {
  return splitRelativePath(relativePath).basename;
}

export function RenameSampleModal({
  open,
  session,
  selectedAsset,
  changeRecovery,
  renameRecovery,
  api = renameApi,
  onClose,
  refreshSession,
  onPrepared,
  onRenameRecoveryChange,
}: RenameSampleModalProps) {
  const currentBasename = basenameFromPath(selectedAsset.relativePath);
  const parentPath = splitRelativePath(selectedAsset.relativePath).parentPath;
  const [newBasename, setNewBasename] = useState(currentBasename);
  const [stage, setStage] = useState<WorkflowStage>("input");
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [blockedReasons, setBlockedReasons] = useState<Array<{ code: string; message: string }>>([]);
  const [binding, setBinding] = useState<ReviewBinding | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [preparedStatus, setPreparedStatus] = useState<RenameStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const writeEnabled = session.mode === "write_enabled" && session.capabilities.write;
  const additiveRecovery = changeRecovery?.recoveryRequired === true;
  const renameRecoveryBlocking = renameRecovery?.recoveryRequired === true;
  const recoveryUnavailable = changeRecovery === null || renameRecovery === null;
  const canStart = writeEnabled && !additiveRecovery && !renameRecoveryBlocking && !recoveryUnavailable;

  useEffect(() => {
    if (!open) return;
    setNewBasename(currentBasename);
    setStage("input");
    setPlan(null);
    setBlockedReasons([]);
    setBinding(null);
    setProgress([]);
    setPreparedStatus(null);
    setError(null);
    setBusy(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, session.rootId, selectedAsset.fileInstanceId, currentBasename]);

  function closeModal() {
    if (busy) return;
    onClose();
  }

  async function reviewRename() {
    const validation = validateBasename(newBasename, currentBasename);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    if (!canStart) return;

    setBusy(true);
    setError(null);
    setPlan(null);
    setBlockedReasons([]);
    setBinding(null);
    setPreparedStatus(null);
    setProgress([]);
    setStage("planning");

    const destinationRelativePath = combineBasename(parentPath, newBasename);
    try {
      const response = await api.plan(
        session.rootId,
        selectedAsset.fileInstanceId,
        destinationRelativePath,
      );
      if (response.outcome === "blocked") {
        setBlockedReasons(response.blocked.blockReasons);
        setStage("blocked");
        return;
      }
      setPlan(response.plan);
      setBinding({
        rootId: session.rootId,
        fileInstanceId: selectedAsset.fileInstanceId,
        planId: response.plan.planId,
        observedRevision: session.observedRevision,
      });
      setStage("planned");
    } catch (reason) {
      setError(renameErrorMessage(reason));
      setStage("error");
    } finally {
      setBusy(false);
    }
  }

  function bindingStillValid(): boolean {
    if (binding === null || plan === null) return false;
    return binding.rootId === session.rootId
      && binding.fileInstanceId === selectedAsset.fileInstanceId
      && binding.planId === plan.planId
      && binding.observedRevision === session.observedRevision;
  }

  async function approveAndPrepare() {
    if (plan === null || !bindingStillValid() || !canStart || busy) return;

    setBusy(true);
    setError(null);
    setProgress([]);
    setStage("authorizing");

    try {
      const currentSession = await refreshSession();
      if (
        currentSession.mode !== "write_enabled"
        || !currentSession.capabilities.write
      ) {
        throw Object.assign(new Error("Enable edit mode again before preparing."), {
          code: "WRITE_NOT_ENABLED",
        });
      }

      const latestPlan = await api.getPlan(session.rootId, plan.planId);
      if (
        latestPlan.planId !== plan.planId
        || latestPlan.sourceRelativePath !== plan.sourceRelativePath
        || latestPlan.destinationRelativePath !== plan.destinationRelativePath
      ) {
        throw Object.assign(new Error("The displayed plan no longer matches the backend plan."), {
          code: "PLAN_STALE",
        });
      }

      setProgress(["Plan approved"]);
      const authority = await api.authorize(session.rootId, plan.planId);
      setStage("backing_up");
      setProgress((items) => [...items, "Authority verified"]);

      const backup = await api.createBackup(
        session.rootId,
        plan.planId,
        authority.authorityId,
      );
      setStage("preparing");
      setProgress((items) => [...items, "Backup created and verified"]);

      const prepared = await api.prepare(
        session.rootId,
        plan.planId,
        authority.authorityId,
        backup.snapshotId,
      );
      setProgress((items) => [...items, "References prepared"]);

      const status = await api.getStatus(session.rootId, prepared.operationId);
      if (status.state !== "prepared") {
        throw Object.assign(new Error("Rename preparation did not reach a prepared state."), {
          code: "INVALID_TRANSITION",
        });
      }

      setPreparedStatus(status);
      setStage("prepared");
      try {
        await onPrepared();
      } catch (refreshReason) {
        setError(`Rename was prepared, but status refresh failed: ${renameErrorMessage(refreshReason)}`);
      }
      try {
        onRenameRecoveryChange?.(await api.recoveryStatus(session.rootId));
      } catch {
        // Prepared state is already confirmed; recovery refresh failure is non-fatal here.
      }
    } catch (reason) {
      setError(renameErrorMessage(reason));
      setStage("error");
      try {
        onRenameRecoveryChange?.(await api.recoveryStatus(session.rootId));
      } catch {
        // Keep the primary error when recovery status cannot be refreshed.
      }
    } finally {
      setBusy(false);
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && stage === "input" && !busy) {
      event.preventDefault();
      void reviewRename();
    }
  }

  const validation = validateBasename(newBasename, currentBasename);
  const showApprove = stage === "planned" && plan !== null && bindingStillValid();
  const locked = busy || stage === "authorizing" || stage === "backing_up" || stage === "preparing";

  return (
    <Modal
      open={open}
      onClose={closeModal}
      locked={locked}
      closeOnBackdrop={!locked}
      closeOnEscape={!locked}
      contentClassName="rename-sample-modal"
    >
      <Modal.Header>
        <div className="rename-sample-modal__heading">
          <h3 id="rename-sample-title">Review rename</h3>
          <StatusBadge tone={writeEnabled ? "warning" : "readonly"}>
            {writeEnabled ? "EDIT ENABLED" : "READ ONLY"}
          </StatusBadge>
        </div>
      </Modal.Header>
      <Modal.Body aria-labelledby="rename-sample-title">
        {!writeEnabled && (
          <p className="rename-sample-modal__notice" role="status">
            Edit mode is required before preparing a rename.
          </p>
        )}
        {recoveryUnavailable && (
          <p className="rename-sample-modal__alert" role="alert">
            Write safety status is unavailable. Rename preparation is disabled.
          </p>
        )}
        {additiveRecovery && (
          <p className="rename-sample-modal__alert" role="alert">
            An incomplete additive-copy operation must be resolved before another rename can be prepared.
          </p>
        )}
        {renameRecoveryBlocking && (
          <p className="rename-sample-modal__alert" role="alert">
            A previous file operation requires recovery before another rename can be prepared.
          </p>
        )}

        <div className="rename-sample-modal__source">
          <span>Current name</span>
          <strong>{currentBasename}</strong>
          <code>{selectedAsset.relativePath}</code>
        </div>

        {(stage === "input" || stage === "error") && (
          <label className="rename-sample-modal__input">
            <span>New name</span>
            <Input
              ref={inputRef}
              value={newBasename}
              disabled={busy || !canStart}
              aria-label="New file name"
              onChange={(event) => {
                setNewBasename(event.target.value);
                setError(null);
              }}
              onKeyDown={handleInputKeyDown}
            />
          </label>
        )}

        {stage === "planning" && (
          <p className="rename-sample-modal__processing" role="status">
            Checking references...
          </p>
        )}

        {stage === "blocked" && (
          <div className="rename-sample-modal__blocked" role="alert">
            <h4>Rename blocked</h4>
            <ul>
              {blockedReasons.map((reason) => (
                <li key={`${reason.code}:${reason.message}`}>
                  {renameBlockReasonMessage(reason.code, reason.message)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan !== null && (stage === "planned" || stage === "authorizing" || stage === "backing_up" || stage === "preparing" || stage === "prepared") && (
          <div className="rename-sample-modal__review" aria-label="Rename impact review">
            <div className="rename-sample-modal__diff">
              <span>{basenameFromPath(plan.sourceRelativePath)}</span>
              <span aria-hidden="true">→</span>
              <span>{basenameFromPath(plan.destinationRelativePath)}</span>
            </div>
            <dl>
              <div>
                <dt>Location</dt>
                <dd><code>{parentPath === "" ? "." : parentPath}</code></dd>
              </div>
              <div>
                <dt>Reference updates</dt>
                <dd>{plan.referenceUpdateCount} reference{plan.referenceUpdateCount === 1 ? "" : "s"} will be updated</dd>
              </div>
              <div>
                <dt>Sidecar</dt>
                <dd>
                  {plan.sidecarImpacts.length > 0
                    ? "Sample settings sidecar will be renamed"
                    : "No sidecar"}
                </dd>
              </div>
              <div>
                <dt>Backup</dt>
                <dd>
                  Files requiring backup: {plan.backupRelativePaths.length}
                  {" · "}
                  Estimated bytes: {formatBytes(plan.estimatedLocalStagingBytes)}
                </dd>
              </div>
            </dl>

            {plan.stateDocumentImpacts.length > 0 && (
              <div className="rename-sample-modal__impacts">
                <h4>Reference details</h4>
                <ul>
                  {plan.stateDocumentImpacts.flatMap((impact) =>
                    impact.referenceUpdates.map((update) => (
                      <li key={`${impact.relativePath}:${update.slotKind}:${update.slotNumber}`}>
                        Project: {update.projectDocumentRelativePath.split("/").pop()}
                        {" · "}
                        {formatStateDocumentRole(impact.role)}
                        {" · "}
                        {formatSlotKind(update.slotKind)} Slot {update.slotNumber}
                      </li>
                    )),
                  )}
                </ul>
              </div>
            )}

            {plan.warnings.length > 0 && (
              <ul className="rename-sample-modal__warnings">
                {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}

            <p className="rename-sample-modal__safety">
              No files have been changed. Original references will be verified again before preparation.
              No Octatrack media changes occur during this step.
            </p>
          </div>
        )}

        {progress.length > 0 && (
          <div className="rename-sample-modal__progress" role="status" aria-live="polite">
            <h4>Preparing rename</h4>
            <ul>
              {progress.map((item) => (
                <li key={item}>✓ {item}</li>
              ))}
              {(stage === "authorizing" || stage === "backing_up" || stage === "preparing") && (
                <li>… {
                  stage === "authorizing"
                    ? "Verifying authority"
                    : stage === "backing_up"
                      ? "Creating verified backup"
                      : "Preparing references"
                }</li>
              )}
            </ul>
          </div>
        )}

        {stage === "prepared" && preparedStatus !== null && (
          <div className="rename-sample-modal__success" role="status">
            <h4>Rename prepared</h4>
            <p>Backup verified. References prepared. No Octatrack media changes have been applied.</p>
            <p>Status: PREPARED</p>
          </div>
        )}

        {error !== null && (
          <p className="rename-sample-modal__alert" role="alert">{error}</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <div className="rename-sample-modal__footer">
          {stage === "prepared" ? (
            <Button variant="modalPrimary" onClick={closeModal}>Close</Button>
          ) : (
            <>
              <Button variant="modal" onClick={closeModal} disabled={locked}>
                Cancel
              </Button>
              {showApprove ? (
                <Button
                  variant="modalPrimary"
                  disabled={locked || !canStart}
                  onClick={() => void approveAndPrepare()}
                >
                  {locked ? <><Spinner fa style={{ marginRight: "0.4rem" }} />Preparing...</> : "Approve & Prepare"}
                </Button>
              ) : (
                <Button
                  variant="modalPrimary"
                  disabled={busy || !canStart || !validation.ok}
                  onClick={() => void reviewRename()}
                >
                  {busy ? "Checking..." : "Review Rename"}
                </Button>
              )}
              {(stage === "blocked" || stage === "error") && (
                <Button
                  variant="secondary"
                  disabled={busy || !canStart}
                  onClick={() => {
                    setStage("input");
                    setPlan(null);
                    setBlockedReasons([]);
                    setBinding(null);
                    setError(null);
                  }}
                >
                  Replan
                </Button>
              )}
            </>
          )}
        </div>
      </Modal.Footer>
    </Modal>
  );
}
