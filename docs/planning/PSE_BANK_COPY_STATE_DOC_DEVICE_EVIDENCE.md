# Native Bank Copy state-document device evidence

Work ID: `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
Classification parent: [`PSE_BANK_STATE_DOC_SEMANTICS_2.md`](./PSE_BANK_STATE_DOC_SEMANTICS_2.md)

Base SHA: [`4eaf4ce9d3421786cd2c058bcb0333398522498a`](https://github.com/kaz4g/masterocta/commit/4eaf4ce9d3421786cd2c058bcb0333398522498a) (`main` after PR #235)

## Judgment (Phase B — operator capture analyzed)

Operator-local bytes: `~/octa-captures/P_BANK_COPY_STATE/` (not committed). S3/S4/S5
re-captured after correcting control-bank selection (2026-10-19).

```text
DISPOSABLE_PROJECT = P_BANK_COPY_STATE
REPO_FIXTURE_ROOT = src-tauri/tests/fixtures/pse_bank_copy_state_doc/  (still empty receptacle)
OPERATOR_CAPTURE_ROOT = ~/octa-captures/P_BANK_COPY_STATE/

DEVICE_CAPTURE = PASS
DEVICE_EVIDENCE_PROMOTION = ALLOWED
RESULT = READY_FOR_REVIEW
CAPTURE_TRANSPORT_CONFIDENCE = PROVEN_NON_MUTATING
PRE_SOURCE_WORK_STRD_DIVERGENCE = PASS
IMMEDIATE_COPY_TIMING_ATTRIBUTION = PASS

COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED
COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN

