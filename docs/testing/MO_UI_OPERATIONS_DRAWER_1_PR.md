# MO-UI-OPERATIONS-DRAWER-1 — PR handoff

## SHAs

| | SHA |
| --- | --- |
| Integration check start (pre-rebase head) | `ded1db52b0f4e74151911fb190f85d5cdd894882` |
| #133 merged to `main` | `3af9e324a5d08c99931e4761fe2506251987ddbe` |
| Product commit (drawer implementation) | `2090794` |
| Merge `main` into feature branch | `54273bfcde4ad14ddf08a7f2f8f4b7ff1d273a35` |
| Final head (integration-check complete) | `df9d8f2` (`9221533` product/E2E fixes) |

## Dependency / base

- **#133 merged** — [PR 133](https://github.com/kaz4g/masterocta/pull/133) is on `main` (`3af9e32`).
- **#134 base** — `main` (changed from stacked `feat/ui-library-inspector-migration-1` so `pull_request` CI runs).
- **`main...HEAD` diff** — Operations Drawer slice only (32 product/doc files; no #133 duplication).

## Entry / migration table

| Operation | Before | After |
| --- | --- | --- |
| Clone | Sources footer `CloneOperatorPanel` (always visible) | Top bar + Sources footer button → Operations Drawer (`clone`) |
| Rename prepare | Inspector Rename → `RenameSampleModal` | Sample ops menu → Drawer (`rename`) embedded prepare + `RenameOperatorPanel` |
| Rename continue/apply/recover | Bottom `RenameOperatorPanel` | Same panel inside Drawer (`rename`) |
| Additive copy | Bottom `AdditiveCopyChangeDrawer` | Sample ops menu → Drawer (`copy`) |
| Recovery (copy) | Bottom drawer | Drawer (`copy`) rollback section |
| Recovery (rename) | Bottom rename operator | Drawer (`rename`) operator cards |
| Prepared hint | Inspector `RenamePreparedNotice` | Short `operations.preparedHint` + status bar |

## State contracts

| Event | UI | Backend / IPC |
| --- | --- | --- |
| Close drawer | Hide panel only; mount retained | No apply/cancel/recover |
| Reopen drawer (same session) | Restore embedded rename/copy inputs and stages | No automatic re-plan |
| List selection change while drawer open | Pinned `fileInstanceId` unchanged for active rename/copy | API args stay on pin |
| Explicit new sample Rename/Copy | Updates pin; additive copy resets on pin change | Existing stale-plan guards unchanged |
| Root switch / close | Clears pin; closes drawer | Existing epoch guards unchanged |
| Prepared rename, no list selection | Status bar continuation → opens rename drawer without pin | `v2_rename_get_prepared_plan` / operator UI |
| Restart | Drawer closed; recovery/prepared from journal via existing APIs | No new ephemeral persistence |

## Layout

- Wide: right Drawer ~32rem, scrollable body.
- `max-width: 840px`: full-width Drawer; list sample ops menu + status bar recovery path.
- AppShell bottom change drawer slot: **unused** (Library vertical space reclaimed).

## Verification

### Local (integration worktree `54273bf` + fixes, `CI=true`, port 1421 reuse)

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run test:frontend` | PASS — 78 files / 601 tests |
| E2E rename-prepare / rename-operator / workspace-layout / waveform-zoom (840/1280) | PASS — 9 tests |
| `pnpm run check:architecture` | **NOT_RUN** locally (no `cargo metadata` in agent env) |
| Native Tauri acceptance | **NOT_RUN** — mock IPC only |

### CI (GitHub)

| Run | Head | Frontend | E2E | Rust | Gate C macOS | Gate C Ubuntu |
| --- | --- | --- | --- | --- | --- | --- |
| [35029101363](https://github.com/kaz4g/masterocta/actions/runs/35029101363) | `54273bf` (merge only) | PASS | **FAIL** (pre–E2E fix) | PASS | PASS | PASS |
| _(pending)_ | final head after E2E/product fix push | — | — | — | — | — |

Re-run CI on final head after integration-check commit; do not treat the failed E2E run as green.

## Mock vs native

- Component / unit / Vitest / Playwright use synthetic IPC.
- Native smoke is **not** claimed from mock success.

## Remaining / blockers

- Operator panel **body copy** (Clone / Rename / Copy internals) remains largely English; chrome i18n added (`operations.*`, status bar).
- Native catalog smoke: **NOT_COMPLETE** (unchanged from #133).
- Final CI green on head after integration-check fixes required before merge train.

## Follow-up — MO-UI-SLICE-WORKSPACE-1

- Slice central/right workspace expansion deferred.
- Full operator panel i18n can follow in slice workspace or dedicated i18n wave.
