# M5-C5 — Gate C Controlled Operator Harness

- Status: **Phase 1 COMPLETE**；**Phase 2 COMPLETE**；**Phase 3 COMPLETE**；**Phase 4A COMPLETE**；**Phase 4B–4D 未着手**
- Base: `origin/main` at PR #72 merge (`b661840` / M5-C5 Phase 2 rename APIs)
- Goal: expose rename Apply on a **disposable registered clone** through production
  Tauri + explicit approval UI, without bypassing Intent → Plan → Apply or opening
  writes on original removable media

## Non-scope

- Original SD/CF / sole-copy personal media
- Bypassing `RenameImpactPlan` approval (no direct executor calls from UI)
- Generic `ApprovedExecutionRoot` apply on live mounted volumes (C3 requires
  `VerifiedCloneRoot`)
- Gate C human hardware smoke execution (checklist only until harness lands)
- Developer ID signing / notarization / public distribution

## Operator model

The operator prepares a **filesystem clone** outside MasterOCTa, registers that
clone path read-only, reviews catalog health, enables the session-limited write
grant, plans a sample rename, explicitly approves the displayed plan, and applies
once on the registered clone root.

`VerifiedCloneRoot::attest_temporary_copy` remains the apply gate. Production
harness must mint that capability only after:

1. `RootRegistry` session exists with `write_enabled`
2. Operator attestation that the registered root is a disposable clone (explicit
   UI acknowledgement; not implied by write grant alone)
3. Plan freshness + C1 backup verification immediately before apply

M5-C4 proved the executor/catalog chain in `#[cfg(test)]`. M5-C5 wires the same
contracts through `v2_*` commands and a rename drawer patterned on additive copy.

## Reference implementation (additive copy)

Mirror these boundaries; do not extend legacy rename commands.

| Layer | Additive copy (Gate B pilot) | Rename harness (M5-C5) |
|---|---|---|
| Plan store | `write_runtime.rs` | `rename_write_runtime.rs` (new) |
| Tauri | `v2_change_plan` / `apply` / `recover` | `v2_rename_*` (new) |
| Frontend API | `src/api/changes.ts` | `src/api/rename.ts` |
| UI | `AdditiveCopyChangeDrawer` | `RenameSampleModal` |
| Authority | `WriteAuthority` on live root | `CloneWriteAuthority` → `VerifiedCloneRoot` |
| Catalog refresh | post-apply rescan in `apply_change_sync` | same after rename apply |

## Planned API surface

### Rust (`v2_api` + `rename_write_runtime`)

| Command | Phase | Purpose |
|---|---|---|
| `v2_rename_plan` | 1 | Build `RenameImpactPlan` from catalog + live hash; store with TTL |
| `v2_rename_get_plan` | 1 | Fetch stored plan for review |
| `v2_rename_authorize` | 2 | Issue session-bound rename authority after write grant + freshness checks |
| `v2_rename_create_backup` | 2 | C1 verified rename backup (`create_verified_for_rename`) |
| `v2_rename_prepare` | 2 | C2 Mac-side staging + Prepared journal |
| `v2_rename_get_status` | 2 | Operation/journal status (restart-safe read) |
| `v2_rename_recovery_status` | 2 | Incomplete rename operations; `recoveryEligible` for Applying/RecoveryRequired |
| `v2_rename_recover` | 4C | Explicit recovery approval + rollback + rescan + postcondition verification |
| `v2_rename_verify_rolled_back` | 4C | Read-only rollback postcondition re-verification |
| `v2_clone_create_managed` | 4A | Managed NOFOLLOW clone from registered source |
| `v2_clone_record_source_evidence` | 4A | Immutable source baseline for external clone verify |
| `v2_clone_verify_external` | 4A | External clone manifest + evidence match |
| `v2_clone_verification_status` | 4A | Sanitized verification DTO (no canonical paths) |
| `v2_clone_reverify` | 4A | Live manifest re-check before authority |
| `v2_clone_issue_authority` | 4A | Session-bound clone write authority record |
| `v2_rename_apply` | 4C | Requires Continuation Authority + write grant |
| `v2_rename_verify_committed` | 4C | Read-only post-commit verification |

DTOs use a dedicated schema (`rename-plan:v1`, `rename-blocked:v1`) rather than
overloading `change-plan:v1`.

### Frontend

