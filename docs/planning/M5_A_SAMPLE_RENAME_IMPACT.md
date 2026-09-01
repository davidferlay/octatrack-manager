# M5-A Sample Rename Impact Planning

- Status: read-only domain/planning contract
- Scope: pure Rust types in `ot-domain` and `ot-plan`; no media writes, no Tauri
  commands, no executor wiring, no frontend Apply

## Purpose

M5-A defines the rename half of the Intent → Plan boundary for Octatrack sample
files. A rename is never a single filesystem operation: it may require Project
state reference rewrites, `.ot` sidecar co-rename planning, backup target
enumeration, and fail-closed rejection when catalog observations are incomplete
or stale.

This milestone delivers the contract and tests only. M5-B owns lossless Project/Bank
reference rewrite codecs and apply ordering.

## Domain boundary (`ot-domain`)

### `FileInstanceId`

Opaque catalog identity accepting only `fileinst:v1:<sha256>`. Derived from the
root fingerprint and validated root-relative path using the same digest algorithm
as the v2 catalog API.

### `RenameSampleIntent`

User-facing rename intent containing:

- live `RootId`
- opaque `FileInstanceId` for the source sample
- validated destination `RootRelativePath`

Raw absolute paths never enter this type.

## Planning boundary (`ot-plan`)

AdditiveCopy types and `ChangePlan` remain unchanged. Rename planning lives in
independent types:

- `RenameSamplePlanningFacts` — root, source, destination, optional derived
  sidecar destination, state documents,
  slot assignments, usage edges, sidecars, graph/coverage completeness flags
- `RenameImpactPlan` — read-only canonical impact for an approved rename
- `BlockedRenameImpact` — observed partial impact plus all block reasons when
  planning must fail closed
- `validate_rename_plan_freshness` — pure stale detector for Apply gating

### `plan_rename_sample`

Accepts `RenameSampleIntent` and `RenameSamplePlanningFacts`, then either:

1. returns a deterministic `RenameImpactPlan` with canonical ordering, or
2. returns `BlockedRenameImpact` without minting a `PlanId`

Successful plans enumerate:

- source/destination paths and live size/hash preconditions
- Project document impacts split by Working vs SavedCheckpoint
- Bank usage context (informational edges referencing the renamed sample)
- related `.ot` sidecar rename impacts when ownership is unique and parsed
- unresolved references (always blocked)
- backup candidate paths
- `estimated_media_additional_bytes` (0 for rename)
- local staging byte estimate for backup/application
- explicit `reference_update_count`, including `0` for unused samples

### Rename `PlanId`

Rename plans bind a versioned schema (`masterocta:rename-impact-plan:v1`) to:

- root identity and fingerprint
- base observed revision
- source file instance identity, path, hash, and size
- destination path
- every impacted Project document identity/hash/size and its reference-update set
- related sidecar identity/hash and destination sidecar path
- reference-update count

Identical facts produce identical IDs regardless of input vector order. Any
safety-relevant fact change produces a different ID.

## Fail-closed blockers

Planning refuses to mint a plan when any of the following hold:

