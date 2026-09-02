# M5-C Recoverable Rename Transaction

- Status: C1 verified-backup contract **complete**; C2 Mac staging **complete**;
  C3 clone apply / rollback **complete** (`373a755` / #69); C4 automated
  clone-rescan proof **complete** (`15eef67` / #70); C5 operator harness **Phase 1
  complete**, **Phase 2 complete**, Phase 3+ in progress
- Scope of C3: apply a C2 `Prepared` journal to a **temporary/cloned** root;
  re-verify C1 backup + authorization hashes + codec rebuild from backup
  before any clone write; roll the clone back from backup on failure
- Scope of C4: compose C1/C2/C3 with catalog baseline scan, fresh filesystem
  rescan after apply or rollback, and `#[cfg(test)]` fault injection via
  `ot-executor` feature `test-seams` (production builds unchanged)
- Non-scope of this PR: original removable media, Tauri, frontend, SQLite
  migration, cloud, DMG, signing, Gate C human clone-load smoke,
  controlled operator harness

## Purpose

A sample rename is a multi-file transaction. Before any Octatrack media mutation,
MasterOCTa must hold an immutable, re-verifiable Mac-side backup of every file
listed by `RenameImpactPlan`. C1 creates and re-verifies that backup only. It
does not change the source root.

The backup target set is reconstructed from the plan and must equal
`backup_relative_paths`:

- `source_relative_path`
- `state_document_impacts[].relative_path`
- `sidecar_impacts[].source_sidecar_relative_path`

Destination audio and destination sidecar paths are never copied into the
snapshot.

## Schema choice: `masterocta-rename-backup:v1`

Existing `ot-backup` v2 is an additive-copy `ChangePlan` snapshot:

- `SnapshotId::for_plan`, `create_verified`, `verify_for_plan`, and
  `recovery_binding_for_plan` assume a single source and destination
- M4 executor/recovery depends on `masterocta-backup:v2` and
  `recovery-binding:v1:`
- v2 `BackupManifest` / `VerifiedBackup` have no typed operation kind and no
  multi-file role list

C1 therefore adds a dedicated schema instead of `masterocta-backup:v3`.

| Choice | Why |
|---|---|
| Dedicated `masterocta-rename-backup:v1` | Do not reinterpret v2 or convert a `RenameImpactPlan` into a fake `ChangePlan` |
| Typed `RenameBackupOperationKind::RenameSample` | Operation kind is a serde enum (`rename_sample`), not a loose string |
| Separate `VerifiedRenameBackup` | Do not add rename fields to v2 `BackupManifest` / `VerifiedBackup` |
| Binding prefix `recovery-binding:rename:v1:` | Canonical digest prefix is `masterocta:rename-recovery-binding:v1`; M4 `recovery-binding:v1:` stays exclusive to additive copy |
| Same `snapshot:v1:<plan-sha256-hex>` directory name | `SnapshotId::for_rename_plan` reuses the existing SnapshotId format; mixing is rejected by schema / `operation_kind` at verify |

Existing v2 create/verify/recovery tests remain unchanged and must keep passing.

## C1 / C2 / C3 split

| Slice | Allowed | Forbidden |
|---|---|---|
| **C1** | Reconstruct the plan backup set; copy those files to a Mac-side snapshot outside the source root; fsync; atomic publish; re-verify size/hash/binding | Media rename/move, PATH rewrite, journal, rollback, recovery apply, Tauri, frontend |
| **C2** | Re-verify the C1 backup; run `ProjectReferenceCodec` on Mac staging copies; semantic diff; authorization; prepare a journal that is not yet applied to media | Media mutation, publishing rewritten Project files onto the Octatrack root |
| **C3** (this PR) | Apply the prepared journal to a temporary/cloned root with rollback | Original removable media; cloud; public distribution; Tauri |

C2 must not write codec output with a raw `std::fs::write` onto media, and must
not route Project rewrite through `ot-tools-io` full serialize or
`update_project_file_paths_surgical`. C3 writes the clone only through
descriptor-relative `NOFOLLOW` open / `EXCL` create / `renameat` `NOREPLACE`.

## C3 API

- `RenameSampleExecutor::apply(plan, codec, authority)` where
  `authority: CloneWriteAuthority` and resolve yields a `VerifiedCloneRoot`
  (attested temporary copy). A generic `WriteAuthority` cannot call apply.
- `RenameSampleExecutor::rollback(live_root_id, operation_id, authority)`
  where `authority: RecoveryAuthority`. After restart the session `RootId`
  and write grant may be gone; recovery is keyed by the live registered root
  and operation ID, same as M4 `recover_incomplete_operation`. It does not
  require `write_enabled` or the original `observed_revision`.
- Journal statuses: `Prepared`, `Applying`, `Committed`, `RolledBack`,
  `RecoveryRequired`
- Optional `failure_code` on the rename journal (absent on a fresh `Prepared`)

Apply flow:

1. Validate the plan shape and clone write authority; acquire the per-root lock;
   re-resolve the clone (canonical path + fingerprint) after the lock and again
   immediately before the first clone write
2. Load the create-once authorization (read-only, `NOFOLLOW`) and `Prepared`
   journal; they must agree on hashes, binding, and plan identity
3. Re-verify the C1 backup. Do not trust C2 staging bytes
4. Rebuild dest audio, dest sidecar, and rewritten Projects from **backup**
   bytes through `ProjectReferenceCodec`. The rebuilt records must equal both
   the journal and the authorization
5. Re-read the clone: source / sidecar / Project hashes must still match the
   plan; destination audio and sidecar must be absent. Also reject an ASCII
   case-insensitive name in the destination parent. Unicode NFC/NFD
   equivalence stays a planner observation; apply does not add a
   normalization crate
6. Persist `Applying`, then write the clone in order:
   new audio (and dest sidecar) → Project replace → source quarantine
7. Post-read dest / Project hashes; unlink source quarantines (unlink failure
   is propagated); persist `Committed`. A failed `Committed` journal write
   rolls the clone back
8. On any apply failure after `Applying`, restore the clone from the C1 backup
   (and leftover `.partial` / `.quarantine` siblings) and persist `RolledBack`.
   A rollback that cannot restore expected bytes becomes `RecoveryRequired`

Rollback preflights every target before mutating. Destinations are removed
only when the live bytes are the transaction's staged hash. Projects and
sources are restored only when live bytes are missing, match the backup, or
match the staged transaction output. Any other live hash leaves the tree
untouched and returns `RecoveryRequired`.

`rollback` on a still-`Prepared` journal only marks `RolledBack` and does not
touch the clone. `rollback` on `Applying` / `RecoveryRequired` restores the
clone from the verified rename snapshot (no plan required).

Tests copy a tempfile tree to a clone, apply only the clone, and assert the
original tree is byte-identical. No original SD/CF media.

## C2 API

- `RenameSampleExecutor::prepare(plan, codec, authority)`
- `RenameSampleExecutor::rename_journal(operation_id)`
- `OperationId::for_rename_plan`
- Dedicated journal schema `masterocta-rename-operation-journal:v1`
- Dedicated authorization schema `masterocta-rename-recovery-authorization:v1`
- Typed `RenameJournalOperationKind::RenameSample`
- Journal / authorization / staging live under `journals/rename/` and
  `staging/rename/` so M4 `masterocta-operation-journal:v3` scanning is unchanged

Prepare flow:

1. Validate `RenameImpactPlan` integrity and rename shape (no unresolved refs)
2. Resolve write authority; reject local dirs inside the source root
3. Acquire the same per-root writer lock as additive copy
4. Re-verify the C1 snapshot with `BackupStore::verify_for_rename_plan`
5. Copy backup bytes into Mac staging: destination audio, destination sidecar,
   rewritten Project documents at their original relative paths
6. Build `SlotPathPatch` from inspect + planned updates. The observed `PATH=`
   is resolved from the project directory (parent of the document), using the
   same algorithm as `legacy_read_adapter::resolve_project_reference`. The
   resolved root-relative path must equal `from_relative_path`. A basename-only
   PATH such as `kick.wav` therefore matches only a project-local file, not a
   pool path like `SET/AUDIO/kick.wav`. Destination PATH uses
   `rewrite_same_directory_path`. Source and destination parents must match;
   a cross-directory plan is rejected because the codec cannot rewrite PATH
   into another directory
7. Write create-once authorization (no absolute paths) bound to staged file
   hashes and project rewrite hashes, then the `Prepared` journal.
   Authorization files are read-only; a later writable mode is rejected.
   `rename_journal` validates path, hash, binding, and record-count fields
8. Return `RenamePrepareResult` + semantic diff; source root stays byte-identical
9. Staging is built under `{stem}.partial` and promoted with `renameat`
   `NOREPLACE`. A leftover staging directory without a journal is treated as
   an orphan and replaced. Parent `rename/` is created without `create_dir_all`

C2 never opens the live Octatrack root for write. Staging bytes come only from
the verified backup. A missing C1 snapshot fails closed. Re-running prepare
against an existing rename journal is `PlanConsumed`.

## C1 API

- `SnapshotId::for_rename_plan(&RenameImpactPlan)`
- `BackupStore::create_verified_for_rename(source_root, plan)`
- `BackupStore::verify_for_rename_plan(plan)`
- `recovery_binding_for_rename_plan(plan)`
- `RenameBackupManifest` / `RenameBackupFileManifest` / `RenameBackupFileRole`

Create flow:

1. Validate plan integrity and reconstruct/validate the target set
2. Canonicalize the source root; reject a backup directory inside that root
3. Create a new `.partial` directory (fail if final or partial already exists)
4. Open each source file with descriptor-relative `NOFOLLOW`; copy + SHA-256
5. Fail `SourceChanged` if live size/hash does not match the plan
6. Write canonical `manifest.json` and `context.md` (no absolute paths, no `RootId`)
7. fsync files and the partial directory; rename to the final snapshot name; fsync parent
8. Re-verify the published snapshot against the same plan

Target validation fail-closed cases:

- duplicate backup paths
- `backup_relative_paths` not equal to the reconstructed set
- destination audio or sidecar destination listed as a backup target
- ASCII case-insensitive path pairs (`UnsafePath`)
- any `state_document_impacts` kind other than `StateDocumentKind::Project`

File roles:

| Role | Source |
|---|---|
| `source_audio` | `source_relative_path` |
| `project_working` | Project Working document |
| `project_saved_checkpoint` | Project SavedCheckpoint document |
| `sample_sidecar` | `.ot` sidecar source path, with destination sidecar recorded in the file row |

## Filesystem boundary

- Tests use `tempfile` trees only. No original SD/CF media.
- C3 apply / rollback run only against a copied clone inside that tempfile.
- After a successful or failed C3 apply, tests assert the original tree is unchanged.
- v2 `BackupStore::verify` rejects a rename snapshot (`schema` / deserialize).

## C4 automated clone-rescan proof (M5-C4)

Gate C automated evidence lives in `src-tauri/src/gate_c_clone_rescan.rs`
(`#[cfg(test)]` only). It builds a synthetic original/clone pair under
`tempfile`, registers the clone read-only through `RootRegistry`, stores a
baseline `LibrarySnapshot`, maps catalog facts into `RenameSamplePlanningFacts`,
then runs:

1. `BackupStore::create_verified_for_rename` (C1)
2. `RenameSampleExecutor::prepare` with a test `WriteAuthority` double (C2)
3. `RenameSampleExecutor::apply` or `apply_with_fault` through
   `VerifiedCloneRoot::attest_temporary_copy` only (C3)
4. A **fresh** filesystem rescan with an empty catalog baseline (in-memory
   snapshot discarded) and a new completed catalog revision

Assertions cover destination audio hash, optional sidecar co-rename, Working and
SavedCheckpoint references resolving to the destination with zero
Missing/Invalid/Unresolved references, sentinel byte identity, and original-tree
immutability. Rollback proof uses `RenameApplyFault::DestinationPublished`
injected only after the `Applying` journal checkpoint. Unknown live bytes use
the existing C3 `RecoveryRequired` path without overwriting tampered source
bytes.

Fault injection is exported only through the empty `test-seams` feature on
`ot-executor`, forwarded by the matching `masterocta` feature for `cargo test`
/ CI only (release builds omit it).

Portable CI smoke: `scripts/gate-c-synthetic-smoke.sh` (Linux + macOS matrix job,
SHA-pinned Actions). Generated reports stay under `/tmp` and are not committed.

`ot-catalog` clears stale `sample_settings` rows before each rescan projection
so an unchanged file-sidecar path can store a second completed revision without
violating the file-owner unique index.

## M5-C5 production planning API freshness

The M5-C5 Phase 1 Tauri commands (`v2_rename_plan`, `v2_rename_get_plan`) must not
advance to C1/C2 until planning evidence is fresh. Production code re-verifies live
filesystem bytes and compares the catalog snapshot to a live rescan before storing a
plan. `RootSession.observed_revision` tracks the latest completed catalog scan revision
and must match `base_catalog_scan_revision` at plan time unless the session is stale
(`CATALOG_REVISION_MISMATCH`). Phase 2 commands (`v2_rename_authorize`,
`v2_rename_create_backup`, `v2_rename_prepare`) repeat the same checks at each boundary.
C1/C2 contracts themselves are unchanged; production `RenameSampleExecutor::apply` remains
unwired until R3 wires Continuation Authority.

## M5-C5 R2 — prepared rename continuation

After C2 `Prepared`, `masterocta-prepared-rename-plan:v1` persists the validated
`RenameImpactPlan` plus journal/backup/clone-evidence bindings. Process restart
invalidates in-memory Rename / Clone / Continuation authority; rediscovery reads
journal + snapshot only. Explicit operator Continue (`v2_rename_continue`) re-verifies
backup, journal binding, and live clone manifest before issuing a memory-only
`rename-continuation:v1` lease.

## M5-C5 R3 — continuation apply and committed verification

Production apply requires an issued Continuation Authority. `v2_rename_apply` loads
the durable prepared snapshot plan, validates journal/backup bindings, and executes
`RenameSampleExecutor::apply_continued` through `ContinuationCloneWriteAuthority`.
`HistoricalRenamePlanRoot` carries the prepared identity while
`VerifiedContinuationCloneRoot` carries a separate current
`ApprovedExecutionRoot`; historical identity is never combined with a current path.
Committed mutations return success even when post-apply catalog verification fails.
Read-only `v2_rename_verify_committed` checks audio source/destination, affected
parsed documents and their journal staged hashes, every planned reference
destination, Missing/Invalid/Unresolved counts, and co-renamed sidecar
bytes/catalog state.

## M5-C5 R4 — restart-safe recovery and mutation gate

Production recovery uses existing `RenameSampleExecutor::rollback` semantics
(backup reverify, all-target preflight, unknown live bytes fail-closed). Recovery
does not require a write grant; it uses `RecoveryAuthority` /
`RegistryRenameRecoveryAuthority` instead.

- `v2_rename_recovery_status` discovers `Applying` / `RecoveryRequired`
  operations from durable journal + authorization + backup evidence (no in-memory
  plan store required). Restart discovery still returns the journal-bound opaque
  `planId` when the in-memory plan store expired.
- `v2_rename_recover` requires `approvedOperationId == operationId`, rolls back,
  fresh-rescans, and returns `rename-recovery-result:v1` with separate
  `mutationState` / `verificationState`.
- `v2_rename_verify_rolled_back` re-verifies rollback postconditions without
  re-running rollback when verification alone failed.
- `Prepared` and `Committed` operations are rejected at the production API
  (`Prepared` discard is a future separate semantic).
- Cross-domain `mutation_gate` blocks new rename/additive mutations on the same
  root while rename or additive recovery is required; unrelated roots are unaffected.

## Deferred

- Gate C real-hardware clone-load human smoke and human sign-off (after M5-C5
  Phases 1–3)
- Production recovery UI polish for rename (beyond minimal status/recover commands)
