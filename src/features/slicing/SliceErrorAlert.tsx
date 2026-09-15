import type { TranslateFn } from "../../i18n";
import {
  shouldShowDiagnosticDetail,
  sliceErrorSummary,
  type SliceErrorState,
} from "./sliceErrors";

export function SliceErrorAlert({
  error,
  t,
}: {
  error: SliceErrorState | null;
  t: TranslateFn;
}) {
  if (error === null) return null;
  const summary = sliceErrorSummary(t, error);
  const detail = shouldShowDiagnosticDetail(error) ? error.detail : undefined;
  return (
    <>
      <p role="alert" className="slice-error">{summary}</p>
      {detail !== undefined && (
        <p className="slice-error-detail">{detail}</p>
      )}
    </>
  );
}
