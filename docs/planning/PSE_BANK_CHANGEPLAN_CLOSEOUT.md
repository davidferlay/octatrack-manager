# Bank ChangePlan closeout (#181 read-only)

Work ID: `MO-PSE-BANK-CHANGEPLAN-CLOSEOUT-1`
Parent: [#181](https://github.com/kaz4g/masterocta/issues/181)
Audit base: `main` @ [`0c47dbe9c95d403e70d8eafe5071e96dc68117c2`](https://github.com/kaz4g/masterocta/commit/0c47dbe9c95d403e70d8eafe5071e96dc68117c2) (merge PR [#232](https://github.com/kaz4g/masterocta/pull/232); includes PR [#231](https://github.com/kaz4g/masterocta/pull/231))

This work unit records a **re-audit** of current `main` after the read-only ChangePlan landed. It does not authorize Apply, alter the gate ledger by itself, or close GitHub issues.

## Judgment (current main)

```text
BANK_CHANGEPLAN_READ_ONLY_PLANNER = COMPLETE
CHANGEPLAN_IMPLEMENTATION_READINESS = PARTIAL
ISSUE_181_CLOSE_READY = NO
CHANGEPLAN_EXECUTION_READINESS = NOT_READY
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO
APPLY_READINESS = NOT_READY
```

### Terminology

| Symbol | Meaning |
| --- | --- |
| `BANK_CHANGEPLAN_READ_ONLY_PLANNER = COMPLETE` | `plan_bank_change()` for Copy / Move / Swap exists on `main`, is fail-closed, and does not write media |
| `CHANGEPLAN_IMPLEMENTATION_READINESS = PARTIAL` | Planner scaffold and inventory gates are in place; **full** pre-write impact (final affected files, semantics) is not complete |
| `ISSUE_181_CLOSE_READY = NO` | Keep **#181 OPEN** until Move/Swap/Copy pre-write impact is fully specified (Working/SavedCheckpoint, vacated Move source, active-bank retarget) or #181 Done is explicitly rescoped in the issue |
| `CHANGEPLAN_EXECUTION_READINESS = NOT_READY` | Executable plans (semantics resolved, Apply permitted) are not ready |
| `BANK_CHANGEPLAN_READINESS = NOT_READY` | Legacy **execution** sense unless a doc says otherwise |

#181 GitHub Done line today: *all three operations produce a ChangePlan whose pre-write impact is reviewable*. Blocked semantics mean `candidate_change_documents` are **role candidates**, not a guaranteed complete affected-file set. Closing #181 would drop the tracker for those semantics even though Apply stays blocked.

Apply readiness, `BankMutationEnvelope` sealing, and `APPLY_AUTHORIZED` are unchanged.

Implementation evidence:

- [`PSE_BANK_CHANGEPLAN_CORE.md`](./PSE_BANK_CHANGEPLAN_CORE.md) (PR #231)
- [`PSE_BANK_CHANGEPLAN_REFERENCE_COVERAGE.md`](./PSE_BANK_CHANGEPLAN_REFERENCE_COVERAGE.md) (PR #232)
- Code: [`ot_plan::bank_changeplan`](../../src-tauri/crates/ot-plan/src/bank_changeplan.rs)

## #181 Done checklist (re-audit)

| Requirement | Status | Evidence / caveat |
| --- | --- | --- |
| Copy / Move / Swap Intent | PASS | `BankChangeIntent`; `source == destination` → `Err` |
| affected Banks / Patterns / Parts / Tracks / Sample Slot refs | PASS | `enumerate_affected_references`, scoped `reference_observations`; Working vs SavedCheckpoint separate |
| affected files | **PARTIAL** | `read_dependencies` + `candidate_change_documents` list **candidates** from state-document rules; final set unknown until #217 / owner decisions (Move vacated source, retarget, Working/SavedCheckpoint) |
| PRE hashes / preconditions | **PASS** (observed deps) | After `MO-PSE-BANK-CHANGEPLAN-MANIFEST-COMPLETENESS-1`: `validate_observed_dependency_manifest` rejects missing/non-regular/mismatch before preconditions; `FULL_FILESYSTEM_ENUMERATION_PROVEN = NO` |
| backup requirement | PASS | `BackupRequirementDeclaration` only (no `BackupEvidence`) |
| verification requirement | PASS | six `VerificationRequirementKind` declarations (no fabricated POST hashes) |
| deterministic PlanId | PASS | `derive_bank_changeplan_id`, `validate_integrity`; Copy / Move / Swap each run planner twice in unit tests and compare `PlanId` |
| stale detection | **PASS_WITH_VALIDATED_PRE_MANIFEST** | `check_bank_changeplan_staleness` unchanged; plans only start from validated observed-dependency PRE (`scope_manifest` completeness for read-model paths) |
| planner byte preservation | PASS (scoped) | Subset digest on committed fixtures (`.work`, `.strd`, selected sidecars) — **not** a syscall-level no-write proof ([`PSE_CI_FOUNDATION.md`](../testing/PSE_CI_FOUNDATION.md) §5) |

Plans remain **blocked for execution** (`execution_readiness = Blocked`, semantic / readiness blockers in `Ok(plan)`).

## #191 ChangePlan gates (ledger)

Ledger: [`scripts/pse-bank-mutation-gates.json`](../../scripts/pse-bank-mutation-gates.json). Required tests: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json).

Six ChangePlan gates are **ACTIVE** on `main` (inventory + guard). That means required tests run in Project Structure CI; it does **not** override the **PARTIAL** rows above or `ISSUE_181_CLOSE_READY = NO`.

Mutation and recovery gates (12) stay **BLOCKED** until a **Bank fixture Apply runner** exists. GitHub [#183](https://github.com/kaz4g/masterocta/issues/183) is **CLOSED** with no production runner (`ISSUE_183_STATE_MISMATCH = YES` in [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md)). Do not assign new mutation work only to closed #183 — reopen it or open a successor issue before implementation.

## ReadinessEvidence (`current_main()`)

Pinned by `current_main_readiness_keeps_remaining_changeplan_gaps_open` in [`bank_mutation.rs`](../../src-tauri/crates/ot-plan/src/bank_mutation.rs).

**RESOLVED:** `ArrangementFileSlot` (#204), `BankChangePlan` (read-only planner).

**OPEN (5):** `ArrangerPatternReferences`, `BankInternalIdentity`, `SceneAndRecorderDependencies`, `WorkingSavedCheckpointRule`, `ApplyAuthorization`.

## Next work

```text
NEXT_WORK_ID = MO-PSE-BANK-STATE-DOC-SEMANTICS-2
Parent = #217
```

Classify Copy Working/SavedCheckpoint, Move/Swap document roles, active-bank retarget, and Move vacated source into device-evidence vs owner-decision buckets (#217 remains the semantic parent; #181 stays open until impact is known).

## Historical docs

Older snapshots: [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md), [`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md). **Current closeout judgment is this file.**
