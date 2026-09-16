## Description

MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1 + **FIX-1** (`MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-FIX-1`): synthetic Octatrack fixture, safe generation, catalog-backed Rust smoke, and a **repeatable native acceptance procedure** (not a claim of full product native PASS).

- **Base:** `main` @ `22344fb` (after #135)
- **FIX-1 review start:** `b386d3b`
- **Head:** `e1e586f` (FIX-1 implementation `bc78af6`, clippy `9935ae2`)
- **Record:** [`docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md)

## Observed (pre FIX-1)

- Generator accepted arbitrary output paths and could overwrite existing trees.
- Prepare trusted manifest JSON for RANGE SHA, not file bytes.
- Native launcher mutated parent `HOME` / `PATH`; catalog path docs did not match code.
- Catalog smoke used live scan only, not `v2_library_list` DTO path.
- `EMPTY_SLOT` was not a selectable catalog location.
- `test:ui-native-fixture` was not in CI or root `pnpm test`; Cargo checks omitted `--locked`.

## Expected

- Managed-temp-only fixture generation with unsafe-target rejection and Node regression tests.
- Byte-level RANGE SHA verify (`43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1`); prepare exits non-zero on mismatch.
- Child-process launcher; **code-derived** vs **observed** catalog paths documented (`HOME` alone ≠ isolation proof).
- `list_library_dto_sync` integration test; CI runs fixture tests; Rust `--locked`.
- **Overall native UI acceptance remains NOT_COMPLETE** until operator WebView matrix is run.

## Changes

- `scripts/ui-workspace-fixture-safe.mjs`, `generate-ui-workspace-native-fixture.mjs` (+ `generate-ui-workspace-native-fixture.test.mjs`)
- `scripts/verify-ui-workspace-range-sha.mjs`, `prepare-ui-workspace-native-acceptance.sh`, `launch-native-acceptance-tauri.sh`
- `v2_api`: `ui_workspace_native_fixture_registers_and_lists_audio` via `list_library_dto_sync`
- CI: Frontend step `pnpm run test:ui-native-fixture`; Rust `--locked`
- Acceptance doc + CODEX_HANDOFF §6.0

## Test Coverage

### Rust (`src-tauri/`)

- [x] `cargo test --locked -p masterocta --features test-seams ui_workspace_native_fixture_registers_and_lists_audio`
- [x] `cargo clippy --locked` clean on FIX-1 head

### Frontend / Node

- [x] `pnpm run test:ui-native-fixture` (8 regression tests)
- [x] Included in root `pnpm test`

### CI

- [x] [Actions run 35073128124](https://github.com/kaz4g/masterocta/actions/runs/35073128124) — **success** on `e1e586f` (Frontend Checks incl. `test:ui-native-fixture`, Rust, E2E, Gate C)

## NOT_RUN (operator, post-merge)

WebView IPC, location picker, Operations Drawer, slice expand/restart, hearing, post-UI WAV SHA, runtime catalog path observation under isolated HOME.

## Operator next steps

```bash
bash scripts/prepare-ui-workspace-native-acceptance.sh
REAL_HOME="${REAL_HOME:-$HOME}" ./scripts/launch-native-acceptance-tauri.sh "<isolated_home>" "$(pwd)"
```

## Checklist

- [x] Fixture + verification scripts and regression tests
- [x] CI green on final head
- [ ] Operator native acceptance matrix (separate follow-up; doc tracks NOT_RUN)
