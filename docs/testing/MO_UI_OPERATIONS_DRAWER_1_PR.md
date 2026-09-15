# MO-UI-OPERATIONS-DRAWER-1 — PR handoff

## SHAs

| | SHA |
| --- | --- |
| Base (#133 `feat/ui-library-inspector-migration-1`) | `285999ee9f7c7ee5eed836afb0e01cc6cb85f8c7` |
| Final head | `2090794fa46c55d33097e1ce7e67a9db3323df12` |

## Dependency

- **Stacked on #133** ([PR 133](https://github.com/kaz4g/masterocta/pull/133)) — tabbed Inspector migration. **NOT merged** at handoff time.
- Draft PR base branch: `feat/ui-library-inspector-migration-1`
- #133 CI (head `f34834e`): Frontend / Rust / Gate C **PASS**; E2E **FAILURE** (rename-prepare locale, waveform 840px en). This PR updates those E2E paths; full CI on stacked head is authoritative.

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
| Restart | Drawer closed; recovery/prepared from journal via existing APIs | No new ephemeral persistence |

## Layout

- Wide: right Drawer ~32rem, scrollable body.
- `max-width: 840px`: full-width Drawer; list sample ops menu + status bar recovery path.
- AppShell bottom change drawer slot: **unused** (Library vertical space reclaimed).

## Verification (local)

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run test:frontend` | PASS — 78 files / 601 tests |
| `pnpm run build` | PASS |
| `pnpm run check:architecture` | **NOT_RUN** — `cargo metadata` unavailable in this environment |
| `cargo fmt/clippy/test` | _(NOT_RUN if no cargo in environment)_ |
| E2E rename-prepare / rename-operator / waveform 840px | Updated for Drawer + locale; run on CI |
| Native Tauri acceptance | **NOT_RUN** — mock IPC only |

## Mock vs native

- Component / unit / Vitest / Playwright use synthetic IPC.
- Native smoke is **not** claimed from mock success.

## Remaining / blockers

- #133 merge + stacked CI green on final head required before merge train.
- Operator strings (Clone/Rename/Copy bodies) remain largely English inside panels; chrome i18n added (`operations.*`, status bar).
- Native catalog smoke: **NOT_COMPLETE** (same as #133).

## Follow-up — MO-UI-SLICE-WORKSPACE-1

- Slice central/right workspace expansion deferred.
- Full operator panel i18n can follow in slice workspace or dedicated i18n wave.
