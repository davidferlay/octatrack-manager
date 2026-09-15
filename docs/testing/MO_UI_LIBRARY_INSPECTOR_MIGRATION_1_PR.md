# MO-UI-LIBRARY-INSPECTOR-MIGRATION-1 — PR handoff

## SHAs

| | SHA |
| --- | --- |
| Base (`origin/main` after #132) | `bb9b81484eebd941f8b477fdd23c9824101bce6e` |
| FIX-2 (dependency #132) | `e0e3f24` |
| Final head | `79922e9` |

## Dependency

- **#132 MERGED** — five-region workspace, `CatalogFileList`, narrow layout, geometry guards.
- No mixed changes on #132 branch.

## Layout before / after

| Before | After |
| --- | --- |
| File list: name + path stack, size/ext column | Table: Name (path subline), Size, Format |
| Inspector: vertical stack in shell | Tabbed: Preview, Slice, Info, Usage, Notes |
| Rename in stack above waveform | Rename in Inspector header + activity strip |
| Inline test browser: same stack | Same `InspectorTabbedAssetPanel` |

## Tab / hidden state contract

| Event | Keep | Reset | IPC |
| --- | --- | --- | --- |
| Tab switch (same asset) | Waveform zoom/range, notes draft, slice job/draft | — | No extra waveform/draft/metadata/onsets |
| Tab switch (Preview hidden) | Waveform state | — | Plot width frozen (`layoutVisible=false`) |
| Asset change | — | All panels via `key={rootId:fileInstanceId}` | Normal selection fetch |
| Playback / analysis while hidden | Continues | — | Stop via header (`stopPlaybackToken`, slice cancel callback) |

## Screenshots

Capture at 1280px and 840px, ja and en, themes `classic` + `masterocta`:

- File list columns and off-page selection banner
- Each Inspector tab with LOOP.wav fixture
- Activity strip during range preview (optional)

Store under `docs/testing/screenshots/mo-ui-library-inspector-1/` when captured.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | PASS (local) |
| `pnpm run test:frontend` | PASS — 76 files / 595 tests (local) |
| `pnpm run build` | PASS (local) |
| `pnpm run check:architecture` | **NOT_RUN** — `cargo metadata` unavailable in this environment |
| `pnpm run test:e2e` `library-inspector-tabs.spec.ts` | PASS — 4 tests (local, `CI=true`) |
| `pnpm run test:e2e` related regressions | PASS — `workspace-layout`, `slicing`, `range-to-slice-analysis` (local spot) |
| `cargo fmt/clippy/test` | **NOT_RUN** — no `cargo` in PATH |
| Native Tauri catalog | **NOT_RUN** — operator acceptance pending |

## Mock vs native

- Unit / component / Playwright use synthetic IPC only.
- Native smoke is **not** claimed from mock success.

## Follow-up — MO-UI-OPERATIONS-DRAWER-1

- Change Drawer full reorganisation deferred.
- Slice central+right expansion deferred.
- Operator copy i18n (Clone/Rename drawer) still partial.
