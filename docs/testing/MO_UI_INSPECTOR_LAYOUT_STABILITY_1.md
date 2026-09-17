# MO-UI-INSPECTOR-LAYOUT-STABILITY-1 — PR handoff

## SHAs

| | SHA |
| --- | --- |
| Start (`origin/main`, PR #137 merge) | `3c72c5cab9553164eb06b8a210bc5f9a1129b4d3` |
| Final | `e29dfcae1598809630b134d35fe5a000b9a4bcc2` |

## Problem

Inspector タブ切替・Slice 内容の増減で、中央一覧と Inspector の境界・外枠・下部ステータスが視覚的に動いていた。

## Root cause (code)

1. **`AppShell` 高さがコンテンツ追従** (`flex: 0 1 auto`) — タブ内容でシェル全体と status bar が伸縮。
2. **列の二重 `overflow: auto`** — Inspector 列と `.mo-inspector-pane` でスクロールバー出し入れ → 有効幅のガタつき。
3. **Flex 子の min-content** — Slice フォーム (`minmax(120px)`, `input min-width: 70px`) が表示タブだけで inner split の幅を押し、Main/Inspector 境界が移動（~110px 級）。
4. **Chrome がスクロール内** — ファイル名・タブ列・「広く編集」が panels スクロールに巻き込まれクリック不能になりうる。

## Fix (summary)

- `catalogReady` 時のみ `AppShell` に `mo-app-shell--workspace`: viewport 内固定高、body `flex: 1 1 0` + `overflow: hidden`。
- Inner split: secondary `width: 0; flex: 1 1 0` で min-content 押し広げ防止。
- Inspector: header / tablist / slice toolbar をスクロール外、`.mo-inspector-tabbed__panels` のみ内部スクロール + `scrollbar-gutter: stable`。
- Main: `.catalog-workspace-main` を flex 列、リスト領域のみスクロール。
- Slice compact CSS: `min-width: 0`、grid/input の min-content 緩和。
- 「広く編集」ツールバーを tablist 直下（panels 外）へ移動。expand/collapse 時の split % は変更なし。

## Verification

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | PASS (local) |
| `CI=true pnpm run test:frontend` | PASS (616 tests, local) |
| `tsc && vite build` (local bin) | PASS |
| `pnpm run build` (root script) | NOT_RUN — user-guide workspace install flake in local pnpm hook |
| E2E `inspector-layout-stability`, `workspace-layout`, `library-inspector-tabs`, `slice-workspace-expand` | PASS (Playwright reuse `:1421`, local) |
| `cargo fmt/clippy/test` | NOT_RUN — `cargo` ENOENT in agent environment |
| Native Tauri | NOT_RUN |

Screenshots (after fix): `docs/testing/screenshots/mo-ui-inspector-layout-stability-1/`.  
Baseline before screenshots: not captured at start SHA in agent session (START SHA recorded above).

## Native re-check (operator)

```bash
cd "/path/to/ui-inspector-layout-stability-1"
bash scripts/prepare-ui-workspace-native-acceptance.sh   # optional fixture
REAL_HOME="${REAL_HOME:-$HOME}" \
  ./scripts/launch-native-acceptance-tauri.sh "<isolated_home>" "$(pwd)"
```

同一ウィンドウで Preview ↔ Slice 往復、Slice 詳細表示、「広く編集」→ 通常表示、840px 切替。左ナビ・中央・Inspector 境界と status bar が動かないこと。
