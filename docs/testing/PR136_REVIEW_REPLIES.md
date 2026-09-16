# PR #136 — FIX-1 review thread replies (manual paste)

GraphQL auto-reply needs a token with **Pull requests: Read and write** (fine-grained) or classic **`repo`** scope.  
If `gh` lacks that, paste each block under the matching thread on the PR **Files changed** tab, then **Resolve conversation**.

| # | Link | Topic |
| --- | --- | --- |
| 1 | [discussion_r4022789669](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789669) | P1 fixture output safety |
| 2 | [discussion_r4022789673](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789673) | catalog path / isolation |
| 3 | [discussion_r4022789681](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789681) | Node/pnpm launcher |
| 4 | [discussion_r4022789686](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789686) | RANGE SHA256 |
| 5 | [discussion_r4022789688](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789688) | catalog-backed list |
| 6 | [discussion_r4022789692](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789692) | CI `test:ui-native-fixture` |
| 7 | [discussion_r4022789696](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789696) | empty UI location |
| 8 | [discussion_r4022789700](https://github.com/kaz4g/masterocta/pull/136#discussion_r4022789700) | Cargo `--locked` |

---

## 1 — fixture output safety

FIX-1 (`bc78af6`): `scripts/ui-workspace-fixture-safe.mjs` + generator no longer accepts CLI output paths; managed temp only, `validateEmptyFixtureRoot`, exclusive `wx`, no delete-then-write. Verified: `pnpm run test:ui-native-fixture` (8/8) on head `e1e586f`.

## 2 — catalog path / isolation

FIX-1: traced `lib.rs` → `open_shared_catalog`; prepare + `docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md` distinguish **code-derived** catalog path (bundle `jp.d3nousan.masterocta`) vs **observed** path (**NOT_RUN**). `HOME` alone is not isolation proof.

## 3 — Node/pnpm launcher

FIX-1: `scripts/launch-native-acceptance-tauri.sh` keeps parent `HOME`/`PATH`; resolves node/pnpm/cargo via `command -v`; respects `RUSTUP_HOME`/`CARGO_HOME`. No unexpanded `node/*/bin` glob in parent shell.

## 4 — RANGE SHA256

FIX-1: `scripts/verify-ui-workspace-range-sha.mjs` hashes `RANGE.wav` bytes (expected `43ceb3dc…`); `prepare-ui-workspace-native-acceptance.sh` exits non-zero on mismatch/missing. Covered in `test:ui-native-fixture`.

## 5 — catalog-backed list

FIX-1 (`bc78af6`): `ui_workspace_native_fixture_registers_and_lists_audio` uses `list_library_dto_sync` (same path as `v2_library_list`) after register. `cargo test --locked -p masterocta --features test-seams ui_workspace_native_fixture_registers_and_lists_audio`.

## 6 — CI hook

FIX-1: `test:ui-native-fixture` in root `pnpm test` (`package.json`) and explicit CI step `.github/workflows/ci.yml` Frontend Checks. Green: https://github.com/kaz4g/masterocta/actions/runs/35073128124 (`e1e586f`).

## 7 — empty UI location

FIX-1: removed `EMPTY_SLOT`; empty **selectable** location is Project `SET/ACCEPT_PROJ` (zero audio files). Search-zero is separate (pool + `xyzzy_nomatch`). Manifest + Rust assertion on `project_local` count.

## 8 — Cargo `--locked`

FIX-1: `--locked` on `package.json` `test:rust`, CI Rust job, and acceptance doc commands. Lockfile drift fails CI instead of silent update.
