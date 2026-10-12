# Bank ChangePlan core (read-only)

Work ID: `MO-PSE-BANK-CHANGEPLAN-CORE-1`  
Parent: [#181](https://github.com/kaz4g/masterocta/issues/181)  
Base branch: `main` @ `e299e4ef409c5ed0c9a1eae67786d73883331d82`

This unit adds the first **read-only** Bank Copy / Move / Swap ChangePlan planner.
It does **not** generate destination bytes, seal [`BankMutationEnvelope`](../../src-tauri/crates/ot-plan/src/bank_mutation.rs), authorize Apply, or write media.

```text
WRITE_TO_OCTATRACK_MEDIA = NO
BANK_MUTATION_ENVELOPE = NO
APPLY = NO
EXECUTION_AUTHORIZED = NO
```

## Schema

`BANK_CHANGEPLAN_SCHEMA = masterocta.bank-changeplan:v1`

This is **not** `masterocta.bank-mutation-contract:v1`. The mutation contract remains the future Apply entry envelope.

## Architecture

```text
BankChangeIntent + BankChangePlanningFacts + ReadinessEvidence::current_main()
        │
        ▼
  plan_bank_change()   (pure, ot-plan)
        │
        ▼
  BankChangePlan       (deterministic PlanId, blockers, no post-state)
```

Future path (not implemented here):

`BankChangePlan → semantics resolved → Prepare → BankMutationEnvelope`

## Intent

`BankChangeIntent::Copy | Move | Swap { source, destination }` with validated `BankIndex` only.
`source == destination` is a **hard planning error** (`Err`).

## Planning facts

`BankChangePlanningFacts` holds observed data only:

- root identity (`root_id`, `device_fingerprint`, `observed_revision`, `identity_is_stable`)
- `read_model_schema` (current `masterocta.project-structure:v4`)
- `project_relative_path`, `ProjectStructure`, project-scope `TreeManifest`
- `source_presence` / `destination_presence` (`BankStateDocumentSet`)

Production callers must pass `ReadinessEvidence::current_main()` unchanged. Arbitrary gap closure is rejected.

## Plan model

`BankChangePlan` includes:

- deterministic `PlanId` (`validate_integrity()`)
- read dependencies vs candidate change documents (Copy: source read-only, destination candidates only)
- affected Pattern / Part / Track / sample-slot observations (Working vs SavedCheckpoint separate)
- `reference_coverage = PARTIAL` with documented missing classes (sample locks, inactive machine slots, `parts.saved`, `recorder_slot_id`)
- `readiness_gaps`, `blockers`, preconditions (path + size + hash or absence)
- backup requirement declaration (paths only; no `BackupEvidence`)
- verification requirement declaration (no fabricated post hashes)
- `execution_readiness = Blocked`, `execution_authorized() = false`

State-document rules reuse `ot_domain::bank_state_documents` (`evaluate_bank_operation_state_effect`, swap symmetry helpers). No second Working/SavedCheckpoint engine.

Semantic unknowns (Move vacated source, active bank retarget, Copy SavedCheckpoint semantics) surface as **blockers** inside an `Ok(plan)`.

## Stale plans

`check_bank_changeplan_staleness(plan, fresh_manifest)` uses project-scope manifest diff (`diff_manifests`). Any change → `Stale`; regenerate, do not silently rebase.

## No-write proof

Committed PSE fixtures are read in place; planner execution does not modify `*.work`, `*.strd`, or capture metadata (`pse_bank_changeplan` tests).

## Readiness

After this work, `ReadinessEvidence::current_main()` resolves:

- `ArrangementFileSlot` (#204)
- `BankChangePlan` (#181 planner)

Still open: `ArrangerPatternReferences`, `BankInternalIdentity`, `SceneAndRecorderDependencies`, `WorkingSavedCheckpointRule`, `ApplyAuthorization`.

`CHANGEPLAN_IMPLEMENTATION_READINESS = IMPLEMENTED` (read-only planner)  
`CHANGEPLAN_EXECUTION_READINESS = NOT_READY`  
`BANK_CHANGEPLAN_READINESS = NOT_READY` (execution sense)

## Issue #181 close gate

`ISSUE_181_CLOSE_READY = NO` until sample/reference coverage beyond partial Part/Track machine slots is honest in the plan model or read model.
