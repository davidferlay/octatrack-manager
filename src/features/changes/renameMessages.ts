/** Map backend rename block reason codes to user-facing text. */
export function renameBlockReasonMessage(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    ROOT_MISMATCH: "This rename plan is not bound to the current root.",
    UNSTABLE_ROOT_IDENTITY: "The root does not have a stable device identity.",
    INVALID_ROOT_FINGERPRINT: "The root fingerprint is invalid.",
    SCAN_NOT_COMPLETED: "Catalog indexing has not completed for this root.",
    INVALID_OBSERVED_REVISION: "The catalog revision is invalid.",
    CATALOG_REVISION_MISMATCH: "The catalog changed after this plan was created. Review the rename again.",
    SOURCE_IDENTITY_MISMATCH: "The source sample identity no longer matches the plan.",
    SOURCE_PATH_MISMATCH: "The source path no longer matches the plan.",
    SOURCE_SIZE_MISMATCH: "The source file size changed.",
    SOURCE_HASH_MISMATCH: "The source file content changed.",
    STALE_SOURCE_HASH_FRESHNESS: "The source hash evidence is stale.",
    SOURCE_EQUALS_DESTINATION: "The new name matches the current name.",
    DESTINATION_OBSERVATION_MISMATCH: "The destination observation no longer matches.",
    DESTINATION_OCCUPIED: "A file already exists at the destination name.",
    DESTINATION_CASE_COLLISION: "The destination would collide with an existing name (case-insensitive).",
    DESTINATION_NORMALIZATION_COLLISION: "The destination would collide with a Unicode-normalized sibling name.",
    DESTINATION_UNSAFE_PATH: "The destination path is not safe.",
    DESTINATION_INCOMPARABLE: "The destination parent could not be compared safely.",
    SIDECAR_DESTINATION_OBSERVATION_MISMATCH: "The sidecar destination observation changed.",
    SIDECAR_DESTINATION_OCCUPIED: "A sidecar file already exists at the destination.",
    SIDECAR_DESTINATION_CASE_COLLISION: "The sidecar destination would collide (case-insensitive).",
    SIDECAR_DESTINATION_NORMALIZATION_COLLISION: "The sidecar destination would collide (Unicode normalization).",
    SIDECAR_DESTINATION_UNSAFE_PATH: "The sidecar destination path is not safe.",
    SIDECAR_DESTINATION_INCOMPARABLE: "The sidecar destination parent could not be compared.",
    UNSUPPORTED_STATE_DOCUMENT: "A referenced Project/Bank document is unsupported.",
    MALFORMED_STATE_DOCUMENT: "A referenced Project/Bank document is malformed.",
    UNSUPPORTED_SIDECAR: "A sample settings sidecar is unsupported.",
    MALFORMED_SIDECAR: "A sample settings sidecar is malformed.",
    AMBIGUOUS_SIDECAR_OWNERSHIP: "Sidecar ownership is ambiguous.",
    INCOMPLETE_USAGE_GRAPH: "The usage graph is incomplete for this rename.",
    INCOMPLETE_SET_PROJECT_COVERAGE: "Set/Project coverage is incomplete.",
    UNRESOLVED_REFERENCE: "Unresolved sample references block this rename.",
    DESTINATION_REFERENCED_BY_UNRESOLVED_SLOT: "The destination is referenced by an unresolved slot.",
    DESTINATION_ALREADY_REFERENCED: "The destination is already referenced elsewhere.",
    INCOMPLETE_REFERENCE_UPDATE_SET: "The reference update set is incomplete.",
    ARITHMETIC_OVERFLOW: "Impact estimation overflowed.",
  };
  return messages[code] ?? fallback;
}

export function renameErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    if (typeof record.code === "string") {
      const codeMessages: Record<string, string> = {
        WRITE_NOT_ENABLED: "Enable edit mode in Sources before preparing this rename.",
        PLAN_NOT_FOUND: "This rename plan has expired. Review the current state again.",
        PLAN_STALE: "The source changed after this plan was created. Review the rename again.",
        ROOT_CHANGED: "The source changed after this plan was created. Review the rename again.",
        CATALOG_REVISION_MISMATCH: "The catalog changed after this plan was created. Review the rename again.",
        CATALOG_STALE: "The catalog is stale. Re-register the root or rescan before replanning.",
        RECOVERY_REQUIRED: "A previous file operation requires recovery before another rename can be prepared.",
        BACKUP_FAILED: "Verified backup creation failed.",
        AUTHORITY_EXPIRED: "Rename authority expired. Review and approve again.",
        AUTHORITY_NOT_FOUND: "Rename authority is no longer available. Review and approve again.",
        AUTHORITY_MISMATCH: "Rename authority does not match this plan.",
        SNAPSHOT_MISMATCH: "The verified backup does not match this plan.",
        INVALID_TRANSITION: "This rename operation is no longer in a valid state.",
        VERIFY_FAILED: "Verification failed before preparation could complete.",
        REFERENCE_REWRITE_FAILED: "Reference preparation failed.",
      };
      if (codeMessages[record.code]) return codeMessages[record.code];
    }
    if (typeof record.message === "string" && record.message !== "") {
      return record.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatStateDocumentRole(role: string): string {
  if (role === "working") return "Working state";
  if (role === "saved_checkpoint") return "Saved checkpoint";
  return role;
}

export function formatSlotKind(kind: string): string {
  return kind === "flex" ? "Flex" : "Static";
}
