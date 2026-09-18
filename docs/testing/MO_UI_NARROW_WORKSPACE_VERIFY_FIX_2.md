# MO-UI-NARROW-WORKSPACE-VERIFY-FIX-2

**Work ID:** `MO-UI-NARROW-WORKSPACE-VERIFY-FIX-2` + follow-up `MO-UI-NARROW-WORKSPACE-VERIFY-FIX-2-FOLLOWUP`
**Branch:** `feat/ui-narrow-workspace-verify-fix-2`
**PR:** https://github.com/kaz4g/masterocta/pull/140 (Draft)
**Base (start):** `origin/main` @ `2fee043dbcaa65177cc561c1f49b88917a820d75` (merge PR #139)
**Follow-up start SHA:** `23b17564f26dc192cdcb695a0f43adb25662be83`
**Product change SHA:** `3986a929b4d52d9449be2f43bb679160b342522c`
**Verify target SHA:** `9907d42231141c2bd14fdd055ac904a2aeb6bd1e`

CI on start SHA `23b1756`: run [35398820632](https://github.com/kaz4g/masterocta/actions/runs/35398820632) — Rust / Frontend / E2E / Gate C ubuntu+macos **PASS**. That run does **not** cover this follow-up.

CI on verify SHA `9907d42`: run [35401675643](https://github.com/kaz4g/masterocta/actions/runs/35401675643) — Rust / Frontend / E2E / Gate C ubuntu+macos **PASS**.

## Summary

Real-viewport Playwright acceptance for narrow workspace (no `__E2E_FORCE_NARROW_WORKSPACE__` in product). Restored all six previously skipped layout regressions. Removed FIX-1 E2E-only narrow forcing from production code.

**Follow-up (this SHA):** restore **document-wide** horizontal overflow checks; restore **closed** wide Sources after a narrow roundtrip (`null` vs `false`).

## Root cause classification

| Issue | Class | Fix |
| --- | --- | --- |
| Sources drawer `CatalogWorkspaceNav` outside `CatalogBrowseProvider` (FIX-1) | Product | Already fixed in #139; verified stable at real 840px |
| `__E2E_FORCE_NARROW_WORKSPACE__` in `RootRegistryPanel` | Test / product seam | Removed from production; E2E uses actual viewport |
| `openInspectorSample` `Math.max(height, 720)` | Test harness | Removed; 800×600 runs at true height |
| Narrow transition closed drawer on every `navigationOpen` change | Product | Only auto-close on **enter** narrow; drawer toggle works in narrow |
| Wide Sources column not restored after narrow roundtrip | Product | Restore `navigationOpen` from wide snapshot |
| Status bar intercepting catalog clicks at 600px height | Product | Short-height workspace shell CSS + main pane scroll |
| `showListFromStatusBar` locator used wrong i18n key | Test harness | Use `workspace.showListStatusAria` |
| `useMediaQuery` 100ms poll | Product | Removed; `resize` / `matchMedia` / `visualViewport` listeners suffice |
| Split % lost on narrow roundtrip | Product | Controlled `sourcesSize` / `mainSize` on `AppShell` from `RootRegistryPanel` |
| WebKit `matchMedia` vs `innerWidth` at 841px | Environment | Assert product contract via `innerWidth <= 840` + `data-narrow-layout` |

### Follow-up #1 — document overflow (historical FAIL at `23b1756`)

**Before:** tests used `expectNoWorkspaceHorizontalOverflow` only. Remaining risk: Home header overflow.

**Cause (measured at 800/840):** `.app-version-container { margin-right: -1.0rem }` extended past `innerWidth` by 4px. Header row also used a fixed 52px height and non-wrapping flex (`Search` 150px + theme `min-width: 7.5rem` + tagline nowrap).

**Fix:** remove negative version margin; wrap `.project-header`; shrink search/theme/top-bar `min-width`; keep workspace overflow checks **and** restore document `scrollWidth` vs `innerWidth` (with offender dump). No `overflow-x: hidden` on `html`/`body`.

**After (local, follow-up SHA):** Chromium/WebKit 800×600, 839/840/841, 1280 — document overflow **PASS**.

### Follow-up #2 — Sources closed restore (historical “acceptable default” at `23b1756`)

**Before:** `setNavigationOpen(navigationOpenWideRef.current || true)` treated `false` as missing. Wide nav toggle was CSS-hidden (`display: none` on `.mo-app-shell__narrow-controls`).

**Fix:** `applyWideSourcesNavTransition` records `boolean | null`. Enter-narrow closes the drawer without writing the snapshot. Narrow drawer open/close does not overwrite. Leave-narrow restores `recorded ?? true`. Nav toggle visible in wide; list/inspector toggles stay narrow-only.

**After (local):**
- wide open + resize split → 800 → 1280: column **open**, width restored **PASS**
- wide close → 800 (open/close drawer) → 1280: column **closed** **PASS**
- first catalog at narrow (no wide snapshot): default open on later wide (unit) **PASS**

## Skip / fixme restoration (6 → 0)

| Former skip | Restored as |
| --- | --- |
| `workspace-layout` describe (2 tests @ 840px) | `test.describe` active, real viewport + document overflow |
| `840px: narrow stack, expand roundtrip…` | Active |
| `800x600: narrow workspace…` | Active; **document** + workspace overflow |
| `839/840/841px: breakpoint` | Three separate tests, fresh page per width + document overflow |
| `1280 to 800 to 1280: sources split %` | Active with controlled split state |
| (new) closed Sources roundtrip | `1280 to 800 to 1280: closed sources stay closed after narrow drawer use` |

Additional 840px library/slice/zoom specs use **840×900** real viewport (no force-narrow).

## Automated verification

### Historical (`23b1756`)

| Command | Result |
| --- | --- |
| CI run [35398820632](https://github.com/kaz4g/masterocta/actions/runs/35398820632) | PASS (Rust, Frontend, E2E, Gate C ubuntu+macos) |

### Follow-up (verify target SHA; do not treat `23b1756` CI as this SHA)

| Command | Result |
| --- | --- |
| `pnpm run typecheck` | PASS |
| `pnpm run test:frontend` | PASS (630 tests / 81 files) |
| `pnpm run test:workspace-css` | PASS |
| `pnpm run build` | PASS |
| Playwright `workspace-layout` + `inspector-layout-stability` (Chromium) | PASS (20) |
| Playwright same specs (`webkit-layout`) | PASS (20) |
| `cargo fmt --check` / `clippy -D warnings` / `cargo test --workspace --locked` | PASS (local `~/.cargo/bin/cargo`) |
| Follow-up CI on `9907d42` [35401675643](https://github.com/kaz4g/masterocta/actions/runs/35401675643) | PASS (Rust, Frontend, E2E, Gate C ubuntu+macos) |

## Native Tauri acceptance

**NOT_RUN** (no GUI/picker/hearing in this session). Launching against the operator’s live Tauri/HOME is forbidden.

Operator steps (new isolated `HOME`, this worktree only):

1. Confirm HEAD is the verify target SHA in
   `.worktrees/ui-narrow-workspace-verify-fix-2`
2. Temporary fixture + isolated `HOME` (`RUSTUP_HOME` / `CARGO_HOME` unchanged).
3. Real window: 800×600 register + list; document has no extra horizontal scroll; Sources drawer; list↔inspector; wide open/closed + split restore; Preview/Slice play-stop at 800×600.
4. Range A `[44100,132300)` and draft survive width changes; range B mismatch contract unchanged.
5. Re-hash `RANGE.wav`; catalog path via `lsof` on the live process.

## Evidence

- Playwright attachments: `test-results/**/*layout-metrics.json` and screenshots via `testInfo.outputPath` (not committed under `docs/testing/`).

## Remaining risks

- **Resolved in follow-up:** document overflow from Home chrome; closed Sources always reopening.
- Native GUI still **NOT_RUN**.
- Public distribution **NOT AUTHORIZED**. Draft PR only.
