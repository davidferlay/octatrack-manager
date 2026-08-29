# Gate B cloned-media smoke

## Purpose

This checklist is the final human-reviewed evidence for Gate B's additive-copy
pilot. It does not authorize writes to an original SD/CF card or to a user's
only copy of music-production data.

The automated suite uses only test-created temporary directories and synthetic
WAV data. It covers journaled process interruption, application restart,
verified-backup revalidation, exact-operation approval, rollback, catalog
refresh, replacement-file preservation, symlink rejection, and source-byte
invariance. Automated fixtures are necessary, but they are not a substitute for
this cloned-media smoke.

## Preconditions

- A human identifies a disposable, independently recoverable clone made from
  non-original media. Record its provenance outside the repository.
- The original SD/CF card is disconnected before the smoke begins.
- The clone contains no sole copy of personal audio or project data.
- A separate checksum manifest and restorable image/backup of the clone exist.
- The test uses a synthetic, non-personal WAV already placed in a test Set's
  Audio Pool. Do not select an unknown or personal sample.
- The application build under review and its exact commit are recorded.
- No updater, release, deploy, cloud sync, or remote filesystem is involved.

If any precondition cannot be demonstrated, stop without registering the root.

## Additive-copy smoke

1. Start MasterOCTa and register the disposable clone. Confirm that the session
   begins in `READ ONLY` mode and that no absolute path is shown in the UI.
2. Confirm the expected Set, Project, and synthetic source WAV in the catalog.
3. Confirm that Recovery status is available and clear.
4. Enable the session-limited edit grant.
5. Create an additive-copy plan to a new, unused root-relative destination.
6. Review the displayed source, destination, byte count, backup count, warnings,
   overwrite prohibition, and delete count before checking approval.
7. Approve and apply the exact displayed plan once.
8. Confirm that the source file is byte-for-byte unchanged, the destination is
   byte-for-byte equal to the source, and unrelated clone files match the
   pre-smoke manifest.
9. Confirm that the destination appears after catalog refresh and that no
   second Apply is possible from the consumed approval.
10. Close the root and application. Do not use MasterOCTa to delete the smoke
    destination; retain or discard the disposable clone according to the
    external test plan.

## Recovery-route review

Process-crash fault injection is exercised only by the automated TempDir tests;
the production application exposes no fault-injection switch. Reviewers must
confirm the following from code and CI before signing off:

- Recovery accepts only opaque `RootId`, `OperationId`, and a separately supplied
  matching approved `OperationId`; it accepts no path.
- Recovery does not issue or require a reusable general write grant and revokes
  any grant left on the current session before rollback starts.
- The currently registered root is re-observed and must have the journal's
  stable device fingerprint.
- The operation journal and verified local backup are revalidated before media
  mutation.
- The verified backup manifest binds the source and destination, plan/snapshot
  IDs, root fingerprint, revision, source size/hash, and backup paths with a
  versioned recovery digest; editing the journal alone cannot redirect deletion.
- A published destination is removed only when both its recorded file identity
  and content match the verified backup. A replacement is preserved and keeps
  Recovery required.
- A candidate is first renamed without replacement to an operation-owned
  quarantine and reverified there. A destination replaced during verification
  is restored or preserved, never deleted as the operation-created file.
- Temporary partial files are removed only when their recorded file identity
  still matches.
- Source files and verified backups are retained; only the operation-created
  destination/partial and local staging are eligible for rollback cleanup.
- Symlinks, malformed journal data, missing/tampered backups, identity changes,
  and ambiguous state fail closed.
- Recovery re-observes the registered root after taking the writer lock and
  immediately before media mutation. Terminal journals reject replay.
- If a crash occurs after creating the empty operation partial but before its
  identity checkpoint, recovery preserves that unidentified partial, reports a
  terminal failure, and does not leave every later write blocked.
- A crash after publishing the partial but before the next journal checkpoint
  is recoverable with an identity invariant that survives rename plus content
  verification.
- Prior-release journal v2 remains readable. Its paired backup-manifest v1 is
  not promoted to authenticated deletion evidence; legacy incomplete state is
  marked terminal while its media and backup artifacts are preserved.

## Evidence record

Record the following in the Pull Request or a follow-up issue without including
absolute paths, volume identifiers, personal filenames, or media fingerprints:

- application commit and macOS version
- clone provenance reviewed: yes/no
- original media disconnected: yes/no
- baseline manifest verified: yes/no
- additive-copy result and source/unrelated-file invariance
- recovery code/CI review result
- deviations, failures, and whether the disposable clone was retained

Gate B remains incomplete until this checklist is executed against an approved
disposable clone and the evidence is reviewed by a human. M5 must not begin
before that sign-off.
