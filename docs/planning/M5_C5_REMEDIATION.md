# M5-C5 Remediation

Canonical plan for Phase 4 remediation before Human Gate C. Supersedes stacked
partial-apply work in PR #75 (closed without merge).

## Write principles (all phases)

- **Evidence is durable** — baseline/source evidence and prepared plan snapshots
  persist in the local artifact store with create-once semantics.
- **Authority is ephemeral** — verification leases and write authority exist only
  in memory with short TTL; restart never resurrects stale authority.
- **Journal is mutation state truth** — after Prepared, journal status is the
  only mutation state source of truth.
- **Verification failure ≠ mutation failure** — Committed mutations return
  success with separate verification outcome.

## PR sequence

| Phase | Branch (example) | Base | Scope |
|-------|------------------|------|-------|
| R0 | `m5c5-r0-clone-containment` | `m5c5-phase4a-clone-authority` | Typed artifact IDs, NOFOLLOW I/O, error sanitization, special-file fail-closed, storage layout, `sourceRootClosed` accuracy |
| merge #74 | — | `main` | Phase 4A + R0 |
| R1 | `m5c5-r1-clone-evidence` | `main` | Durable baseline evidence; memory leases; `register_managed_clone` |
| R2 | `m5c5-r2-continuation` | `main` | Prepared plan snapshot; explicit continuation API |
| R3 | `m5c5-r3-apply-state` | `main` | Mutation/verification separation; `v2_rename_verify_committed` |
| R4 | `m5c5-r4-recovery` | `main` | `v2_rename_recover`; cross-domain mutation gate |
| 4D | `m5c5-phase4d-ux` | `main` | Clone-first operator UX + E2E |

PR #75 (`m5c5-phase4b-rename-apply`) is **not merged**; partial apply is replaced
by R2–R4.

## R0 — Clone artifact containment (implemented)

- `src-tauri/src/local_artifact.rs` — validated artifact IDs, NOFOLLOW create-once
  I/O, directory containment, idempotent hash match.
- `clone_runtime.rs` — digest-only artifact filenames; special files rejected;
  managed clone path `Application Support/MasterOCTa/managed-clones` (no double
  product directory); sanitized `CloneRuntimeError::public_message()`.
- `v2_api.rs` — API messages omit OS paths; `sourceRootClosed` reflects actual
  `registry.close()` result.

## R1 — Durable evidence / ephemeral authority (next)

- Split `CloneBaselineEvidence` (disk) from `CloneVerificationLease` and
  `CloneWriteAuthorityLease` (memory only).
- `RootRegistry::register_managed_clone` — domain-separated fingerprint for
  same-volume managed clones; ordinary `register` + `AmbiguousIdentity` unchanged.

## R2 — Prepared plan snapshot / continuation

- `prepared_rename_runtime.rs` — `masterocta-prepared-rename-plan:v1` artifact.
- Explicit Continue API; continued-apply boundary in `rename_apply.rs`.

## R3 — Mutation / verification separation

- Apply DTO: `mutationState` + `verificationState`.
- `v2_rename_verify_committed` — read-only re-verification after Committed.

## R4 — Recovery / mutation gate

- `mutation_gate.rs` — cross-domain Applying/RecoveryRequired block.
- `v2_rename_recover` — production rollback path.

## Gate C

Synthetic Gate C runs in CI per PR. Human Gate C runs only after all phases merge
with green CI, using human-verified disposable clone media (not executed by agents).
