# Bank ChangePlan reference coverage (read-only)

**Formal #181 judgment (current main):** [`PSE_BANK_CHANGEPLAN_CLOSEOUT.md`](./PSE_BANK_CHANGEPLAN_CLOSEOUT.md).

Work ID: `MO-PSE-BANK-CHANGEPLAN-REFERENCE-COVERAGE-1`  
Parent: [#181](https://github.com/kaz4g/masterocta/issues/181)  
Base branch: `main` @ `6e25354bf0e271a706b2b20079dcfeb770192651`

This unit completes the **read-only** sample-slot reference inventory used by
`BankChangePlan`. It does not authorize Apply, write Bank bytes, or resolve
AudioAsset / FileInstance identity inside `ot-plan`.

## Reference class matrix

| Class | Classification | ChangePlan handling |
| --- | --- | --- |
| Active machine (unsaved Part) | ENUMERATED | `ReferenceOrigin::ActiveMachine` |
| Sample lock (Pattern × Track × Step) | ENUMERATED | `ReferenceOrigin::SampleLock`, 64 steps, #209 pool rules |
| `parts.saved` machine slots | ENUMERATED | `ReferenceOrigin::SavedPartMachine`, separate from unsaved |
| Inactive machine-side slot | EXCLUDED_BY_CONTRACT | Never emitted (I-10) |
| `recorder_slot_id` field | UNMODELED_RECORDER_SETUP | Not converted to `SampleSlotId`; `RecorderSetup` remains unmodeled |
| Flex `flex_slot_id` 129–136 | ENUMERATED | `TrackSlotReference::RecorderBuffer` preserved |

`ReferenceCoverage` reports `inactive_machine_slots = ExcludedByContract`,
`recorder_setup = Unmodeled`, and other Sample-slot classes `Covered`.
Aggregate: `COMPLETE_FOR_CHANGEPLAN_REVIEW`.

## Architecture

```text
BankFile + project PATH observations (masterocta adapter)
        │
        ▼
  BankReferenceInventory  (observed_revision, observations, coverage)
        │
        ▼
  BankChangePlanningFacts + plan_bank_change()  (ot-plan, pure)
        │
        ▼
  BankChangePlan.reference_observations + scoped Copy/Move/Swap view
```

Shared pure helpers: `ot_domain::sample_lock_reference`, `ot_domain::track_slot_from_raw`.

## PlanId / staleness

Reference observations (scope, origin, coordinates, target, status, path, audibility)
and structured `ReferenceCoverage` bytes are hashed into `PlanId`.
`reference_inventory.observed_revision` must match `facts.observed_revision` or
planning fails closed.

Project-scope manifest staleness is unchanged (`check_bank_changeplan_staleness`).

## No-write proof

`pse_bank_changeplan` runs Copy / Move / Swap with committed fixtures before/after
tree digest; `*.work` / `*.strd` unchanged.

## #191 gate

`change-plan.affected-reference-enumeration` → **ACTIVE** (inventory + enumeration tests listed in
`scripts/pse-read-model-inventory.json`).

## #181 close readiness

`ISSUE_181_CLOSE_READY = YES` for **read-only ChangePlan review** (reference inventory honest,
broken refs visible, execution still blocked).

`CHANGEPLAN_EXECUTION_READINESS = NOT_READY`  
`BANK_CHANGEPLAN_READINESS = NOT_READY`  
`APPLY_AUTHORIZED = NO`

#217 / #221 remain **OPEN**.
