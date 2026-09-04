# FAT-HASH-1 assessment

This document defines how to assess coarse mtime plus same-size hash reuse on
FAT-like removable media. It is the canonical record for RC2 start-condition
gatekeeping in [GATE_C_RC_LEDGER.md](GATE_C_RC_LEDGER.md).

Do not record local absolute paths, volume UUIDs, media fingerprints, or
personal sample names here.

Ambiguous results, missing evidence, or an unrun required test are **STOP**.
Do not classify those outcomes as `PASS_WITH_NOTES`.

## Assessment status

| Field | Value |
|---|---|
| status | `ASSESSMENT_REQUIRED` |
| verdict | `UNSET` |

Allowed verdict values after assessment with evidence:

- `ACCEPTED_WITH_EVIDENCE`
- `BLOCKED`

This docs-only review does not execute Gate C, does not access removable media,
and does not add tests. It therefore cannot prove safety. Do not record
`ACCEPTED_WITH_EVIDENCE` from this document alone.

While status is `ASSESSMENT_REQUIRED` or `BLOCKED`, RC2 stays `NOT_CREATED`.

## Problem definition

Incremental catalog inventory can reuse a previous content hash when observed
metadata is unchanged:

```text
same byte size
+
same mtime
=
previous content hash reuse
```

On FAT32 and similar coarse-timestamp filesystems, a same-size rewrite can
leave the observed mtime inside the same resolution bucket (commonly 2 seconds
on FAT). The catalog may then emit `ReusedUnchangedMetadata` for different
bytes.

## Gate C impact

The following Gate C judgments are in scope for this assessment:

- catalog rescan after rename Apply
- confirmation of renamed source and destination bytes
- Missing / Invalid / Unresolved reference counts
- `COMMITTED` / `VERIFIED` outcome
- proof that unrelated bytes are unchanged

Source-only live rehash is necessary but not sufficient. If post-apply rescan
or unrelated-byte proof can rest on reused catalog hashes, Gate C can report
clean counts while bytes changed.

## Read-only investigation

Paths below are repository-relative.

### Hash reuse decision

`src-tauri/src/legacy_read_adapter.rs`

- `scan_audio_inventory()` reuses `previous.content_hash` when
  `can_reuse_hash()` is true, and records
  `ContentHashFreshness::ReusedUnchangedMetadata`.
- `can_reuse_hash()` returns true when current `modified_at_unix_ns` is
  `Some`, `byte_size` equals the previous instance, and
  `modified_at_unix_ns` equals the previous instance.
- `verify_unchanged_regular_file()` only rechecks symlink/regular-file type
  and that size/mtime still match the observation used for reuse. It does not
  rehash bytes.

### Size and mtime observation

`src-tauri/src/legacy_read_adapter.rs`

- `collect_audio_candidates()` takes `byte_size` from `symlink_metadata().len()`
  and `modified_at_unix_ns` from `std::fs::Metadata::modified()`.
- `modified_at_unix_ns()` stores nanoseconds since UNIX epoch when the OS
  reports them. There is no FAT-aware rounding or filesystem-type check.

No investigated path consults filesystem type or timestamp granularity before
reuse.

### Forced rehash on Gate C-related paths

`src-tauri/src/rename_planning_facts.rs`

- `build_rename_planning_facts()` hashes the live source with `hash_live_file()`
  and rejects catalog/live size or hash mismatch as `CatalogStale`.
- The facts object then sets `hash_freshness` to `ComputedThisScan` for the
  source observation used by planning.

`src-tauri/crates/ot-plan/src/rename.rs`

- Planning fails closed with `StaleSourceHashFreshness` unless
  `facts.source.hash_freshness == ComputedThisScan`.

`src-tauri/src/rename_planning_facts.rs` `verify_catalog_matches_live_scan()`

- Compares state documents, slot assignments, usage edges, and sidecars.
- Does **not** compare `file_instances` content hashes.

Post-apply catalog rescan uses `RegisteredLegacyLibrary` /
`scan_audio_inventory()`, which is the same reuse path as ordinary indexing.

Conclusion from this read-only pass: rename **source** planning rehashes live
bytes. Unrelated files, destination inventory after apply, and catalog hash
projections used in rescan are not shown here to be force-rehashed. Whether
`COMMITTED` / `VERIFIED` can be satisfied from stale reused hashes is
**unproven**.

### Existing tests

`src-tauri/src/legacy_read_adapter.rs` test
`unchanged_metadata_reuses_hash_while_size_new_path_and_unknown_mtime_require_hashing`

- Rehashes when recorded mtime differs by 1 ns, when size/path change, or when
  mtime is unknown.
- Does **not** cover same size, same mtime, different bytes.
- Does **not** simulate FAT 2-second granularity.

No located test asserts that stale reuse cannot produce Gate C
`COMMITTED` / `VERIFIED` or Missing / Invalid / Unresolved = 0.

## Required evidence before RC2

RC2 freeze is forbidden until all of the following exist:

- an automated test for same-size / same-mtime / different-content
- a regression test that assumes coarse timestamps
- proof that Gate C subject files are rehashed at the required checkpoints
- proof that a stale reused hash cannot establish `COMMITTED` / `VERIFIED`
- a recorded implementation policy and residual risk

## RC2 blocking conditions

Keep RC2 `NOT_CREATED` when any of the following is true:

- this assessment remains `ASSESSMENT_REQUIRED`
- verdict is `BLOCKED`
- coarse-timestamp media can reproduce stale hash reuse
- Gate C safety judgments depend on reused hashes
- rename targets or verification targets are not guaranteed a forced rehash
- the required regression tests above do not exist
- impact scope remains undetermined

## Assessment record template

When assessment is executed, append a dated record here without personal paths
or media identifiers:

- assessor
- assessed commit SHA
- filesystem type exercised
- same-size / same-mtime / different-content test result
- coarse-timestamp regression result
- Gate C forced-rehash evidence
- stale-hash versus `COMMITTED` / `VERIFIED` evidence
- residual risk
- final status (`ASSESSMENT_REQUIRED` remains until complete)
- final verdict (`ACCEPTED_WITH_EVIDENCE` or `BLOCKED`)
