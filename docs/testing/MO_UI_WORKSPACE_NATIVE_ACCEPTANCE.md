# MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1

**Work ID:** `MO-UI-WORKSPACE-NATIVE-ACCEPTANCE-1`  
**Base:** GitHub `main` after PR #135 merge (`22344fb386b1f5e17ee7fea524130eb101fd53ab`)  
**Branch:** `feat/ui-workspace-native-acceptance-1`  
**Host OS:** Darwin 25.6.0 (macOS)  
**Recorded (UTC):** 2026-09-16  

Sanitized record: no operator home paths, no real Octatrack media, no production catalog paths.

## Scope

Real Tauri **development** build (`pnpm run tauri:dev`) on #132–#135 integrated UI. Synthetic fixture only.
Mock IPC / Playwright success is **not** native acceptance. **Merge:** not performed. **Public distribution:** not authorized.

## Preconditions

| Check | Result | Kind |
| --- | --- | --- |
| #135 merged (`MO-UI-SLICE-WORKSPACE-1`) | **PASS** | recorded |
| Worktree at `origin/main` `22344fb` | **PASS** | git |
| Isolated HOME procedure documented | **PASS** | script |
| Mock/E2E substituted for native UI | **PASS (negative)** | policy |

## Isolation

| Item | Value |
| --- | --- |
| Generator | `scripts/generate-ui-workspace-native-fixture.mjs` |
| Prep | `scripts/prepare-ui-workspace-native-acceptance.sh` |
| App data | `export HOME=<isolated>` → `Library/Application Support/jp.d3nousan.masterocta/…` |
| Toolchain | `REAL_HOME` + `RUSTUP_HOME` / `CARGO_HOME` / `PATH` (not isolated) |
| `tauri:dev` note | `package.json` prepends `$HOME/.cargo/bin`; with isolated `HOME`, ensure `CARGO_HOME/bin` stays on `PATH` |

## Fixture (deterministic)

Set layout: `SET/AUDIO/` + project `SET/ACCEPT_PROJ/project.work` (copy of reviewed `real_device_os_1_40` fixture, SHA-256 `742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6`).

| Role | Path | Frames | SHA-256 (file) |
| --- | --- | --- | --- |
| sampleA (M7 RANGE) | `SET/AUDIO/RANGE.wav` | 264600 | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| sampleB | `SET/AUDIO/ALT_FOUR_SEC.wav` | 176400 | `6c593d608fe6d94bc780703e73458857ec01831895574dd1019b31dc5606aec0` |
| japaneseName | `SET/AUDIO/キック_受入.wav` | 44100 | `3fa20276d8a4131431490ed129d0b05fafa4e9c82d4339b5cf635512103d6615` |
| longName | `SET/AUDIO/very_long_disposable_name_for_layout_overflow_acceptance_check.wav` | 44100 | `3fa20276d8a4131431490ed129d0b05fafa4e9c82d4339b5cf635512103d6615` |
| opsClone/Rename/Copy | `SET/AUDIO/ops_*.wav` | 44100 each | `3fa20276d8a4131431490ed129d0b05fafa4e9c82d4339b5cf635512103d6615` |
| empty location | `SET/AUDIO/EMPTY_SLOT/` | — | (no WAV) |

**Range contract (sample A):** half-open absolute PCM frames. Range A `[44100, 132300)` → expect onsets 66150 & 110250 in band; 22050 & 198450 out of band. Range B `[176400, 220500)` → `ANALYSIS_REGION_MISMATCH` when draft from A exists (ROI branch not implemented).

WAV bytes are not committed; regenerate via scripts above.

## Automated observations (non-GUI)

| Step | Result | Notes |
| --- | --- | --- |
| `node --test scripts/generate-ui-workspace-native-fixture.test.mjs` | **PASS** | sampleA SHA matches M7 |
| `v2_api::tests::ui_workspace_native_fixture_registers_and_lists_audio` | **PASS** | real register + scan IPC stack |
| `pnpm run typecheck` / `test:frontend` (610) / `build` | **PASS** | worktree head |
| `cargo fmt --check` / `clippy -D warnings` (workspace) | **PASS** | after acceptance commit |
| `pnpm run tauri:dev` + isolated `HOME` (~120 s window) | **PASS (partial)** | `cargo run` started `masterocta`; no Rust panic in log; session ended by timeout (Vite EPIPE) — not full UI exercise |
| Playwright / `__E2E_ROOT_PATH__` used for native claim | **PASS (negative)** | not used |

## Operator native acceptance (#132–#135 + M7 UI)

| Area | Result | Kind |
| --- | --- | --- |
| #132 Location → list → Inspector (real catalog) | **NOT_RUN** | folder picker + operator |
| #133 Tabs, Notes save/reload, locale without reset | **NOT_RUN** | operator |
| #133 Search zero / empty location smoke | **NOT_RUN** | operator (fixture ready) |
| #134 Clone / Rename / Copy drawer flows + writes | **NOT_RUN** | operator + write grant |
| #134 Drawer close retains input; Prepare busy guards | **NOT_RUN** | operator |
| #134 Prepared restart via status bar | **NOT_RUN** | operator |
| #134 Recovery Required → recovery UI | **NOT_RUN** | no safe synthetic recovery fixture (by design) |
| #135 Expand ↔ compact slice workspace | **NOT_RUN** | operator |
| M7 A–D (range preview hearing, analyze, draft, mismatch) | **NOT_RUN** | picker + hearing + UI |
| Draft restart persistence | **NOT_RUN** | operator |
| Display 1280/840 ja/en + screenshots | **NOT_RUN** | operator |
| Operator panel body English | **NOTE** | recorded; out of scope for this task |

**Overall native product acceptance:** **NOT_COMPLETE** until operator rows above are exercised on real `tauri:dev` with this fixture. Automated catalog + dev startup evidence does **not** close the matrix.

## Session vs restart persistence (expected contract)

| State | After tab/expand toggle (design) | After quit + re-register (design) |
| --- | --- | --- |
| Slice draft / markers / analysis region | keep same session | reload if persisted in catalog (verify operator) |
| Waveform zoom/pan (Library) | keep per #133 handoff | not required to persist across restart |
| List search/page/location | keep per #132/#135 handoff | not required across restart |

## Failures / fixes

| Issue | Action |
| --- | --- |
| UI integration defects in this pass | **None observed** in automated scope |
| Regression tests added | fixture node test + Rust catalog smoke test |

## Verification commands (reference)

```bash
cd .worktrees/ui-workspace-native-acceptance-1
bash scripts/prepare-ui-workspace-native-acceptance.sh
pnpm run test:ui-native-fixture
CI=true pnpm run typecheck && CI=true pnpm run test:frontend && CI=true pnpm run build
cd src-tauri && cargo test ui_workspace_native_fixture_registers_and_lists_audio
```

## Next

- Operator: complete NOT_RUN matrix; append sanitized results to this file.
- `.ot` output / export design: proceed only after native UI acceptance **PASS** (or explicit waiver).
- Operator panel i18n: separate task (see `docs/I18N.md`).
