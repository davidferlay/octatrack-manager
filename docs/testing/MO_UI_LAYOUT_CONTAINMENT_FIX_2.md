# MO-UI-LAYOUT-CONTAINMENT-FIX-2 — handoff

## Scope

PR [#138](https://github.com/kaz4g/masterocta/pull/138) / branch `feat/ui-inspector-layout-stability-1`.

Builds on committed `6af77d9` plus prior uncommitted layout fixes (waveform height, sources split, flex height chain).

## Problems addressed

### 1. Inspector vertical clipping (short viewport)

**Repro:** 1280×600 (Home chrome above workspace), long asset name, Preview / Notes tabs.

**Cause:** `.mo-inspector-tabbed__panels` used `min-height: 12rem` while ancestors used `overflow: hidden`, so fixed chrome + minimum panel height could exceed the flex budget and clip bottom controls without a scroll escape.

**Fix:**

- `.mo-inspector-tabbed__panels`: `min-height: 0` (keep `flex: 1 1 0`, internal scroll).
- `.mo-inspector-tabbed`: `overflow: auto` + `scrollbar-gutter: stable` so oversized header/tab chrome can scroll inside the inspector body.
- Waveform / slice plot heights unchanged (`8.75rem` / `10rem`, `flex-shrink` safe).

### 2. Expanded slice layout vs. real editor width

**Repro:** Viewport &gt; 840px but sources column dragged wide (~900px); expand slice workspace.

**Cause:** Two-column grid (`minmax(260px, 34%)` aside) switched only on viewport `narrowExpanded` (840px), not on the **expanded host** width. Empty inspector column still consumed inner split width.

**Fix:**

- `root-registry-slice-workspace__body`: `container-type: inline-size; container-name: slice-expanded`.
- Default expanded layout: **single column**; `@container slice-expanded (min-width: 40rem)` → two columns (`minmax(16rem, 34%)` aside). Threshold documents ~20rem waveform + 16rem settings + gap.
- `:has(.root-registry-slice-workspace)` on inner split: hide inspector column + divider, main primary `width: 100%` — **inspector stays mounted** (`inert` only), state preserved on collapse.
- Removed viewport-only `slice-workbench--expanded-narrow` class wiring (`narrowExpanded` deprecated, portal/session unchanged).

## E2E

Extended [`e2e/inspector-layout-stability.spec.ts`](../e2e/inspector-layout-stability.spec.ts):

- 1280×600 reachability + chrome stability
- 900px wide sources + expanded slice stack / re-widen
- 840px narrow roundtrip + preview range
- en long filename plot bounds
- Plot height assertions (80–200px preview)

[`playwright.config.ts`](../playwright.config.ts): `webkit-layout` project runs this spec only. CI installs `chromium webkit`.

Screenshots: `docs/testing/screenshots/mo-ui-layout-containment-fix-2/`.

## Verification (local)

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run build` | PASS |
| Layout E2E (Chromium + WebKit, 14×2 runs) | PASS |
| `e2e/slice-workspace-expand.spec.ts` | PASS |
| `pnpm run test:frontend` | FAIL — `AudioFileTable.test.tsx` popover text (unchanged by this diff; investigate separately) |
| `cargo fmt/clippy/test` | NOT_RUN if `cargo` unavailable |
| Native Tauri acceptance | Operator — see below |

### Native (operator)

```bash
cd ".worktrees/ui-inspector-layout-stability-1"
pnpm run tauri:dev   # not pnpm dev alone; free port 1420
```

Confirm: 600px-tall window → Inspector tabs scroll to bottom fields; 900px + wide sources → expanded slice stacks; collapse restores split; Preview range preserved.

Playwright WebKit PASS ≠ Tauri WebKit layout parity.

## Final SHA

(Update after push.)
