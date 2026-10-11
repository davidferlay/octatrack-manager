# Development status (canonical)

- Work ID: `MO-M7-FINAL-EXIT-AUDIT-1`; prior: `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-5`
- Updated: 2026-10-06 (M7 **COMPLETE**; final audit @ `8bedd19c`)
- Product baseline: GitHub `origin/main` **`8bedd19cddb7cf2a498d0b8ff74fa729720d2c5d`**
- Integrated Native session 5 @ **`40ba99c4`**: [`M7_INTEGRATED_NATIVE_ACCEPTANCE_5.md`](../testing/M7_INTEGRATED_NATIVE_ACCEPTANCE_5.md) **PASS**. Session 4 @ **`a84433c0`** and session 3 @ **`04725cb3`** stay historical **STOP** records.

Milestone **numbers and names:** [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md).
Architecture **principles:** [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md).
**M7 completion map:** [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md).

## Status vocabulary

| Label | Meaning |
| --- | --- |
| **COMPLETE** | Exit criteria met for this row’s scope on `main`, including agreed acceptance where applicable |
| **READY_FOR_FINAL_ACCEPTANCE** | Exit Gate **implementation** on `main`; remaining gap is required operator/Native only. **Explicitly DEFERRED** WPs (documented in [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md)) do not count as missing. Exit Gate rows still **PARTIAL** (e.g. stereo UI) prevent this label |
| **IMPLEMENTED_NOT_FULLY_ACCEPTED** | Merged to `main`; automated tests may pass; native/hardware/operator acceptance incomplete |
| **IN_PROGRESS** | Partial delivery on `main`; material WPs remain |
| **PLANNED** | Defined in v0.1; no substantial `main` implementation |
| **DEFERRED** | Explicitly postponed (not a blocker for current track) |
| **UNDOCUMENTED** | Not specified in ingested v0.1 text |

Do **not** conflate: code exists · merged to `main` · CI/automated tests · native acceptance · hardware acceptance.

## Current reconciliation snapshot (2026-10-06)

Final audit baseline **`8bedd19c`**. Integrated Native session 5 at execution SHA **`40ba99c4`** is **PASS** ([`M7_INTEGRATED_NATIVE_ACCEPTANCE_5.md`](../testing/M7_INTEGRATED_NATIVE_ACCEPTANCE_5.md)). **M7 Exit Gate = 5/5 PASS**. **M7 = COMPLETE**. M7-07 and M7-08 remain **DEFERRED** to M11. Issue #177 closed after INT5 canonical merge (#215). **M6** stays **IN_PROGRESS** independently.

## Historical reconciliation snapshot (session 4, 2026-10-06)

Product `main` was **`a84433c04e392e4463a19ae80f2c0745e8b6c59f`**. Integrated Native **session 4**
[`M7_INTEGRATED_NATIVE_ACCEPTANCE_4.md`](../testing/M7_INTEGRATED_NATIVE_ACCEPTANCE_4.md)
**STOP_WITH_FINDINGS** (A14 **NOT_RUN**; B02/B03 **NOT_RUN**). That file is not rewritten.

## Historical reconciliation snapshot (2026-09-28)

