# MO-UI-NARROW-WORKSPACE-VERIFY-FIX-2

**Work ID:** `MO-UI-NARROW-WORKSPACE-VERIFY-FIX-2`  
**Branch:** `feat/ui-narrow-workspace-verify-fix-2`  
**Base (start):** `origin/main` @ `2fee043dbcaa65177cc561c1f49b88917a820d75` (merge PR #139)  
**Start SHA (worktree):** `2fee043dbcaa65177cc561c1f49b88917a820d75`  
**Verify target SHA:** `bd79bf290110630f4f6aed1482a2a4c276457996`

## Summary

Real-viewport Playwright acceptance for narrow workspace (no `__E2E_FORCE_NARROW_WORKSPACE__` in product). Restored all six previously skipped layout regressions. Removed FIX-1 E2E-only narrow forcing from production code.

## Root cause classification

| Issue | Class | Fix |
| --- | --- | --- |
| Sources drawer `CatalogWorkspaceNav` outside `CatalogBrowseProvider` (FIX-1) | Product | Already fixed in #139; verified stable at real 840px |
| `__E2E_FORCE_NARROW_WORKSPACE__` in `RootRegistryPanel` | Test / product seam | Removed from production; E2E uses actual viewport |
| `openInspectorSample` `Math.max(height, 720)` | Test harness | Removed; 800×600 runs at true height |
| Narrow transition closed drawer on every `navigationOpen` change | Product | Only auto-close on **enter** narrow; drawer toggle works in narrow |
| Wide Sources column not restored after narrow roundtrip | Product | Restore `navigationOpen` from wide ref (default open when ref unset) |
| Status bar intercepting catalog clicks at 600px height | Product | Short-height workspace shell CSS + main pane scroll |
| `showListFromStatusBar` locator used wrong i18n key | Test harness | Use `workspace.showListStatusAria` |
| `useMediaQuery` 100ms poll | Product | Removed; `resize` / `matchMedia` / `visualViewport` listeners suffice |
| Split % lost on narrow roundtrip | Product | Controlled `sourcesSize` / `mainSize` on `AppShell` from `RootRegistryPanel` |
| WebKit `matchMedia` vs `innerWidth` at 841px | Environment | Assert product contract via `innerWidth <= 840` + `data-narrow-layout` |

## Skip / fixme restoration (6 → 0)

| Former skip | Restored as |
| --- | --- |
| `workspace-layout` describe (2 tests @ 840px) | `test.describe` active, real viewport |
| `840px: narrow stack, expand roundtrip…` | Active |
| `800x600: narrow workspace…` | Active; workspace-scoped horizontal overflow |
| `839/840/841px: breakpoint` | Three separate tests, fresh page per width |
| `1280 to 800 to 1280: sources split %` | Active with controlled split state |

Additional 840px library/slice/zoom specs migrated from force-narrow to **840×900** real viewport.

## Automated verification (verify target SHA)

| Command | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run test:frontend` | PASS (620 tests; one SliceWorkbench case flaky in full parallel run, passes isolated) |
| `pnpm run test:workspace-css` | PASS |
| `pnpm run build` | PASS |
| Playwright `workspace-layout` + `inspector-layout-stability` (Chromium) | PASS (19) |
| Playwright same specs (`webkit-layout` project) | PASS (19) |
| Playwright narrow library/slice/zoom specs (Chromium) | PASS (local 1478 run) |
| `cargo fmt` / `clippy` / `cargo test` | **NOT_RUN** — `cargo` not available in agent shell PATH (operator macOS toolchain expected) |

## Native Tauri acceptance

**NOT_RUN** (GUI / picker / hearing steps not executed in this session).

Operator minimal steps (isolated `HOME`, do not touch live catalog):

1. Check out verify target SHA in this worktree:  
   `/Volumes/SunSSD 1T/Development/sandbox/masterocta-mac-smoke/.worktrees/ui-narrow-workspace-verify-fix-2`
2. Use `scripts/prepare-range-slice-native-acceptance.sh` or M7 fixture generator; isolated `HOME` only.
3. `pnpm run tauri:dev` with that `HOME`; confirm real window at 800×600, 840px, and 1280↔800 resize.
4. Range A `[44100,132300)`, draft, range B mismatch per `docs/testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md`.
5. After operations, re-hash `RANGE.wav`; locate catalog via `lsof` on the running process (not bundle path alone).

## Evidence

- Playwright attachments: `test-results/**/layout-metrics.json`, layout screenshots via `testInfo.outputPath` (not committed under `docs/testing/`).
- FIX-1 manual table “PASS (expected)” remains **unverified on Tauri** until Native steps above are PASS.

## Remaining risks

- Document-level horizontal overflow may still include legacy Home chrome above the workspace shell; narrow tests assert **workspace shell** overflow.
- Leaving narrow always reopens wide Sources column if wide ref was false (acceptable default for catalog workflow).

## Distribution

Public distribution **NOT AUTHORIZED**. Draft PR only.
