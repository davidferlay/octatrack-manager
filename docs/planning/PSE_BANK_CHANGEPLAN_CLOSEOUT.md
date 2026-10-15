# Bank ChangePlan closeout (#181 read-only)

Work ID: `MO-PSE-BANK-CHANGEPLAN-CLOSEOUT-1`
Parent: [#181](https://github.com/kaz4g/masterocta/issues/181)
Audit base: `main` @ [`0c47dbe9c95d403e70d8eafe5071e96dc68117c2`](https://github.com/kaz4g/masterocta/commit/0c47dbe9c95d403e70d8eafe5071e96dc68117c2) (merge PR [#232](https://github.com/kaz4g/masterocta/pull/232); includes PR [#231](https://github.com/kaz4g/masterocta/pull/231))

This work unit is **docs-only**. It re-audits current `main` and records the formal #181 completion for the **read-only** ChangePlan. It does not close GitHub issues, change Rust, alter the gate ledger, or authorize Apply.

## Judgment (current main)

```text
BANK_CHANGEPLAN_IMPLEMENTATION = COMPLETE
CHANGEPLAN_IMPLEMENTATION_READINESS = COMPLETE
ISSUE_181_CLOSE_READY = YES
CHANGEPLAN_EXECUTION_READINESS = NOT_READY
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO
APPLY_READINESS = NOT_READY
```

### Terminology

| Symbol | Meaning |
| --- | --- |
| `CHANGEPLAN_IMPLEMENTATION_READINESS = COMPLETE` | #181 Done: Copy / Move / Swap produce a reviewable read-only `BankChangePlan` before any write |
| `CHANGEPLAN_EXECUTION_READINESS = NOT_READY` | Executable plans (semantics resolved, Apply permitted) are not ready |
| `BANK_CHANGEPLAN_READINESS = NOT_READY` | Legacy **execution** sense unless a doc says otherwise |
| `ISSUE_181_CLOSE_READY = YES` | Issue #181 may be closed as read-only ChangePlan complete; closing is an operator action outside this PR |

#181 completion does **not** mean Apply readiness, `BankMutationEnvelope` sealing, or lifting `APPLY_AUTHORIZED`.

Implementation evidence:

- [`PSE_BANK_CHANGEPLAN_CORE.md`](./PSE_BANK_CHANGEPLAN_CORE.md) (`MO-PSE-BANK-CHANGEPLAN-CORE-1`, PR #231)
- [`PSE_BANK_CHANGEPLAN_REFERENCE_COVERAGE.md`](./PSE_BANK_CHANGEPLAN_REFERENCE_COVERAGE.md) (`MO-PSE-BANK-CHANGEPLAN-REFERENCE-COVERAGE-1`, PR #232)
- Code: [`ot_plan::bank_changeplan`](../../src-tauri/crates/ot-plan/src/bank_changeplan.rs), inventory tests in [`pse_bank_changeplan.rs`](../../src-tauri/src/pse_bank_changeplan.rs)

## #181 Done checklist (re-audit)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Copy / Move / Swap Intent | PASS | `BankChangeIntent`; `source == destination` → `Err` |
| affected Banks / Patterns / Parts / Tracks / Sample Slot refs | PASS | `enumerate_affected_references`, scoped `reference_observations`, Working vs SavedCheckpoint separate |
| affected files | PASS | `read_dependencies`, `candidate_change_documents` (Copy: source read-only, destination candidates) |
| PRE hashes / preconditions | PASS | project-scope `TreeManifest` → `FilePrecondition` (size + hash or absent); non-regular → blocker |
| backup requirement | PASS | `BackupRequirementDeclaration { required: true, relative_paths }` only (no `BackupEvidence`) |
| verification requirement | PASS | six `VerificationRequirementKind` declarations (no fabricated POST hashes) |
| deterministic PlanId | PASS | `derive_bank_changeplan_id`, `validate_integrity` |
| stale detection | PASS | `check_bank_changeplan_staleness` (manifest diff → `Stale`, no silent rebase) |
| no-write proof | PASS | `execution_authorized() == false`; `bank_changeplan_generation_leaves_committed_fixture_bytes_identical` |

Plans remain **blocked for execution** (`execution_readiness = Blocked`, semantic / readiness blockers in `Ok(plan)`).

## #191 ChangePlan gates (6 / 6 ACTIVE)

Ledger: [`scripts/pse-bank-mutation-gates.json`](../../scripts/pse-bank-mutation-gates.json). Required tests: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json).

| Gate id | Status |
| --- | --- |
| `change-plan.bank-copy-deterministic` | ACTIVE |
| `change-plan.bank-move-deterministic` | ACTIVE |
| `change-plan.bank-swap-deterministic` | ACTIVE |
| `change-plan.affected-reference-enumeration` | ACTIVE |
| `change-plan.stale-precondition-detection` | ACTIVE |
| `change-plan.plan-generation-no-write` | ACTIVE |

PR #232 CI: Project Structure (Linux / macOS), Bank Mutation Safety Guard, Rust Tests — **PASS** (run `38529382333` / `38529382351`).

Mutation and recovery gates (12) remain **BLOCKED** until #183 runner exists.

## ReadinessEvidence (`current_main()`)

Pinned by test `current_main_readiness_keeps_remaining_changeplan_gaps_open` in [`bank_mutation.rs`](../../src-tauri/crates/ot-plan/src/bank_mutation.rs).

**RESOLVED**

| Gap | Tracking |
| --- | --- |
| `ArrangementFileSlot` | #204 |
| `BankChangePlan` | #181 read-only planner (PR #231 / #232) |

**OPEN** (5)

| Gap | Tracking |
| --- | --- |
| `ArrangerPatternReferences` | PSE read-model exit audit §7C / §8 |
| `BankInternalIdentity` | #221 |
| `SceneAndRecorderDependencies` | PSE read-model exit audit §7C |
| `WorkingSavedCheckpointRule` | #217 / BMS §16 |
| `ApplyAuthorization` | control plane §9 (PSE-3) |

## What #181 did not deliver (by design)

- `BankMutationEnvelope` or Prepare / Apply / Verify on fixtures (#183)
- Resolution of execution semantics (Working / SavedCheckpoint, vacated Move source, active bank retarget)
- `APPLY_AUTHORIZED = YES` or write APIs / Tauri mutation IPC

## Next work (not started here)

```text
NEXT_WORK_ID = MO-PSE-BANK-STATE-DOC-SEMANTICS-2
Parent = #217
```

Scope for the next phase (classification only in that work unit):

| Topic | Split goal |
| --- | --- |
| Copy Working / SavedCheckpoint rule | device evidence vs owner decision |
| Move / Swap document role semantics | device evidence vs owner decision |
| Active Bank retarget | device evidence vs owner decision |
| Move vacated source | device evidence vs owner decision |

No gap closure, Apply, encoder, or filesystem write in `MO-PSE-BANK-CHANGEPLAN-CLOSEOUT-1`.

## Historical docs

[`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md) and [`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md) retain pre–#231 / #232 snapshots. **Current judgment for #181 and readiness gaps is this closeout document.**