READINESS_GAP_WORKING_SAVEDCHECKPOINT = OPEN
ISSUE_217_CLOSE_READY = NO
ISSUE_221 = OPEN
APPLY_AUTHORIZED = NO
MASTER_OCTA_FILESYSTEM_WRITE = NO
```

Full hash-level transition matrix:
[`PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md`](./PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md)
(operator copy also at `~/octa-captures/P_BANK_COPY_STATE/EVIDENCE_PHASE_B_MATRIX.md`).

Domain rules stay **BLOCKED** until owner review of matrix + provenance (`dest_*_provenance =
DERIVED_OTHER` on this run). Repo fixture tree remains without device bytes.

## Scope

Answer on disposable Octatrack MkII (`R0173` / `1.40`) only:

1. Native **Bank Copy A → D** — which destination roles change (`bank04.work`, `bank04.strd`)?
2. If `bank04.strd` changes — provenance vs source `.work`, source `.strd`, prior destination, or other?
3. Effect on `project.work` `[STATES] BANK` / `PATTERN`?
4. First attributable persistence transition: `NATIVE_BANK_COPY`, `CONTROL_SWITCH`, `PROJECT_SAVE`, `PROJECT_RELOAD`?

Not in scope: MasterOCTa Apply, Bank writer, #221 internal identity resolution.

## Bank roles (fixed)

| UI | File index | Role |
| --- | --- | --- |
| A | `bank01` | Source |
| B | `bank02` | Control (switch target) |
| C | `bank03` | Untouched negative control |
| D | `bank04` | Destination |

Do not reuse [`pse_bank_copy_persistence/`](../../src-tauri/tests/fixtures/pse_bank_copy_persistence/) (Pattern Paste, #227).

## Schemas

| Symbol | Value |
| --- | --- |
| `META_SCHEMA` | `masterocta.pse-bank-copy-state-doc-capture:v1` |
| `MANIFEST_SCHEMA` | `masterocta-pse-bank-copy-state-doc-manifest:v1` |
| `OPERATION_KIND` | `NATIVE_BANK_COPY` |

## Stages

| Stage | Directory | Semantics | Prior transition |
| --- | --- | --- | --- |
| S0 | `s0_baseline_saved` | `BASELINE_SAVED` | — |
| S1 | `s1_source_working_diverged_pre_copy` | `SOURCE_WORKING_DIVERGED_PRE_COPY` | `SOURCE_WORKING_ONLY_EDIT` |
| S2 | `s2_immediately_after_bank_copy` | `IMMEDIATE_NATIVE_BANK_COPY` | `NATIVE_BANK_COPY` |
| S3 | `s3_after_control_switch` | `CONTROL_SWITCH` | `CONTROL_SWITCH` |
| S4 | `s4_after_project_save` | `PROJECT_SAVE` | `PROJECT_SAVE` |
| S5 | `s5_after_project_reload` | `PROJECT_RELOAD` | `PROJECT_RELOAD` |

### S1 hard gate

After working-only edit on Bank A (no Project Save), **`bank01.work` MUST NOT equal `bank01.strd`** on the acquisition path. If equal: **STOP** — do not perform Bank Copy; record `PRE_SOURCE_ROLE_DIVERGENCE = NOT_PROVEN`.

### Transport

Every stage records `capture_transport`, `capture_required_mode_change`, `capture_may_flush_device_state` (non-empty, not `unknown`). If acquisition may flush device state, retain bytes but classify `IMMEDIATE_COPY_TIMING_ATTRIBUTION = INCONCLUSIVE` and do not promote Copy timing rules.

Do **not** assume USB disk mode, CF removal, power-off, or Mac mount is non-mutating.

## Harness

```bash
node scripts/pse-bank-copy-state-doc-device-evidence.mjs status
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze
node scripts/pse-bank-copy-state-doc-device-evidence.mjs write-manifest <stage>
node scripts/pse-bank-copy-state-doc-device-evidence.mjs verify-manifest <stage>
node scripts/pse-bank-copy-state-doc-device-evidence.mjs dataset
```

`write-manifest` updates `SHA256SUMS.json` only.

## Operator runbook (ordered)

A. Prepare disposable project **P_BANK_COPY_STATE** on Octatrack MkII (`R0173` / `1.40`).  
B. Establish distinguishable sentinels on Bank **A** (source) and Bank **D** (destination).  
C. Select source Bank **A** and a **non-zero** Pattern (preferred UI **A04**, raw `PATTERN=3` — record actual UI + raw).  
D. Explicit **Project Save** (baseline).  
E. Capture **S0** (+ `save_operation` text).  
F. Working-only edit on Bank **A** — **no Project Save** (+ `working_edit_operation`).  
G. Capture **S1**.  
H. Verify on acquisition path: **`bank01.work` ≠ `bank01.strd`**.  
I. If equality persists: **STOP** (do not copy).  
J. Native **Bank Copy A → D** (+ exact `copy_operation` free text).  
K. Capture **S2** before control switch / Save / Reload.  
L. Switch to control Bank **B** (+ `control_switch_operation`).  
M. Capture **S3**.  
N. Explicit **Project Save** (+ `save_operation`).  
O. Capture **S4**.  
P. **Project Reload** (recommended) (+ `reload_operation`).  
Q. Capture **S5** (binaries before extra UI navigation where practical).  
R. Record destination UI sentinel.  
S. Rebuild and verify all manifests; set `device_generated` / `capture_sequence_proven` only after operator confirmation.

## Phase B findings (summary)

| Question | Observation (this run) |
| --- | --- |
| Destination roles on Copy | `bank04.work` and `bank04.strd` both change on **NATIVE_BANK_COPY** (S1→S2). |
| First persistence transition | `dest_work_first_changed_at` / `dest_strd_first_changed_at` = **NATIVE_BANK_COPY**. |
| Byte provenance vs source | Classifier: `dest_work_provenance` / `dest_strd_provenance` = **DERIVED_OTHER** (not byte-equal to S2 source `.work` / `.strd` alone). |
| `project.work` BANK/PATTERN | After Copy: bank index moves to destination (**D**); pattern changes (S0/S1 **A04** → S2+ **A01**). Control switch (S3): **B** / **A01**. |
| Control bank `bank02` | No hash change on S2→S3 (`control_bank_immediate_change = NO`). |
| Save / Reload | S3→S4 and S4→S5: several bank files unchanged on hash matrix; see linked doc. |

Regenerate matrix after capture edits:

```bash
CAPTURE_ROOT=~/octa-captures/P_BANK_COPY_STATE
# from repo: node --input-type=module … analyzeBankCopyEvidence(CAPTURE_ROOT)
```

Move/Swap rules stay **BLOCKED**; `ReadinessGap::WorkingSavedCheckpointRule` stays **OPEN**.

## Safety

```text
WRITE = NO (MasterOCTa)
DEVICE_CAPTURE = WAITING_FOR_REAL_DEVICE
BANK_MUTATION_ENVELOPE = NO
APPLY = NO
```
