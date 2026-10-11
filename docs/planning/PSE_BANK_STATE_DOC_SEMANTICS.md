# Bank Working / SavedCheckpoint operation semantics

Work ID: `MO-PSE-BANK-STATE-DOC-SEMANTICS-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

Scope: read-only audit plus pure domain contract. No ChangePlan generator, Apply, encoder, or filesystem writes.

## Judgment

```text
COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED
ACTIVE_BANK_RETARGET_RULE = BLOCKED
COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN
ACTIVE_BANK_RETARGET = UNKNOWN
BANK_CHANGEPLAN_READINESS = NOT_READY
ISSUE_183_STATE_MISMATCH = YES
```

`ReadinessGap::WorkingSavedCheckpointRule` in `ot_plan::bank_mutation` stays **open** (`ReadinessEvidence::current_main()` unchanged).

Cross-bank Pattern Copy/Paste on disposable `P_BANK_PERSIST` (MkII `R0173` / `1.40`) observed `bank02.work` first changing at control-bank switch and `bank02.strd` first changing at project save. `COPY_SAVED_CHECKPOINT_SEMANTICS` stays **UNKNOWN**. See [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md).

## Issue #183 vs implementation

GitHub [#183](https://github.com/kaz4g/masterocta/issues/183) `[PSE] Bank Fixture Apply` is **CLOSED**, but there is no production Bank Apply runner, Prepare writer, or Tauri command that executes Copy / Move / Swap on fixtures. Only the #182 safety contract (`evaluate_apply_entry`, envelope checks) and disabled legacy writers exist. This audit records `ISSUE_183_STATE_MISMATCH = YES` and does not reopen or mutate the issue.

## Read model (PSE)

| Source | `.work` / `.strd` behavior |
| --- | --- |
| [`project_structure_reader.rs`](../../src-tauri/src/project_structure_reader.rs) | Independent entries per role; missing file → skip; **no** `.work` → `.strd` fallback |
| [`legacy_read_adapter.rs`](../../src-tauri/src/legacy_read_adapter.rs) | Same: separate catalog rows per file |
| [`project_reader.rs`](../../src-tauri/src/project_reader.rs) (legacy UI) | Single logical bank: prefer `.work`, else `.strd` |

Domain: [`project_structure.rs`](../../src-tauri/crates/ot-domain/src/project_structure.rs) documents that Working `project.work` is not filled from `project.strd`.

Working `project.work` `[STATES]` (PSE): `BANK` and `PATTERN` map to zero-based `BankIndex` / `PatternIndex`. `ARRANGEMENT` maps to `arr01`–`arr08` for MkII `R0173` / OS `1.40` only ([#204](https://github.com/kaz4g/masterocta/issues/204) CLOSED; other OS versions stay `Unrecognized`). BMS whitelist still rejects `project.work` as a change target until an explicit contract schema bump ([#182](PSE_BANK_MUTATION_SAFETY_CONTRACT.md) §5, §16-3).

### Working vs SavedCheckpoint (evidence class)

From [PROJECT_STRUCTURE_CONTROL_PLANE.md](./PROJECT_STRUCTURE_CONTROL_PLANE.md) §3.1 (project vocabulary, **not** official manual filename mapping):

| Role | File | Interpretation in this repo |
| --- | --- | --- |
| Working | `bankNN.work` | In-edit / live bank payload (patterns, parts, tracks in PSE read model) |
| SavedCheckpoint | `bankNN.strd` | Device SAVE/RELOAD checkpoint (same binary schema as bank file via `ot-tools-io`) |

Official Elektron manuals do not document `.work` / `.strd` naming; do not treat control-plane wording as firmware specification.

### `parts_edited_bitmask` / `parts_saved_state`

Live in `ot-tools-io` `BankFile` inside **bank** bytes, not in `project.work` `[STATES]`. Legacy `PartsDataResponse` exposes them when reading a bank through `project_reader`. PSE `BankStructure` does not surface these fields yet.

## Legacy writer evidence (disabled)

`copy_bank` / `copy_parts` ([`project_reader.rs`](../../src-tauri/src/project_reader.rs)):

- **Read** source: `bankNN.work` if present, else `bankNN.strd`
- **Write** destination: **`bankNN.work` only** (no `.strd`, no `project.work` `[STATES]`)
- Gated by [`legacy_command_gate.rs`](../../src-tauri/src/legacy_command_gate.rs) / `deny_legacy_write!`

No `move_bank` or `swap_bank` functions exist in the main tree.

## Tracked fixture inventory

Only `git ls-files` under `src-tauri/tests/fixtures/` (no invented rows).

| Fixture | Bank | `.work` | `.strd` | `project.work` | `[STATES] BANK` | `[STATES] PATTERN` |
| --- | --- | --- | --- | --- | --- | --- |
| `real_device/` | 01 | yes | yes | yes | `0` | `0` |
| `multipart/` | 01 | yes | no | yes | `0` | `0` |
| `source_project/` | — | no | no | yes | `0` | `0` |
| `dest_project/` | — | no | no | yes | `0` | `0` |
| `real_device_os_1_40/` | — | no | no | yes | `0` | `0` |
| `pse_bank_multi_device/bank_a_active/` | 01–02 | yes | yes | yes | `0` | `0` |
| `pse_bank_multi_device/bank_b_active/` | 01–02 | yes | yes | yes | `1` | `0` |
| `pse_bank_multi_device/bank_b_pattern_4/` | 01–02 | yes | yes | yes | `1` | `3` |
| `pse_bank_multi_device/bank_a_working_diverged/` | 01–02 | yes | yes | yes | `0` | `0` |
| `pse_bank_multi_device/bank_a_after_save/` | 01–02 | yes | yes | yes | `0` | `0` |

Real-device follow-up ([#219](https://github.com/kaz4g/masterocta/issues/219)): A/B/C/E/F captures are committed ([PSE_BANK_MULTI_DEVICE_EVIDENCE.md](./PSE_BANK_MULTI_DEVICE_EVIDENCE.md)). The E/F sequence did not produce a proven pre-save `.work` vs `.strd` divergence on the mounted CF view. The explicit Save operation did produce observed `bank01` and `project` file updates versus E. Therefore the general Working/SavedCheckpoint operation rule remains unresolved and `ReadinessGap::WorkingSavedCheckpointRule` stays open.

Provenance:

- `real_device`: unmodified copy from real CF card, OS 1.40B (`real_device_roundtrip.rs` header)
- `multipart`: synthetic bank spanning four parts (`PSE_CI_FOUNDATION.md` §5)
- `real_device_os_1_40`: byte-for-byte from disposable disk image, OS 1.40 R0173 (README in fixture)

Layout cases in tracked fixtures:

| Case | Status |
| --- | --- |
| `.work` only (no sibling `.strd`) | **PRESENT** (`multipart/bank01`) |
| `.work` + `.strd` | **PRESENT** (`real_device/bank01`) |
| `.strd` only | **ABSENT** (reader tests copy `.strd` alone; not device-generated evidence) |
| Other bank indices with files | **ABSENT** (only bank01 where bank files exist) |

## `real_device` bank01.work vs bank01.strd

Read-only comparison (test `real_device_bank01_work_and_strd_decode_and_differ`):

| Observation | Value |
| --- | --- |
| File size | 636113 bytes each |
| Raw bytes | **Not identical** (`cmp` differs) |
| `BankFile` decode | Both parse |
| `parts_edited_bitmask` | **Equal** on this fixture (observation only) |
| `parts_saved_state` | **Equal** on this fixture (observation only) |

Other internal fields may differ; a full field diff is **UNKNOWN** without a dedicated audited diff pass. Equal flag fields do **not** prove that SavedCheckpoint always mirrors Working on device.

## Pair invariant (contract)

Pure types in [`bank_state_documents.rs`](../../src-tauri/crates/ot-domain/src/bank_state_documents.rs):

- `BankStateDocumentSet`: optional Working and optional SavedCheckpoint per `BankIndex`; neither role implies the other
- `swap_banks_have_symmetric_role_presence`: both banks expose the same roles (symmetric presence only)
- `swap_aligned_role_pairings` / `validate_swap_role_pairings`: same-role swap mappings; asymmetric presence → `SwapRolePresenceAsymmetric`; cross-role mapping → `CrossRolePairRejected`
- Observation `BankStateDocumentSet.bank` must match operation source/destination index → else `BankIdentityMismatch`
- Move/Swap with no active bank index → `ActiveBankRetarget::SelectionUnavailable` (not `NotApplicable`)
- Do not construct cross-mix pairs such as moving `A.work` bytes onto `D.strd`

## Missing-pair behavior (ChangePlan precondition)

| Presence | ChangePlan presence gate |
| --- | --- |
| Both | `ObservedPair` (real_device bank01) |
| Working only | STOP (`WorkingOnlyUnproven`) |
| SavedCheckpoint only | STOP (`SavedCheckpointOnly`) |
| Neither | STOP (`NeitherDocuments`) |

Even when presence passes, operation rules remain **BLOCKED** until #181 readiness and owner decisions in BMS §16 are resolved.

## Copy / Move / Swap (contract only)

| Operation | Candidate documents (deterministic listing) | Authorized to write |
| --- | --- | --- |
| Copy A→D | For each role present on A: `bankD.{work\|strd}` | **No** (`COPY_STATE_DOC_RULE = BLOCKED`) |
| Move A→D | All roles present on A or D at those indices | **No** |
| Swap A↔D | Same role set on both banks required | **No** |

Copy SavedCheckpoint meaning when duplicating `.strd`: **UNKNOWN** (`CopySavedCheckpointSemantics::Unknown`).

Move source vacated state (empty template vs absent files): **UNKNOWN** (BMS §16-1).

## `project.work` `[STATES] BANK` / `PATTERN`

| Operation | `BANK=` | `PATTERN=` |
| --- | --- | --- |
| Copy (active bank = source) | No retarget rule; project state not in BMS whitelist | **UNKNOWN** (all fixtures static `0`) |
| Move (active bank = source) | `ActiveBankRetarget::Unknown` | **UNKNOWN** |
| Swap (active bank involved) | `ActiveBankRetarget::Unknown` | **UNKNOWN** |

Do not infer “follow slot index” vs “follow bank contents” without device evidence.

## Pure domain API

Exported from `ot_domain`:

- `evaluate_bank_operation_state_effect`
- `BankStateDocumentPresence`, `BankStateDocumentSet`, `BankOperationStateEffect`
- Rule constants `COPY_STATE_DOC_RULE`, `MOVE_STATE_DOC_RULE`, `SWAP_STATE_DOC_RULE`, `ACTIVE_BANK_RETARGET_RULE` (all `Blocked`)

No changes to `BankMutationEnvelope`, `ReadinessEvidence::current_main`, or BMS schema v1.

## Tests

| Test | Location |
| --- | --- |
| Separate roles, no promotion, copy listing, move retarget unknown, swap presence | `ot-domain` `bank_state_documents.test.rs` |
| Fixture hash unchanged after contract evaluation | `tests/bank_state_doc_semantics.rs` |
| bank01.work/strd decode and byte inequality | `tests/bank_state_doc_semantics.rs` |
| PSE reader no fallback | `project_structure_reader.rs` (existing) |

## Resolved prerequisites (not remaining #181 blockers)

- [#204](https://github.com/kaz4g/masterocta/issues/204) Arrangement file slot — `ReadinessGap::ArrangementFileSlot` resolved on `main` for MkII `R0173` / OS `1.40`; see [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md).
- [#210](https://github.com/kaz4g/masterocta/issues/210) Recorder buffer raw range — `RecorderBufferId` `129..=136`; not a ChangePlan blocker (Scene/Recorder unmodeled gap covers plan safety).

## Remaining #181 blockers (reconciled after #227)

- Arranger `pattern_id` evidence (fail-closed unmodeled; does not block read-only planner — see reconciliation doc)
- Bank internal identity bytes ([#221](https://github.com/kaz4g/masterocta/issues/221))
- Scene / Recorder dependencies (fail-closed unmodeled)
- Working / SavedCheckpoint operation rule ([#217](https://github.com/kaz4g/masterocta/issues/217)); `COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN` after #227 Pattern Paste evidence
- Active bank retarget and Move vacated source (BMS §16-1–§16-3 owner items)

## Safety

```text
WRITE = NO
APPLY = NO
BACKUP = NO
RECOVERY = NO
LEGACY_BANK_WRITER = DISABLED
```
