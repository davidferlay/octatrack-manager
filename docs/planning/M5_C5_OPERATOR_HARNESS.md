# M5-C5 — Gate C Controlled Operator Harness

- Status: **in progress** on branch `cursor/m5c5-gate-c-operator-harness`
- Base: `origin/main` at PR #70 merge (`15eef67` / M5-C4 automated clone-rescan proof)
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
| Frontend API | `src/api/changes.ts` | `src/api/rename.ts` (Phase 3) |
| UI | `AdditiveCopyChangeDrawer` | `RenameSampleChangeDrawer` (Phase 3) |
| Authority | `WriteAuthority` on live root | `CloneWriteAuthority` → `VerifiedCloneRoot` |
| Catalog refresh | post-apply rescan in `apply_change_sync` | same after rename apply |

## Planned API surface

### Rust (`v2_api` + `rename_write_runtime`)

| Command | Phase | Purpose |
|---|---|---|
| `v2_rename_plan` | 1 | Build `RenameImpactPlan` from catalog + live hash; store with TTL |
| `v2_rename_get_plan` | 1 | Fetch stored plan for review |
| `v2_rename_apply` | 2 | Requires write grant + matching `approvedPlanId` + clone attestation |
| `v2_rename_status` | 2 | Operation/journal status |
| `v2_rename_recovery_status` | 2 | Incomplete rename operations |
| `v2_rename_recover` | 2 | Rollback via `RecoveryAuthority` (no reusable write grant) |

DTOs use a dedicated schema (`rename-plan:v1`, `rename-blocked:v1`) rather than
overloading `change-plan:v1`.

### Frontend

- Phase 3: `RenameSampleChangeDrawer` + `src/api/rename.ts`
- Phase 1: backend-only; no frontend IPC client or UI wiring

## Phased delivery (small PRs)

### Phase 1 — Read-only rename planning API

**PR title:** `M5-C5 Phase 1 — Add read-only rename planning API`

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

### Phase 2 — Clone attestation + apply/rescan

- `RegistryCloneWriteAuthority` implementing `CloneWriteAuthority`
- `v2_rename_apply` orchestrating C1 backup → C2 prepare → C3 apply
- Post-apply catalog rescan (reuse `scan_library_sync` + `store_library_snapshot`)
- Tempfile integration tests mirroring Gate C happy path through public API

### Phase 3 — Operator UI

- `RenameSampleChangeDrawer` + `src/api/rename.ts`
- Clone attestation modal/copy in drawer
- Root panel wiring + e2e smoke on synthetic fixture

### Phase 4 — Human Gate C smoke

- Execute `docs/testing/GATE_C_CLONE_SMOKE.md` against Phase 3 build
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
e2e once drawer exists.

## Gate C completion

Gate C sign-off requires **both** this harness (Phases 1–3) **and** human clone-load
smoke (Phase 4). M5-C4 automated proof remains necessary but not sufficient.
