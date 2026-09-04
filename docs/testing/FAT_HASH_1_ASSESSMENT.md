# FAT-HASH-1 assessment

This document defines how to assess coarse mtime plus same-size hash reuse on
FAT-like removable media. It is the canonical record for RC2 start-condition
gatekeeping in [GATE_C_RC_LEDGER.md](GATE_C_RC_LEDGER.md).

Do not record local absolute paths, volume UUIDs, media fingerprints, or
personal sample names here.

Ambiguous results, missing evidence, or an unrun required test are **STOP**.
Do not classify those outcomes as `PASS_WITH_NOTES`.

## Status and verdict contract

status:

- `ASSESSMENT_REQUIRED`: assessment is incomplete
- `ASSESSED`: assessment and verdict recording are complete

verdict:

- `UNSET`: not judged
- `BLOCKED`: a Gate C blocking finding exists
- `ACCEPTED_WITH_EVIDENCE`: required evidence shows no Gate C blocking finding
  in the assessed scope

Allowed combinations:

| status | verdict | Meaning |
|---|---|---|
| `ASSESSMENT_REQUIRED` | `UNSET` | Waiting for assessment. RC2 freeze is forbidden. |
| `ASSESSED` | `BLOCKED` | Assessed. RC2 freeze is forbidden. |
| `ASSESSED` | `ACCEPTED_WITH_EVIDENCE` | FAT-HASH condition only. Other RC2 conditions remain. |

Any other combination, missing evidence, or inconsistency is **STOP**.

Transition:

- Move from `ASSESSMENT_REQUIRED` to `ASSESSED` only when required evidence and
  a verdict are recorded together, including assessed SHA, scope, and evidence
  references.
- If related implementation or assumptions change so that recorded evidence no
  longer applies, keep the past record and reassess.
- FAT-HASH condition satisfaction is not Gate C PASS and is not M5 COMPLETE.

## Current assessment record

| Field | Value |
|---|---|
| status | `ASSESSMENT_REQUIRED` |
| verdict | `UNSET` |
| assessed SHA | `UNSET` |
| assessed scope | Gate C rename Apply, committed verification, post-apply rescan, Missing / Invalid / Unresolved counts, unrelated-byte proof |
| this docs-only update | does **not** complete the assessment |

This read-only investigation records code evidence. It does not run Gate C, does
not access removable media, and does not add tests. Unrun tests are `NOT_RUN`.
Unconfirmed items are `UNKNOWN`. Do not record `ASSESSED` or
`ACCEPTED_WITH_EVIDENCE` from this document alone.

While status is `ASSESSMENT_REQUIRED` / `UNSET`, or `ASSESSED` / `BLOCKED`, RC2
stays `NOT_CREATED`.

## Problem definition

Incremental catalog inventory can reuse a previous content hash when the live
path has a baseline entry with unchanged observed metadata:

