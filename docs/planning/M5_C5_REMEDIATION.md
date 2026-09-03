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
| R2 | `m5c5-r2-prepared-continuation` | `main` | Prepared plan snapshot; explicit continuation API |
| R3 | `m5c5-r3-apply-state` | `main` | **Merged #80**; mutation/verification separation; committed verification hardening follows |
| R4 | `m5c5-r4-recovery` | `main` | **Merged #82** — `v2_rename_recover`; cross-domain mutation gate |
| 4D | `m5c5-phase4d-operator-ux` | `main` | **COMPLETE (local branch)** — Clone-first operator UX, typed clone/rename IPC, `v2_rename_get_prepared_plan`, E2E harness |

PR #75 (`m5c5-phase4b-rename-apply`) is **not merged**; partial apply is replaced
by R2–R4. PR #78 landed partial apply/recover early; R2–R4 completion continues on
dedicated branches from `main`.

## R0 — Clone artifact containment (implemented)

- `src-tauri/src/local_artifact.rs` — validated artifact IDs, NOFOLLOW create-once
  I/O, directory containment, idempotent hash match.
- `clone_runtime.rs` — digest-only artifact filenames; special files rejected;
  managed clone path `Application Support/MasterOCTa/managed-clones` (no double
  product directory); sanitized `CloneRuntimeError::public_message()`.
- `v2_api.rs` — API messages omit OS paths; `sourceRootClosed` reflects actual
  `registry.close()` result.

## R1 — Durable evidence / ephemeral authority (**COMPLETE**)

- Split `CloneBaselineEvidence` (disk) from `CloneVerificationLease` and
  `CloneWriteAuthorityLease` (memory only).
- `RootRegistry::register_managed_clone` — domain-separated fingerprint for
  same-volume managed clones; ordinary `register` + `AmbiguousIdentity` unchanged.

## R2 — Prepared plan snapshot / continuation (**COMPLETE**)

- `prepared_rename_runtime.rs` — `masterocta-prepared-rename-plan:v1` artifact.
- Explicit Continue API (`v2_rename_continuation_status`, `v2_rename_continue`);
  memory-only `rename-continuation:v1` authority.

## R3 — Mutation / verification separation (**COMPLETE**, #80)

- `HistoricalRenamePlanRoot` + `VerifiedContinuationCloneRoot` — historical plan
  evidence and current root identity/path remain separate.
- `v2_rename_apply` — Continuation Authority only (`operationId` + `continuationAuthorityId`).
- Apply DTO: `mutationState` + `verificationState` (verification failure ≠ mutation failure).
- `v2_rename_verify_committed` — read-only re-verification after Committed; verifies
  destination/source audio postconditions, affected parsed documents against journal
  staged hashes, every planned reference, Missing/Invalid/Unresolved counts, and
  co-renamed sidecar bytes/catalog state.
- Apply/verification result schemas are v2 and expose Missing/Invalid/Unresolved counts.

## R4 — Recovery / mutation gate (**COMPLETE**)

- `rename_recovery_runtime.rs` — `VerifiedRecoveryCloneRoot` separates historical
  transaction evidence from the current verified clone root.
- `v2_rename_recover` — explicit approval, `RecoveryAuthority` rollback via existing
  `RenameSampleExecutor::rollback`, fresh rescan, rollback postcondition verification
  (`rename-recovery-result:v1` with separate `mutationState` / `verificationState`).
- `v2_rename_verify_rolled_back` — read-only re-verification after `RolledBack`; does
  not re-run rollback when rescan alone failed.
- `v2_rename_recovery_status` — `recoveryEligible` on `rename-status:v1` operations;
  `recoveryRequired` only for `Applying` / `RecoveryRequired` (not `Prepared`).
- `mutation_gate.rs` wired to `v2_root_enable_write`, rename authorize/backup/prepare/
  continue/apply, and additive `v2_change_apply`. Read-only plan APIs remain allowed.
- Production recovery rejects `Prepared`, `Committed`, double recovery, tampered backup/
  journal/authorization, and unknown live bytes (fail-closed).
- Restart discovery returns durable journal `planId` even when the in-memory plan
  store expired.
- Production-route tests cover RootId rotation recover, RecoveryRequired recover,
  Committed+VerificationFailed recover block, mutation gate matrix, and rolled-back
  gate clear.

## Gate C

Synthetic Gate C runs in CI per PR. Human Gate C runs only after all phases merge
with green CI, using human-verified disposable clone media (not executed by agents).
