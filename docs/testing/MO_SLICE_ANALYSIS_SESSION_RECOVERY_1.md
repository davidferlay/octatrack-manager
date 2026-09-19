# MO-SLICE-ANALYSIS-SESSION-RECOVERY-1

Slice UI recovery after an analysis session becomes invalid. Keep the catalog
draft. Do not auto-reanalyze or auto-apply candidates.

## Boundary

- Diagnostic start SHA (PR #140 head): `3f916962205b4b13a984ded8e7fd56cb63e438e9`
- Branch: `feat/slice-analysis-session-recovery-1`
- Isolated worktree only. Do not touch the running Native app, the
  VERIFY-FIX-2 worktree, live fixtures, catalog, or drafts.
- No media Apply, `.ot` export, RC8 freeze objects, merge, or release.
- Native acceptance remains **not PASS**.

## Facts

- Apply-candidates uses `v2_slice_draft_update` → `SliceWorkbench::edit`.
- The ja string「解析は利用できません。」 is only `slicing.error.ANALYSIS_NOT_FOUND`.
- `ANALYSIS_NOT_FOUND` is returned when the job id/root/window does not match,
  the job is cancelled, or a preview token is missing/expired.
- Job TTL is 15 minutes from `job.created` (analysis start). Propose does not
  refresh it. Process uptime is not job age.
- After `phase === "ready"`, the UI does not poll status, so a dead backend job
  can leave a clickable proposal in memory.
- Stale `proposalId` is `DRAFT_CONFLICT`, not `ANALYSIS_NOT_FOUND`.
- Unmount / file key change still calls `api.cancel` (unchanged). TTL was not
  extended. Ready polling was not added. Cleanup cancel was not removed.

## Hypotheses (still not proven on Native)

Which event produced Native `ANALYSIS_NOT_FOUND` is **unconfirmed**: TTL vs
cancel vs job replacement vs HMR vs preview-token confusion. This change does
not treat process uptime as job age.

## Product change

- TTL expiry now returns `ANALYSIS_EXPIRED` (backend, known error codes, ja/en).
  `ANALYSIS_NOT_FOUND` meaning is unchanged.
- Test seam: `expire_jobs_for_test()` sets TTL to zero. Tests do not sleep 15
  minutes.
- On `ANALYSIS_NOT_FOUND` or `ANALYSIS_EXPIRED` from draft / propose / edit /
  waveform / status: clear the in-memory proposal, disable apply and other
  mutations, show `slicing.reanalyzeRequired`, **keep** the in-memory draft.
  Do not `setDraft(null)`, do not auto-start, do not auto-accept.
- `readPreview` `ANALYSIS_NOT_FOUND` does **not** mark the session dead (token
  TTL still shares that code).
- Play `ANALYSIS_EXPIRED` does mark the session dead (job lookup).
- Draft / propose / waveform / status / edit ignore stale responses via
  `generation.current`. A superseded edit's success, failure, and `finally`
  must not set `editing`/`editBusy` on the new session.
- Explicit Detect / Analyze again starts a new job under the existing contract
  (revision CAS + analysis ROI). Locale change does not reset the invalid
  session or re-run IPC.

## Verification SHA

Review product (current): `3dd8eac05339be543072cd8447e56fc380f78473`
First product: `ef59520f86f76de7db24b415f8a67ba2ac9749e1`
Base: `3f916962205b4b13a984ded8e7fd56cb63e438e9` (PR #140 diagnostic head)

## Tests (review SHA)

- `pnpm run typecheck` PASS
- `pnpm run test:frontend` PASS (81 files / 639 tests)
- `pnpm run check:architecture` PASS
- `cargo fmt --all -- --check` PASS
- `cargo clippy --workspace --all-targets -- -D warnings` PASS
- `cargo test --workspace --lib slice_workbench` PASS (12 cases)
- `pnpm run test:e2e` NOT_RUN (layout Playwright is out of scope)
- Real Tauri IPC NOT_RUN (running Native process left untouched)
- `pnpm run build` NOT_RUN on this review SHA (PASS on `ef59520`)

## Real Tauri IPC

**NOT_RUN.** In-process `SliceWorkbench` tests cover propose → accept. A second
isolated Tauri window was not launched, so that the running Native process and
its HOME/catalog stay untouched.

## Native re-check (do not mark PASS here)

On a **new** isolated HOME + synthetic fixture, after this SHA:

1. Fresh analysis → proposal → apply succeeds; catalog draft revision advances.
2. After session invalid (do not wait 15 minutes in the hearing): explanation
   is visible, apply is disabled, existing draft revision is unchanged.
3. Explicit re-analyze restores propose/apply without wiping the catalog draft
   except via the existing start/load contract.
4. Locale toggle does not re-analyze or reset the draft/invalid banner.
5. Old async responses must not apply to the new job id.

Do not use the currently running VERIFY-FIX-2 process for this re-check.
