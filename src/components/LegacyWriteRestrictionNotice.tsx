import { LEGACY_WRITE_RESTRICTION_NOTICE } from "../utils/legacyWriteRestriction";

/** Short banner for legacy Home / project / pool / tools surfaces. */
export function LegacyWriteRestrictionNotice() {
  return (
    <div className="legacy-write-restriction-notice" role="status">
      <i className="fas fa-shield-halved" aria-hidden />
      <span>{LEGACY_WRITE_RESTRICTION_NOTICE}</span>
    </div>
  );
}
