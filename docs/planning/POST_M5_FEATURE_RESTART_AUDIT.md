# Post-M5 Feature Restart Audit

> **HISTORICAL:** Investigation snapshot at GitHub `main` `456db35` (2026-09-12).
> Current milestone numbers and status:
> [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md),
> [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md). Do not treat §2.2 “gap” as
> current — v0.1 plan is ingested under `planning/sources/`.

- Work ID: `MO-POST-M5-FEATURE-RESTART-AUDIT-1`
- Status: Investigation complete (read-only)
- Date: 2026-09-12
- Audience: M5 完了後の機能開発再開判断

## 1. 目的

Gate C PASS（personal / local）と M5 COMPLETE（rename / reference-safe）を前提に、
一時 close された PR #103 / #104 / #105 の実装・レビュー・依存関係を **現行 GitHub main**
と照合し、旧 PR を再開せず **最初に実装する 1 件** とその作業範囲を確定する。

本調査は読取りのみ。製品コード変更、commit / push / PR 再オープン、実機試験、
RC8 再ビルド・redispatch、公開配布は行わない。

## 2. 現行基準

| 項目 | 値 |
| --- | --- |
| GitHub `main` HEAD | `456db35f2423a3af8bf485e46c937f8ff0ef86c0` |
| #121 merge commit | `456db35f2423a3af8bf485e46c937f8ff0ef86c0`（merge と main HEAD は同一） |
| #121 head（docs branch） | `2447a4f0770f4d01dde5eb200b6266e347e0b12b` |
| #121 内容 | Gate C PASS / M5 COMPLETE の docs 記録。RC8 freeze tuple 不変 |
| Gate C | **PASS**（personal / local） |
| M5 | **COMPLETE**（rename / reference-safe） |
| 公開配布 / 署名 / notarization | **NOT AUTHORIZED** |
| RC8 freeze tuple | 変更しない |

### 2.1 ローカル環境メモ（調査時）

- 一部 clone ではローカル `origin/main` が古い RC8 source SHA のまま残る。**GitHub main（`456db35`）を正とする。**
- `git fetch origin main` が broken ref で失敗する環境では、対象 SHA を `gh api` または immutable ref fetch で取得する。

### 2.2 正本のギャップ（調査時点の記録）

**調査時点（`MO-POST-M5-FEATURE-RESTART-AUDIT-1`）:** GitHub main（`456db35`）には次が **未収録**:

- `docs/OCTATRACK_PERFORMANCE_SYSTEM.md`（M6+ 製品・milestone 正本）
- `docs/planning/MILESTONE_INDEX.md`
- `docs/planning/ADR_INDEX.md`

`docs/NEXT_GENERATION_ARCHITECTURE.md`（main）は旧 M6 Portable / M7 Slice 番号のまま。

**実装方針（`MO-M6-LIBRARY-WORKSPACE-LAYOUT-1` 以降）:** 今回の layout は
`NEXT_GENERATION_ARCHITECTURE.md`、`CODEX_HANDOFF.md`、本 audit の承認済み範囲と
既存 catalog API の上で実装する。未収録の Performance System / milestone 文書は
**実装根拠にしない**。製品全体の milestone 文書整理は **後続の docs-only PR**。
**最初の機能 PR のブロッカーではない。**

**本 layout PR では上記 Performance System 系 docs は持ち込まない。**

## 3. 3 PR の状態（2026-09-08 close）

いずれも RC6 Gate C preflight のため一時 close。head ブランチは保持。再オープンはしない。

