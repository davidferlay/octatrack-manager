# Project Structure CI / Safety Gate foundation

- Work ID: `MO-PSE-CI-FOUNDATION-1`
- Parent issue: #191
- Start `origin/main`: `e71d737609cdbda1af25975c4e6a7aa4471b5264` (PR #188 Read Model)
- Workflow: [`.github/workflows/pse-ci.yml`](../../.github/workflows/pse-ci.yml)
- Shared entry: `pnpm run test:pse-read-model` / `node scripts/pse-read-model-check.mjs`
- Inventory: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json)
- Bank Mutation Safety Guard: `pnpm run check:pse-bank-mutation` / `node scripts/pse-bank-mutation-guard.mjs`
- ChangePlan / Mutation gate ledger: [`scripts/pse-bank-mutation-gates.json`](../../scripts/pse-bank-mutation-gates.json)

This document is the CI audit, reuse map, and Gate ledger for the Project
Structure / Bank Editor line. It does **not** authorize Bank Apply, Recovery,
or public distribution. M5–M11 numbers are unchanged.

The checkboxes in the #191 body are not updated by CI. §11 is the canonical
per-item status for #191.

## 0. Refresh on `f28e9a2` (`MO-PSE-CI-FOUNDATION-2`)

| Item | Value |
| --- | --- |
| `origin/main` | `f28e9a2e2112c3746cea4d8138499a87f7d6d37b` at refresh start |
| Landed since §1 | #193 v2 read command, #195 contained reads, #197 `[STATES]` BANK / PATTERN, #199 master track / per-track scale / `INF`, #200 exit audit, #202 read-only Viewer |
| Closed without merge | #190 Arranger read (`STOP_WITH_FINDINGS`, see the exit audit) |
| Read model judgment | `PSE_READ_MODEL = COMPLETE`, `BANK_CHANGEPLAN_READINESS = NOT_READY`, `APPLY_READINESS = NOT_READY` ([`PSE_READ_MODEL_EXIT_AUDIT.md`](../planning/PSE_READ_MODEL_EXIT_AUDIT.md)) |
| Added here | `Bank Mutation Safety Guard` job, gate ledger, aggregate wiring, this refresh |
| Not added | ChangePlan, Apply, Recovery, any write path, the #182 contract |

Sections 1 and 8 keep the foundation-start snapshot. Where they differ from
the current state, §0, §4, and §11 win.

## 1. Canonical state at foundation start

| Item | Value |
| --- | --- |
| `origin/main` | `e71d737609cdbda1af25975c4e6a7aa4471b5264` |
| Worktree | `.worktrees/pse-ci-foundation-1` |
| Branch | `cursor/pse-ci-foundation-1-6c5e` |
| Parallel open PRs | #189 DTO boundary, #190 Arranger read |
| Shared files avoided | `scripts/check-architecture.mjs`, `scripts/check-containment.mjs` |

## 2. Existing CI reuse map