| Reason | Trigger |
|---|---|
| `RootMismatch` | Intent root differs from observed root |
| `UnstableRootIdentity` | Root identity is not stable |
| `InvalidRootFingerprint` | Fingerprint is not `rootfp:v1:<sha256>` |
| `ScanNotCompleted` | Latest catalog scan did not complete |
| `InvalidObservedRevision` | Live revision is zero |
| `CatalogRevisionMismatch` | Catalog revision differs from live revision |
| `SourceIdentityMismatch` | File instance ID mismatch |
| `SourcePathMismatch` | Catalog and live source paths differ |
| `SourceSizeMismatch` | Catalog and live source sizes differ |
| `SourceHashMismatch` | Catalog and live source hashes differ |
| `StaleSourceHashFreshness` | Source hash was reused without live rehash |
| `SourceEqualsDestination` | No-op rename |
| `DestinationObservationMismatch` | Intent and observed audio destination differ |
| `DestinationOccupied` | Destination already exists |
| `DestinationCaseCollision` | Case-only collision on case-insensitive media |
| `DestinationNormalizationCollision` | NFC/NFD collision |
| `DestinationUnsafePath` | Traversal/symlink/invalid destination |
| `DestinationIncomparable` | Destination could not be classified safely |
| `SidecarDestinationObservationMismatch` | Observed sidecar destination does not match derived co-rename path |
| `SidecarDestinationOccupied` | Derived sidecar destination already exists |
| `SidecarDestinationCaseCollision` | Derived sidecar destination case-only collision |
| `SidecarDestinationNormalizationCollision` | Derived sidecar destination NFC/NFD collision |
| `SidecarDestinationUnsafePath` | Derived sidecar destination path is unsafe |
| `SidecarDestinationIncomparable` | Derived sidecar destination could not be classified safely |
| `UnsupportedStateDocument` | Any observed Project or Bank document is unsupported; parse-incapable documents cannot prove they do not reference the source |
| `MalformedStateDocument` | Any observed Project or Bank document is malformed, including Working or SavedCheckpoint alone |
| `UnsupportedSidecar` | Related `.ot` sidecar unsupported |
| `MalformedSidecar` | Related `.ot` sidecar malformed |
| `AmbiguousSidecarOwnership` | Same-stem sidecar ownership is ambiguous |
| `IncompleteUsageGraph` | Usage graph incomplete |
| `IncompleteSetProjectCoverage` | Set project coverage incomplete |
| `UnresolvedReference` | Missing/invalid references to the rename source remain |
| `DestinationReferencedByUnresolvedSlot` | A missing or invalid slot/usage edge already references the destination path (exact or ASCII case-insensitive) |
| `DestinationAlreadyReferenced` | A resolved slot already references the destination path |
| `IncompleteReferenceUpdateSet` | Resolved slot references lack update rows |
| `ArithmeticOverflow` | Byte accounting overflow |

Parse-incapable Project/Bank documents never generate slot assignments. Planner
therefore treats every `UnsupportedVersion` or `Malformed` state document in the
supplied facts as a blocker and does not infer “no reference” from
`set_project_coverage_complete`.

Destination slot comparison is exact `RootRelativePath` equality plus ASCII
case-insensitive equality. Unicode NFC/NFD slot-path equivalence is not computed
in `ot-plan`. Collectors must classify live destination NFC/NFD collisions as
`NormalizationCollision` or `Incomparable`, and must emit catalog slot paths in
one normalization form.

## Stale detection

`validate_rename_plan_freshness` classifies drift between a stored plan and fresh
observations:

- root identity / fingerprint change (remount)
- observed revision change
- source path/size/hash change
- destination state change, including external file creation
- Project/Bank document hash/size change
- sidecar hash/size change
- reference-update set change
- usage-graph or set-project coverage regression

Any stale reason makes the plan ineligible for Apply.

## Read-only guarantee

M5-A code performs no filesystem mutations. Integration tests use temporary
synthetic fixtures and assert byte-for-byte media stability before and after
planning.

## Deferred to M5-B / later

- lossless Project reference rewrite codec → **M5-B** (`docs/planning/M5_B_REFERENCE_REWRITE.md`)
- `.ot` sidecar rename apply semantics and ordering with audio + state docs
- executor backup/journal/rollback wiring for rename Apply

## Gate C remaining conditions

Before Gate C sign-off for rename Apply:

- codec evidence for reference rewrite — **done** (M5-B)
- M5 executor/backup/journal/rollback on cloned media — **done** (M5-C1–C3)
- rename → rescan shows zero missing references — **automated** (M5-C4 Gate C
  integration tests + `scripts/gate-c-synthetic-smoke.sh`)
- unchanged non-target file hashes remain stable — **automated** (M5-C4)
- rollback restores byte-identical media — **automated** (M5-C4)
- **remaining:** controlled operator harness — **M5-C5** (`docs/planning/M5_C5_OPERATOR_HARNESS.md`)
- **remaining:** clone load smoke on real hardware (human checklist in
  `docs/testing/GATE_C_CLONE_SMOKE.md`)

Developer ID signing, notarization, and public distribution remain separate
release gates.
