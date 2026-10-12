# Cross-bank Pattern Copy/Paste persistence

Work ID: `MO-PSE-CROSS-BANK-PATTERN-PASTE-PERSISTENCE-1`  
Legacy work ID: `MO-PSE-BANK-COPY-PERSISTENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
PR: [#227](https://github.com/kaz4g/masterocta/pull/227)

Originally scaffolded as `MO-PSE-BANK-COPY-PERSISTENCE-1`. Scope corrected before device-evidence promotion because the observed Octatrack operation is cross-bank Pattern Copy/Paste, not Bank Copy.

Disposable project: **`P_BANK_PERSIST`**. Operation:

1. Pattern **A01** Copy to clipboard
2. Select Bank **B** / Pattern **B01** (before paste)
3. Pattern Paste
4. Switch to control bank **D**
5. Explicit project save
6. Project reload, then capture files, then open B/B01 only to record the UI sentinel

This does not prove native Bank Copy. `COPY_STATE_DOC_RULE` stays **BLOCKED**. `COPY_SAVED_CHECKPOINT_SEMANTICS` stays **UNKNOWN**. `#217` and `#221` stay **OPEN**. `BANK_CHANGEPLAN_READINESS` stays **NOT_READY**.

## Stages

| Stage | Directory | Transition into the stage |
| --- | --- | --- |
| S0 | `s0_baseline_saved` | `BASELINE_SAVED` |
| S1 | `s1_destination_selected_before_paste` | `DESTINATION_SELECT_BEFORE_PASTE` |
| S2 | `s2_after_pattern_paste` | `PATTERN_PASTE` |
| S3 | `s3_after_control_switch` | `CONTROL_SWITCH` |
| S4 | `s4_after_project_save` | `PROJECT_SAVE` |
| S5 | `s5_after_project_reload` | `PROJECT_RELOAD` |

S0→S1 includes clipboard copy plus destination selection. It is not a pure bank switch and it is not Bank Copy.

S5 binaries are captured immediately after reload, before opening Bank B to check the sentinel. Record `destination_ui_sentinel_after_reload` in metadata after that UI check, then rebuild the manifest.

## Observed sequence on disposable `P_BANK_PERSIST`

Octatrack MkII, `project.work` OS evidence `R0173` / `1.40`. This is one observed cross-bank Pattern Paste sequence, not a firmware guarantee and not Bank Copy semantics.

Pattern Paste itself (S1→S2) left `bank02.work` and `bank02.strd` byte-identical, and the decoded destination fields were unchanged. `bank02.work` first changed when leaving Bank B for Bank D (`CONTROL_SWITCH`), and that typed delta is `patterns` only. `bank02.strd` first changed at explicit Project Save, again `patterns` only. The Pattern payload decoded from S3 `bank02.work` matches S4 `bank02.strd`.

`project.work` `[STATES] BANK` reads `0, 1, 1, 1, 3, 3` across S0–S5. `PATTERN` stays `0`. The control-bank value `3` first appears in `project.work` at Project Save.

Bank C and Bank D compared files did not change across the six stages. Capture transport was not recorded. The post-reload Bank B / Pattern B01 UI sentinel was not recorded, so reload survival stays `UNKNOWN`.

`CROSS_BANK_PATTERN_PASTE_PERSISTENCE = OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE`. `WORKING_CHECKPOINT_SEPARATION_OBSERVED = YES` for this sequence only. `COPY_SAVED_CHECKPOINT_SEMANTICS` stays **UNKNOWN**. `#217` and `#221` stay **OPEN**.

## Promotion

`device_generated` stays false until the operator confirms the capture sequence, OS, and the S2 sentinel, and the manifest is rebuilt. File bytes alone are not reclassified. An unrecorded `capture_transport` stays `unknown`: that blocks generalizing Working/SavedCheckpoint semantics and keeps `#217` open. It does not block promoting this one observed sequence. While sequence provenance is unproven and compared files are already on disk, status is `STOP_FOR_OPERATOR_CONFIRMATION` and `DEVICE_EVIDENCE_PROMOTION = BLOCKED`.

### Promotion gate hardening after #227 (2026-10-11)

S4 must contain a non-empty string `save_operation` recording the explicit
project-save operation. Missing, null, blank, or non-string values reject S4
and block promotion with `DEVICE_CAPTURE = REJECTED` and
`RESULT = STOP_WITH_FINDINGS`. Stage labels, `operator_note`, and `.strd`
changes are not substitutes; the harness does not infer or backfill metadata.
The field remains free text: no undocumented menu spelling is imposed.
Only S4 requires this record; other stages may retain their empty field.

Working `[STATES]` `BANK` and `PATTERN` must each occur exactly once and be
zero-based indices in `0..15`, consistent with the existing `BankIndex` and
`PatternIndex` domain. Out-of-domain values reject the capture.

Impact on the six committed #227 captures after #228: all manifests still
verify and selection values stay in range, but S4 had an empty
`save_operation`, so `DEVICE_EVIDENCE_PROMOTION` became `BLOCKED` until a
structured operator record was added. That gap was discovered by #228; it did
not invalidate the raw byte observations.

### S4 save_operation correction (`MO-PSE-PATTERN-PASTE-S4-SAVE-METADATA-CORRECTION-1`)

The operator had already confirmed the sequence S0 saved baseline → S1
destination B01 → S2 Pattern Paste → S3 switch to control Bank D → S4 explicit
Project Save → S5 Project Reload. Only the missing provenance field was
corrected: S4 `save_operation` is now the non-empty free-text
`Explicit project save` (no undocumented menu wording). S4
`SHA256SUMS.json` was rebuilt; all six manifests verify. Device-generated
`.work` / `.strd` bytes were not modified. `DEVICE_EVIDENCE_PROMOTION` is
`ALLOWED` and `DEVICE_CAPTURE` is `PASS` again.

Still unknown or unchanged: `capture_transport`, S5
`destination_ui_sentinel_after_reload`, `COPY_SAVED_CHECKPOINT_SEMANTICS`,
Bank Copy state-doc rules, `#217`, `#221`, and
`BANK_CHANGEPLAN_READINESS = NOT_READY`. No Bank Apply or ChangePlan is
enabled.

## Commands

```bash
node scripts/pse-pattern-paste-persistence.mjs status
node scripts/pse-pattern-paste-persistence.mjs analyze
node scripts/pse-pattern-paste-persistence.mjs write-manifest s0_baseline_saved
node scripts/pse-pattern-paste-persistence.mjs verify-manifest s0_baseline_saved
```

Fixture root remains `src-tauri/tests/fixtures/pse_bank_copy_persistence/` so existing local copies can be renamed in place. Schema is `masterocta.pse-pattern-paste-persistence-capture:v1`.
