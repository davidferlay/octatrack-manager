# MO-UI-LAYOUT-CONTAINMENT-FIX-3 — handoff

## Scope

PR [#138](https://github.com/kaz4g/masterocta/pull/138) / branch `feat/ui-inspector-layout-stability-1`.

Follow-up to [MO_UI_LAYOUT_CONTAINMENT_FIX_2.md](./MO_UI_LAYOUT_CONTAINMENT_FIX_2.md).

## Problems addressed

### 1. Expanded slice did not reclaim inner split width (High)

**Repro:** Expand slice workspace after adjusting main/inspector split; viewport ~900px with wide sources.

**Cause:** `SplitPane.Primary` inline `flex` / `maxWidth` (% of inner split) beat CSS `width: 100% !important` only; main stayed ~55–75% with empty right gutter.

**Fix:** [`AppShell.css`](../src/app/AppShell.css) — expanded `:has(.root-registry-slice-workspace)` primary: `max-width: none !important`, `flex: 1 1 auto !important`. `primarySize` state unchanged; collapse restores inline %.

### 2. Inspector tabbed scroll escape blocked (Medium)

**Cause:** `.mo-inspector-pane__body--tabbed > * { overflow: hidden }` clipped keyed wrapper; `.mo-inspector-tabbed { overflow: auto }` could not scroll chrome.

**Fix:**

- Keyed wrapper class `mo-inspector-pane__tabbed-host` ([`RootRegistryPanel.tsx`](../src/features/roots/RootRegistryPanel.tsx)).
- Host flex chain + tabbed `overflow: auto` via `.mo-inspector-pane__tabbed-host > .mo-inspector-tabbed` ([`InspectorPane.css`](../src/features/inspector/InspectorPane.css)).
- Slice expand toolbar moved **inside** slice tab panel ([`InspectorTabbedAssetPanel.tsx`](../src/features/inspector/InspectorTabbedAssetPanel.tsx)) so it does not overlay portaled controls.

### 3. Short viewport (1280×600) + long filename

**Cause:** Workspace shell `min-height: 24rem` and tall context/header left ~0px for inspector panels; detect click intercepted.

**Fix:** Workspace shell/context/header caps ([`AppShell.css`](../src/app/AppShell.css), [`InspectorTabbedAssetPanel.css`](../src/features/inspector/InspectorTabbedAssetPanel.css)); panels `min-height: 8rem` in workspace only (with scroll chain, not FIX-1 clip).

Container query `40rem` unchanged.

## E2E

[`e2e/inspector-layout-stability.spec.ts`](../e2e/inspector-layout-stability.spec.ts):

- `expectExpandedMainFillsInnerSplit` during expand (±2px).
- 1280×600 ja/en: tabbed `overflow` escape + **real** compact-slice detect → apply enabled.
- 900px: sources drag 200px + expand width fill + 1-column host &lt; 640px.

Screenshots: `docs/testing/screenshots/mo-ui-layout-containment-fix-3/`.

## Verification

| Check | Result |
| --- | --- |
| Start SHA | `4bc0df2a2c023a6743ce1e54db83a32f40cbfce2` |
| `pnpm run typecheck` | PASS |
| `pnpm run build` | PASS |
| Layout E2E (Chromium + WebKit, 16) + `slice-workspace-expand` (2 Chromium) | PASS (18) |
| `pnpm run test:frontend` | Not re-run this pass (known unrelated `AudioFileTable` popover fail on FIX-2) |
| `cargo` | NOT_RUN |
| Native Tauri (600px / expand full width) | **Operator** — see below |

### Native (operator)

With this worktree `pnpm run tauri:dev` (port 1420):

1. Window height ~600px, long sample name → all inspector tabs + compact slice detect click.
2. Expand slice → main fills inner split (no right gutter); wide sources → 1-column expanded editor.
3. Collapse → prior split % and preview range preserved.

Playwright PASS ≠ Tauri WebKit parity.

PR: https://github.com/kaz4g/masterocta/pull/138
