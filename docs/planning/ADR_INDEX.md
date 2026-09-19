# Architecture decision record index

- Work ID: `MO-DEVELOPMENT-PLAN-CANONICALIZATION-1`
- Updated: 2026-09-20

This index lists **accepted** decisions already recorded in the repository and
**proposed** items from the ingested v0.1 plan. This docs pass does **not**
accept new architecture decisions.

## Accepted (canonical text)

Full rationale: [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md) §15.

| ID | Decision | Status |
| --- | --- | --- |
| ADR-001 | Local-first SQLite catalog | Accepted |
| ADR-002 | Raw path → opaque ID at boundary | Accepted |
| ADR-003 | Intent → Plan → Apply | Accepted |
| ADR-004 | Recoverable transaction (no fake multi-file atomicity on media) | Accepted |
| ADR-005 | Legacy adapter incremental migration | Accepted |
| ADR-006 | Asset vs FileInstance separation | Accepted |
| ADR-007 | Markdown context / JSON manifest | Accepted |
| ADR-008 | AI read/proposal only | Accepted |
| ADR-009 | Cloud one-way backup first | Accepted |
| ADR-010 | Additive operation as first write pilot | Accepted |
| ADR-011 | Slot state vs file-sidecar state separation | Accepted |

Additional **accepted principles** from v0.1 Implementation Plan §2 (ingested;
not separate ADR numbers yet): Octatrack not replaced; PC not required for realtime
audio path; non-destructive originals; Intent → Plan → Review → Apply → Verify;
capability-driven Node UI.

## Proposed / candidates (not accepted by this PR)

From v0.1 §21 (risks / ADR candidates) and §14–§15 — **do not implement as decided**:

| Topic | Source | Notes |
| --- | --- | --- |
| Audio I/F hardware selection | v0.1 §21 | OCTA-node prototype |
| Hardware bypass / fail-safe topology | v0.1 §21 | — |
| Node transport (Ethernet vs USB roles) | v0.1 §21 | — |
| Clock authority (MIDI jitter / master) | v0.1 §21 | v0.1 §2.2: Mac not clock-required path |
| Realtime engine language (Rust vs C++) | v0.1 §21 | — |
| Stem model policy | v0.1 §21 | M7-07/08 |
| AudioAsset storage identity | v0.1 §21 | Overlaps ADR-006; derived asset framework open (M7-06) |
| Session schema versioning | v0.1 §21 | M8 PerformanceSession |
| Workspace boundary (anti-DAW scope) | v0.1 §21 | — |
| ADR-015 (descriptor-relative cache / APFS identity) | [`WAVEFORM_V2_INTEGRATION.md`](./WAVEFORM_V2_INTEGRATION.md) §13.2 | **Draft reference only**; Performance System doc not on `main` |

When an ADR moves to Accepted, add a dedicated `docs/planning/adr/ADR-0xx-*.md` or extend NEXT_GEN §15 in a focused PR — not via silent edits to v0.1 source.

## Related

- Milestones: [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md)
- Status: [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md)
- v0.1 baseline: [`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md)
