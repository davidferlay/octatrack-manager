# M7 Library range → slice native acceptance

**Work ID:** `MO-M7-RANGE-TO-SLICE-NATIVE-ACCEPTANCE-1`  
**Pull Request:** https://github.com/kaz4g/masterocta/pull/131  
**Application commit (build SHA):** `31ef6caeda25095f21b49b1096423f96c3f35478`  
**Host OS:** Darwin 25.6.0 (macOS)  
**Recorded (UTC):** 2026-09-15T04:52Z  

This record is **sanitized**: no operator home paths, no real Octatrack media,
no catalog file paths from production installs.

## Scope

Real Tauri **development** build (`pnpm run tauri:dev`) on branch
`feat/m7-range-to-slice-analysis-1`, synthetic Set fixture only. Mock IPC /
Playwright E2E success is **not** treated as this acceptance.

**Merge:** not performed. **Public distribution:** not authorized.

## Preconditions

| Check | Result | Evidence |
| --- | --- | --- |
| Local HEAD matches PR head | **PASS** | `31ef6caeda25095f21b49b1096423f96c3f35478` |
| CI on head (Frontend, Rust, E2E, Gate C ubuntu+macos) | **PASS** | Actions run [34929667085](https://github.com/kaz4g/masterocta/actions/runs/34929667085) |
| PR Draft state (plan: maintain Draft) | **NOTE** | GitHub `isDraft: false` (Ready for review). Re-draft requires operator-approved `gh pr ready 131 --undo` (Auto-review may gate). |
| Review fix 1 — stop in-flight range preview on analyze | **PASS** | `WaveformPreview.tsx` + `WaveformPreview.test.tsx` |
| Review fix 2 — `INVALID_SLICE_REQUEST` detail node | **PASS** | `sliceErrors.ts`, `SliceErrorAlert.tsx` |
| Review fix 3 — locale change does not reset draft | **PASS** | `SliceWorkbench.tsx` effect deps |
| Review fix 4 — error re-translates on locale switch | **PASS** | `SliceErrorState` + render-time `t` |

## Isolation and fixture

App data is isolated by running with a **dedicated `HOME`** so Tauri
`app.path().data_dir()` resolves under that tree (macOS:
`Library/Application Support/jp.d3nousan.masterocta/…`). The operator’s normal
Application Support tree was not modified.

Rust / Node toolchains remain on the real user home (`RUSTUP_HOME`, `CARGO_HOME`,
`PATH`); only application support uses isolated `HOME`.

| Item | Value |
| --- | --- |
| Generator | `scripts/generate-range-slice-native-fixture.mjs` |
| Prep helper | `scripts/prepare-range-slice-native-acceptance.sh` |
| Set layout | `SET/AUDIO/RANGE.wav` (Set = folder containing `AUDIO/`) |
| Sample rate / format | 44100 Hz, 16-bit mono, 6 s |
| `frameCount` | 264600 |
| `byteSize` | 529244 |
| SHA-256 (WAV file) | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| Annotated attack frames | 22050, 66150, 110250, 198450 (0.5 s, 1.5 s, 2.5 s, 4.5 s) |
| Range A (half-open) | `[44100, 132300)` — expect onsets at 66150 & 110250 only (±88 frames @ 44.1 kHz) |
| Range B (half-open) | `[176400, 220500)` — expect mismatch after draft from A |

WAV bytes are **not** committed; regenerate with the scripts above.

## Automated observations (non-UI)

| Step | Result | Notes |
| --- | --- | --- |
| `pnpm run tauri:dev` at build SHA with isolated `HOME` | **PASS** | Vite + `cargo run` finished; no `panic` in captured dev log (~180 s window) |
| Native folder registration | **NOT_RUN** | Requires operator macOS folder picker |
| Post-register `catalog.sqlite3` under isolated HOME | **NOT_RUN** | Catalog appears after register/rescan (not observed without picker) |
| Mock / E2E path used | **PASS (negative)** | Dev session was not Playwright / `__E2E_ROOT_PATH__` |

## Operator acceptance (A–D)

| ID | Step | Result | Operator / automated |
| --- | --- | --- | --- |
| A | Non-zero range select, numeric 44100–132300, range preview Play + Stop | **NOT_RUN** | Picker + **hearing** required |
| B | “Analyze this range” on A; region `[44100,132300)`; candidates vs attacks | **NOT_RUN** | UI + candidate frame log |
| C | Apply candidates to draft; CAS revision/region/markers; SQLite after quit | **NOT_RUN** | UI + post-quit `SELECT` on isolated catalog |
| D | Range B analyze → `ANALYSIS_REGION_MISMATCH`; draft unchanged; ja↔en error only | **NOT_RUN** | UI + locale toggle |

**Overall native product acceptance:** **NOT_COMPLETE** until A–D are **PASS** on
a real dev build with the fixture above. Do not treat CI E2E or this doc’s
fixture/dev smoke as substitute.

## Operator procedure (reference)

1. Run `scripts/prepare-range-slice-native-acceptance.sh`; note manifest SHA-256.
2. Export isolated `HOME` and toolchain env (printed by the script).
3. `cd` worktree; confirm `git rev-parse HEAD` = table SHA; `pnpm run tauri:dev`.
4. Register the generated Octatrack **root** read-only via Library UI.
5. Open `RANGE.wav` in Library waveform; execute A–D; append results to this file
   (or a follow-up commit) with candidate frames and draft revision ids — still
   sanitized.

## Post-run checklist (when A–D complete)

- [ ] WAV SHA-256 unchanged from manifest  
- [ ] No unhandled panic on the exercised path in dev log  
- [ ] No merge, no media Apply, no `.ot` / real card usage  
