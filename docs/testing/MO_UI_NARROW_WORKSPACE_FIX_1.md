# MO-UI-NARROW-WORKSPACE-FIX-1

Branch: `feat/ui-narrow-workspace-fix-1`  
Base: `origin/main` @ `c2bf80c77bb7658ef2687032bf3d363f3788f79e` (#138)

## Scope

- Narrow workspace: Sources overlay drawer, full-width list/inspector panes, inspector header clip fix, status-bar list return (ja/en).
- Single narrow owner: `RootRegistryPanel` → `AppShell` `narrowLayout` (`useMediaQuery` / 840px breakpoint).
- `narrowWorkspace` applies only after `catalogReady` so root registration is not blocked at ≤840px initial viewport.

## Acceptance (manual / product)

| Check | Before (RC8 / main repro) | After (this branch) |
| --- | --- | --- |
| 800px: no permanent Sources column | FAIL (12% column) | **NOT_VERIFIED** on Tauri (Playwright real viewport PASS in FIX-2) |
| List/inspector use full inner width | FAIL (62% cap) | **NOT_VERIFIED** on Tauri (Playwright real viewport PASS in FIX-2) |
| Inspector header Rename/Copy reachable | FAIL (5.5rem clip) | PASS (CSS clip removed; Playwright 1280 header tests) |
| List return from inspector (context + status) | FAIL / clipped | PASS (Playwright narrow + status aria; Tauri **NOT_VERIFIED**) |
| Wide split % after narrow | Not verified | NOT_RUN (Playwright resize clears `#root`; see E2E) |

## Automated verification

| Command | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run build` | PASS |
| `pnpm exec vitest run src/app/AppShell.test.tsx src/hooks/useMediaQuery.test.ts` | PASS |
| `pnpm run test:workspace-css` | PASS (when run) |
| Playwright `workspace-layout` + `inspector-layout-stability` (Chromium) | 11 passed, 6 skipped (`test.fixme`: narrow viewport / mid-test resize) |
| Playwright `inspector-layout-stability` (WebKit layout project) | Wide/narrow fixme cases skipped; remaining per CI |
| Native Tauri narrow scenarios | **NOT_RUN** (Playwright ≠ Tauri WebView) |

## E2E notes (known gaps)

1. **Superseded by FIX-2:** real viewport ≤840px and post-mount resize are covered by `MO_UI_NARROW_WORKSPACE_VERIFY_FIX_2.md`. Do not use `__E2E_FORCE_NARROW_WORKSPACE__` in product code.
2. **Sources Drawer:** `CatalogWorkspaceNav` must stay **inside** `CatalogBrowseProvider` (see FIX-1 / #139).

## Files (high level)

- `RootRegistryPanel.tsx`, `AppShell.tsx`, `AppShell.css`
- `useMediaQuery.ts` (max-width via `innerWidth` + poll for Playwright)
- `WorkspaceStatusBar.tsx`, `InspectorTabbedAssetPanel.css`, `Drawer.css`
- `e2e/narrowWorkspace.ts`, layout specs, `playwright.config.ts` (vite port)
- `docs/I18N.md`

## Distribution

Public distribution **NOT AUTHORIZED**. Draft PR only; do not merge without review.
