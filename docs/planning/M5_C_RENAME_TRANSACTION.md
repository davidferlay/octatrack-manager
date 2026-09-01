# M5-C Recoverable Rename Transaction

- Status: C1 verified-backup contract **complete**; C2 Mac staging (this PR);
  C3 not implemented
- Scope of C2: re-verify the C1 backup; codec rewrite and semantic diff on
  Mac-side staging copies; create-once rename authorization and
  `Prepared` journal. No media writes.
- Non-scope of this PR: rename/move on media, Project PATH rewrite on media,
  journal apply/rollback, recovery execution, Tauri, frontend, SQLite
  migration, cloud, DMG, signing

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
| **C2** (this PR) | Re-verify the C1 backup; run `ProjectReferenceCodec` on Mac staging copies; semantic diff; authorization; prepare a journal that is not yet applied to media | Media mutation, publishing rewritten Project files onto the Octatrack root |
| **C3** | Apply the prepared journal to a temporary/cloned root with rollback | Original removable media; cloud; public distribution |

C2 must not write codec output with a raw `std::fs::write` onto media, and must
not route Project rewrite through `ot-tools-io` full serialize or
`update_project_file_paths_surgical`.

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
   (after stripping leading `../` or `..\\`) must be a suffix of
   `from_relative_path`. A same-basename path in a different directory fails
   closed. Destination PATH uses `rewrite_same_directory_path`
7. Write create-once authorization (no absolute paths) bound to staged file
   hashes and project rewrite hashes, then the `Prepared` journal
8. Return `RenamePrepareResult` + semantic diff; source root stays byte-identical
9. Staging parent `rename/` is created with `NOFOLLOW` metadata checks.
   `create_dir_all` is not used, so a symlink there cannot redirect writes
   onto the source root

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
- Create/verify never write into the Octatrack source root.
- After a successful or failed create, tests assert the source tree is unchanged.
- v2 `BackupStore::verify` rejects a rename snapshot (`schema` / deserialize).

## Deferred

- C3 media apply, rollback, recovery execution
- Gate C clone-load smoke and human sign-off
