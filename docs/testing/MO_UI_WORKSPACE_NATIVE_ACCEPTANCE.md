# MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1

**Work ID:** `MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1` (+ fix pass `MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-FIX-1`)  
**Base:** GitHub `main` after PR #135 merge (`22344fb386b1f5e17ee7fea524130eb101fd53ab`)  
**Branch:** `feat/ui-workspace-native-acceptance-1`  
**PR:** [#136](https://github.com/kaz4g/masterocta/pull/136)  
**Review target SHA (start of FIX-1):** `b386d3bbc970774ca0d0a2e5379637888e371361`  
**Final PR head:** `e1e586f121b0` (FIX-1 code: `bc78af6`, clippy: `9935ae2`)  
**PR body / review replies:** [`PR136_BODY.md`](PR136_BODY.md); after `gh auth login` (単独実行), run `bash scripts/pr136-respond-and-resolve-reviews.sh` (GraphQL reply + resolve)  
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
| 2 | P2 catalog path / isolation | Doc named bundle-id Application Support segment (stale) | Trace `lib.rs` → `data_dir()` → `open_shared_catalog`; document **code-derived** vs **observed** paths and `/tmp` ↔ `/private/tmp` | Real native catalog + `lsof` on `0f39f50` (**PASS**) |
| 3 | P2 Node/pnpm/Rust launcher | Parent `export HOME`; cargo only if already on PATH; `pnpm run tauri:dev` mixed isolated `HOME` with `$HOME/.cargo` | `launch-native-acceptance-env.mjs` + launcher: child `HOME` isolated; `CARGO_HOME`/`RUSTUP_HOME` on real user; `pnpm exec tauri dev`; cargo resolved from PATH or `${CARGO_HOME}/bin` or `${REAL_HOME}/.cargo/bin` | `scripts/launch-native-acceptance-tauri.test.mjs` (Cases A–F) |
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
| Bundle ID | `jp.d3nousan.masterocta` ([`tauri.conf.json`](../../src-tauri/tauri.conf.json)) — app identity only; **not** a path segment for catalog storage on current `main` |
| **Code-derived** Tauri `data_dir` (macOS, child `HOME=<isolated>`) | `$HOME/Library/Application Support/MasterOCTa` via `app.path().data_dir()` ([`lib.rs`](../../src-tauri/src/lib.rs)) |
| **Code-derived** catalog DB | `$HOME/Library/Application Support/MasterOCTa/catalog.sqlite3` ([`catalog_runtime.rs`](../../src-tauri/src/catalog_runtime.rs): `data_directory` → `MasterOCTa/catalog.sqlite3`) |
| **Observed** catalog path (2026-09-19 native pass on `0f39f50`) | `/private/tmp/masterocta-ui-native-0f39f5056c25-20260919T045840Z/Library/Application Support/MasterOCTa/catalog.sqlite3` (same inode as `/tmp/...` on macOS) |
| **Observed** process ↔ catalog binding | **PASS** — `lsof` on native `masterocta` showed open handle on the observed catalog path above (PID 53687 at acceptance time; not a permanent fixture) |

Setting `HOME` alone is **not** recorded as isolation proof. Isolation evidence requires an **isolated catalog file on disk** and a **live native process handle** on that catalog (both **PASS** on `0f39f50`; see §Real native acceptance on `main` post-#142).

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
| Tauri dev startup smoke | **PASS** on `0f39f50` (real native session; see below) |
| WebView native IPC + operator UI | **PASS** on `0f39f50` (operator matrix below) |
| Operator hearing / post-UI WAV SHA | **PASS** — RANGE.wav SHA unchanged (see below) |
| Runtime catalog path observation | **PASS** on `0f39f50` |

## Real native acceptance on `main` post-#142

**Work ID:** `MO-NATIVE-ACCEPTANCE-HARNESS-DOCS-FIX-1` (harness/docs follow-up; product acceptance recorded here)  
**Main commit:** `0f39f5056c25e996f1e3ff69b7a51ca20b0c45bb` (merge PR #142)  
**Main CI:** [Run 35422189584](https://github.com/kaz4g/masterocta/actions/runs/35422189584) — **SUCCESS**  
**Isolated HOME (sanitized):** `/tmp/masterocta-ui-native-0f39f5056c25-20260919T045840Z`  
**Native binary (dev):** `target/debug/masterocta`  
**Recorded (UTC):** 2026-09-19  

### Native isolation

| Check | Result |
| --- | --- |
| Native launch | **PASS** |
| Isolated catalog file exists | **PASS** |
| Runtime process ↔ isolated catalog (`lsof`) | **PASS** |

### Catalog / UI

| Check | Result |
| --- | --- |
| Root register | **PASS** |
| Scan | **PASS** |
| SET | **PASS** |
| Audio Pool | **PASS** |
| RANGE.wav | **PASS** |
| ACCEPT_PROJ (0 files) | **PASS** |
| `xyzzy_nomatch` search zero | **PASS** |
| Inspector tabs | **PASS** |

### Narrow UI (800×600)

| Check | Result |
| --- | --- |
| Sources drawer | **PASS** |
| Horizontal overflow | none — **PASS** |
| List ↔ inspector | **PASS** |

### Slice / Range (Range A)

Half-open PCM `[44100, 132300)` @ 44100 Hz (1.000 s → 3.000 s).

| Check | Result |
| --- | --- |
| Preview range | **PASS** |
| Preview → Slice handoff | **PASS** |
| Analysis region | **PASS** |
| Candidates (2) / suppressed (2) | **PASS** |
| Apply candidates | **PASS** |
| Draft slices (2), revision 1 | **PASS** |

### Persistence / mismatch

After selecting another file then returning to RANGE.wav:

| Check | Result |
| --- | --- |
| Saved draft persistence | **PASS** |
| Preview selection reset / full-file | observed |
| Existing Range A draft vs different analysis region | fail-closed **PASS** |
| Range branching unsupported contract | preserved **PASS** |

### Session recovery (15 min TTL)

Native UI (ja): expired session + re-analyze required; draft preserved; apply disabled.

| Check | Result |
| --- | --- |
| `ANALYSIS_EXPIRED` | **PASS** |
| Candidate discard | **PASS** |
| Apply disabled | **PASS** |
| Draft slices (2) / revision 1 preserved | **PASS** |
| No auto re-analysis | **PASS** |

### Locale (invalid → en)

| Check | Result |
| --- | --- |
| Expired copy (en) | **PASS** |
| Draft / revision preserved | **PASS** |
| No auto re-analysis | **PASS** |

### Explicit recovery

Analyze again: new analysis, candidates restored, Apply re-enabled; draft unchanged.

| Check | Result |
| --- | --- |
| New analysis | **PASS** |
| Candidates (2) restored | **PASS** |
| Apply candidates re-enabled | **PASS** |
| Draft slices (2) / revision 1 preserved | **PASS** |

### Byte integrity

Post-acceptance `RANGE.wav` SHA-256: `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` (matches generation manifest) — **PASS**, file unchanged.

**Overall native product acceptance on `0f39f50`:** **PASS**

## Operator native acceptance (#132–#135 + M7 UI) — historical FIX-1 matrix

Pre-`0f39f50` rows remain **NOT_RUN** in the FIX-1 pass; superseded by the table above for integrated `main`.

| Area | Result |
| --- | --- |
| Location → list → Inspector | **PASS** on `0f39f50` |
| Tabs / Notes / locale | **PASS** on `0f39f50` |
| Empty **project** list vs search-zero in pool | **PASS** on `0f39f50` |
| Operations Drawer / writes | **NOT_RUN** |
| Slice expand / restart / hearing | **PASS** (slice/range + recovery on `0f39f50`) |
| Recovery Required UI | **PASS** (`ANALYSIS_EXPIRED` on `0f39f50`) |
| Display / screenshots | **NOT_RUN** |

## Operator commands (next)

Run from the **current** checkout that contains this harness (`main` after #142, or this PR worktree). Do **not** `cd` into `.worktrees/ui-workspace-native-acceptance-1` (historical PR #136 / `e1e586f`).

```bash
bash scripts/prepare-ui-workspace-native-acceptance.sh
# Use printed isolated_home and fixture_root; confirm range_sha256_ok line
# and catalog_sqlite=.../Library/Application Support/MasterOCTa/catalog.sqlite3
# (no jp.d3nousan.masterocta path segment).

REAL_HOME="${REAL_HOME:-$HOME}" \
  ./scripts/launch-native-acceptance-tauri.sh "<isolated_home>" "$(pwd)"
# Child: HOME=<isolated_home>; CARGO_HOME/RUSTUP_HOME on REAL_HOME; pnpm exec tauri dev (not tauri:dev).
# Register printed fixture_root (read-only). After rescan, verify:
#   <isolated_home>/Library/Application Support/MasterOCTa/catalog.sqlite3
#   (macOS may show /private/tmp/... for the same path)

node scripts/verify-ui-workspace-range-sha.mjs "<fixture_root>/SET/AUDIO/RANGE.wav"
```

## Local verification (FIX-1)

| Check | Result |
| --- | --- |
| `pnpm run test:ui-native-fixture` | **PASS** (fixture + launcher harness tests) |
| `cargo test --locked -p masterocta --features test-seams ui_workspace_native_fixture_registers_and_lists_audio` | **PASS** |
| `bash scripts/prepare-ui-workspace-native-acceptance.sh` | **PASS** (exits 0 only after byte SHA verify) |
| `pnpm run typecheck` / `test:frontend` / `build` | Run at commit time |
| GitHub Actions on final PR head | **PASS** — [Run 35073128124](https://github.com/kaz4g/masterocta/actions/runs/35073128124) (`e1e586f`: Frontend Checks incl. `test:ui-native-fixture`, Rust `--locked`, E2E, Gate C) |

## Failures / fixes

No UI product defects found in FIX-1 scope; changes are fixture safety, verification, catalog test path, CI, and docs.

## Harness drift fixed (MO-NATIVE-ACCEPTANCE-HARNESS-DOCS-FIX-1)

| Issue | Root cause | Fix |
| --- | --- | --- |
| Catalog path docs + prepare script | Stale bundle-id Application Support segment in docs and `prepare-ui-workspace-native-acceptance.sh` | Align printed/tested path with `data_dir()` + `catalog_runtime` and 2026-09-19 `lsof` observation |
| Launcher `cargo metadata` failure | `command -v cargo` only when cargo absent from parent PATH; `bash -lc` + `pnpm run tauri:dev` used isolated `$HOME` for cargo path | Resolve cargo from real toolchain homes; `bash -c` + `pnpm exec tauri dev` |

## Next

Operations Drawer native write paths remain **NOT_RUN**. Operator panel i18n remains a separate task.