- Phase 3: `RenameSampleModal` + `src/api/rename.ts`（Inspector 入口）
- Phase 1: backend-only; no frontend IPC client or UI wiring

## Phased delivery (small PRs)

### Phase 1 — Read-only rename planning API (**COMPLETE**)

**PR title:** `M5-C5 Phase 1 — Add read-only rename planning API` (+ P1 fix follow-up)

Phase 1 P1 prerequisites resolved:

| P1 | Resolution |
|---|---|
| Catalog scan revision vs `RootSession.observed_revision` | Separated in `RenameRootObservation`; session revision synced only after successful catalog store via `RootRegistry::record_completed_scan_revision` |
| Live Project/Bank reference graph freshness | `verify_catalog_matches_live_scan` compares catalog snapshot to a live rescan before planning |
| Live source `.ot` sidecar | `collect_sidecar_observations` observes `{stem}.ot` on live filesystem; catalog/live mismatch → `CATALOG_STALE` |
| Unicode-aware filename case collision | NFC + Unicode lowercase sibling comparison in `rename_planning_facts.rs` |

Deliverables:

- `rename_planning_facts.rs`: catalog snapshot + live filesystem →
  `RenameSamplePlanningFacts` (do not copy Gate C test mapper verbatim; reuse
  semantics only)
- `rename_write_runtime.rs`: in-memory plan store with TTL, root binding, plan
  count limit, idempotent deterministic `PlanId` upsert — **no apply state,
  executor, or authority**
- `v2_rename_plan`, `v2_rename_get_plan` + structured DTOs
- Regression tests + docs update

**Phase 1 constraints (must hold):**

| Rule | Rationale |
|---|---|
| Same-directory rename only | M5-B/C2 codec rejects cross-directory PATH rewrite; planner must not emit move-shaped plans |
| No write grant required | Planning is fully read-only; `enable_write` / `VerifiedCloneRoot` are Phase 2 |
| Live filesystem re-verification | Source, Project Working/SavedCheckpoint, sidecar, destination state must not trust catalog alone |
| Deterministic PlanId idempotency | Same facts → same `PlanId`; re-plan returns existing stored plan (TTL refresh), not `DuplicatePlan` |
| Structured blocked outcome | `RenamePlanningOutcome::Blocked` maps to `rename-blocked:v1` with stable codes — never generic 500 |
| No absolute paths in DTO/runtime JSON | Frontend receives opaque IDs and root-relative paths only |

**Phase 1 STOP conditions** — halt and split PR if any of these become necessary:

- Project/Bank codec changes
- Parser version support expansion
- Filesystem mutation on Octatrack media
- backup / prepare / apply wiring
- `CloneWriteAuthority` generation
- Frontend changes
- Original SD/CF verification

**Phase 1 required tests:**

- Used sample: Working + SavedCheckpoint impacts in DTO
- Unused sample: zero reference updates + warning
- Unsupported/malformed state document → blocked
- Source hash drift → `CATALOG_STALE`
- Destination occupied, same path, extension change, cross-directory → rejected
- Case-only and Unicode normalization collision → blocked
- Plan fetch from different root → `PLAN_NOT_FOUND`
- Plan expiration
- Idempotent re-create of same plan
- No absolute paths in DTO or runtime store
- Pre/post plan byte-identical hash manifest on synthetic tempfile clone
- Additive-copy runtime/API regression unchanged

### Phase 2 — Authority / backup / prepare API (**COMPLETE**)

Production vertical slice (no Apply, no frontend):

- `v2_rename_authorize` — write grant + live freshness re-check; does **not** call `enable_write`
- `v2_rename_create_backup` → C1 `create_verified_for_rename` + `verify_for_rename_plan`
- `v2_rename_prepare` → C2 `RenameSampleExecutor::prepare`
- `v2_rename_get_status` / `v2_rename_recovery_status` — restart-safe journal read
- Canonical sequence enforced: `enable_write → plan → authorize → backup → prepare`
- `plan → enable_write → authorize` fails closed (`CATALOG_REVISION_MISMATCH`)
- TempDir integration tests: happy path, write-disabled, stale plan after rescan, source byte identity

Explicitly **not** in Phase 2:

- `RenameSampleExecutor::apply` from production Tauri API
- frontend Rename UI
- clone Apply / human Gate C smoke

