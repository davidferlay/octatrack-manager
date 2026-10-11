# Bank ChangePlan readiness reconciliation

Work ID: `MO-PSE-BANK-CHANGEPLAN-READINESS-RECONCILIATION-1`  
Parent: [#181](https://github.com/kaz4g/masterocta/issues/181)  
Related merged PR: [#227](https://github.com/kaz4g/masterocta/pull/227)  
Base branch: `main` @ `4b33a524bfd9822d15ea77bb42d3e9cd85f10b96`

This work recalculates Bank Copy / Move / Swap ChangePlan blockers after #227. It does **not** collect new device evidence, implement ChangePlan, enable Apply, or mutate committed fixture bytes.

```text
WRITE_TO_OCTATRACK_MEDIA = NO
APPLY = NO
BANK_ENCODER = NO
BANK_WRITER = NO
FIXTURE_MUTATION = NO
DEVICE_CAPTURE = NO
```

## Two readiness levels

| Level | Meaning |
| --- | --- |
| **ChangePlan implementation readiness** | May we implement a read-only, deterministic planner that lists known effects and every unresolved gap without silent success? |
| **ChangePlan execution readiness** | Do we know enough semantics to produce a plan that could later be authorized for Apply (all operation rules, identity rewrite, external refs)? |

These must not be conflated. `BANK_CHANGEPLAN_READINESS` in older docs means **execution** readiness unless stated otherwise.

## Evidence inventory (on `main` at base SHA)

| Source | Role |
| --- | --- |
| [#204](https://github.com/kaz4g/masterocta/issues/204) CLOSED | `P_ARR_TEST`: UI Arrangement 1/2/8 → raw 0/1/7 → `arr01`/`arr02`/`arr08` (MkII `R0173` / OS `1.40` only). Other firmware (including OS `1.40B`) stays `ProjectArrangementSelection::Unrecognized`. `ReadinessGap::ArrangementFileSlot` is closed globally in `ReadinessEvidence::current_main()`; planners must not treat that as proven mapping on unrecognized targets. |
| [#210](https://github.com/kaz4g/masterocta/issues/210) CLOSED | Flex recorder buffer: `RecorderBufferId` accepts `129..=136` only; not a separate ChangePlan readiness gap. |
| [#219](https://github.com/kaz4g/masterocta/issues/219) CLOSED | Multi-bank fixture evidence; Working/SavedCheckpoint operation rule still open. |
| [#227](https://github.com/kaz4g/masterocta/pull/227) MERGED | Cross-bank Pattern Paste on `P_BANK_PERSIST`: work flush on control switch, strd on project save; **not** Bank Copy semantics. |
| [#217](https://github.com/kaz4g/masterocta/issues/217) OPEN | Working / SavedCheckpoint bank-operation rules. |
| [#221](https://github.com/kaz4g/masterocta/issues/221) OPEN | Bank internal identity evidence audit. |
| [#183](https://github.com/kaz4g/masterocta/issues/183) CLOSED | Issue closed; no production Bank Apply runner (`ISSUE_183_STATE_MISMATCH = YES`). |
| `ot_plan::bank_mutation` | `ReadinessGap` (7 variants), `ReadinessEvidence::current_main()`, `evaluate_apply_entry`, `BankMutationEnvelope`. |
| `ot_domain::bank_state_documents` | Presence gates, blocked `COPY`/`MOVE`/`SWAP` rules, `CopySavedCheckpointSemantics::Unknown`, `ActiveBankRetarget::Unknown`. |
| `ot_domain::project_structure` | `UnmodeledDependency::{Scenes, Arrangements, RecorderSetup}`. |

## Resolved prerequisites (no longer #181 blockers)

| Item | Classification | Notes |
| --- | --- | --- |
| Arrangement file-slot mapping | **RESOLVED** (OS-scoped) | #204; gap closed in code for proven OS. Other versions stay `Unrecognized`. |
| Recorder raw-range (129..=136) | **RESOLVED** | #210; `RecorderBufferId::new` accepts `129..=136` only; raw **128** is **rejected** (`Unrecognized(128)` in the read model). Flex slots **135** and **136** were not observed on every device capture but remain in the accepted domain range. |
| Bank role-pair presence / swap symmetry | **RESOLVED** (precondition) | Pure contract in `bank_state_documents`; does not authorize write. |
| Malformed / unsupported document handling | **RESOLVED** (fail-closed) | Trusted read model and envelope validation stop the plan. |

## Blocker matrix

One row per claimed blocker. Categories: **A** RESOLVED · **B** OPEN_AND_BLOCKS_CHANGEPLAN · **C** OPEN_BUT_BLOCKS_APPLY_ONLY · **D** OPEN_BUT_NON_BLOCKING_FOR_BANK_PLAN · **E** STALE_DOC_REFERENCE · **F** UNKNOWN_NEEDS_SEPARATE_EVIDENCE

| Blocker | Category | Blocks implementation planner? | Blocks executable plan / Apply? |
| --- | --- | --- | --- |
| #204 Arrangement file slot (listed as open blocker) | E | No (global gap closed; per-target still `Unrecognized` off R0173/1.40) | Yes off proven OS — plan must not claim arr slot mapping |
| #210 Recorder buffer (listed as ChangePlan blocker) | E / A | No | No (unmodeled via Scene/Recorder gap if needed) |
| Arranger `pattern_id` numbering | D | No — report `UnmodeledDependency::Arrangements` + `ReadinessGap::ArrangerPatternReferences` | Yes — cannot list affected Arranger rows |
| Bank internal identity (#221) | F | No — filename identity + gap output | Yes — byte rewrite semantics unknown |
| Scene / Recorder dependencies | D | No — fail-closed `UNMODELED` | Yes — full effect claim blocked |
| Working / SavedCheckpoint rule (#217) | F | No — emit `WorkingSavedCheckpointRule` gap | Yes |
| `COPY_SAVED_CHECKPOINT_SEMANTICS` | F | No — `Unknown` in plan effect | Yes for Copy execution |
| Active bank retarget (`[STATES] BANK`) | F | No — `ActiveBankRetarget::Unknown` | Yes for Move/Swap when active bank involved |
| Move source vacated state (BMS §16-1) | F | No — structure verify fails closed today | Yes |
| #181 ChangePlan not implemented | B (until CORE lands) | N/A — `ReadinessGap::BankChangePlan` open until planner merged | Yes |
| Apply authorization (PSE-3) | C | No | Yes |
| #183 CLOSED vs no Apply runner | E (doc/PM) | No | Yes — Apply unauthorized |

### Scene / Recorder scope

- `BANK_CHANGEPLAN_CAN_FAIL_CLOSED_ON_UNMODELED_DEPENDENCY = YES`
- `BANK_CHANGEPLAN_REQUIRES_FULL_SCENE_DECODER = NO`

A planner may output `Scene = UNMODELED`, `Recorder = UNMODELED`, and `Plan = BLOCKED` / `REVIEW_REQUIRED` without a Scene read model. That does **not** satisfy an executable Copy/Move/Swap plan.

### Working / SavedCheckpoint (#217 + #227)

| Field | Value |
| --- | --- |
| `CROSS_BANK_PATTERN_PASTE_PERSISTENCE` | `OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE` |
| `WORKING_CHECKPOINT_SEPARATION_OBSERVED` | `YES` (one Pattern Paste sequence only) |
| `COPY_SAVED_CHECKPOINT_SEMANTICS` | `UNKNOWN` (not promoted to Bank Copy) |
| `MOVE_STATE_DOC_RULE` | `BLOCKED` |
| `SWAP_STATE_DOC_RULE` | `BLOCKED` |
| `ACTIVE_BANK_RETARGET_RULE` | `BLOCKED` |
| `WORKING_SAVEDCHECKPOINT_BLOCKS_PLANNER_IMPLEMENTATION` | `NO` |
| `WORKING_SAVEDCHECKPOINT_BLOCKS_EXECUTABLE_PLAN` | `YES` |

### Bank internal identity (#221)

| Field | Value |
| --- | --- |
| `BANK_INTERNAL_IDENTITY` | `UNKNOWN` |
| `STABLE_SLOT_CORRELATED_FIELD` | `NONE_OBSERVED` |
| `BANK_INTERNAL_IDENTITY_BLOCKS_READ_ONLY_CHANGEPLAN` | `NO` |
| `BANK_INTERNAL_IDENTITY_BLOCKS_APPLY` | `YES` |

### Arranger `pattern_id`

| Field | Value |
| --- | --- |
| `ARRANGER_PATTERN_ID_STATUS` | `NON_BLOCKING_FOR_BANK_CHANGEPLAN` |
| Open GitHub issue | None (#190 closed without merge) |
| Recommended future evidence unit | Issue title: `[PSE][#181] Arranger pattern_id numbering evidence`; Work ID: `MO-PSE-ARRANGER-PATTERN-ID-EVIDENCE-1` (not created by this work) |

## Copy / Move / Swap matrices

Shared for all three:

- **Documents:** operated `bankNN.work` / `bankNN.strd` only (BMS whitelist); not `project.work` until contract bump.
- **Unmodeled:** Scenes, Arrangements (Arranger rows), RecorderSetup on every bank structure read.
- **Apply:** `NOT_AUTHORIZED`; `ReadinessGap::ApplyAuthorization` open.
- **Fail-closed plan:** Yes — types already support gaps, unmodeled deps, blocked state-doc rules.

### COPY

| Dimension | Status |
| --- | --- |
| `plan_model` | `FAIL_CLOSED_GAP_REPORT` (allowed after CORE-1) |
| `document_presence` | Deterministic listing; asymmetric presence → STOP |
| `saved_checkpoint_rule` | `COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN` |
| `active_state_retarget` | `NotApplicable` for copy effect helper; project `[STATES]` still not in whitelist |
| `internal_identity` | Gap open; no byte rewrite in read-only plan |
| `execution_readiness` | `NOT_READY` |
| `apply_authorized` | `NO` |

### MOVE

| Dimension | Status |
| --- | --- |
| `plan_model` | `FAIL_CLOSED_GAP_REPORT` |
| `document_presence` | Same as Copy |
| `saved_checkpoint_rule` | Blocked with Working/SavedCheckpoint gap |
| `active_state_retarget` | `UNKNOWN` when active bank = source |
| `move_vacated_source` | `UNKNOWN` (BMS §16-1); structure verify closed |
| `internal_identity` | Gap open |
| `execution_readiness` | `NOT_READY` |
| `apply_authorized` | `NO` |

### SWAP

| Dimension | Status |
| --- | --- |
| `plan_model` | `FAIL_CLOSED_GAP_REPORT` |
| `document_presence` | Symmetric role requirement enforced in domain |
| `saved_checkpoint_rule` | Blocked |
| `active_state_retarget` | `UNKNOWN` when active bank involved |
| `internal_identity` | Gap open |
| `execution_readiness` | `NOT_READY` |
| `apply_authorized` | `NO` |

## Domain contract audit

Current types **already** fail closed for:

- Unresolved Working/SavedCheckpoint → `ReadinessGap::WorkingSavedCheckpointRule`, blocked operation rules, `CopySavedCheckpointSemantics::Unknown`
- Unresolved internal identity → `ReadinessGap::BankInternalIdentity`
- Unresolved active retarget → `ActiveBankRetarget::Unknown`, `ACTIVE_BANK_RETARGET_RULE = Blocked` (no separate `ReadinessGap` variant required for planner v1)
- Asymmetric document presence → `MissingPairStop` variants
- Unmodeled dependency → `UnmodeledDependency` + `StopCondition::UnmodeledDependency`

No production enum change required for this reconciliation. Smallest future change (only if Apply tracking needs it): optional `ReadinessGap::ActiveBankRetargetRule` — not implemented here.

## Decision gate

```text
BANK_CHANGEPLAN_IMPLEMENTATION = READY
```

Meaning: begin [#181](https://github.com/kaz4g/masterocta/issues/181) planner implementation next (`MO-PSE-BANK-CHANGEPLAN-CORE-1`), read-only and fail-closed. Do **not** raise legacy `BANK_CHANGEPLAN_READINESS` to READY until execution gaps close.

### Recommended next Work ID

`MO-PSE-BANK-CHANGEPLAN-CORE-1`

Scope (future work, not this unit):

- Intent types for Copy / Move / Swap
- Deterministic affected document listing
- Affected Pattern / Part / sample refs where read model allows
- Precondition hashes, readiness-gap output, backup requirement declaration, verification plan declaration
- **NO APPLY**, **NO WRITE**

If implementation were blocked, the single highest-priority evidence unit would be **#217** Working/SavedCheckpoint bank-operation semantics (not selected — implementation is READY).

## Issue #183

GitHub #183 is **CLOSED**. Production has no Bank Apply runner. `ISSUE_183_STATE_MISMATCH = YES` (documentation / project-management mismatch, not proof Apply exists).

## Arrangement mapping scope (global gap vs target firmware)

`ReadinessEvidence::current_main()` closes `ArrangementFileSlot` once for all builds. That reflects reviewed #204 evidence, not “every supported project firmware has a mapped arrangement slot.” When Working `project.work` compatibility is not MkII `R0173` / OS `1.40`, or `[STATES] ARRANGEMENT` stays `Unrecognized`, a ChangePlan must treat arrangement file-slot mapping as **unproven for that target** even though the global readiness gap is closed. Executable plans and Apply must fail closed on those targets until OS-scoped evidence exists or a per-target gap is added in a future contract revision.

## Machine-readable final report

```text
WORK_ID = MO-PSE-BANK-CHANGEPLAN-READINESS-RECONCILIATION-1
BASE_SHA = 4b33a524bfd9822d15ea77bb42d3e9cd85f10b96
HEAD_SHA = 3e731c7ae740e062d97dec1d4d01e2a1d5e57efd
PR = https://github.com/kaz4g/masterocta/pull/229
PR227_EVIDENCE = INCORPORATED
ARRANGEMENT_MAPPING = PROVEN (MkII R0173 / OS 1.40 only)
ARRANGEMENT_MAPPING_OTHER_FIRMWARE = UNRECOGNIZED (per-target; global ReadinessGap closed)
RECORDER_RAW_RANGE = RESOLVED (129..=136; raw 128 rejected)
ARRANGER_PATTERN_ID_STATUS = NON_BLOCKING_FOR_BANK_CHANGEPLAN
WORKING_SAVEDCHECKPOINT_STATUS = OPEN (#217)
BANK_INTERNAL_IDENTITY = UNKNOWN
ACTIVE_BANK_RETARGET = UNKNOWN
SCENE_DEPENDENCY_FOR_BANK_PLAN = FAIL_CLOSED_UNMODELED
RECORDER_DEPENDENCY_FOR_BANK_PLAN = FAIL_CLOSED_UNMODELED
ISSUE_183_STATE_MISMATCH = YES
COPY_PLAN_READINESS = FAIL_CLOSED_GAP_REPORT / EXECUTION_NOT_READY
MOVE_PLAN_READINESS = FAIL_CLOSED_GAP_REPORT / EXECUTION_NOT_READY
SWAP_PLAN_READINESS = FAIL_CLOSED_GAP_REPORT / EXECUTION_NOT_READY
CHANGEPLAN_IMPLEMENTATION_READINESS = READY
CHANGEPLAN_EXECUTION_READINESS = NOT_READY
BANK_CHANGEPLAN_READINESS = NOT_READY
ISSUE_181 = OPEN
ISSUE_217 = OPEN
ISSUE_221 = OPEN
NEXT_WORK_ID = MO-PSE-BANK-CHANGEPLAN-CORE-1
FIXTURE_NO_WRITE = PASS
APPLY_AUTHORIZED = NO
RESULT = READY_FOR_BANK_CHANGEPLAN_CORE
```
