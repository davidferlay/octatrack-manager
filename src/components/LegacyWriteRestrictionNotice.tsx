import { useTranslate } from "../i18n";
import { legacyWriteRestrictionNotice } from "../utils/legacyWriteRestriction";

/** Short banner for legacy Home / project / pool / tools surfaces. */
export function LegacyWriteRestrictionNotice() {
  const t = useTranslate();
  return (
    <div className="legacy-write-restriction-notice" role="status">
      <i className="fas fa-shield-halved" aria-hidden />
      <span>{legacyWriteRestrictionNotice(t)}</span>
    </div>
  );
}
