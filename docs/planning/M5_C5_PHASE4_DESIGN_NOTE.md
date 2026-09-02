# M5-C5 Phase 4 — Pre-implementation Design Note

- Status: Phase 4A **GO (conditional)**
- Base: `origin/main` at `52d36c32ba65d1bf0fed288d610a10e16b054403` (PR #73 merge)
- Date: 2026-09-02

## 1. VerifiedCloneRoot / CloneWriteAuthority generation path

| Layer | State |
|-------|-------|
| `RenameSampleExecutor::apply` | Requires `CloneWriteAuthority` → `VerifiedCloneRoot` (`rename_apply.rs`) |
| `VerifiedCloneRoot::attest_temporary_copy` | Public no-op attestation; no filesystem proof |
| Production mint | **Missing** — only Gate C `FixtureAuthority` in `#[cfg(test)]` |
| Prepare path | Uses generic `WriteAuthority` / `RegistryWriteAuthority` only |

**Phase 4A action:** Add proof-backed `RegistryCloneWriteAuthority` that mints
`VerifiedCloneRoot` only after clone verification + session revalidation. Do not
register `v2_rename_apply` until Phase 4B. Restrict `attest_temporary_copy` to
`pub(crate)`.

## 2. RootRegistry identity evidence

Available today (`root_registry.rs`):

- `RootId` (opaque, session-scoped)
- `device_fingerprint` (`rootfp:v1:…` from stable_key + fs type + capacity)
- `stable_device_identity` (Volume UUID on macOS)
- `observed_revision` (bound after catalog scan)
- `canonical_path` (backend only)
- Remount detection via full `DeviceObservation` equality (`mount_token`)
- `AmbiguousIdentity` for same fingerprint + different canonical path

**Not available:** clone provenance, source/clone binding, baseline manifest,
operator attestation persistence.

## 3. Minimum disposable clone proof (production)

Checkbox-only attestation is **insufficient**. Minimum proof:

1. **App-managed (preferred):** read-only source scan → NOFOLLOW copy to Mac
   Application Support → source re-scan unchanged → clone manifest matches source
   → distinct device fingerprint + canonical surface → register clone only.
2. **External:** immutable `CloneSourceEvidence` captured while source was
   registered → external clone registered → manifest match + identity distinction
   + operator acknowledgement + live re-scan at verify time.

Cryptographic proof that media is not original removable SD/CF is **out of scope**
(operation + baseline + identity binding only).

## 4. Prepared journal / restart Plan evidence

| Artifact | Survives restart | Sufficient for full plan |
|----------|------------------|--------------------------|
| In-memory plan store | No | Yes (when present) |
| C2 journal + authorization | Yes | No (missing impacts) |
| C1 backup manifest | Yes | Partial |
| Live replan | N/A | **No** — `base_observed_revision` + `root_id` in PlanId |

**Blocked:** restart → replan → same PlanId (revision drift + new RootId).

**Required (Phase 4B):**

- Create-once `masterocta-prepared-rename-plan:v1` at prepare time
- Explicit continuation authority binding old PlanId/root to new session RootId
- No unconditional plan revival; continuation requires live revalidation

## 5. Replan same PlanId feasibility

**BLOCKED** for restart apply eligibility. PlanId hashes `root_id` and
`base_observed_revision` (`ot-plan/rename.rs`). Process restart issues new
RootId and rescan bumps revision.

## 6. M4 recovery authority reuse boundary

| Reuse | Rename-specific |
|-------|-----------------|
| `RecoveryAuthority` trait | `RenameSampleExecutor::rollback` |
| `RegistryRecoveryAuthority` pattern | C2 journal/authorization paths |
| `approvedOperationId` approval | Prepared discard vs Applying recovery |
| Cross-domain recovery block | Rename `Applying`/`RecoveryRequired` vs additive write |

Executor rollback is **GO**; production `v2_rename_recover` and cross-domain
mutation gates landed in **R4 (#82)**.

## Operator flow (clone-first)

```text
Register source → record source evidence (optional, for external)
→ create managed clone OR register external + verify
→ enable_write on clone root only
→ plan → authorize → backup → prepare
→ [4B] continuation if restarted → apply on clone
→ [4C] recovery if incomplete
```

Prepare on source root with apply on another root is **rejected** by existing
plan/journal/authority binding.

## Phase 4A GO conditions

Proceed when all hold:

- [x] Managed clone can produce baseline manifest + verification record
- [x] Source == clone / symlink / nested / same surface rejectable
- [x] `AmbiguousIdentity` not weakened
- [x] No raw path to frontend for clone operations
- [x] `CloneWriteAuthority` type boundary preserved
- [x] Apply not wired in P4-A PR

## STOP triggers (halt and report)

- Need generic `WriteAuthority` for apply
- Need raw frontend path for apply
- Cannot distinguish source from clone safely
- Must mutate C1/C2 schemas to proceed
- Gate C synthetic smoke regression
