# Bank Working / SavedCheckpoint operation semantics (classification)

Work ID: `MO-PSE-BANK-STATE-DOC-SEMANTICS-2`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
Prior audit: [`PSE_BANK_STATE_DOC_SEMANTICS.md`](./PSE_BANK_STATE_DOC_SEMANTICS.md) (`MO-PSE-BANK-STATE-DOC-SEMANTICS-1`)

Base SHA: [`60407bb4c9ef30dc6f282f11f8d2c6f8a2143cdc`](https://github.com/kaz4g/masterocta/commit/60407bb4c9ef30dc6f282f11f8d2c6f8a2143cdc) (`main` after PR #234)

Scope: read-only evidence audit and documentation. No ChangePlan Apply, encoder, Bank writer, device capture, or mutation of tracked `*.work` / `*.strd`. Domain rule constants stay **Blocked**; `CopySavedCheckpointSemantics::Unknown` unchanged.

## Judgment (this work unit)

```text
COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED
ACTIVE_BANK_RETARGET_RULE = BLOCKED

COPY_SAVED_CHECKPOINT_SEMANTICS = DEVICE_EVIDENCE_REQUIRED
MOVE_VACATED_SOURCE = OWNER_DECISION_REQUIRED

COPY_WORKING_ROLE = DEVICE_EVIDENCE_REQUIRED
COPY_SAVED_CHECKPOINT_ROLE = DEVICE_EVIDENCE_REQUIRED
COPY_PROJECT_STATE_EFFECT = NOT_APPLICABLE (until Copy role rule is proven; no accepted retarget)

MOVE_DESTINATION_ROLE_SET = OWNER_DECISION_REQUIRED (same-role default constraint only; not product semantics)
SWAP_ROLE_RULE = OWNER_DECISION_REQUIRED (same-role symmetry is safe enumeration, not proven product semantics)

COPY_ACTIVE_BANK_RETARGET = DEVICE_EVIDENCE_REQUIRED (native Bank Copy exists)
MOVE_ACTIVE_BANK_RETARGET = OWNER_DECISION_REQUIRED (no native firmware Move; PSE-2 product only)
SWAP_ACTIVE_BANK_RETARGET = OWNER_DECISION_REQUIRED (no native firmware Swap; PSE-2 product only)
ACTIVE_PATTERN_RETARGET_COPY = DEVICE_EVIDENCE_REQUIRED
ACTIVE_PATTERN_RETARGET_MOVE = OWNER_DECISION_REQUIRED
ACTIVE_PATTERN_RETARGET_SWAP = OWNER_DECISION_REQUIRED

READINESS_GAP_WORKING_SAVEDCHECKPOINT = OPEN
READINESS_GRANULARITY_MISMATCH = YES

AFFECTED_FILES = PARTIAL
ISSUE_181_CLOSE_READY = NO
ISSUE_217_CLOSE_READY = NO

ISSUE_221 = OPEN
BANK_INTERNAL_IDENTITY = UNKNOWN

CHANGEPLAN_EXECUTION_READINESS = NOT_READY
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO

FILESYSTEM_WRITE = NO
DEVICE_CAPTURE = NO
RESULT = STOP_WITH_FINDINGS
NEXT_WORK_ID = MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1
```

No operation rule was promoted to `Ready`. Classification is complete; semantics are not.

## Evidence inventory (committed, read-only)

| Source | Relevance to this work |
| --- | --- |
| [`PSE_BANK_STATE_DOC_SEMANTICS.md`](./PSE_BANK_STATE_DOC_SEMANTICS.md) | Presence gates, candidate path listing, blocked rules, pair invariant |
| [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md) | Cross-bank Pattern Paste only; **not** Bank Copy |
| [`PSE_BANK_MULTI_DEVICE_EVIDENCE.md`](./PSE_BANK_MULTI_DEVICE_EVIDENCE.md) | A/B/C/E/F; Save updates `.strd`; pre-save `.work`≠`.strd` **not** proven on mounted CF |
| [`PSE_BANK_INTERNAL_IDENTITY.md`](./PSE_BANK_INTERNAL_IDENTITY.md) | Device Bank Copy captures (#221); post-save/reload; `.work`==`.strd` at capture |
| [`PSE_BANK_CHANGEPLAN_CLOSEOUT.md`](./PSE_BANK_CHANGEPLAN_CLOSEOUT.md) | `AFFECTED_FILES = PARTIAL`; manifest completeness after #234 |
| [`PSE_BANK_MUTATION_SAFETY_CONTRACT.md`](./PSE_BANK_MUTATION_SAFETY_CONTRACT.md) | BMS §16 owner items; structure verify closed on vacated Move |
| [`bank_state_documents.rs`](../../src-tauri/crates/ot-domain/src/bank_state_documents.rs) | Pure contract; all operation rules `Blocked` |
| [`bank_changeplan.rs`](../../src-tauri/crates/ot-plan/src/bank_changeplan.rs) | Read-only planner; semantic blockers |
| Fixtures: `real_device`, `multipart`, `pse_bank_multi_device/*`, `pse_bank_copy_persistence/*`, `pse_bank_identity*` | Observations scoped to capture OS and procedure |

Historical assumptions (legacy disabled `copy_bank`, control-plane vocabulary) are **not** promoted to firmware facts.

## Semantic decision matrix

| Semantic question | Evidence available | Device-defined? | Product-policy? | Classification |
| --- | --- | --- | --- | --- |
| Copy: which roles on destination (`bankD.work`, `bankD.strd`) | #221 device copies post-save; no copy-immediate stage | Likely yes once staged capture exists | MasterOCTa could choose only if device allows multiple outcomes | **DEVICE_EVIDENCE_REQUIRED** |
| Copy: destination `.strd` meaning (source `.strd`, source `.work` snapshot, unchanged D, absent, other) | None distinguishing options | Unknown | Could choose if device silent | **DEVICE_EVIDENCE_REQUIRED** (`COPY_SAVED_CHECKPOINT_SEMANTICS`) |
| Copy: `project.work` `[STATES] BANK` / `PATTERN` | No Bank Copy capture | Unknown | Copy might not require retarget | **DEVICE_EVIDENCE_REQUIRED** (Copy retarget); **NOT_APPLICABLE** until Copy roles proven |
| Move: vacated source slot A after A→D | No device Move; no empty-bank fixture norm | Unknown for firmware Move | PSE-2 Move is product operation | **OWNER_DECISION_REQUIRED** |
| Move: which roles move (Working only, SavedCheckpoint only, both) | Same-role listing only in domain | Unknown for device Move | Product must decide if device has no Move | **OWNER_DECISION_REQUIRED** (role set); paired with vacated source |
| Swap: same-role pairing sufficient as product semantics | Symmetry enforced in domain | Unknown (no device Swap capture) | Safe default vs full semantics | **OWNER_DECISION_REQUIRED** |
| Copy: active `[STATES] BANK` / `PATTERN` on native Bank Copy | No staged Bank Copy capture yet | Unknown until capture | Copy may not need retarget | **DEVICE_EVIDENCE_REQUIRED** |
| Move/Swap: active `[STATES] BANK` follow contents vs stay on index | No firmware Move/Swap | N/A (product-only ops) | MasterOCTa UX / safety | **OWNER_DECISION_REQUIRED** |
| `[STATES] PATTERN` when BANK changes (Copy) | `bank_b_pattern_4` shows separate fields only | Unknown | — | **DEVICE_EVIDENCE_REQUIRED** (with Copy capture) |
| `[STATES] PATTERN` when BANK changes (Move/Swap) | No device Move/Swap | N/A | Product policy | **OWNER_DECISION_REQUIRED** |
| Copy / Swap: same-role only; no cross-role mapping | `validate_swap_role_pairings`; Copy lists per-role destinations | Swap enforced in domain | Copy listing convention | **ALREADY_PROVEN** (Copy + Swap constraints only) |
| Move: same-role only; no cross-role mapping | Move lists union of roles; **no** Move role-pair validator in domain | N/A | Must decide + later contract | **OWNER_DECISION_REQUIRED** (not ALREADY_PROVEN) |
| Swap asymmetric role presence → block | Domain + tests | N/A | Fail-closed | **ALREADY_PROVEN** (Swap constraint) |
| Bank internal identity / byte rewrite | #221 | Separate issue | Separate issue | **NOT_APPLICABLE** (see #221) |
| Scene / Recorder / Arranger in bank bytes | Unmodeled gaps | — | — | **NOT_APPLICABLE** (fail-closed; do not expand decoders here) |

## Copy

### Questions

| Symbol | Result |
| --- | --- |
| `COPY_WORKING_ROLE` | **DEVICE_EVIDENCE_REQUIRED** |
| `COPY_SAVED_CHECKPOINT_ROLE` | **DEVICE_EVIDENCE_REQUIRED** |
| `COPY_PROJECT_STATE_EFFECT` | **NOT_APPLICABLE** (no accepted Copy retarget or role rule) |

### Facts (not Bank Copy semantics)

- Legacy disabled writer: read source `.work` else `.strd`; write destination `.work` only — implementation history only.
- Pattern Paste (`P_BANK_PERSIST`, #227): paste step unchanged `bank02` files; `.work` first changes on control-bank switch; `.strd` on Project Save — **Pattern Paste persistence**, not Copy A→D.

### SavedCheckpoint on Copy

When copying Bank A → D, whether `D.strd` becomes A's `.strd`, A's working snapshot, prior D `.strd`, absent, or another derived state is **unresolved**. Existing #221 captures were taken after save (and sometimes reload), with `.work` byte-equal to `.strd` at capture time, so they do not separate copy-immediate role writes from save consolidation.

`CopySavedCheckpointSemantics::Unknown` remains; do not change until one outcome is legitimately accepted.

## Move

### Vacated source (`MOVE_VACATED_SOURCE`)

After Move A → D, what A becomes (empty template, files absent, initialized state, unchanged, device-defined other) is **OWNER_DECISION_REQUIRED**. No committed device Move evidence; BMS §16-1. Structure verify stays closed (`MoveVacatedSourceUndefined` in `ot_plan::bank_mutation`).

### Destination document roles

Same-role pairing for Move is **not** enforced like Swap (`validate_swap_role_pairings` is Swap-only). A future Move contract must add an explicit role-mapping rule or accept cross-role risk. Until then: which roles Move touches and whether cross-role mapping is forbidden are **OWNER_DECISION_REQUIRED** together with vacated source policy (BMS §16-1).

`MOVE_STATE_DOC_RULE` stays **BLOCKED**.

## Swap

Same-role symmetry (Working↔Working, SavedCheckpoint↔SavedCheckpoint), asymmetric presence blocked, cross-role rejected — **ALREADY_PROVEN** as safe constraints in [`bank_state_documents.rs`](../../src-tauri/crates/ot-domain/src/bank_state_documents.rs).

Whether that pairing is **fully sufficient product semantics** for Swap is **OWNER_DECISION_REQUIRED**. No device Swap capture exists.

`SWAP_STATE_DOC_RULE` stays **BLOCKED**.

## Active Bank and Pattern coupling

Working `project.work` `[STATES]`:

| Operation | `[STATES] BANK` | `[STATES] PATTERN` |
| --- | --- | --- |
| Copy (native on device) | **DEVICE_EVIDENCE_REQUIRED** | **DEVICE_EVIDENCE_REQUIRED** (Copy capture) |
| Move (PSE-2 product only) | **OWNER_DECISION_REQUIRED** | **OWNER_DECISION_REQUIRED** |
| Swap (PSE-2 product only) | **OWNER_DECISION_REQUIRED** | **OWNER_DECISION_REQUIRED** |

Firmware exposes native **Bank Copy**; it does not expose native Bank Move/Swap matching PSE-2. Unconditional **DEVICE_EVIDENCE_REQUIRED** on Move/Swap retarget would leave #217's close gate unsatisfiable without a product decision path.

Domain today: Copy → `ActiveBankRetarget::NotApplicable` in evaluator; Move/Swap active source or Swap destination → `Unknown`. That is **code default**, not accepted semantics.

Example (unresolved): active A, Pattern index 3; Move A → D — if BANK follows contents to D, whether PATTERN stays 3 is **unknown**.

`ACTIVE_BANK_RETARGET_RULE` stays **BLOCKED**.

## Owner decision plan (do not decide in code)

### Move vacated source (BMS §16-1)

| Option | Safety | ChangePlan | BMS whitelist | Verify | Recovery | Compatibility |
| --- | --- | --- | --- | --- | --- | --- |
| A: Empty bank template bytes at A | Wrong template corrupts slot; needs encoder evidence | Must list A `.work`/`.strd` as write targets | Only if paths whitelisted | Structure check needs defined template | Restore A from backup | Device reload may expect specific empty shape |
| B: Files absent at A | Safer if device omits files; presence gates differ | May delete or omit paths; manifest must reflect | Deletion policy | Vacated = absent predicate | Restore files from backup | Other banks unchanged; arranger refs to A? |
| C: Preserve A unchanged (not a true Move) | Mislabels operation | Plan would not match Move intent | N/A | Fails Move verify | N/A | Breaks user expectation of Move |

Owner must pick before `MOVE_STATE_DOC_RULE` can become `Ready`.

### Swap role rule completeness

| Option | Notes |
| --- | --- |
| Accept same-role swap only | Matches current domain; may omit device behaviors (e.g. selection side effects) |
| Require additional project-state or bank-byte rules | Needs #221 and active-bank evidence first |

## Device evidence plan (design only — not executed)

### `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1` (smallest next unit)

| Field | Value |
| --- | --- |
| Work ID | `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1` |
| Parent | #217 |
| Fixture | New disposable project (e.g. `P_BANK_COPY_STATE`) under `src-tauri/tests/fixtures/` after separate evidence Work ID approval |
| Device | Octatrack MkII, `R0173` / `1.40` |
| PRE | (1) Establish **distinct** source Working vs SavedCheckpoint on bank A: after baseline Project Save, apply a **working-only** edit on bank A (no Save), then **verify on the acquisition path** that `bankA.work` ≠ `bankA.strd` (typed or raw); if mount shows equality, stop — do not attribute Copy SavedCheckpoint semantics. (2) Record distinct **destination sentinel** on bank D (known prior `bankD.work` / `bankD.strd` hashes). (3) Record `[STATES] BANK`, `PATTERN`. (4) Hash `bankA`, `bankB`, `bankD` `.work`/`.strd`, **`project.work` and `project.strd`**. (5) Record `capture_transport` for PRE acquisition. |
| Operation | Native **Bank Copy** A → D (menu labels recorded in manifest) |
| POST stages | (1) Immediately after copy, **before** bank switch or Project Save; (2) After switch to control bank not A/D; (3) After explicit Project Save; (4) Optional reload + UI sentinel. **Record `capture_transport` per stage** (same rule as [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md): unknown transport blocks generalizing Working/SavedCheckpoint timing). Prefer acquisition that does not flush device state (if USB disk mode / CF mount mutates, document and treat stage attribution as **inconclusive**). |
| UI sentinel | Destination bank/pattern visible state at each stage |
| Files | All compared bank files + `project.work` + **`project.strd`** at **every** stage (including PRE) |
| Manifest | `masterocta.pse-bank-copy-state-doc-capture:v1` (to be defined in that Work ID); per-stage `capture_transport` required for promotion |
| Success | PRE proved `bankA.work` ≠ `bankA.strd`; per-stage transport recorded and non-mutating **or** attribution qualified; first **operation-attributable** divergence identifies Copy role writes; destination `.strd` provenance classifiable vs source `.work` vs source `.strd` vs prior D |
| Inconclusive | PRE could not seed distinct source roles; copy not isolated from immediate save; unknown or state-mutating `capture_transport`; CF mount hides pre-save `.work` divergence (#219 E/F); immediate `project.strd` change with no PRE baseline |

### Optional follow-ups (only if one sequence cannot cover)

| Work ID | When |
| --- | --- |
| `MO-PSE-BANK-ACTIVE-RETARGET-DEVICE-EVIDENCE-1` | After Copy role timing known; Move/Swap may be **product-only** — capture only if firmware exposes Move/Swap |
| `MO-PSE-BANK-MOVE-STATE-DOC-DEVICE-EVIDENCE-1` | Only if device Move exists and disposable test authorized |
| `MO-PSE-BANK-SWAP-STATE-DOC-DEVICE-EVIDENCE-1` | Only if device Swap exists and disposable test authorized |

Do not merge Copy + active retarget if Copy-immediate stages already answer both.

## Readiness granularity

`ReadinessGap::WorkingSavedCheckpointRule` is one gap for Copy, Move, and Swap. This work resolves **classification** only; partial resolution per operation is valid in documentation, but the gap stays **OPEN** until the readiness model's scope is fully satisfied or a future contract change splits the gap.

`READINESS_GRANULARITY_MISMATCH = YES` — documented; no `ReadinessGap` redesign in this Work ID.

## #181 re-audit

| #181 row | Status after this work |
| --- | --- |
| affected files | **PARTIAL** — candidates + manifest completeness (#234); final affected set needs Copy/Move/Swap semantics above |
| Other closeout rows | Unchanged from [`PSE_BANK_CHANGEPLAN_CLOSEOUT.md`](./PSE_BANK_CHANGEPLAN_CLOSEOUT.md) |

`ISSUE_181_CLOSE_READY = NO`

## #217 close gate

#217 may close only when Working/SavedCheckpoint rules are resolved for Copy, Move, and Swap **and** active-bank handling is resolved (device evidence for Copy; **owner decisions** for product-only Move/Swap retarget) or split to a tracked successor with narrowed #217 scope.

Neither condition is met. `ISSUE_217_CLOSE_READY = NO`

## #221 separation

Resolving state-document **roles** does not resolve bank **internal identity** or byte rewrite correctness. `ReadinessGap::BankInternalIdentity` stays open. Do not infer byte-for-byte copy from semantics.

## Domain contract changes (this Work ID)

**None.** `COPY_STATE_DOC_RULE`, `MOVE_STATE_DOC_RULE`, `SWAP_STATE_DOC_RULE`, `ACTIVE_BANK_RETARGET_RULE` remain `Blocked`. `CopySavedCheckpointSemantics::Unknown`, `ActiveBankRetarget::Unknown` unchanged. `ReadinessEvidence::current_main()` unchanged.

## Tests

No new tests encoding unresolved choices. Existing `ot-domain` / `ot-plan` coverage for blocked rules, swap symmetry, and unknown semantics remains authoritative.

## Safety

```text
READ_ONLY = YES
WRITE_TO_OCTATRACK_MEDIA = NO
BANK_ENCODER = NO
PREPARE = NO
APPLY = NO
LEGACY_BANK_WRITER = DISABLED
```

## Related docs (unchanged history)

- [`PSE_BANK_STATE_DOC_SEMANTICS.md`](./PSE_BANK_STATE_DOC_SEMANTICS.md) — semantics-1 audit (still valid as historical contract baseline)
- [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md) — not edited
