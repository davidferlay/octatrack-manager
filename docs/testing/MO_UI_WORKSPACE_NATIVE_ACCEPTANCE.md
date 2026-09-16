# MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1

**Work ID:** `MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1` (+ fix pass `MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-FIX-1`)  
**Base:** GitHub `main` after PR #135 merge (`22344fb386b1f5e17ee7fea524130eb101fd53ab`)  
**Branch:** `feat/ui-workspace-native-acceptance-1`  
**PR:** [#136](https://github.com/kaz4g/masterocta/pull/136) (Draft)  
**Review target SHA (start of FIX-1):** `b386d3bbc970774ca0d0a2e5379637888e371361`  
**Final PR head:** `f7fe55192b1b52a6a296bf096c744f9cc48b4c52` (FIX-1 code: `bc78af6`, clippy: `9935ae2`)  
**Host OS:** Darwin 25.6.0 (macOS)  
**Recorded (UTC):** 2026-09-16  

Sanitized record: no operator home paths, no real Octatrack media, no production catalog paths.

## Scope

Real Tauri **development** build on #132–#135 integrated UI. Synthetic fixture only.
Mock IPC / Playwright success is **not** native acceptance. **Merge / public release:** not authorized.

## Review FIX-1 (8 items)

| # | Topic | Reproduce (before) | Fix | Verification |
| --- | --- | --- | --- | --- |
| 1 | P1 fixture output safety | CLI accepted arbitrary paths; overwrote via mkdir/write | Managed temp root only; `validateEmptyFixtureRoot`; exclusive `wx` writes; no delete-then-write; cleanup owned root on failure | `scripts/generate-ui-workspace-native-fixture.test.mjs` (8 cases) |
| 2 | P2 catalog path / isolation | Doc implied HOME= alone; path partly wrong | Trace `lib.rs` → `open_shared_catalog`; document **code-derived** path vs **observed** path; launcher child only | `prepare-ui-workspace-native-acceptance.sh` + this doc; runtime catalog file **NOT_RUN** |
| 3 | P2 Node/pnpm launcher | Parent `export HOME`; PATH glob `node/*/bin` | `launch-native-acceptance-tauri.sh` preserves parent PATH; resolves node/pnpm/cargo via `command -v`; respects RUSTUP_HOME/CARGO_HOME | Manual review + prepare output |
| 4 | P2 RANGE SHA256 | Manifest JSON only | `verify-ui-workspace-range-sha.mjs` hashes file bytes; prepare exits non-zero on mismatch | Node tests + prepare integration |
| 5 | P2 catalog list path | Test used live scan snapshot only | `list_library_dto_sync` (same as `v2_library_list`) after register | `cargo test --locked ui_workspace_native_fixture_registers_and_lists_audio` |
| 6 | P2 CI hook | `test:ui-native-fixture` not in CI | Added to `.github/workflows/ci.yml` frontend job + root `pnpm test` | CI on final head (see below) |
| 7 | P2 empty UI location | `EMPTY_SLOT` not a catalog location | `ACCEPT_PROJ` project location (selectable, zero audio files); search-zero separate (`xyzzy_nomatch` in pool) | Manifest `acceptanceLocations` + Rust assertion on zero `project_local` under ACCEPT_PROJ |
| 8 | P1 Cargo `--locked` | Scripts/docs omitted `--locked` | `package.json` `test:rust`, CI rust job use `--locked` | Local `cargo test --locked` PASS |

## Isolation

| Item | Value |
| --- | --- |
| Generator | `scripts/generate-ui-workspace-native-fixture.mjs` (managed root; no CLI output path) |
| Prep | `scripts/prepare-ui-workspace-native-acceptance.sh` |
| Launcher | `scripts/launch-native-acceptance-tauri.sh <isolated_home> [repo_root]` |
| Bundle ID | `jp.d3nousan.masterocta` ([`tauri.conf.json`](../../src-tauri/tauri.conf.json)) |
| **Code-derived** data dir (macOS, isolated HOME) | `$HOME/Library/Application Support/jp.d3nousan.masterocta` |
| **Code-derived** catalog DB | `…/MasterOCTa/catalog.sqlite3` ([`catalog_runtime.rs`](../../src-tauri/src/catalog_runtime.rs)) |
| **Observed** catalog path after register | **NOT_RUN** (operator: `test -f` on path under `isolated_home` only) |

Setting `HOME` alone is **not** recorded as isolation proof.

## Fixture (deterministic)

Regenerate: `bash scripts/prepare-ui-workspace-native-acceptance.sh` (creates managed set root + verifies RANGE SHA).

| Role | Path | SHA-256 (file) |
| --- | --- | --- |
| sampleA (M7 RANGE) | `SET/AUDIO/RANGE.wav` | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| sampleB | `SET/AUDIO/ALT_FOUR_SEC.wav` | `6c593d608fe6d94bc780703e73458857ec01831895574dd1019b31dc5606aec0` |
| japaneseName | `SET/AUDIO/キック_受入.wav` | `3fa20276d8a4131431490ed129d0b05fafa4e9c82d4339b5cf635512103d6615` |
| longName | `SET/AUDIO/very_long_disposable_name_for_layout_overflow_acceptance_check.wav` | (same as 1 s silent fixture) |
| searchZeroHint | `SET/AUDIO/zz_no_search_hit.wav` | use query `xyzzy_nomatch` in Audio Pool |
| empty list location | **Project** `SET/ACCEPT_PROJ` (catalog location; zero audio files) | — |

**Range contract (sample A):** half-open absolute PCM. Range A `[44100, 132300)`; Range B `[176400, 220500)` → `ANALYSIS_REGION_MISMATCH` when draft from A exists.

WAV bytes are not committed.

## Evidence classes (do not conflate)

| Class | Status |
| --- | --- |
| Fixture generation + byte SHA verify | **PASS** (automated) |
| Rust catalog-backed `v2_library_list` DTO test | **PASS** (automated; not WebView IPC) |
| Tauri dev startup smoke | **NOT_RUN** in FIX-1 pass (prior timeout ≠ success; not re-run as PASS) |
| WebView native IPC + operator UI | **NOT_RUN** |
| Operator hearing / post-UI WAV SHA | **NOT_RUN** |
| Runtime catalog path observation | **NOT_RUN** |

## Operator native acceptance (#132–#135 + M7 UI)

| Area | Result |
| --- | --- |
| Location → list → Inspector | **NOT_RUN** |
| Tabs / Notes / locale | **NOT_RUN** |
| Empty **project** list vs search-zero in pool | **NOT_RUN** (fixture ready) |
| Operations Drawer / writes | **NOT_RUN** |
| Slice expand / restart / hearing | **NOT_RUN** |
| Recovery Required UI | **NOT_RUN** |
| Display / screenshots | **NOT_RUN** |

**Overall native product acceptance:** **NOT_COMPLETE**

## Operator commands (next)

```bash
cd .worktrees/ui-workspace-native-acceptance-1
bash scripts/prepare-ui-workspace-native-acceptance.sh
# Use printed isolated_home and fixture_root; confirm range_sha256_ok line.

REAL_HOME="${REAL_HOME:-$HOME}" \
  ./scripts/launch-native-acceptance-tauri.sh "<isolated_home>" "$(pwd)"
# Register printed fixture_root (read-only). After rescan, verify catalog file under isolated_home only.

node scripts/verify-ui-workspace-range-sha.mjs "<fixture_root>/SET/AUDIO/RANGE.wav"
```

## Local verification (FIX-1)

| Check | Result |
| --- | --- |
| `pnpm run test:ui-native-fixture` | **PASS** (8 tests) |
| `cargo test --locked -p masterocta --features test-seams ui_workspace_native_fixture_registers_and_lists_audio` | **PASS** |
| `bash scripts/prepare-ui-workspace-native-acceptance.sh` | **PASS** (exits 0 only after byte SHA verify) |
| `pnpm run typecheck` / `test:frontend` / `build` | Run at commit time |
| GitHub Actions on final PR head | **PASS** — [Run 35072520250](https://github.com/kaz4g/masterocta/actions/runs/35072520250) (`f7fe551`: Frontend Checks incl. `test:ui-native-fixture`, Rust `--locked`, E2E, Gate C) |

## Failures / fixes

No UI product defects found in FIX-1 scope; changes are fixture safety, verification, catalog test path, CI, and docs.

## Next

Complete operator NOT_RUN matrix before `.ot` output design. Operator panel i18n remains a separate task.
