# Project Structure Read Model exit audit

- Work ID: `MO-PSE-READ-MODEL-EXIT-AUDIT-1`
- Parent: #179
- Kind: docs-only. This audit does not change product code, DTOs, or fixtures.

Read Model completion, Viewer readiness, Bank ChangePlan readiness, and Apply readiness are separate judgments.

## 1. Audit baseline

Fetched from GitHub at audit time. `origin/main` had not moved past the #199 merge.

| Item | Value |
| --- | --- |
| `origin/main` | `59ee873fa8cde2defdd309eb0d83c5f560558a8d` |
| #199 merge | same SHA |
| #197 merge | `61a85ed7444a51b99afc9bb42488ddc3076ccb24` |
| #195 merge | `218bfc7a268702b48ebdf66dc645d1c8560b8c87` |
| #193 merge | `0820785724cf702b56ff6ff3e13b632c32ef6f39` |
| #192 merge | `ad4953c7f2c6d559e24f0b28e2037606691df1e6` |
| #188 merge | `e71d737609cdbda1af25975c4e6a7aa4471b5264` |
| Rust on the audit host | 1.98.1 |
| DTO schema on this SHA | `masterocta.project-structure:v3` |

Issue state at audit time: #179 OPEN, #180 OPEN, #181 OPEN, #190 OPEN, #196 OPEN, #198 OPEN.

## 2. Canonical sources

- #179 body (original contract)
- #180, #181, #196, #198 bodies
- #190 PR body (`ARRANGER_READ = STOP_WITH_FINDINGS`)
- [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md) PSE-1 and PSE-2
- [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) Project Structure bullets
- [`PSE_CI_FOUNDATION.md`](../testing/PSE_CI_FOUNDATION.md)
- `src-tauri/src/project_structure_command.rs` schema constant on this SHA
- GitHub Actions on `59ee873` (push to `main`)

## 3. #179 original contract

Purpose: a read-only Project structure model, separate from Sample Management.

Model: Project → Bank → Pattern → Part → Track → Sample Slot Reference.

Scope: audit the existing readers, reuse the M3-C2 projection and usage edges, fix domain ownership, prove the read with fixtures. Scene stays out until a trusted read model exists.

Non-goals: Apply to Project or Bank, reimplementing Sample Management, renumbering M6/M7.

Done: the structure and its references can be read deterministically from fixtures, and no-write is proven.

Scene is outside the original Done line. Arranger rows are not a Done line. `project.work` `[STATES]`, `MASTER_TRACK`, per-track scale, and `INF` are accuracy work that landed after the original text. They are on `main` now. They are not extra reasons to keep #179 open, and their absence would have left Track and Pattern length wrong. With #199 merged, that accuracy gap is closed.

## 4. Merged PR inventory

| PR | Work | On `59ee873` | What it established |
| --- | --- | --- | --- |
| #188 | `MO-PSE-READ-MODEL-1` | yes | Bank / Pattern / Part / Track / Slot. `.work` and `.strd` stay separate. Malformed and unsupported Banks expose no partial structure. |
| #192 | `MO-PSE-CI-FOUNDATION-1` | yes | Inventory, zero-test failure, fixture PRE/POST, Linux and macOS. |
| #193 | `MO-PSE-READ-MODEL-2` | yes | `v2_project_structure_read`, `RootId`, root-relative DTO, no absolute paths. |
| #195 | B2 safety | yes | Schema field, project-directory gate, `O_NOFOLLOW` contained reads, I/O separated from decode failure. |
| #197 | `MO-PSE-PROJECT-STATE-READ-1` | yes | `BANK` and `PATTERN` mapped. `ARRANGEMENT` stays `Unmapped(raw)`. OS 1.40 exception, non-blocking open, 1 MiB `project.work` cap. |
| #199 | `MO-PSE-READ-MODEL-COMPLETENESS-1` | yes | Track 8 master role, per-track scale, `INF` distinct from a finite step count. Schema `v3`. |
| #190 | Arranger read | not merged | `STOP_WITH_FINDINGS`. Stacked on the old B2 branch. |

`PROJECT_STATE_READ` was `PARTIAL` on the original audit SHA because the arrangement file slot was unknown. Disposable `P_ARR_TEST` captures later mapped UI Arrangement 1 / 2 / 8 to raw `0` / `1` / `7` and to `arr01.work` / `arr02.work` / `arr08.work`. That slot is no longer the partial. `ARRANGEMENT_MODE` stays unmodeled. The partial was not an #179 Done miss.

## 5. Capability matrix