Product `main` was **`04725cb3`** (PR #170). Integrated Native **session 3**
[`M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md`](../testing/M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md)
**STOP_WITH_FINDINGS** on execution baseline **`04725cb3`** (**A01** / **B01** **PASS**; **A02–A15** / **B02–B03** operator **NOT_RUN**). That file remains the frozen session 3 record.

## Historical GitHub audit snapshot (M7 exit audit, 2026-09-21)

```text
origin/main:     37f86c9603e74bbb59735a98fa79dc51d888ec24
PR #154:         MERGED
#154 final head: 6a5ec66b9be48de37613240b262a3f352cadcc9b
#154 merge SHA:  37f86c9603e74bbb59735a98fa79dc51d888ec24
open PRs:        none (2026-09-21)
CI (#154 push):  success — run 35545049683
catalog schema:  13
```

Historical WFM2 snapshot (`#145` / `95ca4cb`) remains valid for cache implementation. See [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §1–3.

---

## Milestone summary

| Milestone | Status | Summary |
| --- | --- | --- |
| **M5** | **COMPLETE** | Gate C PASS (personal/local); rename/reference-safe; RC8 ledger frozen |
| **M6** | **IN_PROGRESS** | Library workspace largely merged; M6-06/M6-08 vs v0.1 exit gaps |
| **M7** | **COMPLETE** | Exit Gate **5/5 PASS**; Integrated Native session 5 **PASS** @ `40ba99c4`. M7-01–M7-06 **COMPLETE**; M7-07/08 **DEFERRED** (M11). See [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) |
| **M8** | **PLANNED** | No PerformanceSession / MockNode on `main` |
| **M9** | **PLANNED** | No OCTA-node prototype in repo |
| **M10** | **PLANNED** | — |
| **M11** | **PLANNED** | Slice `.ot`/media Apply not started |

Public distribution / signing / notarization: **NOT AUTHORIZED** (unchanged).

---

## M5 — Safety / Gate C Completion

| Dimension | Status | Evidence |
| --- | --- | --- |
| Domain / merge | **COMPLETE** | M5-A/B/C/C5 PRs; #82 recovery/mutation gate |
| Gate C (personal/local) | **COMPLETE** | [`../testing/GATE_C_RC_LEDGER.md`](../testing/GATE_C_RC_LEDGER.md) §RC8 — **do not re-evaluate or edit** |
| Human Gate C | **COMPLETE** | Formal continuous trial documented; RC7 Prepare STOP remains historical |
| Public release | **NOT AUTHORIZED** | Separate from M5 COMPLETE |

---

## M6 — Library Workspace & AudioAsset Foundation

Judged by **responsibility**, not exact v0.1 widget names.

| WP | Status | Main merge / evidence | Automated | Native / operator | Notes |
| --- | --- | --- | --- | --- | --- |
| M6-01 AppShell | **COMPLETE** | #122, #132 | CI on merges | [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) PASS (post-#142 doc) | Five-region shell |
| M6-02 Top Context Bar | **COMPLETE** | #122, #132 | CI | Native doc | Context bar + root panel |
| M6-03 Navigation Pane | **COMPLETE** | #132 | CI | Native doc | Location nav |
| M6-04 Sample Browser v2 | **COMPLETE** | #122, #132 | CI + frontend tests | Native doc | Search/sort/pagination |
| M6-05 Sample Inspector v2 | **COMPLETE** | #133, #135, #138 | CI | Native doc | Tabbed inspector + slice workspace |
| M6-06 Operation Modal | **IMPLEMENTED_NOT_FULLY_ACCEPTED** | #134 Operations **Drawer** (not modal) | CI | — | v0.1 exit: remove always-visible prepared-operation panel. **Gate C rename/clone/copy still uses Change Drawer** (`RenameOperatorPanel` etc.). Drawer consolidates low-frequency ops; not identical to v0.1 “Operation Modal” acceptance |
| M6-07 AudioAsset baseline | **COMPLETE** | M3-C1 #13 (`AudioAsset` / `FileInstance`) | Catalog tests | — | v0.1 “migration-free read” satisfied via existing catalog |
| M6-08 keyboard / resize / persisted UI | **IN_PROGRESS** | Resize/split (#132, #139–#140); keyboard partial | CI | Narrow layout verified #140 | **Pane persistence to localStorage** not evidenced as M6-08 complete |

**M6 exit gate (v0.1):** Partially met; **M6-06** and **M6-08** prevent calling M6 **COMPLETE**.

---

## M7 — Waveform v2 & Audio Analysis

| WP | Status | Main merge / evidence | Automated | Native | Notes |
| --- | --- | --- | --- | --- | --- |
| M7-01 waveform query model | **COMPLETE** | #124 | CI + ot-audio tests | N/A | `v2_audio_waveform_query`. Audit: [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §4 |
| M7-02 multi-resolution cache (WFM2) | **COMPLETE** | #145 (`820183b`) | CI + `wfm2`/`waveform_v2` tests (see MO_M7_WFM2 doc) | **NOT_RUN** | Native NOT_RUN is completion quality, not Exit Gate. Fail-closed truncated header; invalid peak regen; warm path uses header/table + seek peak reads |
| M7-03 stereo/channel representation | **COMPLETE** | #124, #145, #161 (`3379b9d`) | Tests + lane UI tests | **PASS** (session 5) | Session 5 B01–B03 **PASS**; independent L/R lanes |
| M7-04 zoom / range / scroll UI | **COMPLETE** | #129, #130 | CI + frontend tests + zoom E2E | PARTIAL | Button zoom/pan/drag range. **Canvas is a WAVEFORM_V2 follow-on, not v0.1 Exit Gate** |
| M7-05 transient analysis | **COMPLETE** | #102, #131, #141/#142 | Rust/UI/E2E | **PASS** (session 5) | Session 5 A13 and A14 **PASS**. 100-clip / `.ot` are Auto Slice / M11 |
| M7-06 derived AudioAsset framework | **COMPLETE** | #147–#154 (`37f86c9`) | ot-domain / ot-catalog v13 / lineage query IPC / Inspector Info / export E2E | **PASS** (session 5) | Session 5 export, lineage, retry, original SHA, A14 relaunch **PASS** |
| M7-07 stem separation adapter spike | **DEFERRED** | enum `STEM` / `StemRole` only | — | — | Not in v0.1 Exit Gate; spike deferred to **M11 prep** (enum-only ≠ spike). See audit §11 |
| M7-08 optional stem separation workflow | **DEFERRED** | — | — | — | Optional WP; production stem is **M11**. Not an M7 exit blocker |

**M7 exit gate (v0.1):** **5/5 PASS** (final audit 2026-10-06). Integrated Native session 5 **PASS**. Full matrix: [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §13–14.

---

## M8 – M11

| Milestone | Status | Notes |
| --- | --- | --- |
| M8 Performance Domain & Node Protocol | **PLANNED** | v0.1 §17; no `MockNode` / Performance workspace in product tree |
| M9 OCTA-node Prototype | **PLANNED** | Hardware/software prototype out of repo |
| M10 Integrated Performance System | **PLANNED** | — |
| M11 Advanced Sample Preparation | **PLANNED** | Partial overlap with Auto Slice **analysis UI** only |

---

## Auto Slice (cross-cutting; not a separate milestone ID)

Boundary on `main` per [`AUTO_SLICE_1_IMPLEMENTATION_STATUS.md`](./AUTO_SLICE_1_IMPLEMENTATION_STATUS.md):

| Capability | Status |
| --- | --- |
| Detect attacks / candidates / draft apply / manual edit / preview | **On main** (#102, slice workbench) |
| Library range → analysis (#131) | **Merged** |
| Analysis session recovery (#141/#142) | **Merged** |
| Draft SQLite persistence | **On main** |
| `.ot` output / Intent→Plan→Apply media Apply | **NOT_STARTED** |
| Real music corpus evaluation (100 clips) | **NOT_STARTED** |
| AS-1 disk snapshot / cache budget | **NOT_STARTED** |

**Do not** equate “Slice UI exists” with “Octatrack-safe `.ot` generation/apply”.

---

## PR map (#122–#154, selected)

| PR | Theme |
| --- | --- |
| #122 | M6 library layout |
| #124 | M7-01 v2 waveform query |
| #127 | Range preview |
| #128–#130 | i18n, pane resolution, zoom/range |
| #131 | Range→slice analysis |
| #132–#133 | Workspace foundation, inspector migration |
| #134 | Operations drawer (M6-06 partial) |
| #135–#140 | Slice workspace, native acceptance, layout fixes |
| #141–#142 | Slice analysis session recovery |
| #143–#144 | Native acceptance harness docs |
| #145 | M7-02 WFM2 multi-res cache |
| #147–#151 | M7-06 lineage + TRIM generation / verify |
| #152–#153 | Slice Draft → `SLICE_EXPORT` + UI |
| #154 | Lineage query IPC + Inspector Info |

#103 / #104 / #105 remain **closed** — do not reopen.

---

## Dependency chain (current)

```text
M5 (COMPLETE)
  → M6 Library shell (IN_PROGRESS)
  → M7 WF2 + analysis (COMPLETE)
  → safe sample/slice `.ot` output (PLANNED / M11)
  → M7-07/08 stem (DEFERRED → M11)
  → M8 MockNode + protocol (PLANNED)
  → M9 hardware → M10 integration
```

Aligned with v0.1 §23; stem separation does not precede M7-06 without explicit replan.

---

## Recommended next product Work ID

**M7 follow-up:** none required for milestone closure.

**Next canonical milestone:** M8 Performance Domain & Node Protocol.

**Independent active track:** Project Structure / Bank Editor (PSE).

**Not M7 blockers:** Canvas renderer, dedicated WFM2 Native, 100-clip corpus, mac_derived injection, `.ot` Apply (M11 / post-M7 quality).

**Historical:** session 3 remains
[`M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md`](../testing/M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md)
at **`04725cb3`**. Do not rewrite it.

**Dependencies:** M5 COMPLETE; #160 on `main`; Gate C boundaries unchanged.

**Secondary (not next):** Auto Slice 100-clip quality; WFM2 dedicated Native; stem adapter spike; Canvas renderer. See [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §15–17.

**Proposed product track (not a Work ID, not next on `main`):** [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md) (`MO-PSE-DESIGN-1`). Octatrack Project structure viewer and, later, Bank/Pattern/Part/Scene operations. First slice stops at a read-only viewer plus Bank ChangePlans. No Apply. Separate worktree from M7. Does not allocate an M5–M11 number.

- `MO-PSE-READ-MODEL-1` (B1, first unit): read-only `ot_domain::project_structure` plus a backend adapter reading `bankNN.work` / `bankNN.strd` as separate entries (Pattern→Part, Part→Track machine→slot). Fixture tests only; no Tauri command, DTO, UI, catalog migration, or write path. Scene / Arranger / Recorder are listed as unmodeled dependencies. Arranger references to Banks are the main unknown for later Bank Move/Swap plans.
- `MO-PSE-CI-FOUNDATION-1` (#191): Read-only Project Structure CI / fixture gate. See [`../testing/PSE_CI_FOUNDATION.md`](../testing/PSE_CI_FOUNDATION.md). Does not authorize Bank Apply.
- `MO-PSE-CI-FOUNDATION-2` (#191): `Bank Mutation Safety Guard` job inside the `Project Structure` aggregate. Static trip-wire: no write API in the Bank editor read path, Viewer IPC limited to `v2_project_structure_read`, legacy Bank writes stay disabled. ChangePlan / Mutation gates are a machine-checked ledger, all BLOCKED on #181 / #182 / #183 / #184 / #185. Per-item #191 status is in `PSE_CI_FOUNDATION.md` §11. No ChangePlan, Apply, or contract.
- `MO-PSE-READ-MODEL-2`: `v2_project_structure_read(root_id, project_relative_path)` maps the B1 model to a DTO through RootRegistry. Slot DTO fields serialize camelCase. A missing path or a directory that is not an Octatrack project is `INVALID_PROJECT_PATH`. Bank files are opened once through a non-following descriptor that must stay inside the registered root; filesystem I/O failures are `PROJECT_STRUCTURE_UNAVAILABLE`, and decode failures stay `malformed` with no Pattern or Part values. `RootRegistryError::Unavailable` stays unrecoverable. No absolute paths, UI, ChangePlan, Arranger parser, or write. Arranger rows and whether a Bank file stores its own index remain unmodeled.
- `MO-PSE-PROJECT-STATE-READ-1` (#196, child of #179): Working `project.work` `[STATES]` is a project-level selection. `BANK` and `PATTERN` reuse `BankIndex` and `PatternIndex` (zero-based; out of range stays unrecognized). `ARRANGEMENT` stays raw and unmapped to `arr01`–`arr08`. `project.strd` is not a fallback. Compatibility reuses `evaluate_project_compatibility`, including the verified VERSION=19 / R0173 / 1.40 fixture. `project.work` is opened nonblocking and rejected when it is not a regular file or larger than 1 MiB. The DTO schema is `masterocta.project-structure:v2`. No Viewer, ChangePlan, Arranger row parser, Scene, or write.
- `MO-PSE-READ-MODEL-COMPLETENESS-1` (#198, child of #179): `MASTER_TRACK=1` makes Track 8 a master track and withholds its leftover slot. Pattern scale keeps normal and per-track modes. Per-track `INF` is the sentinel pair 255/255 and is not a step count. The DTO schema is `masterocta.project-structure:v3`. Arrangement mapping stays unknown. No Viewer or ChangePlan.
- `MO-PSE-READ-MODEL-EXIT-AUDIT-1`: docs-only audit on `59ee873`. #179's original read-model contract is met (`CLOSE_READY`). Viewer (#180) may start. Bank ChangePlan (#181) stays `NOT_READY`. See [`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md).
- `MO-PSE-BANK-MUTATION-CONTRACT-1` (#182): Bank mutation safety contract `masterocta.bank-mutation-contract:v1` in `ot_plan::bank_mutation`. Pure checks only: phase flow, sealed plan envelope, Apply entry permit, project-scope stale guard, a change-set whitelist of operated `bankNN.work` / `bankNN.strd` files, backup coverage, byte and structure verify, recovery to PRE. Samples outside the project directory are outside its manifest; #184 / #185 must check them. The #191 gate ledger points at the contract and maps gates to BMS rules; every gate stays BLOCKED. Contract tests run on TempDir fixture copies and are in the PSE inventory. No Apply, write API, or command. `APPLY_READINESS` stays `NOT_READY`: #181, the remaining audit §7C gaps (`ReadinessEvidence::current_main()` has six open gaps; `ArrangementFileSlot` resolved after #204 on proven OS only), and PSE-3 approval are open. See [`PSE_BANK_MUTATION_SAFETY_CONTRACT.md`](./PSE_BANK_MUTATION_SAFETY_CONTRACT.md) and [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md).
- `MO-PSE-BANK-INTERNAL-IDENTITY-1` ([#221](https://github.com/kaz4g/masterocta/issues/221), child of #181): A/B/C/E/F raw + typed Bank internal identity audit on pinned `ot-tools-io` `cd246d8…`. `BANK_INTERNAL_IDENTITY = UNKNOWN` (unresolved slot-correlated offset 585459; no same-content/different-slot device capture). Read-only tests + symlink-safe reads + [`scripts/pse-bank-internal-identity-audit.mjs`](../scripts/pse-bank-internal-identity-audit.mjs); no write path. `ReadinessGap::BankInternalIdentity` stays open. See [PSE_BANK_INTERNAL_IDENTITY.md](./PSE_BANK_INTERNAL_IDENTITY.md).
- `MO-PSE-BANK-INTERNAL-IDENTITY-DEVICE-EVIDENCE-1` ([#221](https://github.com/kaz4g/masterocta/issues/221), child of #181): Disposable `P_BANK_ID` on Octatrack MkII OS 1.40 (R0173). Three saves, current bank raw `0` / `1` / `2`. Offset 585459 is `108` on `bank01`, `bank02`, and copied `bank03`, so the old slot candidate is excluded. Patterns match. Unsaved part 0 does not: Bank B track 7 main volume is 97 rather than 108, copied banks share unsaved part-parameter bytes, and Bank C `parts_edited_bitmask` is 0. No non-checksum byte takes three distinct slot values. `BANK_INTERNAL_IDENTITY = NO_INTERNAL_IDENTITY_OBSERVED`. Not `PROVEN_ABSENT`. `ReadinessGap::BankInternalIdentity` stays open. `BANK_CHANGEPLAN_READINESS` stays `NOT_READY`. **RESULT = STOP_WITH_FINDINGS**. Merged in #224. No Bank write path. See [PSE_BANK_INTERNAL_IDENTITY.md](./PSE_BANK_INTERNAL_IDENTITY.md) §11.
- `MO-PSE-BANK-INTERNAL-IDENTITY-DEVICE-EVIDENCE-2` ([#221](https://github.com/kaz4g/masterocta/issues/221), child of #181): Disposable `P_BANK_ID2` on Octatrack MkII OS 1.40 (R0173). Device Bank Copy A → B/C, capture with **current bank D** (`BANK=3`). Saved parts, part names, and saved state match across `bank01`–`bank03`. Patterns and unsaved parts do not fully match (`parts_edited_bitmask` 1/0/0). Offset 585459 is `108` on all compared banks. `TYPED_CONTENT_EQUAL_A_B_C = NO`. `SAME_CONTENT = INSUFFICIENT`. `#221` stays open. **RESULT = STOP_WITH_FINDINGS**. See [PSE_BANK_INTERNAL_IDENTITY.md](./PSE_BANK_INTERNAL_IDENTITY.md) §12.
- `MO-PSE-BANK-INTERNAL-IDENTITY-CROSSOVER-1` ([#221](https://github.com/kaz4g/masterocta/issues/221), child of #181): Disposable `P_BANK_XA` / `P_BANK_XB` on Octatrack MkII OS 1.40 (R0173), current bank D. Run A (B then C) changes `patterns` on Bank B and Bank C together; Run A post keeps B/C raw and typed equal. Run B PRE equals POST on all compared banks, so `RUN_B_COPY_EFFECT_OBSERVED = NO` and reversed-order negative evidence stays `INSUFFICIENT`. Bank D runtime control is `PRESENT`. Absolute B/C/B-D/C-D comparison finds no stable slot field. `BANK_INTERNAL_IDENTITY = UNKNOWN`. `#221` stays open. `BANK_CHANGEPLAN_READINESS` stays `NOT_READY`. **RESULT = STOP_WITH_FINDINGS**. See [PSE_BANK_INTERNAL_IDENTITY.md](./PSE_BANK_INTERNAL_IDENTITY.md) §13.
- `MO-PSE-BANK-REAL-DEVICE-FIXTURE-1` ([#219](https://github.com/kaz4g/masterocta/issues/219), child of #181): A/B/C/E/F real-device captures committed under `pse_bank_multi_device/` (Capture D optional, `NOT_RUN`). UI Bank/Pattern ↔ raw/file mapping evidence added; E/F did not fully resolve Working/SavedCheckpoint semantics on mounted CF. **RESULT = STOP_WITH_FINDINGS** (remaining semantic unknowns). [PSE_BANK_MULTI_DEVICE_EVIDENCE.md](./PSE_BANK_MULTI_DEVICE_EVIDENCE.md). No synthetic bank edit, Apply, or ChangePlan. `BANK_CHANGEPLAN_READINESS` stays **NOT_READY**.
- `MO-PSE-PROJECT-STATE-ARRANGEMENT-1` ([#204](https://github.com/kaz4g/masterocta/issues/204), child of #181): Disposable `P_ARR_TEST` on Octatrack MkII OS 1.40 (R0173) maps UI Arrangement 1 / 2 / 8 to `[STATES] ARRANGEMENT` raw `0` / `1` / `7` and to `arr01.work` / `arr02.work` / `arr08.work` (`ARR1-TEST`, `ARR2-TEST`, `ARR8-TEST`). That mapping is applied only for revision `R0173` and release `1.40`. Other supported versions, including OS 1.40B, stay `Unrecognized`. Out of range stays `Unrecognized`. DTO schema is `masterocta.project-structure:v4`. `ARRANGEMENT_MODE` stays unmodeled. `ARRANGEMENT_MAPPING = PROVEN` for that OS only. `PROJECT_STATE_READ = COMPLETE`. `BANK_CHANGEPLAN_READINESS` stays `NOT_READY` (Arranger `pattern_id`, Working/SavedCheckpoint, active retarget, Scene/Recorder, bank internal identity). No Apply.
- `MO-PSE-BANK-STATE-DOC-SEMANTICS-1` ([#217](https://github.com/kaz4g/masterocta/issues/217), child of #181): read-only audit of `bankNN.work`, `bankNN.strd`, and Working `project.work` `[STATES] BANK` / `PATTERN` for Copy / Move / Swap prerequisites. Pure contract in `ot_domain::bank_state_documents` (presence, deterministic candidate paths, blocked operation rules). `COPY/MOVE/SWAP/ACTIVE_BANK_RETARGET` rules stay **BLOCKED**; `ReadinessGap::WorkingSavedCheckpointRule` unchanged. `ISSUE_183_STATE_MISMATCH = YES` documented. No ChangePlan, Apply, encoder, or legacy writer enablement. See [`PSE_BANK_STATE_DOC_SEMANTICS.md`](./PSE_BANK_STATE_DOC_SEMANTICS.md).
- `MO-PSE-CROSS-BANK-PATTERN-PASTE-PERSISTENCE-1` (legacy `MO-PSE-BANK-COPY-PERSISTENCE-1`, [#217](https://github.com/kaz4g/masterocta/issues/217), child of #181): Disposable `P_BANK_PERSIST` on Octatrack MkII OS `R0173` / `1.40`. Operator-confirmed Pattern A01 Copy → Bank B / Pattern B01 select → Pattern Paste. S2 UI sentinel confirms the paste. `bank02` `.work` and `.strd` are unchanged across the paste itself; `.work` first changes at the switch to Bank D (`patterns` only) and `.strd` first changes at project save (`patterns` only). S3 working patterns match S4 saved patterns. Transport and post-reload UI sentinel were not recorded. **CROSS_BANK_PATTERN_PASTE_PERSISTENCE = OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE**. **COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN**. `#217` **OPEN**, `#221` **OPEN**, `BANK_CHANGEPLAN_READINESS` **NOT_READY**. After #228, promotion was blocked until S4 `save_operation` was recorded (see correction Work ID below). No Apply. See [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md).
- `MO-PSE-PATTERN-PASTE-S4-SAVE-METADATA-CORRECTION-1` ([#217](https://github.com/kaz4g/masterocta/issues/217), post-#228): Metadata-only correction on committed #227 captures. Operator-confirmed S4 explicit Project Save recorded as `save_operation = Explicit project save`; S4 manifest rebuilt; all six manifests verify; device `.work`/`.strd` bytes unchanged. **DEVICE_EVIDENCE_PROMOTION = ALLOWED**, **DEVICE_CAPTURE = PASS**. Transport and reload UI sentinel stay **UNKNOWN**; `#217`/`#221` **OPEN**; `BANK_CHANGEPLAN_READINESS` **NOT_READY**. **RESULT = EVIDENCE_PROMOTION_RESTORED**. No Apply. See [`PSE_PATTERN_PASTE_PERSISTENCE.md`](./PSE_PATTERN_PASTE_PERSISTENCE.md).
- `MO-PSE-BANK-CHANGEPLAN-READINESS-RECONCILIATION-1` ([#181](https://github.com/kaz4g/masterocta/issues/181), post-#227): Docs/tests only on `main` @ `4b33a524`. Recalculates blockers: #204/#210 removed from remaining lists; `ReadinessEvidence::current_main()` still has 6 open gaps. **CHANGEPLAN_IMPLEMENTATION_READINESS = READY** → next `MO-PSE-BANK-CHANGEPLAN-CORE-1` (read-only planner, no Apply). **CHANGEPLAN_EXECUTION_READINESS = NOT_READY**; `BANK_CHANGEPLAN_READINESS` stays **NOT_READY**. See [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md).
- `MO-INTEGRATION-SLOT-ASSET-BOUNDARY-1` (#187): Sample Slot ↔ AudioAsset ownership contract. The Project side owns Project / Bank / Pattern / Part / Track / Sample Slot Reference and holds slot references only. The Sample side owns Library / AudioAsset / FileInstance / Waveform / Slice / Derived AudioAsset, lineage, and hash. Cross-line regression tests are in the PSE inventory. No product change. Bank ChangePlan / Apply invariants stay pending. See [`SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md`](./SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md).

---

## M7-05 native acceptance re-audit (2026-09-20)

| Source | Overall | Scope |
| --- | --- | --- |
| [`M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md`](../testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md) | **NOT_COMPLETE** (historical) | #131 head `31ef6ca`; A–D **NOT_RUN** |
| [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) § post-#142 | **PASS** | `main` `0f39f50`; integrated workspace + slice/range |

**A–D mapping (integrated PASS):**

| ID | Original step | Superseded on `0f39f50`? |
| --- | --- | --- |
| A | Range preview Play + Stop | **Yes** — “Preview range” PASS |
| B | Analyze range; candidates vs attacks | **Yes** — analysis region, 2 candidates / 2 suppressed PASS |
| C | Apply candidates; draft + SQLite after quit | **Partial** — Apply + draft revision PASS; persistence verified via **file switch**, not documented post-quit `SELECT` |
| D | Range B → `ANALYSIS_REGION_MISMATCH` | **Yes** — fail-closed mismatch PASS |

**Conclusion (2026-09-21 review fix):** Do **not** treat M7-05 Native as **PASS**. Step C (post-quit draft persistence) was **Partial** only. Integrated Native session 3 (`MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-3`) must record quit + isolated-catalog `slice_drafts` evidence, after fixture re-registration, before M7-05 → **COMPLETE**. Keep `M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md` historical.

---

## Unresolved ambiguities

1. **M6-06:** Operations Drawer (#134) vs v0.1 Operation Modal vs Gate C Change Drawer — three UX surfaces coexist; document operator path in future UX ADR if consolidating.
2. **M6-08:** Persisted pane widths / workspace layout — no canonical acceptance doc marking COMPLETE.
3. **M7-04 Canvas:** **Resolved (2026-09-21 exit audit).** v0.1 Exit Gate does not name Canvas; WAVEFORM_V2 §13.2/§13.5 treats it as follow-on. M7-04 is **COMPLETE** with SVG/DOM zoom/pan/range. Canvas remains post-M7 quality unless a later ADR elevates it.
4. **`docs/OCTATRACK_PERFORMANCE_SYSTEM.md`:** Exists in user’s other clone but **not** on GitHub `main`; canonical ingest is `planning/sources/MASTA_OCTA_*_v0.1.md` only.
5. **ADR-015 / Performance System:** Referenced in WAVEFORM_V2 as draft only; not accepted in ADR_INDEX.

---

## Docs-only indexes

| Artifact | Path |
| --- | --- |
| Milestone numbers | [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md) |
| This status | [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) |
| M7 exit audit | [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) |
| ADR list | [`ADR_INDEX.md`](./ADR_INDEX.md) |
| v0.1 verbatim | [`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md) |
| Project structure proposal | [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md) (**PROPOSED**, design only) |