```text
same relative path
+
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

This is a general catalog inventory risk. It is not, by itself, proof that Gate
C `COMMITTED` / `VERIFIED` can be established from a stale hash.

“Destination file is absent on disk” and “catalog baseline has no entry for
that path” are not the same fact. A stale baseline entry can exist after a
deleted file if the catalog was not refreshed. Gate C planning also inspects
catalog sibling paths, so those cases must be kept distinct.

## Gate C versus general catalog hardening

Keep these findings separate:

- General catalog stale-hash reuse: remaining hardening. Do not mark the
  problem resolved. Do not make it an unconditional RC2 blocker only because
  reuse is possible or reproducible.
- Gate C blocker: a required Gate C judgment depends on reused catalog hashes,
  or the Gate C impact of reuse is still `UNKNOWN`.

Do not treat independently hashed or independently manifested Gate C checks as
unsafe without evidence that they use the reuse path.

## Impact table

Evidence status uses `CONFIRMED` for code or existing tests inspected here,
`NOT_RUN` for required tests that were not executed, and `UNKNOWN` for
remaining uncertainty.

| Judgment or process | Information used | Hash reuse? | Code / existing-test evidence | Confirmed / unconfirmed | Gate C impact |
|---|---|---|---|---|---|
| Ordinary catalog inventory of an unchanged path | Live size/mtime vs previous `FileInstance` at the same relative path | Yes, when `can_reuse_hash()` is true | `src-tauri/src/legacy_read_adapter.rs` `scan_audio_inventory_with()`, `can_reuse_hash()`; test `unchanged_metadata_reuses_hash_while_size_new_path_and_unknown_mtime_require_hashing` | CONFIRMED that reuse exists. Same-size / same-mtime / different-content is `NOT_RUN`. Coarse-timestamp regression is `NOT_RUN`. | General catalog risk. Not an automatic RC2 blocker. |
| Rename destination occupancy | Live destination file via `destination_exists_live()`; catalog and live sibling paths via `observe_destination_state()` / `classify_destination_state()` | No content-hash reuse in occupancy | `src-tauri/src/v2_api.rs` `destination_exists_live()`; `src-tauri/src/rename_planning_facts.rs` `observe_destination_state()`; `src-tauri/crates/ot-plan/src/rename.rs` `classify_destination_state()` (exact path in sibling list is `Existing` → `DestinationOccupied`) | CONFIRMED that a live destination file blocks planning. CONFIRMED that a catalog sibling path equal to the intended destination also classifies as `Existing`. Dedicated stale-baseline-destination test is `NOT_RUN`. | Gate C requires an unused destination stem. A remaining catalog entry for that path is not treated as “unused”. |
| First post-rename scan of destination audio | Previous catalog `file_instances` keyed by relative path | Reuse only if that destination path already has a baseline entry whose size and mtime match | `scan_audio_inventory_with()` builds `baseline_by_path` from stored catalog; `scan_library_sync()` loads that baseline before rescan. Missing path takes the hasher branch (`ComputedThisScan`). | CONFIRMED path-keyed reuse. CONFIRMED hashing branch when no baseline path exists. Whether a Gate C unused destination can still have a baseline entry after a successful plan is `UNKNOWN` without a dedicated test (`NOT_RUN`). | Destination bytes used by Gate C committed verification are not taken from this catalog hash. See live destination hash below. |
| Committed verification of destination audio | Live destination file bytes | No. Direct hash | `src-tauri/src/v2_api.rs` `evaluate_rename_committed_verification()` → `verify_audio_postconditions()` → `hash_live_source()` | CONFIRMED | Protects destination audio identity for `COMMITTED` / `VERIFIED`. Do not treat as catalog-reuse dependent. |
| Committed verification of rewritten Project documents | Live Project file bytes vs recorded rewrite hash | No. Direct hash | `verify_project_document_hashes()` → `hash_live_source()`; test `rename_committed_verification_rejects_project_tamper_and_invalid_references` | CONFIRMED | Protects Project rewrite identity for `COMMITTED` / `VERIFIED`. |
| Committed verification of sidecar | Live sidecar bytes vs plan sidecar hash | No. Direct hash | `verify_sidecar_postconditions()` → `hash_live_source()` | CONFIRMED | Protects sidecar identity for `COMMITTED` / `VERIFIED`. |
| Catalog destination hash compared after rescan | Post-scan `file_instances` hash vs `plan.source_content_hash` | Uses the post-scan catalog hash, which may be reused if a baseline dest entry existed | `evaluate_rename_committed_verification()` `DESTINATION_HASH_MISMATCH` | CONFIRMED as an extra catalog check after live audio hash. A stale dest catalog hash would fail this check, not skip the live hash. | Not shown to create a false `COMMITTED` / `VERIFIED` pass. Residual if dest baseline reuse exists remains `UNKNOWN`. |
| Missing / Invalid / Unresolved | Live Project/Bank path resolution against current inventory **paths** | No content-hash comparison | `scan_state_inventory()` uses `inventory_paths` from `file_instances` relative paths; `resolve_project_reference()`; `count_sample_reference_status()` / `count_unresolved_planned_references()` | CONFIRMED path-based. Whether a same-path stale file with different bytes can still be `Resolved` is expected (`UNKNOWN` as a byte-identity question, but that identity is covered by live destination hash). | Counts do not consume reused content hashes. Gate C still requires counts = 0 **and** live destination/project/sidecar hashes. |
| Unrelated-byte invariance | Pre/post clone manifest of file path, size, and content hash | Independent of catalog reuse | `src-tauri/src/clone_runtime.rs` `scan_baseline_entries()` hashes files directly; `src-tauri/src/gate_c_clone_rescan.rs` `snapshot_manifest()` / `sentinel_unchanged()`; `GATE_C_CLONE_SMOKE.md` pre-smoke byte-for-byte check | CONFIRMED independent hashing in clone baseline and Gate C synthetic manifest. Human Gate C pre-run manifest procedure is specified, not re-executed here (`NOT_RUN`). | Unrelated-byte proof is not taken from catalog hashes. |
| Rename source planning | Live source bytes | No. Direct hash | `build_rename_planning_facts()` `hash_live_file()`; `ot-plan` `StaleSourceHashFreshness` | CONFIRMED | Source planning does not reuse catalog hash. |
| Catalog vs live projection before plan | State documents, slots, usage edges, sidecars | Does not compare `file_instances` hashes | `verify_catalog_matches_live_scan()` | CONFIRMED | Not a content-hash reuse path. |

## Read-only investigation notes

Paths below are repository-relative.

### Hash reuse decision

`src-tauri/src/legacy_read_adapter.rs`

- `scan_audio_inventory()` delegates to `scan_audio_inventory_with()`.
- Reuse is keyed by `relative_path` in `baseline_by_path`.
- `can_reuse_hash()` returns true when current `modified_at_unix_ns` is
  `Some`, `byte_size` equals the previous instance, and
  `modified_at_unix_ns` equals the previous instance.
- `verify_unchanged_regular_file()` rechecks type, size, and mtime only.
- `modified_at_unix_ns()` uses `std::fs::Metadata::modified()`. No filesystem
  type or timestamp-granularity check was found.

### Destination baseline versus live absence

`src-tauri/src/v2_api.rs` `destination_exists_live()` returns whether the
destination is a live regular file. That is not a catalog lookup.

`observe_destination_state()` then builds sibling paths from catalog
`file_instances` **and** the live parent directory. `classify_destination_state()`
treats an intended path already present in that sibling list as `Existing`.

Therefore a destination that is absent on disk can still be occupied for
planning if a catalog baseline entry for that path remains. Gate C “unused
destination” is not established by a live `NotFound` alone.

A dedicated test that a stale catalog destination entry blocks planning, or
that a successful Gate C plan implies no destination baseline entry, is
`NOT_RUN`.

### Forced live hashing on Gate C committed verification

`src-tauri/src/v2_api.rs` `evaluate_rename_committed_verification()`:

- live-hashes destination audio
- live-hashes rewritten Project documents
- live-hashes destination sidecar
- then checks catalog presence, catalog destination hash, and path-based
  Missing / Invalid / Unresolved counts

`run_rename_committed_rescan()` scans with the previous catalog as baseline,
evaluates those checks, then stores the new snapshot.

### Unrelated bytes

Clone baseline entries and Gate C synthetic manifests hash file bytes
directly. They do not call `can_reuse_hash()`.

## Required evidence before FAT-HASH can become `ASSESSED`

Map each required item to a Gate C condition. Do not demand tests that only
restate general catalog reuse if the Gate C judgment is already independently
hashed.

| Required evidence | Gate C condition | Current state |
|---|---|---|
| Code confirmation that committed dest/project/sidecar checks live-hash | `COMMITTED` / `VERIFIED` audio, Project, sidecar identity | CONFIRMED in this investigation |
| Code confirmation that Missing / Invalid / Unresolved use inventory paths | counts = 0 | CONFIRMED in this investigation |
| Code confirmation that unrelated-byte proof uses an independent manifest | unrelated bytes unchanged | CONFIRMED for clone baseline and Gate C synthetic manifest; human pre-run manifest `NOT_RUN` |
| Code confirmation that reuse is path-keyed | first post-rename destination scan | CONFIRMED |
| Automated test: successful unused-destination plan implies no destination baseline path, so first dest scan hashes | destination content at first post-rename scan | `NOT_RUN` |
| Automated test: same-size / same-mtime / different-content catalog reuse | general catalog hardening; only becomes a Gate C blocker if a Gate C judgment uses that reused hash | `NOT_RUN` |
| Coarse-timestamp regression | general catalog hardening; Gate C blocker only if a required Gate C judgment depends on reused hashes | `NOT_RUN` |
| Recorded residual risk and implementation policy | assessment completeness | incomplete; status remains `ASSESSMENT_REQUIRED` |

New tests are needed only for the `NOT_RUN` rows. Existing tests already cover
ordinary reuse-on-unchanged-metadata, destination occupancy, Project tamper
rejection, and synthetic unrelated-sentinel invariance.

## RC2 blocking conditions

Keep RC2 `NOT_CREATED` when any of the following is true:

- this assessment remains `ASSESSMENT_REQUIRED` / `UNSET`
- status/verdict is `ASSESSED` / `BLOCKED`
- a required Gate C judgment depends on reused catalog hashes
- the Gate C impact of reuse remains `UNKNOWN`
- required evidence in the table above is still missing

Do **not** freeze-block RC2 solely because general catalog reuse can occur or
can be reproduced on coarse-timestamp media, while Gate C dest/project/sidecar
identity and unrelated-byte proof remain independently hashed.

Do **not** treat this docs-only update as `ACCEPTED_WITH_EVIDENCE`.

## Remaining general hardening

These remain open outside the Gate C blocker decision:

- catalog inventory can reuse a hash on same path + same size + same mtime
- no filesystem-type or FAT granularity handling
- no located regression for same-size / same-mtime / different-content
- no located coarse-timestamp regression

Do not describe these as resolved.

## Assessment record template

When assessment is executed, append a dated record here without personal paths
or media identifiers:

- assessor
- assessed commit SHA
- assessed scope
- filesystem type exercised, or `NOT_RUN`
- evidence references for each Gate C condition in the required-evidence table
- `NOT_RUN` / `UNKNOWN` items remaining
- residual general-hardening risk
- status after this record (`ASSESSED` only if evidence and verdict are
  complete)
- verdict (`BLOCKED` or `ACCEPTED_WITH_EVIDENCE`; never `UNSET` when
  `ASSESSED`)
