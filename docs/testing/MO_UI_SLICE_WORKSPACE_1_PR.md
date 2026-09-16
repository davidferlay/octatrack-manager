# MO-UI-SLICE-WORKSPACE-1 — PR handoff

## SHAs

| | SHA |
| --- | --- |
| #134 merge on `main` | `a3dafcc0beca1b6e9a304f86b355a982d03621cf` |
| Product head | `27ce5c6` |

## Scope

- Single `SliceWorkbench` / `SliceSession` owned by `RootRegistryPanel` (`key={rootId:fileInstanceId}`).
- Portal host: compact mount in Inspector slice tab; expanded mount in AppShell main.
- Expanded layout: center = analysis + waveform; aside = candidates + marker editor (`layout: "expanded"`).
- Catalog main + `InspectorTabbedAssetPanel` stay mounted with `hidden` + `inert` while expanded.
- i18n: expand/exit chrome only (ja/en). Slice body English unchanged.
- No slice IPC / backend contract changes.

## Native / smoke

| Check | Result |
| --- | --- |
| Operations Drawer min-smoke (pre-step, real Tauri) | **NOT_RUN** — no native session in agent environment; mock/E2E only |
| Slice workspace UI (this PR) | Playwright E2E `e2e/slice-workspace-expand.spec.ts` (CI) |

## Local verification (agent)

```text
CI=true pnpm run typecheck          — pass
CI=true pnpm run test:frontend      — pass (610 tests)
CI=true pnpm run build              — pass
CI=true pnpm exec playwright test e2e/slice-workspace-expand.spec.ts — NOT_RUN locally (Playwright browser missing)
```

Rust (`cargo fmt/clippy/test`): not run locally in this worktree session; rely on CI Rust job when PR opens.

## CI

- Fill run URL after push: _pending_

## Remaining risks / blockers

- Expanded narrow (840px) uses stacked grid; long marker lists scroll in aside — no separate internal tab view.
- Activity bar in hidden Inspector during expand: cancel/stop for playback on non-slice tabs relies on expanded workbench controls or status bar paths.
