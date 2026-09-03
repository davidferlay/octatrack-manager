import { useEffect, useMemo, useRef, useState } from "react";
import {
  changeApi,
  renameApi,
  type ChangeApi,
  type ChangeRecoveryStatus,
  type CloneVerification,
  type RenameApi,
  type RenameApplyStatus,
  type RenameCommittedVerification,
  type RenameContinuationAuthority,
  type RenameContinuationStatus,
  type RenamePlan,
  type RenameRecoveryResult,
  type RenameRecoveryStatus,
  type RenameRollbackVerification,
  type RenameStatus,
  type RootSession,
} from "../../api";
import { Button, StatusBadge } from "../../design-system";
import "./RenameOperatorPanel.css";

interface RenameOperatorPanelProps {
  session: RootSession;
  changeRecovery: ChangeRecoveryStatus | null;
  renameRecovery: RenameRecoveryStatus | null;
  cloneVerification: CloneVerification | null;
  api?: RenameApi;
  changeClient?: ChangeApi;
  disabled?: boolean;
  refreshSession: () => Promise<RootSession>;
  onApplied: () => Promise<void> | void;
  onRecovered: () => Promise<void> | void;
  onBusyChange?: (busy: boolean) => void;
  onRenameRecoveryChange?: (recovery: RenameRecoveryStatus) => void;
  onRecoveryChange?: (recovery: ChangeRecoveryStatus) => void;
}

interface ContinuationGrant {
  operationId: string;
  continuationAuthorityId: string;
  expiresAtMs: number;
}

interface TransactionOutcome {
  operationId: string;
  kind: "apply" | "recovery";
  apply?: RenameApplyStatus;
  committedVerification?: RenameCommittedVerification;
  recovery?: RenameRecoveryResult;
  rollbackVerification?: RenameRollbackVerification;
}