### Phase 3 — Explicit approval / prepare UI (**COMPLETE**)

- `RenameSampleModal` + `src/api/rename.ts`
- Inspector rename entry on selected catalog sample
- Edit mode gate, basename-only same-directory rename, impact review
- Explicit `Approve & Prepare` orchestrating `authorize → backup → prepare`
- Prepared status persistence via `v2_rename_get_status` / recovery read
- **No** clone Apply, **no** media mutation, **no** Gate C completion claim

### Phase 4A — Verified disposable clone authority (**COMPLETE**)

- `v2_clone_record_source_evidence` / `v2_clone_create_managed` /
  `v2_clone_verify_external` / `v2_clone_verification_status` /
  `v2_clone_reverify` / `v2_clone_issue_authority`
- App-managed NOFOLLOW copy + baseline manifest + verification records
- External clone requires immutable source evidence (no attestation-only path)
- Rename plan/authorize/backup/prepare gated on verified clone root
- `RegistryCloneWriteAuthority` adapter (Apply wiring deferred to Phase 4B)
- **No** `v2_rename_apply`, **no** frontend clone UX yet

### Phase 4B — Prepared rename continuation (R2 **COMPLETE**)

- `masterocta-prepared-rename-plan:v1` snapshot persisted after Prepare
- `v2_rename_continuation_status` / `v2_rename_continue` — explicit restart
  continuation; memory-only `rename-continuation:v1` authority

### Phase 4C — Production rename Apply API (R3 **COMPLETE**, #80)

- `v2_rename_apply` requires Continuation Authority + post-apply fresh rescan
- historical plan evidence is kept separate from the current verified clone root
- `v2_rename_verify_committed` read-only committed verification covers planned
  references, Missing/Invalid/Unresolved states, affected documents, and sidecars

### Phase 4D — Recovery API (R4)

- `v2_rename_recover` + cross-domain recovery block

### Phase 4D — Operator UX + Gate C readiness

- Clone-first UI, two-stage approval, e2e coverage

### Phase 4 (legacy heading) — Clone Apply + human Gate C smoke

- `v2_rename_apply` + clone attestation UI
- Execute `docs/testing/GATE_C_CLONE_SMOKE.md` against Phase 4 build
- Record evidence outside repository; do not commit personal paths/fingerprints

## Safety invariants (must not regress)

- Fail closed on stale catalog, destination collision, blocking references, recovery
  required, unstable device identity, traversal/symlink escape
- Apply rejects when `approvedPlanId !== planId`
- Journal / authorization JSON must not contain absolute paths (C2 contract)
- Failed apply leaves clone byte-restorable from C1 backup
- Original removable media never registered for write during harness tests

## Verification (each phase)

```bash
node scripts/check-architecture.mjs
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --workspace --all-targets --exclude masterocta -- -D warnings
cd src-tauri && cargo clippy -p masterocta --all-targets --features test-seams -- -D warnings
cd src-tauri && cargo test --workspace --exclude masterocta
cd src-tauri && cargo test -p masterocta --features test-seams
pnpm run typecheck && pnpm run test:frontend && pnpm run build
scripts/gate-c-synthetic-smoke.sh
```

Phase 1 does not require Gate C smoke (apply not wired). Phase 3+ also run targeted
e2e (`e2e/rename-prepare.spec.ts`).

## Gate C completion

Gate C sign-off requires Phases 1–4 **and** human clone-load smoke. M5-C4 automated proof remains necessary but not sufficient.

## M5-C5 Phase 1 planning freshness (production API)

Before backup/prepare (Phase 2+), production rename planning must prove:

```text
live bytes
=
plan reference graph
=
catalog observation
```

Implementation (`rename_planning_facts.rs`, `v2_api.rs`):

- `base_catalog_scan_revision` comes from the latest completed catalog scan
- `live_observed_revision` comes from `RootSession.observed_revision`, synced only after successful catalog store
- A live library rescan is compared to the loaded catalog snapshot (state documents, slot assignments, usage edges, sidecar settings)
- Source audio, Project/Bank documents, and `{stem}.ot` sidecars are re-hashed from the live filesystem with `NOFOLLOW`
- Mismatch → `CATALOG_STALE` or structured `rename-blocked:v1`; never proceed to backup/prepare with stale evidence

Phase 2+ must re-run the same freshness checks at authority, backup, and prepare boundaries.
