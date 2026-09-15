# MO-UI-WORKSPACE-FOUNDATION-1 — PR handoff

## SHAs

| | SHA |
| --- | --- |
| Start (branch from `origin/main`) | `4da00644493b79195be7082221a1753082652ec5` |
| Final head | see PR head after docs commit |

## Problem / this stage

The catalog UI kept Browse/Locations inside the main column while Sources only held root chrome. This PR splits the live catalog into a five-region workspace (top / left nav / center list / right inspector / bottom status) without new IPC or global stores.

## Migration table (summary)

| Before | After |
| --- | --- |
| `SourcesPane` root + clone | Top bar (connect/mode/search/refresh) + left nav footer (clone) |
| Browse + Locations columns in `CatalogLibraryBrowser` | Left `CatalogLocationNav` (tree) |
| Files column in browser | Center `CatalogFileList` |
| Shell `InspectorPane` | Right (unchanged wiring) |
| Change Drawer only | Bottom status strip + Change Drawer |

Embedded `CatalogLibraryBrowser` (3-column) remains for unit tests.

## State contract (keep / reset / stop / continue)

| Event | Keep | Reset | Stop | Continue |
| --- | --- | --- | --- | --- |
| Root register/close | New session | library, browse, selection, search | Stale `listLibrary` via `catalogEpochRef` | New catalog load |
| Location change | search | page, selection | — | New file list |
| Asset change | rootId | Inspector `key` by `fileInstanceId` | Waveform/metadata request counters | New asset fetch |
| Search/sort/page | selection if still in location | page on filter change | — | Query results |
| Locale/theme | catalog + selection + inspector edits | labels only | — | No extra IPC |
| 840px toggle | inspector single mount | — | — | Hidden pane keeps playback |
| Recovery | — | — | — | Change Drawer + status links |

## Verification (local)

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run test:frontend` (562 tests) | PASS |
| `pnpm run check:containment` | PASS |
| `pnpm run build` | PASS |
| `pnpm run check:architecture` | NOT_RUN — `cargo` unavailable in agent environment (ENOENT) |
| `pnpm run test:e2e` | NOT_RUN locally — CI on PR |
| Native Tauri + real catalog | NOT_RUN — operator acceptance pending |

## Mock vs native

- Unit/component/E2E specs use synthetic IPC fixtures only.
- Native catalog smoke is **not** claimed from mock success.

## Follow-ups

- `MO-UI-LIBRARY-INSPECTOR-MIGRATION-1`: inspector density/tabs, operator i18n, OperationsDialog deferral unchanged.
- PR #131 (range→slice analysis) not merged; no cherry-pick.

## Screenshots

CI / operator: capture 1280px and 840px, ja and en, themes `classic` + `masterocta` after native run.