function messageFrom(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function operatorOperations(recovery: RenameRecoveryStatus | null): RenameStatus[] {
  if (recovery === null) return [];
  return recovery.operations.filter((operation) => (
    operation.state === "prepared"
    || operation.state === "applying"
    || operation.state === "recovery_required"
    || operation.state === "committed"
    || operation.state === "rolled_back"
  ));
}

function uniqueProjectCount(plan: RenamePlan | null): number {
  if (plan === null) return 0;
  const paths = new Set<string>();
  for (const impact of plan.stateDocumentImpacts) {
    paths.add(impact.relativePath);
  }
  return paths.size;
}

function RenamePlanReview({ plan }: { plan: RenamePlan }) {
  return (
    <dl className="mo-rename-operator__review">
      <div>
        <dt>Source</dt>
        <dd><code>{plan.sourceRelativePath}</code></dd>
      </div>
      <div>
        <dt>Destination</dt>
        <dd><code>{plan.destinationRelativePath}</code></dd>
      </div>
      <div>
        <dt>References</dt>
        <dd>{plan.referenceUpdateCount}</dd>
      </div>
      <div>
        <dt>Affected Project documents</dt>
        <dd>{uniqueProjectCount(plan)}</dd>
      </div>
      <div>
        <dt>Sidecar</dt>
        <dd>{plan.sidecarImpacts.length > 0 ? "yes" : "no"}</dd>
      </div>
      <div>
        <dt>Backup</dt>
        <dd>{plan.backupRelativePaths.length > 0 ? "verified scope recorded" : "none"}</dd>
      </div>
    </dl>
  );
}

function ContinuationReview({
  continuation,
}: {
  continuation: RenameContinuationStatus | null;
}) {
  if (continuation === null) return null;
  return (
    <dl className="mo-rename-operator__continuation">
      <div>
        <dt>Prepared snapshot</dt>
        <dd>{continuation.preparedSnapshotAvailable ? "VERIFIED" : "MISSING"}</dd>
      </div>
      <div>
        <dt>Backup</dt>
        <dd>{continuation.backupVerified ? "VERIFIED" : "NOT VERIFIED"}</dd>
      </div>
      <div>
        <dt>Clone</dt>
        <dd>{continuation.cloneVerified ? "VERIFIED" : "NOT VERIFIED"}</dd>
      </div>
      <div>
        <dt>Continuation state</dt>
        <dd>{continuation.state.replace(/_/g, " ").toUpperCase()}</dd>
      </div>
    </dl>
  );
}

export function RenameOperatorPanel({
  session,
  changeRecovery,
  renameRecovery,
  cloneVerification,
  api = renameApi,
  changeClient = changeApi,
  disabled = false,
  refreshSession,
  onApplied,
  onRecovered,
  onBusyChange,
  onRenameRecoveryChange,
  onRecoveryChange,
}: RenameOperatorPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, RenamePlan>>({});
  const [continuations, setContinuations] = useState<Record<string, RenameContinuationStatus>>({});
  const [continueApproved, setContinueApproved] = useState<Record<string, boolean>>({});
  const [applyApproved, setApplyApproved] = useState<Record<string, boolean>>({});
  const [recoveryApproved, setRecoveryApproved] = useState<Record<string, boolean>>({});
  const [continuationGrant, setContinuationGrant] = useState<ContinuationGrant | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, TransactionOutcome>>({});
  const expiryTimerRef = useRef<number | null>(null);

  const operations = useMemo(() => operatorOperations(renameRecovery), [renameRecovery]);
  const additiveRecovery = changeRecovery?.recoveryRequired === true;
  const renameRecoveryBlocking = renameRecovery?.recoveryRequired === true;
  const safetyUnavailable = changeRecovery === null || renameRecovery === null;
  const writeEnabled = session.mode === "write_enabled" && session.capabilities.write;
  const cloneVerified = cloneVerification?.state === "verified";
  const cloneBlocked = cloneVerification?.state === "tampered"
    || cloneVerification?.state === "revoked";
  const interactionBusy = busy || disabled;

  function setPanelBusy(nextBusy: boolean) {
    setBusy(nextBusy);
    onBusyChange?.(nextBusy);
  }

  useEffect(() => {
    setContinuationGrant(null);
    setContinueApproved({});
    setApplyApproved({});
    setRecoveryApproved({});
    setOutcomes({});
    setError(null);
  }, [session.rootId]);

  useEffect(() => {
    if (continuationGrant === null) return undefined;
    const remainingMs = continuationGrant.expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      setContinuationGrant(null);
      setApplyApproved((current) => {
        const next = { ...current };
        delete next[continuationGrant.operationId];
        return next;
      });
      return undefined;
    }
    expiryTimerRef.current = window.setTimeout(() => {
      setContinuationGrant(null);
      setApplyApproved((current) => {
        const next = { ...current };
        delete next[continuationGrant.operationId];
        return next;
      });
    }, remainingMs);
    return () => {
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
      }
    };
  }, [continuationGrant]);

  useEffect(() => {
    let cancelled = false;
    async function loadOperationContext() {
      const nextPlans: Record<string, RenamePlan> = {};
      const nextContinuations: Record<string, RenameContinuationStatus> = {};
      for (const operation of operations) {
        try {
          nextPlans[operation.operationId] = await api.getPreparedPlan(
            session.rootId,
            operation.operationId,
          );
        } catch {
          // Prepared plan may be unavailable for terminal states; keep operation visible.
        }
        if (operation.state === "prepared") {
          try {
            nextContinuations[operation.operationId] = await api.continuationStatus(
              session.rootId,
              operation.operationId,
            );
          } catch {
            // Fail closed in UI when continuation status is unavailable.
          }
        }
      }
      if (!cancelled) {
        setPlans(nextPlans);
        setContinuations(nextContinuations);
      }
    }
    if (operations.length > 0) {
      void loadOperationContext();
    } else {
      setPlans({});
      setContinuations({});
    }
    return () => {
      cancelled = true;
    };
  }, [api, operations, session.rootId]);

  async function refreshRecoveryStatuses() {
    try {
      onRenameRecoveryChange?.(await api.recoveryStatus(session.rootId));
    } catch {
      // UI remains fail closed.
    }
    try {
      onRecoveryChange?.(await changeClient.recoveryStatus(session.rootId));
    } catch {
      // UI remains fail closed.
    }
  }

  async function continueOperation(operation: RenameStatus) {
    if (
      interactionBusy
      || !continueApproved[operation.operationId]
      || safetyUnavailable
      || additiveRecovery
      || cloneBlocked
    ) {
      return;
    }
    setPanelBusy(true);
    setError(null);
    setApplyApproved((current) => ({ ...current, [operation.operationId]: false }));
    try {
      await refreshSession();
      const authority: RenameContinuationAuthority = await api.continueOperation(
        session.rootId,
        operation.operationId,
        operation.operationId,
      );
      setContinuationGrant({
        operationId: operation.operationId,
        continuationAuthorityId: authority.continuationAuthorityId,
        expiresAtMs: Date.now() + authority.expiresInSeconds * 1000,
      });
      const latestContinuation = await api.continuationStatus(
        session.rootId,
        operation.operationId,
      );
      setContinuations((current) => ({
        ...current,
        [operation.operationId]: latestContinuation,
      }));
    } catch (reason) {
      setContinuationGrant(null);
      setError(messageFrom(reason));
    } finally {
      setPanelBusy(false);
    }
  }

  async function applyOperation(operation: RenameStatus) {
    const grant = continuationGrant;
    if (
      interactionBusy
      || grant === null
      || grant.operationId !== operation.operationId
      || !applyApproved[operation.operationId]
      || !writeEnabled
      || safetyUnavailable
      || additiveRecovery
      || !cloneVerified
      || cloneBlocked
    ) {
      return;
    }
    setPanelBusy(true);
    setError(null);
    let applyAttempted = false;
    const authorityId = grant.continuationAuthorityId;
    try {
      const currentSession = await refreshSession();
      if (currentSession.mode !== "write_enabled" || !currentSession.capabilities.write) {
        throw new Error("The session write grant expired. Enable edit mode again before Apply.");
      }
      const plan = await api.getPreparedPlan(session.rootId, operation.operationId);
      const displayed = plans[operation.operationId];
      if (
        displayed !== undefined
        && (
          displayed.planId !== plan.planId
          || displayed.sourceRelativePath !== plan.sourceRelativePath
          || displayed.destinationRelativePath !== plan.destinationRelativePath
        )
      ) {
        throw new Error("The displayed prepared plan no longer matches the backend plan.");
      }
      applyAttempted = true;
      const applied = await api.apply(
        session.rootId,
        operation.operationId,
        operation.operationId,
        authorityId,
      );
      setOutcomes((current) => ({
        ...current,
        [operation.operationId]: { operationId: operation.operationId, kind: "apply", apply: applied },
      }));
      if (applied.mutationState === "committed") {
        try {
          await onApplied();
        } catch (refreshReason) {
          setError(`Rename committed, but refresh failed: ${messageFrom(refreshReason)}`);
        }
      }
    } catch (reason) {
      const primaryError = messageFrom(reason);
      setError(primaryError);
      if (applyAttempted) {
        try {
          const recoveredStatus = await api.getStatus(session.rootId, operation.operationId);
          if (recoveredStatus.state === "committed") {
            setOutcomes((current) => ({
              ...current,
              [operation.operationId]: {
                operationId: operation.operationId,
                kind: "apply",
                apply: {
                  schema: "rename-apply-status:v2",
                  planId: recoveredStatus.planId ?? "",
                  operationId: operation.operationId,
                  snapshotId: recoveredStatus.backupSnapshotId ?? "",
                  mutationState: "committed",
                  verificationState: "failed",
                  verificationCode: "APPLY_RESPONSE_INTERRUPTED",
                  rescanCompleted: false,
                  observedFileCount: 0,
                  missingReferenceCount: 0,
                  invalidReferenceCount: 0,
                  unresolvedReferenceCount: 0,
                },
              },
            }));
            try {
              await onApplied();
            } catch (refreshReason) {
              setError(`Backend confirms rename committed, but refresh failed: ${messageFrom(refreshReason)}`);
            }
            setError(`Apply response was interrupted: ${primaryError}. Backend confirms the rename committed.`);
          }
        } catch {
          // Keep primary error.
        }
      }
    } finally {
      setContinuationGrant(null);
      setApplyApproved((current) => ({ ...current, [operation.operationId]: false }));
      await refreshRecoveryStatuses();
      setPanelBusy(false);
    }
  }

  async function verifyCommittedOperation(operationId: string) {
    setPanelBusy(true);
    setError(null);
    try {
      const verified = await api.verifyCommitted(session.rootId, operationId);
      setOutcomes((current) => ({
        ...current,
        [operationId]: {
          ...(current[operationId] ?? { operationId, kind: "apply" }),
          committedVerification: verified,
          apply: current[operationId]?.apply,
        },
      }));
      await onApplied();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setPanelBusy(false);
    }
  }

  async function recoverOperation(operation: RenameStatus) {
    if (interactionBusy || !recoveryApproved[operation.operationId]) return;
    setPanelBusy(true);
    setError(null);
    let recoveryAttempted = false;
    try {
      await refreshSession();
      recoveryAttempted = true;
      const recovered = await api.recover(
        session.rootId,
        operation.operationId,
        operation.operationId,
      );
      setOutcomes((current) => ({
        ...current,
        [operation.operationId]: {
          operationId: operation.operationId,
          kind: "recovery",
          recovery: recovered,
        },
      }));
      if (recovered.mutationState === "rolled_back" && recovered.verificationState === "passed") {
        try {
          await onRecovered();
        } catch (refreshReason) {
          setError(`Rollback completed, but refresh failed: ${messageFrom(refreshReason)}`);
        }
      }
    } catch (reason) {
      const primaryError = messageFrom(reason);
      setError(primaryError);
      if (recoveryAttempted) {
        try {
          const recoveredStatus = await api.getStatus(session.rootId, operation.operationId);
          if (recoveredStatus.state === "rolled_back") {
            setOutcomes((current) => ({
              ...current,
              [operation.operationId]: {
                operationId: operation.operationId,
                kind: "recovery",
                recovery: {
                  schema: "rename-recovery-result:v1",
                  operationId: operation.operationId,
                  planId: recoveredStatus.planId ?? "",
                  mutationState: "rolled_back",
                  verificationState: "failed",
                  verificationCode: "RECOVERY_RESPONSE_INTERRUPTED",
                  rescanCompleted: false,
                  restoredReferenceCount: 0,
                  missingReferenceCount: 0,
                  invalidReferenceCount: 0,
                  unresolvedReferenceCount: 0,
                },
              },
            }));
            try {
              await onRecovered();
            } catch (refreshReason) {
              setError(`Backend confirms rollback, but refresh failed: ${messageFrom(refreshReason)}`);
            }
            setError(`Recovery response was interrupted: ${primaryError}. Backend confirms rollback completed.`);
          }
        } catch {
          // Keep primary error.
        }
      }
    } finally {
      setRecoveryApproved((current) => ({ ...current, [operation.operationId]: false }));
      await refreshRecoveryStatuses();
      setPanelBusy(false);
    }
  }

  async function verifyRollbackOperation(operationId: string) {
    setPanelBusy(true);
    setError(null);
    try {
      const verified = await api.verifyRolledBack(session.rootId, operationId);
      setOutcomes((current) => ({
        ...current,
        [operationId]: {
          ...(current[operationId] ?? { operationId, kind: "recovery" }),
          rollbackVerification: verified,
          recovery: current[operationId]?.recovery,
        },
      }));
      await onRecovered();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setPanelBusy(false);
    }
  }

  const continuationSecondsRemaining = continuationGrant === null
    ? null
    : Math.max(0, Math.ceil((continuationGrant.expiresAtMs - Date.now()) / 1000));

  return (
    <section className="mo-rename-operator" aria-labelledby="mo-rename-operator-title">
      <div className="mo-rename-operator__heading">
        <div>
          <p className="mo-rename-operator__eyebrow">Prepared transaction operator</p>
          <h3 id="mo-rename-operator-title">Rename operator</h3>
        </div>
        <StatusBadge tone={renameRecoveryBlocking ? "danger" : "warning"}>
          {renameRecoveryBlocking ? "RECOVERY REQUIRED" : "PREPARED OPERATIONS"}
        </StatusBadge>
      </div>

      {safetyUnavailable && (
        <p className="mo-rename-operator__blocking" role="alert">
          Write safety status unavailable. Mutation controls are disabled.
        </p>
      )}

      {additiveRecovery && (
        <p className="mo-rename-operator__blocking" role="alert">
          An incomplete additive-copy operation exists. Rename continue and apply are disabled.
        </p>
      )}

      {!cloneVerified && operations.some((operation) => operation.state === "prepared") && (
        <p className="mo-rename-operator__blocking" role="alert">
          Rename apply requires a verified disposable clone.
        </p>
      )}

      {operations.length === 0 && (
        <p className="mo-rename-operator__empty">
          No prepared or incomplete rename operations are currently bound to this root session.
        </p>
      )}

      {operations.map((operation) => {
        const plan = plans[operation.operationId] ?? null;
        const continuation = continuations[operation.operationId] ?? null;
        const outcome = outcomes[operation.operationId];
        const applyOutcome = outcome?.apply;
        const committedVerification = outcome?.committedVerification ?? (
          applyOutcome?.mutationState === "committed" ? applyOutcome : undefined
        );
        const recoveryOutcome = outcome?.recovery;
        const rollbackVerification = outcome?.rollbackVerification;
        const canContinue = operation.state === "prepared"
          && continuation?.state === "ready_to_continue"
          && continuation.preparedSnapshotAvailable
          && continuation.backupVerified
          && continuation.cloneVerified
          && writeEnabled
          && !safetyUnavailable
          && !additiveRecovery
          && !cloneBlocked;
        const activeGrant = continuationGrant?.operationId === operation.operationId
          ? continuationGrant
          : null;

        return (
          <article
            key={operation.operationId}
            className="mo-rename-operator__card"
            aria-label={`Rename operation ${operation.operationId}`}
          >
            <header className="mo-rename-operator__card-header">
              <div>
                <strong>Operation</strong>
                <code>{operation.operationId}</code>
              </div>
              <StatusBadge tone={
                operation.state === "recovery_required" || operation.state === "applying"
                  ? "danger"
                  : operation.state === "prepared"
                    ? "warning"
                    : "readonly"
              }>
                {operation.state.replace(/_/g, " ").toUpperCase()}
              </StatusBadge>
            </header>

            {plan !== null && <RenamePlanReview plan={plan} />}

            {operation.state === "prepared" && (
              <>
                <ContinuationReview continuation={continuation} />
                <label className="mo-rename-operator__approval">
                  <input
                    type="checkbox"
                    checked={continueApproved[operation.operationId] === true}
                    disabled={interactionBusy || !canContinue}
                    onChange={(event) => setContinueApproved((current) => ({
                      ...current,
                      [operation.operationId]: event.target.checked,
                    }))}
                  />
                  <span>
                    I reviewed this prepared rename and approve continuing this exact operation
                    on the verified clone.
                  </span>
                </label>
                <Button
                  variant="secondary"
                  disabled={interactionBusy || !canContinue || !continueApproved[operation.operationId]}
                  onClick={() => continueOperation(operation)}
                >
                  {busy ? "Continuing..." : "Continue prepared rename"}
                </Button>

                {activeGrant !== null && (
                  <>
                    <p className="mo-rename-operator__status" role="status" aria-live="polite">
                      Continuation approval expires in {continuationSecondsRemaining ?? 0} seconds.
                    </p>
                    <label className="mo-rename-operator__approval">
                      <input
                        type="checkbox"
                        checked={applyApproved[operation.operationId] === true}
                        disabled={interactionBusy || !writeEnabled || !cloneVerified || cloneBlocked}
                        onChange={(event) => setApplyApproved((current) => ({
                          ...current,
                          [operation.operationId]: event.target.checked,
                        }))}
                      />
                      <span>
                        I approve applying this exact rename to the verified disposable clone.
                      </span>
                    </label>
                    <Button
                      variant="modalPrimary"
                      disabled={
                        interactionBusy
                        || !applyApproved[operation.operationId]
                        || activeGrant === null
                      }
                      onClick={() => applyOperation(operation)}
                    >
                      {busy ? "Applying..." : "Apply approved rename"}
                    </Button>
                  </>
                )}
              </>
            )}

            {(applyOutcome?.mutationState === "committed"
              || committedVerification?.mutationState === "committed") && (
              <div className="mo-rename-operator__result" role="status" aria-live="polite">
                <StatusBadge tone={
                  (committedVerification?.verificationState ?? applyOutcome?.verificationState) === "passed"
                    ? "safe"
                    : "danger"
                }>
                  COMMITTED
                  {" / "}
                  {(committedVerification?.verificationState ?? applyOutcome?.verificationState) === "passed"
                    ? "VERIFIED"
                    : "VERIFICATION FAILED"}
                </StatusBadge>
                <dl>
                  <div><dt>Missing</dt><dd>{committedVerification?.missingReferenceCount ?? applyOutcome?.missingReferenceCount ?? 0}</dd></div>
                  <div><dt>Invalid</dt><dd>{committedVerification?.invalidReferenceCount ?? applyOutcome?.invalidReferenceCount ?? 0}</dd></div>
                  <div><dt>Unresolved</dt><dd>{committedVerification?.unresolvedReferenceCount ?? applyOutcome?.unresolvedReferenceCount ?? 0}</dd></div>
                  <div><dt>Rescan</dt><dd>{(committedVerification?.rescanCompleted ?? applyOutcome?.rescanCompleted) ? "completed" : "pending"}</dd></div>
                </dl>
                {(committedVerification?.verificationState ?? applyOutcome?.verificationState) === "failed" && (
                  <Button
                    variant="secondary"
                    disabled={interactionBusy}
                    onClick={() => verifyCommittedOperation(operation.operationId)}
                  >
                    Re-run verification
                  </Button>
                )}
              </div>
            )}

            {(operation.state === "applying" || operation.state === "recovery_required") && (
              <div className="mo-rename-operator__recovery">
                <p role="alert">
                  Recovery is required for this exact incomplete rename operation.
                </p>
                <label className="mo-rename-operator__approval">
                  <input
                    type="checkbox"
                    checked={recoveryApproved[operation.operationId] === true}
                    disabled={interactionBusy}
                    onChange={(event) => setRecoveryApproved((current) => ({
                      ...current,
                      [operation.operationId]: event.target.checked,
                    }))}
                  />
                  <span>
                    I approve rollback of this exact incomplete rename operation.
                  </span>
                </label>
                <Button
                  variant="danger"
                  disabled={interactionBusy || !recoveryApproved[operation.operationId]}
                  onClick={() => recoverOperation(operation)}
                >
                  {busy ? "Recovering..." : "Roll back incomplete rename"}
                </Button>
              </div>
            )}

            {(recoveryOutcome?.mutationState === "rolled_back"
              || rollbackVerification?.mutationState === "rolled_back") && (
              <div className="mo-rename-operator__result" role="status" aria-live="polite">
                <StatusBadge tone={
                  (rollbackVerification?.verificationState ?? recoveryOutcome?.verificationState) === "passed"
                    ? "safe"
                    : "danger"
                }>
                  ROLLED BACK
                  {" / "}
                  {(rollbackVerification?.verificationState ?? recoveryOutcome?.verificationState) === "passed"
                    ? "VERIFIED"
                    : "VERIFICATION NEEDS ATTENTION"}
                </StatusBadge>
                {(rollbackVerification?.verificationState ?? recoveryOutcome?.verificationState) === "failed" && (
                  <Button
                    variant="secondary"
                    disabled={interactionBusy}
                    onClick={() => verifyRollbackOperation(operation.operationId)}
                  >
                    Re-run rollback verification
                  </Button>
                )}
              </div>
            )}
          </article>
        );
      })}

      {error !== null && <p className="mo-rename-operator__error" role="alert">{error}</p>}
    </section>
  );
}
