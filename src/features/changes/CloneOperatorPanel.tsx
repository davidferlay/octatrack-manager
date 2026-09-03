import { useState } from "react";
import type { CloneVerification, RootSession } from "../../api";
import { Button, StatusBadge } from "../../design-system";
import "./CloneOperatorPanel.css";

export interface CloneOperatorPanelProps {
  session: RootSession;
  cloneVerification: CloneVerification | null;
  busy?: boolean;
  sourceEvidenceRecorded?: boolean;
  onCreateManagedClone: () => Promise<void>;
  onRecordSourceEvidence: () => Promise<void>;
  onRegisterExternalClone: () => Promise<void>;
  onVerifyExternal: (acknowledgedDisposableClone: boolean) => Promise<void>;
  onReverify: () => Promise<void>;
}

function cloneBadgeTone(
  verification: CloneVerification | null,
): "readonly" | "warning" | "danger" | "safe" {
  if (verification === null) return "readonly";
  if (verification.state === "verified") return "safe";
  if (verification.state === "expired") return "warning";
  return "danger";
}

function cloneBadgeLabel(
  verification: CloneVerification | null,
  readOnlySource: boolean,
): string {
  if (verification === null) {
    return readOnlySource ? "READ-ONLY SOURCE" : "CLONE NOT VERIFIED";
  }
  switch (verification.state) {
    case "verified":
      return "VERIFIED CLONE";
    case "expired":
      return "CLONE VERIFICATION EXPIRED";
    case "tampered":
      return "CLONE TAMPERED";
    case "revoked":
      return "CLONE REVOKED";
    default:
      return "CLONE NOT VERIFIED";
  }
}

export function CloneOperatorPanel({
  session,
  cloneVerification,
  busy = false,
  sourceEvidenceRecorded = false,
  onCreateManagedClone,
  onRecordSourceEvidence,
  onRegisterExternalClone,
  onVerifyExternal,
  onReverify,
}: CloneOperatorPanelProps) {
  const [externalAcknowledged, setExternalAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const interactionBusy = busy || localBusy;
  const readOnlySource = session.mode === "read_only" && cloneVerification === null;
  const cloneVerified = cloneVerification?.state === "verified";
  const cloneBlocked = cloneVerification?.state === "tampered"
    || cloneVerification?.state === "revoked";

  async function run(action: () => Promise<void>) {
    setLocalBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <section className="mo-clone-operator" aria-labelledby="mo-clone-operator-title">
      <div className="mo-clone-operator__heading">
        <div>
          <p className="mo-clone-operator__eyebrow">Clone-first safety</p>
          <h3 id="mo-clone-operator-title">Clone operator</h3>
        </div>
        <StatusBadge tone={cloneBadgeTone(cloneVerification)}>
          {cloneBadgeLabel(cloneVerification, readOnlySource)}
        </StatusBadge>
      </div>

      <p className="mo-clone-operator__lede">
        Rename apply requires a verified disposable clone. Use managed clone creation or verify an
        external disposable copy before continuing rename operations.
      </p>

      {cloneVerified && (
        <p className="mo-clone-operator__status" role="status" aria-live="polite">
          Verified disposable clone active on this session.
          {" "}
          {cloneVerification.expiresInSeconds > 0
            ? `Verification expires in ${cloneVerification.expiresInSeconds} seconds.`
            : "Verification expiry is pending refresh."}
        </p>
      )}

      {cloneVerification?.state === "expired" && (
        <p className="mo-clone-operator__blocking" role="alert">
          Clone verification expired. Re-verify before rename apply or continuation.
        </p>
      )}

      {cloneBlocked && (
        <p className="mo-clone-operator__blocking" role="alert">
          Clone verification is {cloneVerification.state}. Continue and Apply are disabled until
          operator guidance is followed.
        </p>
      )}

      <div className="mo-clone-operator__actions">
        <Button
          variant="secondary"
          disabled={interactionBusy || cloneVerified}
          onClick={() => run(onCreateManagedClone)}
        >
          {localBusy ? "Working..." : "Create managed disposable clone"}
        </Button>
      </div>

      <details className="mo-clone-operator__external">
        <summary>External disposable clone</summary>
        <div className="mo-clone-operator__external-body">
          <p>
            Record source evidence on the read-only source, close it, register the external clone
            with the native picker, then verify against the recorded evidence.
          </p>
          <Button
            variant="secondary"
            disabled={interactionBusy || session.mode !== "read_only"}
            onClick={() => run(onRecordSourceEvidence)}
          >
            Record source evidence
          </Button>
          {sourceEvidenceRecorded && (
            <p className="mo-clone-operator__status" role="status">
              Source evidence recorded for this session.
            </p>
          )}
          <Button
            variant="secondary"
            disabled={interactionBusy || !sourceEvidenceRecorded}
            onClick={() => run(onRegisterExternalClone)}
          >
            Choose external clone root...
          </Button>
          <label className="mo-clone-operator__approval">
            <input
              type="checkbox"
              checked={externalAcknowledged}
              disabled={interactionBusy || cloneVerified}
              onChange={(event) => setExternalAcknowledged(event.target.checked)}
            />
            <span>
              I confirm this is a disposable clone and not the only copy of the source media.
            </span>
          </label>
          <Button
            variant="secondary"
            disabled={
              interactionBusy
              || !externalAcknowledged
              || cloneVerified
              || !sourceEvidenceRecorded
            }
            onClick={() => run(async () => onVerifyExternal(externalAcknowledged))}
          >
            Verify external clone
          </Button>
        </div>
      </details>

      {cloneVerification?.state === "expired" && (
        <Button variant="secondary" disabled={interactionBusy} onClick={() => run(onReverify)}>
          Re-verify clone
        </Button>
      )}

      {error !== null && <p className="mo-clone-operator__error" role="alert">{error}</p>}
    </section>
  );
}
