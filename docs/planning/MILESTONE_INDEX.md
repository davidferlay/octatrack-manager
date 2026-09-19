# Milestone index (canonical numbering)

- Work ID: `MO-DEVELOPMENT-PLAN-CANONICALIZATION-1`
- Status: Active canonical index
- Updated: 2026-09-20

## Role of this document

This file is the **only canonical source for product milestone numbers M5–M11**
(Library / Waveform / Performance System track). It does not replace safety
architecture: see [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md)
for Intent → Plan → Apply, RootRegistry, gates, and legacy M0–M4 history.

Milestone **names, work packages, and exit gates** are transcribed from
[`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md)
(2026-09-06, non-modified ingest). **Implementation status** lives in
[`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md).

## Canonical milestones (v0.1)

| ID | Name | Purpose (summary) |
| --- | --- | --- |
| **M5** | Safety / Gate C Completion | Complete current file-operation safety; Gate C; rename Plan/Apply boundary |
| **M6** | Library Workspace & AudioAsset Foundation | Library-first UI; sample browser and inspector; AudioAsset baseline |
| **M7** | Waveform v2 & Audio Analysis | Sample preparation: WF2, analysis jobs, derived assets (planned) |
| **M8** | Performance Domain & Node Protocol | PerformanceSession, transport, routing, MockNode without hardware |
| **M9** | OCTA-node Prototype | Raspberry Pi realtime audio/MIDI prototype |
| **M10** | Integrated Performance System | Octatrack + OCTA-node + Masta-OCTA as one performance instrument |
| **M11** | Advanced Sample Preparation / Performance Tools | Stem, slice/chop, batch prep, export recipes (candidates in v0.1) |

---

### M5 — Safety / Gate C Completion

**Purpose:** Finish current file-operation safety.

**Work packages (v0.1):** FAT/hash mandatory tests; tamper / double-apply / restart;
Human Gate C; rename Plan/Apply boundary; safety ledger / handoff.