Inspected on `e71d737`. Existing [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
already owns workspace-wide product checks. The dedicated Project Structure
workflow does **not** rebuild the full workspace for format, frontend, E2E, or
Gate C.

| Inspection | Workflow / job | Command | OS | Trigger | Evidence | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| Rust format | `CI` / `Rust Tests` | `cargo fmt --all -- --check` | ubuntu-22.04 | PR + push `main` (path-filtered) | existing CI | none; reused |
| Rust clippy | `CI` / `Rust Tests` | `clippy --workspace --exclude masterocta` then `clippy -p masterocta --features test-seams` | ubuntu-22.04 | same | existing CI | none; feature split kept |
| Rust tests | `CI` / `Rust Tests` | `cargo test --workspace --exclude masterocta` then `cargo test -p masterocta --features test-seams` | ubuntu-22.04 | same | existing CI | includes reader tests, but no inventory / 0-test guard |
| Architecture | `CI` / `Rust Tests` | `node scripts/check-architecture.mjs` | ubuntu-22.04 | same | existing CI | none; reused |
| Containment | `CI` / `Rust Tests` | `node scripts/check-containment.mjs` + legacy command tests | ubuntu-22.04 | same | existing CI | none; reused |
| Frontend typecheck / unit / build | `CI` / `Frontend Checks` | `pnpm run typecheck`, `test:frontend`, `build` | ubuntu-latest | same | existing CI | none; reused |
| E2E | `CI` / `E2E Tests` | `pnpm run test:e2e` | ubuntu-latest | same | existing CI | none; reused |
| Gate C Synthetic Smoke | `CI` / `Gate C Synthetic Smoke` | `scripts/gate-c-synthetic-smoke.sh` | ubuntu-22.04 + macos-latest | same | existing CI | none; not deleted or weakened |
| Gate C byte-manifest / candidate contracts | `CI` / `Frontend Checks` | `test:gate-c-manifest`, `test:gate-c-candidate` | ubuntu-latest | same | existing CI | Gate C forbids symlinks; PSE needs its own recorder |
| macOS app bundle / signed build | `Gate C Candidate Build` | dispatch-only freeze + codesign | macos-latest | `workflow_dispatch` only | not a PR check | **not reused** for PR CI (signing / draft release) |
| Project Structure inventory + PRE/POST | **new** `Project Structure CI` | `node scripts/pse-read-model-check.mjs` | ubuntu-22.04 + macos-latest | PR + push `main` | this workflow | added |
| Script / aggregate contracts | **new** `Project Structure Scripts` | `pnpm run test:pse-scripts` | ubuntu-22.04 | always | this workflow | added |
| Viewer API / UI contracts (#202) | `CI` / `Frontend Checks` | explicit `vitest run src/api/projectStructure.test.ts src/features/project-structure/ProjectStructureViewer.test.tsx` | ubuntu-latest | PR + push `main` (path-filtered) | existing CI | none; a removed Viewer test file fails the step |
| Viewer browser regression (#202) | `CI` / `E2E Tests` | `e2e/project-structure-viewer.spec.ts` inside `pnpm run test:e2e` | ubuntu-latest | same | existing CI | asserts no mutation command is invoked |
| Bank write-surface trip-wire | **new** `Bank Mutation Safety Guard` | `node scripts/pse-bank-mutation-guard.mjs` | ubuntu-22.04 | always (no path filter) | this workflow | added in `MO-PSE-CI-FOUNDATION-2` |

### Why a dedicated workflow

- Existing CI already compiles the whole workspace. Duplicating that in a second
  workflow would add cost without new proof.
- A required-check candidate must always report. Workflow-level `paths:` would
  leave the check Pending on docs-only PRs.
- Feature-branch `push` is omitted so a PR and its branch do not run the same
  SHA twice. `push` is `main` only, matching existing CI.
- Merge queue / `merge_group` is not configured on this repository (ruleset
  `Protect main` has no merge-queue rule).

## 3. Shared inspection entry

Local and CI use the same commands.

```bash
pnpm run test:pse-scripts
pnpm run test:pse-read-model
```

`test:pse-read-model`:

1. Loads [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json).
2. Lists and runs the real `ot-domain` / `masterocta --features test-seams` tests.
3. Fails on missing, ignored, failed, or **zero executed** tests.
4. Copies tracked fixtures into a temporary tree (never the tracked originals).
5. Captures PRE, invokes the product reader harness, captures POST, compares.

Adding a required contract test means adding it to the inventory. Do not add a
CI-only parser.

## 4. Implemented gates

| Gate | Issue | Implementation | Verification | Status | Next enablement |
| --- | --- | --- | --- | --- | --- |
| Read Model / domain contracts | #179 / #191 | `ot_domain::project_structure` + `project_structure_reader` + inventory runner | inventory suites on the PR head | **PASS** when the Linux/macOS jobs succeed | keep inventory current |
| Fixture PRE/POST + symlink text | #191 | `scripts/pse-fixture-manifest.mjs` + preserve scenarios | happy / mixed / missing / symlink | **PASS** when preserve reports identical PRE/POST | none |
| Comparator negative tests | #191 | 1-byte / add / delete / rename / link change | `pse-fixture-manifest.test.mjs` | **PASS** when script job succeeds | none |
| Zero-test / ignore / skip detection | #191 | inventory parser + aggregate evaluator | unit tests + CI aggregate | **PASS** when those tests succeed | none |
| Architecture / containment | existing | unchanged existing CI jobs | existing CI | reused; this workflow does not re-run them | none |
| Sample Management / Gate C regression | existing | unchanged `CI` workflow | existing CI | reused; not weakened | none |
| Linux / macOS FS + symlink | #191 | same read-model entry on both OSes | Linux + macOS jobs | **PASS** when both succeed | none |
| macOS signed / notarized app | — | Gate C Candidate only | not a PR check | **NOT_APPLICABLE** for this read-only foundation | do not run release workflows from PR CI |
| `project.work` `[STATES]`, master track, per-track scale, `INF` | #196 / #198 | inventory names added by #197 / #199 | Linux + macOS read-model jobs | **PASS** when both succeed | keep inventory current |
| Viewer UI / E2E | #180 | #202 Viewer + explicit Frontend Checks step + `e2e/project-structure-viewer.spec.ts` | existing `CI` Frontend Checks / E2E; Viewer paths are in PSE scope | **PASS** when those jobs succeed | Native desktop inspection stays with #186 |
| Bank write-surface trip-wire | #191 | `scripts/pse-bank-mutation-guard.mjs` | `Bank Mutation Safety Guard` job, always runs, feeds the aggregate | **PASS** while the Bank editor path has no write API (§12) | revise only with #182 / #183 |
| ChangePlan / Mutation gate ledger | #191 | `scripts/pse-bank-mutation-gates.json` checked by the guard | same job | **PASS** = all 18 gates listed; ChangePlan 6 **ACTIVE**; mutation / recovery **BLOCKED** | [`PSE_BANK_CHANGEPLAN_CLOSEOUT.md`](../planning/PSE_BANK_CHANGEPLAN_CLOSEOUT.md) |
| ChangePlan determinism / stale | #181 | `ot_plan::bank_changeplan` + inventory tests | Project Structure Linux / macOS | **PASS** when ledger ChangePlan gates are ACTIVE and jobs succeed (PR #232) | execution readiness stays `NOT_READY` |
| Expected-changed-files Apply | #183 | ledger entries only | — | **BLOCKED** | #182 contract + #183 runner |
| Reference integrity after mutation | #184 | ledger entry only | — | **BLOCKED** | Apply + integrity suite |
| Backup / failure injection / Recovery | #185 | ledger entries only | — | **BLOCKED** | Recovery implementation |
| Native acceptance | #186 | none | — | **BLOCKED** | Native session after Viewer/Apply (§13) |
| Slot ↔ AudioAsset boundary | #187 | [`SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md`](../planning/SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md) + `sample_slot_boundary` inventory suite + `sampleSlotBoundary.test.ts` | inventory suite on the PR head; frontend in `CI / Frontend Checks` | **PASS** for the current read / Sample-write surface when the Linux/macOS jobs succeed | Bank ChangePlan / Apply invariants stay pending with #181 / #183 / #184 (doc §8) |

Unimplemented gates are not empty tests, `continue-on-error`, or unconditional
skips. They stay **BLOCKED** until the product code exists. The ledger makes
that state machine-checked: a BLOCKED gate may not list tests, and a mutation
or recovery gate cannot be marked ACTIVE yet.

## 5. Fixture safety and proof scope

Tracked fixtures used after copy into a dedicated temporary directory:

| Fixture | Provenance | Files copied |
| --- | --- | --- |
| `src-tauri/tests/fixtures/real_device` | tracked repo fixture used by PR #188 | `project.work`, `bank01.work`, `bank01.strd`, `markers.work`, `arr01.work` |
| `src-tauri/tests/fixtures/multipart` | tracked synthetic Bank spanning four Parts | used by inventory rust tests (their own temp copies) |

Preserve scenarios (Node harness):

- `happy`: read a copied `real_device` tree twice
- `mixed`: valid `bank01.work` plus undecodable `bank02.work`
- `missing`: containment / missing project path
- `symlink`: `bank02.work` is a symlink and is treated as absent

PRE and POST manifests record root-relative path, entry type, regular-file size
and SHA-256, and raw symlink text. External symlink targets are not followed or
hashed. Manifests and reports are written **outside** the copied tree.

### Proof scope

PRE/POST hash identity is evidence that the copied tree bytes and symlink text
are unchanged after the read. It is **not** a proof that no write syscall
occurred. Combine it with:

- `project_structure_reader` has no write API
- containment via `resolve_relative_for_read` / `is_regular_source_file`
- existing architecture / containment guards in `CI`
- rust tests that hash the copied tree before and after a read

mtime / atime are not used as correctness.

The product reader requires a **canonical** registered root (`resolve_relative_for_read`
uses `canonicalize()` then `starts_with(root)`). On macOS, `/var` → `/private/var`.
The CI harness therefore `realpath`s / `canonicalize`s the temporary copy before
the read. That is a path-contract check, not a weakening of containment.

## 6. Workflow behavior

| Topic | Behavior |
| --- | --- |
| Triggers | `pull_request` to `main`; `push` to `main` only |
| Feature-branch push | not used (avoids PR + branch double-run) |
| `workflow_dispatch` | not added; must not replace required PR checks |
| `pull_request_target` | forbidden / unused |
| Path filter | job-level via `pse-ci-scope.mjs`, not workflow `paths:` |
| Docs-only | rust jobs skip; aggregate verdict `NOT_APPLICABLE` (not “tests passed”) |
| Unknown path state | treated as in-scope (fail closed) |
| Concurrency | `pse-ci-${{ pr.number \|\| ref }}`, cancel in progress |
| Timeouts | 10 / 45 / 5 minutes by job |
| Permissions | `contents: read` |
| Secrets | none |
| Action pins | same full SHAs as existing CI |
| Artifacts | PRE/POST/summary JSON only; no catalog, user audio, or Project originals |
| Aggregate | `always()`; evaluates `needs.*.result`; never unconditional `exit 0` |
| Always-required jobs | `Project Structure Scope`, `Project Structure Scripts`, `Bank Mutation Safety Guard` (failure, cancel, skip, or missing result fails the aggregate even on docs-only PRs) |
| In-scope jobs | `Project Structure Linux`, `Project Structure macOS` |

Required-check candidate name: **`Project Structure CI / Project Structure`**.
The aggregate already includes the Bank Mutation Safety Guard, so the guard
does not need its own required-check entry.

## 7. Compatibility

| Surface | This change | Status |
| --- | --- | --- |
| M6 / M7 completion text | not edited except one additive PSE CI bullet | unchanged |
| Gate C jobs / scripts | not deleted or weakened | reused |
| `cargo test --workspace` replacement | not done; `test-seams` split kept | preserved |
| Linux read-model | new job | this workflow |
| macOS path / symlink | new job | this workflow |
| Full Tauri `.app` bundle | not added | **NOT_APPLICABLE** here |

## 8. Deferred findings from PR #188

| Finding | Current main (`e71d737`) | Gate status |
| --- | --- | --- |
| Arranger Bank / Pattern references | still unmodeled (`UnmodeledDependency::Arrangements`); #190 is an open follow-up | **BLOCKED** for ChangePlan |
| `project.work` BANK / PATTERN / ARRANGEMENT | not decoded by the structure reader | **BLOCKED** |
| Working / SavedCheckpoint must not mix in a later plan | reader keeps separate entries today | keep as a later ChangePlan check |
| Bank file self-index | still unverified | **BLOCKED** |
| Multiple Bank fixtures | still only `bank01` tracked | **BLOCKED** for multi-bank plans |
| Scenes / Recorder unmodeled | listed, never treated as absent | keep listed; do not skip |

Status on `f28e9a2`: `[STATES]` `BANK` / `PATTERN` are mapped (#197);
`ARRANGEMENT` stays `Unmapped(raw)` and is still a ChangePlan blocker. #190 was
closed without merge. Bank internal identity, multi-Bank fixtures, and Scene /
Recorder are unchanged and remain ChangePlan blockers per the exit audit §7.C.

Do not revive disabled legacy `copy_bank`. Do not reuse rename APIs as Bank swap.
The Bank Mutation Safety Guard fails if `copy_bank`, `copy_parts`,
`copy_patterns`, `copy_tracks`, `save_parts`, `commit_part`, `commit_all_parts`,
or `reload_part` leave `DISABLED_COMMANDS`.

This CI PASS is **not** Bank Apply approval.

## 9. Required checks vs repository protection

Read-only check of ruleset `Protect main` (`21538639`) on 2026-09-30, re-checked
read-only on 2026-10-04 with the same rule types:

- Enforcement: active on the default branch
- Rules: `deletion`, `non_fast_forward`, `pull_request` (0 approving reviews)
- **No required status checks are configured**
- Classic branch-protection API: **UNKNOWN** (403 to this integration)

No ruleset or branch-protection change is made by this work.

### Required-check candidates (documentation only)

| Candidate | Source | Notes |
| --- | --- | --- |
| `CI / Rust Tests` | existing | format, clippy, architecture, containment, rust tests |
| `CI / Frontend Checks` | existing | typecheck, unit, Gate C script contracts, build |
| `CI / E2E Tests` | existing | Playwright |
| `CI / Gate C Synthetic Smoke (ubuntu-22.04)` | existing | Gate C regression |
| `CI / Gate C Synthetic Smoke (macos-latest)` | existing | Gate C regression |
| `Project Structure CI / Project Structure` | **new aggregate** | read-model + fixture + skip/fail propagation + Bank Mutation Safety Guard |

A runtime `Bank Mutation Safety` check (PRE/POST around a real Apply, failure
injection, recovery) is **not** a candidate until #183 / #185 exist. Until then
the static guard inside the aggregate is the only mutation-side check.

macOS / Tauri build: PR CI compiles and tests the `masterocta` crate on
`macos-latest` (Gate C Synthetic Smoke and Project Structure macOS). No PR job
builds the `.app` bundle; the signed bundle stays in the dispatch-only Gate C
Candidate workflow.

### Path-filter caveat for the owner

`CI` uses workflow-level `paths:`. If its jobs become required status checks,
a PR that touches none of those paths never reports them and stays pending.
`Project Structure CI` has no workflow-level filter and reports
`NOT_APPLICABLE` instead, so it can be required as-is. Changing protection is
an owner decision and is not part of this work.

## 10. Reproduction

```bash
# script contracts (no Rust)
pnpm run test:pse-scripts

# Bank write-surface trip-wire + gate ledger (no Rust)
pnpm run check:pse-bank-mutation

# real reader + inventory + PRE/POST (needs Rust / GTK stack on Linux)
pnpm run test:pse-read-model
```

Record the checked SHA, OS, rustc/cargo/node versions, suite counts from the
inventory summary, and the Actions run URL. Do not reuse another branch’s
green result. Do not treat the GitHub test-merge SHA as the PR head SHA.

## 11. #191 item status (canonical)

Status values: **DONE** (automated and running on PRs), **PARTIAL**,
**BLOCKED** (waits on the listed issue), **OWNER** (repository setting, not
changed by agents). `DONE` for a CI item means the check exists and runs; a
given PR is only green when its own Actions run is green.

### CI foundation

| #191 item | Status | Where |
| --- | --- | --- |
| current CI audit / reusable workflow | DONE | §2 (start) + §0 (refresh) |
| `cargo fmt --all -- --check` | DONE | `CI` / `Rust Tests` |
| `cargo clippy ... -D warnings` | DONE | `CI` / `Rust Tests`, split as `--workspace --exclude masterocta` + `-p masterocta --features test-seams` |
| Rust workspace / unit tests | DONE | `CI` / `Rust Tests`, same split |
| Frontend typecheck | DONE | `CI` / `Frontend Checks` |
| Frontend unit / component tests | DONE | `CI` / `Frontend Checks`, incl. explicit Viewer step |
| E2E gate | DONE | `CI` / `E2E Tests`, incl. `project-structure-viewer.spec.ts` |
| macOS / Tauri build gate | PARTIAL | crate compile + tests on `macos-latest`; no PR `.app` bundle build (§9) |
| existing Gate C regression kept | DONE | `CI` / `Gate C Synthetic Smoke` ubuntu + macOS, unchanged |
| Project Structure job / workflow | DONE | `Project Structure CI` |

### Read-only safety gates

| #191 item | Status | Where |
| --- | --- | --- |
| Project fixture read | DONE | inventory suites, `real_device` + `multipart` |
| Bank / Pattern / Part / Track / Slot projection | DONE | `masterocta-project-structure-reader` suite |
| deterministic read model | DONE | `repeated_reads_return_equal_structure` |
| no-write proof | DONE | PRE/POST + reader has no write API, now enforced by the guard (§12) |
| PRE/POST fixture hash identity | DONE | `scripts/pse-fixture-manifest.mjs` scenarios |
| malformed / unsupported fail-closed | DONE | `undecodable_bank_*`, `bank_failing_validation_*`, `malformed_project_work_*`, `unsupported_project_os_*` |

### ChangePlan gates (#181)

All six are ledger entries with status **ACTIVE** on current `main` (PR #231 / #232). Formal audit: [`PSE_BANK_CHANGEPLAN_CLOSEOUT.md`](../planning/PSE_BANK_CHANGEPLAN_CLOSEOUT.md). `BANK_CHANGEPLAN_IMPLEMENTATION = COMPLETE`; `BANK_CHANGEPLAN_READINESS` and `CHANGEPLAN_EXECUTION_READINESS` stay `NOT_READY` (execution sense).

| Ledger id | #191 item | Status |
| --- | --- | --- |
| `change-plan.bank-copy-deterministic` | Bank Copy ChangePlan deterministic | ACTIVE |
| `change-plan.bank-move-deterministic` | Bank Move ChangePlan deterministic | ACTIVE |
| `change-plan.bank-swap-deterministic` | Bank Swap ChangePlan deterministic | ACTIVE |
| `change-plan.affected-reference-enumeration` | affected reference enumeration | ACTIVE |
| `change-plan.stale-precondition-detection` | stale / precondition detection | ACTIVE |
| `change-plan.plan-generation-no-write` | plan generation does not change the fixture | ACTIVE |

How a ChangePlan gate becomes ACTIVE: add its Rust tests to
`scripts/pse-read-model-inventory.json` (so they run with zero-test and
ignore detection on Linux and macOS), list the same names in the gate's
`required_tests`, and set `status` to `ACTIVE`. The guard rejects ACTIVE
gates whose tests are not in the inventory.

### Mutation safety gates (#183 and later)

All twelve are ledger entries with status BLOCKED. The guard rejects ACTIVE
for these phases until the #183 runner exists.

| Ledger id | #191 item | Waits on |
| --- | --- | --- |
| `mutation.pre-manifest` | PRE manifest / hash | #182, #183; primitive exists (`pse-fixture-manifest.mjs`) |
| `mutation.post-manifest` | POST manifest / hash after Apply | #182, #183; same primitive |
| `mutation.expected-changed-files-only` | only expected files change | #181 (plan lists files), #182, #183 |
| `mutation.unrelated-files-preserved` | unrelated byte / hash preservation | #182, #183 |
| `mutation.reference-integrity` | Pattern / Part / Track / Slot integrity | #183, #184 |
| `recovery.backup-creation` | backup creation | #182, #183, #185 |
| `recovery.failure-injection` | failure injection | #182, #183, #185 |
| `recovery.partial-apply-failure` | partial Apply failure | #182, #183, #185 |
| `recovery.verify-failure` | Verify failure | #182, #183, #185 |
| `recovery.rollback` | rollback / recovery | #182, #183, #185 |
| `recovery.restores-pre-state` | back to PRE hash / reference state | #182, #183, #184, #185 |
| `recovery.retry-idempotency` | retry / idempotency | #182, #183, #185 |

`#182` hook: `contract.document` in the ledger is
[`docs/planning/PSE_BANK_MUTATION_SAFETY_CONTRACT.md`](../planning/PSE_BANK_MUTATION_SAFETY_CONTRACT.md),
and the guard requires that file to exist. The contract, not this document,
defines the rules.

Each mutation / recovery gate (and the two #182-related change-plan gates)
also lists `contract_rules` (BMS rule ids) and `contract_tests` (contract
tests already required by the inventory). These are a map, not the gate's
`required_tests`: every gate stays **BLOCKED** until the #183 runner applies
a real Bank change to fixture copies. The guard checks that mapped tests are
in the inventory, that rules are `BMS-*` ids, and that a mapping is only
present when the contract document is set. Rule-to-gate table: contract §14.

Scope limit carried from the contract (BMS-SAMPLE): the contract manifest
covers the project directory only. Samples in the Set Audio Pool (outside the
project) are out of that scope, so `mutation.unrelated-files-preserved` and
`mutation.reference-integrity` need #184 / #185 checks at the Set-root level
or over the files the slots reference before they can leave BLOCKED.

### PR gate policy

| #191 item | Status | Where |
| --- | --- | --- |
| required-check candidates documented | DONE | §9 |
| branch protection / ruleset change | OWNER | no required status checks today; see §9 caveat |

### Safety / Non-goals

| #191 item | Status | Where |
| --- | --- | --- |
| no real Octatrack CF original as CI fixture | DONE | tracked fixtures only, copied to temp (§5) |
| no write to user originals | DONE | read-only path + guard |
| no CI mutation of external devices | DONE | workflows have `contents: read`, no device access |
| M6 / M7 completion criteria unchanged | DONE | not edited |
| Sample Management gates not removed / weakened | DONE | `CI` workflow unchanged by this line |
| Bank Apply not unlocked by CI work | DONE | guard + ledger keep it locked |

### Completion conditions

| #191 completion line | Status |
| --- | --- |
| Bank Editor CI defined against current main | DONE (§0, §2, §4) |
| minimum CI for #179 actually passes | DONE (exit audit §6) |
| read-only / no-write fixture gate automated | DONE |
| gates after #181 written down | DONE (ledger + this section) |
| Mutation Safety Gate implemented or clearly BLOCKED before #183 | DONE as machine-checked BLOCKED; runtime gate is #183 work |
| no regression in Sample Management / Gate C | DONE when the PR's `CI` run is green |
| CI names and required-check candidates documented | DONE (§6, §9) |
| evidence recorded in canonical docs | DONE (this file) |

#191 stays open: its ChangePlan and Mutation gates are BLOCKED, not done.

## 12. Bank Mutation Safety Guard rules

`scripts/pse-bank-mutation-guard.mjs` is a static trip-wire. It does not prove
that no write syscall runs; it stops the obvious ways a write path could enter
the Bank editor line before #182 / #183 define how one is allowed.

| Rule | Scope | Fails when |
| --- | --- | --- |
| `RUST_WRITE_API` | production code (outside `#[cfg(test)] mod`) of the five required Rust files plus any `*.rs` under `src-tauri/src` or `src-tauri/crates` whose file name contains `bank` or `project_structure` | std::fs write / rename / delete, write-mode `OpenOptions`, `File::create`, `io::Write`, libc write / create / delete flags or calls, `to_data_file`, or a dependency on an executor / backup / write runtime |
| `FRONTEND_IPC` | `src/api/projectStructure.ts`, non-test files under `src/features/project-structure/` and any `src/features/bank*/` | a `v2_*` command other than `v2_project_structure_read`, or a legacy disabled / authorized write command name |
| `FRONTEND_IMPORT` | same | a value import of `@tauri-apps/*`, the `src/api` barrel, or any `src/api` module other than `projectStructure` (the API file itself may use only `client`) |
| `V2_SURFACE` | `src-tauri/src/v2_api.rs` | a v2 command whose name contains `bank` or `project_structure` other than the read |
| `LEGACY_GATE` | `src-tauri/src/legacy_command_gate.rs` | a legacy Bank-family write leaves `DISABLED_COMMANDS` |
| `LEDGER` | `scripts/pse-bank-mutation-gates.json` | a #191 gate is missing or unknown, a BLOCKED gate lists tests or has no blocker, a mutation / recovery gate is ACTIVE, `mutation_runner.implemented` is not `false`, or a set contract document does not exist |
| `MISSING_TARGET` / `*_PARSE` | all of the above | a required file is missing or cannot be parsed |

Known limits: a write reached through a generic module (for example a Bank
intent routed through `v2_change_plan` / `v2_change_apply`) is not caught by
file names. `check-architecture.mjs` pins the full v2 command surface, and the
Viewer E2E asserts no mutation command is invoked. The #182 contract rule
BMS-ROUTE covers the rest: a generic command that can touch Bank documents
must call `evaluate_apply_entry` before Apply and must be added to this
guard's allowlist explicitly. The contract test
`generic_mutation_commands_are_pinned_and_carry_no_bank_mutation` pins the
generic media-mutating command list and fails if the composition code
references Bank mutation types without the entry gate.

Lifting a rule is part of the reviewed #182 / #183 change, together with the
runtime mutation gates. Editing the ledger alone cannot unlock Apply.

## 13. Gate ↔ #186 Native acceptance map

CI gates run on fixtures. #186 is a human Native session on a copy of a real
Project. CI PASS does not replace any #186 row.

| #186 scope | CI gates that must be green first | Native-only evidence |
| --- | --- | --- |
| Project Structure Viewer | read-only gates, Viewer Frontend Checks / E2E | desktop layout, real Project copy, quit / relaunch |
| Bank Copy / Move / Swap | `change-plan.*`, `mutation.*` | operation on a copied Project |
| ChangePlan review | `change-plan.*` | review UI shows every affected file and reference |
| fixture / temporary project Apply | `mutation.*`, Bank write-surface guard revised under #182 | Apply on a temporary copy only |
| Verify / Recovery | `recovery.*` | recovery after a forced failure on a copy |
| Sample Slot reference integrity | `mutation.reference-integrity`, `recovery.restores-pre-state` | slots still resolve after the operation; #187 boundary |
| quit / relaunch persistence | none in CI today | Native only |
