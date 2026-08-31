# M5-C Recoverable Rename Transaction

- Status: C1 verified-backup contract (this PR); C2/C3 not implemented
- Scope of C1: `ot-backup` rename-only snapshot create/verify; no media writes
- Non-scope of this PR: rename/move on media, Project PATH rewrite on media,
  journal, rollback, recovery execution, Tauri, frontend, SQLite migration,
  executor rename mutation, cloud, DMG, signing

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
| **C1** (this PR) | Reconstruct the plan backup set; copy those files to a Mac-side snapshot outside the source root; fsync; atomic publish; re-verify size/hash/binding | Media rename/move, PATH rewrite, journal, rollback, recovery apply, Tauri, frontend |
| **C2** | Re-verify the C1 backup; run `MemoryProjectReferenceCodec` on Mac staging copies; semantic diff; authorization; prepare a journal that is not yet applied to media | Media mutation, publishing rewritten Project files onto the Octatrack root |
| **C3** | Apply the prepared journal to a temporary/cloned root with rollback | Original removable media; cloud; public distribution |

C2 must not write codec output with a raw `std::fs::write` onto media, and must
not route Project rewrite through `ot-tools-io` full serialize or
`update_project_file_paths_surgical`.

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

- C2 Mac staging, codec rewrite, journal preparation
- C3 media apply, rollback, recovery execution
- Gate C clone-load smoke and human sign-off