| PR | タイトル | 状態 | Base | Head | 種別 |
| --- | --- | --- | --- | --- | --- |
| [#103](https://github.com/kaz4g/masterocta/pull/103) | Library Workspace + Waveform 2.0 区間表示・試聴 | CLOSED | `827c7c5` | `9956620` | 機能（36 files, +2266 −441） |
| [#104](https://github.com/kaz4g/masterocta/pull/104) | Waveform 2.0 query engine + ranged preview | CLOSED（Draft） | `827c7c5` | `6778fd6` | 機能（29 files） |
| [#105](https://github.com/kaz4g/masterocta/pull/105) | 自動スライス残実装計画 | CLOSED | `827c7c5` | `e276c42` | docs-only（2 files, +571） |

当時 base `827c7c5` は [#102](https://github.com/kaz4g/masterocta/pull/102)（AUTO-SLICE AS-0〜4）merge 後。
現行 main はその後 **71 commits** 先行（Gate C RC7/RC8、#109/#111 契約、rename prepare 修正、M5 closeout docs 等）。

## 4. 比較表

| PR | 機能 | 現行 main との差 | 未解決問題 | 依存先 | 再利用可能部分 | 推奨順 |
| --- | --- | --- | --- | --- | --- | --- |
| **#103** | M6 Library Workspace + 独自 WF2 backend/UI | UI: context bar、検索/ソート/100件ページ、Inspector 比率、`OperationsDialog`。Backend: `waveform_v2.rs`、`v2_audio_waveform_query`、`v2_audio_preview_range_create`。**main には WF2 library API なし**（v1 640 点 + slice 用 `range_get` / `region_*` のみ） | GitHub P2（generation 採番）は **head で修正済み**（コード確認）。Mac 大規模 library 性能・実サンプル視覚受入は PR 本文で未了 | #102 統合済み（当時）。#104 と WF2 実装競合 | **UI レイアウト契約**（AppShell contextBar、CatalogLibraryBrowser 検索/ページ）、P2 制約、AIFF SSND 私有コピー補正の知見 | **1**（layout のみ先行） |
| **#104** | M7 WF2 エンジン（WFM2 pyramid、prepare/query、Canvas） | `query.rs`、WFM2 cache、`v2_audio_waveform_prepare`、Canvas/PreviewController。`number` frame IPC（#102/#103 の u64 文字列と **不一致**） | Draft のまま close。実サンプル QA 未了。`cargo audit` 未実行（PR 記載）。#103 と **同一コマンド名の別実装** | M6 Inspector サイズ（#103 UI と重複） | WFM2 形式、descriptor-relative cache、APFS identity + preview 常時 rehash、Canvas 操作仕様 | **2**（#103 layout 後、IPC を u64 文字列で再設計してから） |
| **#105** | AUTO-SLICE 残 5 項目の設計 | main 未マージ。AS-N01〜N14 計画 | Codex P1×2、P2×2 は **docs 上未修正**（export stem、Apply 時 write grant、snapshot 後 path 再解決、ROI fork request ID）。計画の schema v7 記述は **obsolete**（main catalog **v11**） | N03/N04 は WF2 共有 audio 前提。N12 は媒体 write | 保存/Apply 分離、mutation_gate 非流用、AS-N 順序、横断受入表 | **3**（N01 以降。製品順では Library/WF2 の後） |

## 5. 個別調査メモ

（調査時の詳細は §7–§10 を参照。#103 P2 generation-before-spawn、#104 u64 IPC、#105 Plan/Apply 契約は実装 PR でも維持。）

## 6. M5 成果との整合（関連範囲のみ）

| 観点 | #103 / #104 | #105 | 最初の 1 件（layout） |
| --- | --- | --- | --- |
| Intent → Plan → Apply | 追加 write API なし（read-only cache） | N12 で必須 | backend 不変更 → **影響なし** |
| RootId / session authority | live root + catalog 再検証 | export 専用 authority | 既存 catalog 投影のみ |
| disposable clone | 触らない | export は verified clone 想定 | 触らない |
| キャッシュ失効 | source hash / revision、asset 切替で preview 破棄 | snapshot lease | v1 waveform の既存 invalidation を維持 |
| 非同期キャンセル | #103 P2: generation-before-spawn | AnalysisRun 失効 | WF2 未実装のため N/A |
| Gate C operator UI | #103 は `OperationsDialog` へ移動 → **常時可視性変更** | N/A | **Change Drawer 維持**（RC8 受入済み導線） |

## 7. 推奨: 最初の 1 件

**#103 由来の Library Workspace layout（M6-01 / M6-02 / M6-04 / M6-05 相当）を、現行 main から新規 PR で実装する。旧 #103 は再開しない。**

### 7.3 今回実装する範囲（layout PR）

- `AppShell`: optional `contextBar`、**左 Sources は必須のまま**（Gate C E2E `Choose root...` 維持）、Inspector/main 比率調整。
- `RootRegistryPanel` + `CatalogLibraryBrowser`: context bar 統合、search/sort/pagination（ラベル **Search this location**）。
- `catalogFileQuery.ts`: location 内 snapshot 全件に対する純関数 filter/sort/page（100 件、page clamp）。
- 選択 identity は `fileInstanceId`。search/sort/page では autoselect しない。
- 既存 Inspector 内容（WaveformPreview v1、SliceWorkbench、tags、usage、rename 入口）の **配線維持**。
- Change Drawer 経由の `RenameOperatorPanel` / `CloneOperatorPanel` / `AdditiveCopyChangeDrawer` **不変更**。

### 7.4 後回し

- `v2_audio_waveform_query`、ranged preview、WFM2、`waveform_v2.rs` / `query.rs`
- `OperationsDialog` への clone/rename/copy 集約（M6-06）
- Auto-slice N01+、`.ot` export（#105）
- Mac 実機 / Gate C 再試験
- `docs/OCTATRACK_PERFORMANCE_SYSTEM.md` 等 main 未収録 milestone 正本

## 8. 次タスク実装指示案

```
Work ID: MO-M6-LIBRARY-WORKSPACE-LAYOUT-1
Base SHA: 456db35f2423a3af8bf485e46c937f8ff0ef86c0
Branch: feat/m6-library-workspace-layout

Must:
- 旧 #103 / #104 / #105 を reopen しない
- Backend / Tauri / allowlist 変更禁止
- Gate C operator は Change Drawer 維持
- RC8 freeze tuple 変更禁止
- 公開配布 NOT AUTHORIZED
```

## 9. 調査上の不足・限界

- 本 audit は GitHub API、PR メタデータ、main @ `456db35` の **読取** に基づく。
- #103/#104 の Mac 実サンプル視覚受入は未実施（承認済みコピー path 未提供）。

## 10. 結論

| 項目 | 決定 |
| --- | --- |
| 現行 main / #122 merge SHA | `bed38a46f1c8e644b4bfaae2d1aaac1a3f290eb6`（#121 `@456db35` の後続） |
| M6 layout | **MERGED**（#122）。WF2 **未実装** |
| 次に続く候補 | [WAVEFORM_V2_INTEGRATION.md](./WAVEFORM_V2_INTEGRATION.md) → Library `v2_audio_waveform_query` PR → ranged preview / WFM2 → #105 AS-N01 以降 |
| 調査文書 | 本ファイル + Waveform v2 統合設計 |

## 11. Layout PR 実装記録（`MO-M6-LIBRARY-WORKSPACE-LAYOUT-1`）

| 項目 | 内容 |
| --- | --- |
| Base | `456db35f2423a3af8bf485e46c937f8ff0ef86c0` |
| Branch | `feat/m6-library-workspace-layout` |
| 実装 | context bar、location 内 search/sort/100-page、`catalogFileQuery`、Inspector 比率（64/75）、Sources 初期幅 20% |
| 未実装 | WF2 backend、`OperationsDialog`、#104/#105、Performance System docs |
| 後続 | #122 merge 後 `MO-WAVEFORM-V2-INTEGRATION-DESIGN-1`（統合設計。layout 完了と WF2 未実装を分離） |
| 検証 | typecheck、frontend tests、build、architecture/containment、rename E2E（drawer 経路）、合成 fixture の UI 受入 |
| 文書 | §2.2 の調査記録と実装方針を分離。milestone docs は後続であり layout のブロッカーではない |
| UI 受入 | 合成 fixture（絶対 path なし）。Vite `localhost:1420`、Playwright Chromium。1280px / 840px。Search/Sort は catalog 実幅に応じて折り返す。locale 非依存検索と page reset/clamp を分離 |

---

関連: [CODEX_HANDOFF.md](../CODEX_HANDOFF.md), [GATE_C_RC_LEDGER.md](../testing/GATE_C_RC_LEDGER.md),
PR [#103](https://github.com/kaz4g/masterocta/pull/103), [#104](https://github.com/kaz4g/masterocta/pull/104),
[#105](https://github.com/kaz4g/masterocta/pull/105), [#121](https://github.com/kaz4g/masterocta/pull/121).