**Current status:** See [DEVELOPMENT_STATUS § M5](./DEVELOPMENT_STATUS.md#m5--safety--gate-c-completion).

**Exit gate:** M6 can reuse M5 safety boundary without bypass.

**Canonical supporting docs:**

- [`../testing/GATE_C_RC_LEDGER.md`](../testing/GATE_C_RC_LEDGER.md) (RC8; do not mutate)
- [`M5_A_SAMPLE_RENAME_IMPACT.md`](./M5_A_SAMPLE_RENAME_IMPACT.md), [`M5_B_REFERENCE_REWRITE.md`](./M5_B_REFERENCE_REWRITE.md), [`M5_C_RENAME_TRANSACTION.md`](./M5_C_RENAME_TRANSACTION.md), [`M5_C5_OPERATOR_HARNESS.md`](./M5_C5_OPERATOR_HARNESS.md)
- [`../CODEX_HANDOFF.md`](../CODEX_HANDOFF.md) (historical PR ledger)

**Note:** Public distribution, Developer ID signing, and notarization are **not** part of M5 exit (separate release gate).

---

### M6 — Library Workspace & AudioAsset Foundation

**Purpose:** Move to new UI; sample-centric Library.

**Work packages (v0.1):**

| WP | Name |
| --- | --- |
| M6-01 | AppShell |
| M6-02 | Top Context Bar |
| M6-03 | Navigation Pane |
| M6-04 | Sample Browser v2 |
| M6-05 | Sample Inspector v2 |
| M6-06 | Operation Modal |
| M6-07 | AudioAsset domain baseline |
| M6-08 | keyboard / resize / persisted UI state |

**Exit gate (v0.1):** Source management in top context / dialog; browser dominates layout; waveform usable size in Inspector; prepared-operation always-visible panel removed; write safety preserved; AudioAsset represents existing Octatrack samples.

**Current status:** [DEVELOPMENT_STATUS § M6](./DEVELOPMENT_STATUS.md#m6--library-workspace--audioasset-foundation).

**Canonical supporting docs:**

- [`POST_M5_FEATURE_RESTART_AUDIT.md`](./POST_M5_FEATURE_RESTART_AUDIT.md) (historical investigation; #103–#105 reopen ban)
- [`WAVEFORM_V2_INTEGRATION.md`](./WAVEFORM_V2_INTEGRATION.md) (M7 WF2; depends on M6 layout)
- Testing: `docs/testing/MO_UI_WORKSPACE_*`, `MO_UI_LIBRARY_INSPECTOR_*`, `MO_UI_OPERATIONS_DRAWER_*`, `MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`

---

### M7 — Waveform v2 & Audio Analysis

**Purpose:** Sample preparation foundation.

**Work packages (v0.1):**

| WP | Name |
| --- | --- |
| M7-01 | waveform query model |
| M7-02 | multi-resolution waveform cache |
| M7-03 | stereo/channel representation |
| M7-04 | zoom / range / scroll UI |
| M7-05 | transient analysis |
| M7-06 | derived AudioAsset framework |
| M7-07 | stem separation adapter spike |
| M7-08 | optional stem separation workflow |

**Exit gate (v0.1):** Width-driven high-res waveform; not limited to 640 points; stereo channels; non-blocking analysis jobs; derived assets do not mutate originals.

**Current status:** [DEVELOPMENT_STATUS § M7](./DEVELOPMENT_STATUS.md#m7--waveform-v2--audio-analysis).

**Canonical supporting docs:**

- [`WAVEFORM_V2_INTEGRATION.md`](./WAVEFORM_V2_INTEGRATION.md)
- [`AUTO_SLICE_1_TECHNICAL_DESIGN.md`](./AUTO_SLICE_1_TECHNICAL_DESIGN.md), [`AUTO_SLICE_1_IMPLEMENTATION_STATUS.md`](./AUTO_SLICE_1_IMPLEMENTATION_STATUS.md)
- [`../testing/MO_M7_WFM2_MULTIRES_CACHE_1.md`](../testing/MO_M7_WFM2_MULTIRES_CACHE_1.md) (#145)
- [`../testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md`](../testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md)

---

### M8 — Performance Domain & Node Protocol

**Purpose:** Build Node-integrated UI without hardware.

**Work packages (v0.1):** M8-01 PerformanceSession; M8-02 Transport; M8-03 Routing domain; M8-04 NodeCapability; M8-05 NodeClient interface; M8-06 MockNode; M8-07 state/event synchronization; M8-08 Performance workspace shell; M8-09 Node workspace shell.

**Exit gate (v0.1):** MockNode drives routing, 4 looper, transport UI; reconnect / stale state simulation; no hardware-version branches scattered in UI.

**Current status:** [DEVELOPMENT_STATUS § M8](./DEVELOPMENT_STATUS.md#m8--m11).

**Canonical supporting docs:** v0.1 §14–§15 (protocol and node software); [`ADR_INDEX.md`](./ADR_INDEX.md) (proposed ADR candidates from v0.1 §21).

---

### M9 — OCTA-node Prototype

**Purpose:** Minimal realtime system on Raspberry Pi (4 IN / 8 OUT prototype scope per v0.1).

**Current status:** [DEVELOPMENT_STATUS § M8–M11](./DEVELOPMENT_STATUS.md#m8--m11).

**Hardware acceptance criteria:** v0.1 §17 M9 (MAIN/CUE thru, underrun, MIDI jitter, 4-looper load, latency).

---

### M10 — Integrated Performance System

**Purpose:** Unify Octatrack, OCTA-node, and Masta-OCTA as one instrument.

**Scope (v0.1):** Session recall, routing matrix, looper UI, Node recording → AudioAsset import, CUE/Looper/DSP paths, external FX, scene prototype, automated stem export prototype, failure/reconnect tests.

**Current status:** [DEVELOPMENT_STATUS § M8–M11](./DEVELOPMENT_STATUS.md#m8--m11).

---

### M11 — Advanced Sample Preparation / Performance Tools

**Purpose (v0.1 candidates):** Production stem separation; slice generation; transient chop; BPM/key analysis; batch prep; scene morph; MIDI profiles; Octatrack-oriented export recipes.

**Current status:** [DEVELOPMENT_STATUS § M8–M11](./DEVELOPMENT_STATUS.md#m8--m11).

**Note:** Safe `.ot` output and media Apply for slice workflows remain **out of scope** until Intent → Plan → Apply path is defined (see Auto Slice boundary in DEVELOPMENT_STATUS).

---

## Legacy milestone mapping (`NEXT_GENERATION_ARCHITECTURE.md` §12)

The next-generation architecture document predates the Performance System plan.
**Do not use legacy M6–M9 numbers for new work.** Feature intent is preserved below.

| Legacy (NEXT_GEN §12) | Current placement | Notes |
| --- | --- | --- |
| Legacy **M6** Portable Project | **Backlog** (Gate D capability) | Collect/bundle/import remains in NEXT_GEN §10.2 and Gate D; not scheduled as current M6. Revisit after M10 or as explicit portable-project milestone. |
| Legacy **M7** Slice & Sample Chain | **M7-05** + **M11** + Auto Slice track | Attack/transient analysis and Library range→slice (#131) are in progress on main. Lossless `.ot` write, chain generation, and hardware slice acceptance align with M11 and [`AUTO_SLICE_1_*`](./AUTO_SLICE_1_IMPLEMENTATION_STATUS.md), not legacy M7 number. |
| Legacy **M8** AI context | **Post-M10 / optional** | Markdown export and IntentProposal in NEXT_GEN §9; v0.1 M8 is Performance Domain, not AI. |
| Legacy **M9** optional cloud / MCP | **Post-M10 / optional** | ADR-009 one-way backup; no v0.1 milestone slot until local boundary complete. |

Historical text in [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md) §12 M6–M9 is **unchanged**; read it with this table.

---

## Dependency order (from v0.1 §23, validated on main)

1. M5 complete before bypassing safety.
2. M6 Library workspace before WF2-heavy Inspector work (#122 → #124+).
3. M7 waveform/analysis foundation before stem separation (M7-07/08) and before M8 MockNode (v0.1 §23 steps 9–10).
4. M8 MockNode before requiring Raspberry Pi (M9).
5. M10 integration after M9 prototype + M8 domain.

Stem separation (M7-07/08) must not reorder ahead of M7-02/04/06 without documented dependency change in DEVELOPMENT_STATUS.

---

## Related indexes

- Current implementation status: [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md)
- Architecture decisions: [`ADR_INDEX.md`](./ADR_INDEX.md)
- Agent handoff entrypoint: [`../CODEX_HANDOFF.md`](../CODEX_HANDOFF.md)