| Capability | #179 required? | On main | Evidence | Result |
| --- | --- | --- | --- | --- |
| Project directory read | YES | YES | `v2_project_structure_read` plus `is_octatrack_project` | PASS |
| Bank | YES | YES | #188, separate `.work` / `.strd` | PASS |
| Pattern → Part | YES | YES | reader tests, legacy part assignment | PASS |
| Part → Track | YES | YES | eight tracks per part | PASS |
| Sample Slot Reference | YES | YES | Static / Flex / unassigned / recorder / unrecognized; catalog usage edges | PASS |
| Parse status fail-closed | YES | YES | malformed and unsupported expose empty patterns and parts | PASS |
| No-write | YES | YES | inventory PRE/POST, tracked fixture hashes, reader has no write API | PASS |
| `MASTER_TRACK` / Track 8 | accuracy, now required for a correct Track | YES | #199; `real_device` `MASTER_TRACK=1` withholds Track 8 slot | PASS |
| Per-track scale | accuracy, now required for a correct Pattern | YES | #199; `real_device` pattern 0 lengths 12 and 64 | PASS |
| Master length `INF` | accuracy, now required so 255 is not rounded | YES | #199; sentinel 255/255 is `Infinite`, normal-mode 255 stays finite | PASS |
| Active Bank / Pattern from `[STATES]` | added after the original text; present | YES | #197 mapped | PASS |
| Arrangement file slot | not an #179 Done line | YES for MkII `R0173` / OS `1.40` only, zero-based `0..8` | `P_ARR_TEST` UI 1/2/8 → raw 0/1/7 → `arr01`/`arr02`/`arr08`. Other OS versions stay unrecognized | PROVEN for that OS |
| Scene | NO until a trusted model exists | listed unmodeled | #179 body and control-plane §5 | DEFERRED |
| Arranger rows | not an #179 Done line | not on main | #190 `STOP_WITH_FINDINGS` | BLOCKED-FUTURE |
| Bank internal identity | not an #179 Done line | file name is the index used by the reader; bytes inside the bank are not proven as identity | #190 findings | UNKNOWN |
| Apply / ChangePlan / Viewer | NO | absent | #179 non-goals; #180 and #181 still open | OUT OF SCOPE |

## 6. CI and no-write

Push of `59ee873` to `main`:

| Workflow | Run | Jobs | Result |
| --- | --- | --- | --- |
| CI | [36826187636](https://github.com/kaz4g/masterocta/actions/runs/36826187636) | Rust Tests, Frontend Checks, E2E Tests, Gate C ubuntu-22.04, Gate C macos-latest | success |
| Project Structure CI | [36826187630](https://github.com/kaz4g/masterocta/actions/runs/36826187630) | Scope, Scripts, Linux, macOS, aggregate Project Structure | success |

The same two workflows were success on #199 head `e1e59bf` before merge.

Still in force on this SHA, from [`PSE_CI_FOUNDATION.md`](../testing/PSE_CI_FOUNDATION.md) and `scripts/pse-read-model-inventory.json`:

| Gate | Still present |
| --- | --- |
| Required-test inventory | yes, including #197 and #199 names |
| Zero executed tests fail | yes |
| Missing or ignored required test fails | yes |
| Fixture PRE/POST | yes |
| Symlink bank or `project.work` is absent | yes |
| Malformed / unsupported withhold structure | yes |
| Gate C jobs | success on this SHA; workflow not weakened by this audit |

PRE/POST proves the copied tree bytes did not change. It does not by itself prove that no write syscall ran. The reader still has no write API, and containment stays in front of the read. That is the same proof scope the foundation document already records.

## 7. Known unknowns, classified

### A. #179 blockers

None. The original Done line is the deterministic fixture read plus no-write. Scene and Arranger were not that line.

### B. Viewer, deferred

These can ship as an explicit unread or unmapped label. They do not stop a read-only first viewer.

| Item | Why it does not block #180 |
| --- | --- |
| Arrangement file slot | The active slot is mapped for MkII `R0173` / OS `1.40`. The viewer shows the one-based arrangement number for that OS and the raw value when the version or the raw is unrecognized. Arranger rows are still unread. |
| Scene | #179 and PSE-1 say not to invent Scene rows. The DTO already lists `scenes` as unmodeled. The viewer says "Scene is not read". |
| Arranger rows | PSE-1 scope is Bank, Pattern, Part, Track, Sample Slot, parse status. |

### C. Bank ChangePlan blockers

#181 Done is a reviewable plan for Copy, Move, and Swap before any write. These are still missing, so the three operations are not safe to explain:

| Gap | Why it blocks a plan |
| --- | --- |
| Arrangement file slot | Resolved for MkII `R0173` / OS `1.40`: UI Arrangement N is raw `N - 1` and `arrNN.work`. Other OS versions stay unrecognized. A bank change can still retarget Arranger `pattern_id` rows, which remain unproven. |
| Arranger `pattern_id` | Numbering, including `n_rows == 0`, is unproven. A move/swap cannot list Arranger rows that point at the bank. |
| Bank internal identity | Only `bank01` is in the tracked fixtures. The reader uses the file name. Bytes inside the bank are not proven as a second identity the plan must rewrite. |
| Scene and Recorder | Control plane §6: an unmodeled dependency closes the plan as a failure. The read model lists them. A plan that always fails is not a reviewable plan for the three operations. |
| Working / SavedCheckpoint operation rule | The read model keeps the two documents apart. Copy/Move/Swap still has no rule for which of `.work` and `.strd` move, and what happens to `[STATES] BANK`. |

**Note (2026-10-11):** [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md) re-evaluates §7C after #204 / #227. Arrangement file slot is no longer an open readiness gap on `main`. `PROJECT_STATE_READ = COMPLETE` in the Judgment block below supersedes the historical `PARTIAL` line here for current `main`. A fail-closed read-only ChangePlan planner may proceed (`BANK_CHANGEPLAN_IMPLEMENTATION = READY`); executable Copy/Move/Swap plans remain `NOT_READY`.

## 8. #190 Arranger

Do not merge #190 onto `main`.

The branch is `cursor/arranger-read-1-c1e1`, based on the old `cursor/project-structure-read-model-2-c1e1`, not on current `main`. The judgment on that PR is `ARRANGER_READ = STOP_WITH_FINDINGS` and `BANK_MOVE_SWAP_PLANNING = NOT_READY`. Merging it would land an evidence-short parser only to put the branch on `main`.

Disposition: after this audit is on `main`, close #190 without merging. Keep the findings in the PR body and in this file. Do not open a replacement implementation issue until a labeled fixture shows `pattern_id` numbering, including the `n_rows == 0` case. This audit does not close the PR itself.

## 9. Issue disposition

| Issue | Judgment | Reason |
| --- | --- | --- |
| #179 | `CLOSE_READY` | Original model, fixture read, and no-write are on `main`. Scene stays deferred by the issue text. |
| #198 | `CLOSE_READY` | #199 is merged. Master track, per-track scale, and `INF` match the issue scope. This audit does not close it. |
| #196 | `SPLIT_RECOMMENDED` | `BANK` and `PATTERN` are mapped (#197). `ARRANGEMENT` was in the issue and is still `Unmapped`. Keep #196 open. A later issue can own the file-slot question. Do not close #196 in this audit. |
| #190 | close without merge, after this audit | Stale base and `STOP_WITH_FINDINGS`. |
| #180 | start allowed, not started here | See §10. |
| #181 | stay blocked | See §11. |

## 10. Viewer readiness

#180 depends on the Read Model being done. PSE-1 asks for Bank, Pattern, Part, Track, Sample Slot reference, missing references, and parse status, with no absolute paths and no write.

Those reads exist on `main` as `v2_project_structure_read` and schema `v3`. Scene stays an explicit unread label. Arrangement mapping is not part of that first screen.

`VIEWER_READINESS = READY`

This audit does not implement the viewer.

## 11. ChangePlan and Apply

Copy, Move, and Swap still cannot name every external reference they would change. "Copy might be smaller" is not a reason to start #181. The issue Done line is all three operations.

`BANK_CHANGEPLAN_READINESS = NOT_READY`

`APPLY_READINESS = NOT_READY`

Apply stays behind ChangePlan, and behind the control plane's later phase. Public distribution is unchanged and stays unauthorized.

## 12. Next Work ID

On this product line the next candidate is #180, Project Structure Viewer (`PSE-1`).

Historical gate: this audit said not to start #181 until `BANK_CHANGEPLAN_READINESS = READY` (execution sense).

**Update (2026-10-11):** Reconciliation after #227 separates **implementation** readiness (`READY` → `MO-PSE-BANK-CHANGEPLAN-CORE-1`) from **execution** readiness (`BANK_CHANGEPLAN_READINESS = NOT_READY`). See [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md).

This repository's M7 primary in `DEVELOPMENT_STATUS.md` is a different line. This audit does not make #180 the M7 next step.

## Judgment

```text
PSE_READ_MODEL = COMPLETE

ISSUE_179 = CLOSE_READY
ISSUE_198 = CLOSE_READY
ISSUE_196 = SPLIT_RECOMMENDED

VIEWER_READINESS = READY

PROJECT_STATE_READ = COMPLETE
ARRANGEMENT_MAPPING = PROVEN (MkII R0173 / OS 1.40 only)
ARRANGER_READ = STOP_WITH_FINDINGS

BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_READINESS = NOT_READY
```
