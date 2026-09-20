# Development status (canonical)

- Work ID: `MO-DEVELOPMENT-PLAN-CANONICALIZATION-1`
- Updated: 2026-09-20
- Baseline: GitHub `origin/main` **`6a03deb687fc7d060aad9d75500a50d726f1d243`** (merge PR #146)

Milestone **numbers and names:** [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md).  
Architecture **principles:** [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md).

## Status vocabulary

| Label | Meaning |
| --- | --- |
| **COMPLETE** | Exit criteria met for this row’s scope on `main`, including agreed acceptance where applicable |
| **IMPLEMENTED_NOT_FULLY_ACCEPTED** | Merged to `main`; automated tests may pass; native/hardware/operator acceptance incomplete |
| **IN_PROGRESS** | Partial delivery on `main`; material WPs remain |
| **PLANNED** | Defined in v0.1; no substantial `main` implementation |
| **DEFERRED** | Explicitly postponed (not a blocker for current track) |
| **UNDOCUMENTED** | Not specified in ingested v0.1 text |

Do **not** conflate: code exists · merged to `main` · CI/automated tests · native acceptance · hardware acceptance.

## GitHub audit snapshot (start of canonicalization)

```text
origin/main:     95ca4cbda8fb3846fd41b892f705785b7bc23558
PR #145:         MERGED
#145 final head: 820183b5a7795302d960bc77cc43c7db62b65c44
#145 merge SHA:  95ca4cbda8fb3846fd41b892f705785b7bc23558
open PRs:        none (2026-09-20)
CI (#145 push):  success — run 35469399221
```

WFM2 implementation evidence: [`../testing/MO_M7_WFM2_MULTIRES_CACHE_1.md`](../testing/MO_M7_WFM2_MULTIRES_CACHE_1.md), `src-tauri/crates/ot-audio/src/wfm2.rs`, `waveform_v2.rs`.

---

## Milestone summary

| Milestone | Status | Summary |
| --- | --- | --- |
| **M5** | **COMPLETE** | Gate C PASS (personal/local); rename/reference-safe; RC8 ledger frozen |
| **M6** | **IN_PROGRESS** | Library workspace largely merged; M6-06/M6-08 vs v0.1 exit gaps |
| **M7** | **IN_PROGRESS** | WF2 query/cache/zoom/transient on main; derived asset/stem/Canvas open |
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
| M7-01 waveform query model | **COMPLETE** | #124 | CI + ot-audio tests | — | `v2_audio_waveform_query` |
| M7-02 multi-resolution cache (WFM2) | **COMPLETE** | #145 (`820183b`) | CI + `wfm2`/`waveform_v2` tests (see MO_M7_WFM2 doc) | **NOT_RUN** | Fail-closed truncated header; invalid peak regen; warm path uses header/table + seek peak reads; proportional buckets — verified on `main` |
| M7-03 stereo/channel representation | **COMPLETE** | #124 | Tests | — | Per-channel peaks in v2 query |
| M7-04 zoom / range / scroll UI | **IN_PROGRESS** | #129, #130 | CI + frontend tests | — | Button zoom/pan/drag range; **Canvas renderer / scroll** not implemented (WAVEFORM_V2 §13.5) |
| M7-05 transient analysis | **IMPLEMENTED_NOT_FULLY_ACCEPTED** | #102, #131, #141/#142 | Rust/UI tests | Range→slice native **PASS** on `main` `0f39f50` (integrated; see below) | Onsets + Library range→analysis. [`M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md`](../testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md) A–D **NOT_RUN** at #131 head is **superseded** by [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) post-#142. v0.1 “non-blocking job” for all analysis still open |
| M7-06 derived AudioAsset framework | **IN_PROGRESS** | #147 + `MO-M7-DERIVED-AUDIOASSET-2` (branch) | ot-domain / ot-catalog v13 / ot-audio / ot-application / integration test | — | Lineage (#147); Mac TRIM derived WAV → catalog `mac_derived` + lineage (no query IPC / operator UI) |
| M7-07 stem separation adapter spike | **PLANNED** | — | — | — | Explicitly out of AUTO-SLICE-1 scope |
| M7-08 optional stem separation workflow | **PLANNED** | — | — | — | — |

**M7 exit gate (v0.1):** Not met (M7-06+; Canvas optional in docs but width-driven WF2 largely met).

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

## PR map (#122–#145, selected)

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

#103 / #104 / #105 remain **closed** — do not reopen.

---

## Dependency chain (current)

```text
M5 (COMPLETE)
  → M6 Library shell (IN_PROGRESS)
  → M7 WF2 + analysis (IN_PROGRESS)
  → M7-06 derived AudioAsset (IN_PROGRESS)
  → safe sample/slice `.ot` output (PLANNED / M11)
  → M7-07/08 stem (PLANNED)
  → M8 MockNode + protocol (PLANNED)
  → M9 hardware → M10 integration
```

Aligned with v0.1 §23; stem separation does not precede M7-06 without explicit replan.

---

## Recommended next product Work ID

**Candidate:** `MO-M7-DERIVED-QUERY-API-1` (read-only lineage/query IPC) after TRIM slice lands, or stem/normalize follow-ups.

**Reason:** M7-06 TRIM vertical slice (`MO-M7-DERIVED-AUDIOASSET-2`) proves generation + catalog + lineage; UI query and broader processors remain open.

**Dependencies:** M5 COMPLETE; M7-01–03 and M7-02 on `main`; Gate C boundaries unchanged.

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

**Conclusion:** Treat range→slice **native product acceptance** as **PASS** on integrated `main` at `0f39f50`. Keep `M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md` as historical #131 evidence; do not cite its NOT_COMPLETE as current blocker. Re-run on newer `main` (e.g. post-#145) only if slice/range UI changes.

---

## Unresolved ambiguities

1. **M6-06:** Operations Drawer (#134) vs v0.1 Operation Modal vs Gate C Change Drawer — three UX surfaces coexist; document operator path in future UX ADR if consolidating.
2. **M6-08:** Persisted pane widths / workspace layout — no canonical acceptance doc marking COMPLETE.
3. **M7-04:** Canvas deferred indefinitely or required for M7 exit — WAVEFORM_V2 lists Canvas as follow-on.
4. **`docs/OCTATRACK_PERFORMANCE_SYSTEM.md`:** Exists in user’s other clone but **not** on GitHub `main`; canonical ingest is `planning/sources/MASTA_OCTA_*_v0.1.md` only.
5. **ADR-015 / Performance System:** Referenced in WAVEFORM_V2 as draft only; not accepted in ADR_INDEX.

---

## Docs-only canonicalization (this PR)

| Artifact | Path |
| --- | --- |
| Milestone numbers | [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md) |
| This status | [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) |
| ADR list | [`ADR_INDEX.md`](./ADR_INDEX.md) |
| v0.1 verbatim | [`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md) |
