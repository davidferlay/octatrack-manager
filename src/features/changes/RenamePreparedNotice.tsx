import type { RenameRecoveryStatus, RenameStatus } from "../../api";
import "./RenamePreparedNotice.css";

export interface RenamePreparedNoticeProps {
  recovery: RenameRecoveryStatus | null;
}

function preparedOperations(recovery: RenameRecoveryStatus | null): RenameStatus[] {
  if (recovery === null) return [];
  return recovery.operations.filter((operation) => operation.state === "prepared");
}

export function RenamePreparedNotice({ recovery }: RenamePreparedNoticeProps) {
  const prepared = preparedOperations(recovery);
  if (prepared.length === 0) return null;

  return (
    <section className="rename-prepared-notice" aria-label="Prepared rename operations">
      <h4>Prepared rename</h4>
      {prepared.map((operation) => (
        <p key={operation.operationId}>
          A prepared rename operation exists.
          {" "}
          No media changes have been applied.
          {operation.planExpired && " The original review plan is no longer available."}
        </p>
      ))}
    </section>
  );
}
