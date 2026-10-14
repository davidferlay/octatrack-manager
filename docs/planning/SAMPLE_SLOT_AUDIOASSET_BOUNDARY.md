# Sample Slot ↔ AudioAsset 所有境界

- Work ID: `MO-INTEGRATION-SLOT-ASSET-BOUNDARY-1`
- Issue: #187（関連: #181 Bank ChangePlan、#182 / #207 Bank Mutation Safety Contract、#184 Bank Reference Integrity）
- Status: **ACCEPTED**（境界はプロジェクトリード承認済み。この文書と回帰テストで固定する）
- Updated: 2026-10-05（#208 レビュー反映。同一 metadata の hash 再利用、marker fixture、import 解決、`recorder_slot_id`、絶対パス、Project 側ソース範囲、`RootRegistry`）
- Canonical milestone numbers: [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md)（この文書は M5–M11 を増やさない）
- Project 側の設計: [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md)、[`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md)
- Sample 側の設計: [`M7_DERIVED_AUDIOASSET.md`](./M7_DERIVED_AUDIOASSET.md)、[`M7_AUTO_SLICE_DERIVED_EXPORT.md`](./M7_AUTO_SLICE_DERIVED_EXPORT.md)
- Write boundary: [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md)
- 回帰テスト: `src-tauri/src/sample_slot_boundary.rs`、`src/features/project-structure/sampleSlotBoundary.test.ts`

## 1. 目的

Project Structure / Bank Editor ライン（以下 Project 側）と Sample Management ライン（以下 Sample 側）は、別 worktree で並行して進む。両者の接点は Sample Slot Reference だけである。

この文書は、その接点の所有者、中身、解決方法、書き込み権限、不変条件を固定する。両ラインが同じ概念を別々に実装せず、main へ安全に統合できることが目的である。

この文書は製品挙動を変えない。新しい書き込みも承認しない。

## 2. 所有境界

| 側 | 所有するもの | 現行コード上の実体 |
| --- | --- | --- |
| Project 側 | Project | `LibraryProject`、`ot_domain::project_structure::ProjectStructure`、`ProjectStateDocument` |
| Project 側 | Bank | `BankStructure`（Working `.work` と SavedCheckpoint `.strd` は別エントリ） |
| Project 側 | Pattern | `PatternStructure`（Part を index で参照する） |
| Project 側 | Part | `PartStructure`（現行の読取は `parts.unsaved` だけ。§3.2） |
| Project 側 | Track | `TrackStructure`、`TrackPlayback`、`MachineKind` |
| Project 側 | Sample Slot Reference | 構造モデルの `TrackSlotReference` と `ot_codec::RegularSampleAssignment { slot, raw_path }` / `RecorderBufferObservation` の組（§3.1） |
| Project 側 | slot-local 設定 | `project.work` / `project.strd` の `[SAMPLE]` 設定フィールドと `markers.work` / `markers.strd`（trim / loop / slice）。catalog では `SampleSettings`（owner `SlotAssignment`、`marker_source_relative_path`） |
| Sample 側 | Library | catalog の root / scan / file inventory（`LibrarySnapshot` の Sample 部分） |
| Sample 側 | AudioAsset | `AudioAsset`。`ContentHash` を AudioAsset の identity として使う意味づけは Sample 側が持つ |
| Sample 側 | FileInstance | `FileInstance`（identity は root + `RootRelativePath`） |
| Sample 側 | Waveform | `ot-audio` の WF2 query / WFM2 cache（Mac 側 app data） |
| Sample 側 | Slice | `SliceDraft`（catalog `slice_drafts`）、`.ot` sidecar の `SampleSettings`（owner `FileInstanceSidecar`）。`markers.*` の slice は Project 側の slot-local 設定であり、ここに含めない |
| Sample 側 | Derived AudioAsset | `asset_derivations`、`mac_derived` storage scope、derived-audio publisher |
| Sample 側 | lineage | `DerivationEdge`、`AssetDerivation`、`source_hash_evidence` |

### 2.1 どちらにも属さない共有語彙

次は `ot-domain` の共有型である。どちらのラインも再定義しない。

| 型 / 関数 | 役割 |
| --- | --- |
| `RootId`、`RootRelativePath` | 承認済み root の識別子と、その root からの相対パス |
| `SampleSlotId`、`SampleSlotKind` | Slot の識別子（Static / Flex、1–128） |
| `RecorderBufferId` | Recorder buffer（Flex 129–136）。Slot ではない |
| `ContentHash` | バイト列の SHA-256 digest。plan / backup / executor / `TreeManifest`（#207）でも使う汎用型。AudioAsset identity としての意味だけが Sample 側の所有 |
| `SampleReferenceStatus` | 解決結果（`Resolved` / `Missing` / `InvalidPath` / `Ambiguous` / `UnassignedSlot`） |
| `reference_identity::resolve_against_inventory` | `PATH=` 文字列を root 相対パスと解決結果に変える純粋関数 |
| `StateDocumentRole`、`StateDocumentParseStatus` | Working / SavedCheckpoint と parse 状態 |

`RootRegistry` は `ot-domain` の語彙ではない。外側の Tauri crate にある登録境界で、canonical なファイルシステムパスとデバイス観測を持つ。内側の crate は `RootRegistry` に依存しない。両ラインが承認済み root を受け取るときは `RootId` と `RootRelativePath` だけを使う。

### 2.2 scan と catalog 上の投影

catalog（Mac 側 SQLite）は両側の観測を一つの DB に持つ。所有はテーブルと関数の単位で分ける。

| 対象 | 所有者 | 書くもの |
| --- | --- | --- |
| `state_documents`、`slot_assignments`、`usage_edges`（参照パスと `reference_status` を含む） | Project 側の scan 投影 | library scan だけ。操作の書き込み先にしない |
| 参照パスから `file_instances` / `audio_assets` への join | Sample 側 | 読み取りだけ |
| `audio_assets`、`file_instances` | Sample 側 | library scan と derived 登録 |
| `asset_derivations` | Sample 側 | derived 登録（追記のみ。scan や Project 操作は書き換えない） |
| `slice_drafts`、sidecar `sample_settings` | Sample 側 | Slice workbench と scan |
| slot-local `sample_settings`（owner `SlotAssignment`） | Project 側の scan 投影 | library scan だけ |

`reference_status` は、Project 側の scan が `PATH=` を Sample 側の inventory パス集合に当てた結果である。inventory は読むだけで、書き換えない。

`slot_assignments` は `file_instances` への外部キーを持たない。持つのは解決後の `referenced_relative_path` と `reference_status` だけである（migration `0003`）。生の `PATH=` は catalog に保存しない。この形を変えない。

scan の関数単位の所有者（`legacy_read_adapter.rs` は legacy adapter 境界の内側にある混在ファイルで、所有は関数で分ける）:

| 関数 | 所有者 |
| --- | --- |
| `legacy_read_adapter::scan_state_inventory`、`parse_project_state`（`resolve_against_inventory` を呼ぶ）、`parse_bank_state`、`append_usage_edges`、`scan_slot_local_settings`、`read_markers_source` | Project 側 |
| `project_reader::compute_sample_usage_for_documents` | Project 側（`append_usage_edges` の入力） |
| `ot_codec::parse_project_document` | Project 側 |
| `legacy_read_adapter::scan_audio_inventory*`、`collect_audio_candidates`、`hash_regular_file*`、`classify_storage_scope`、`scan_file_sidecar_settings`、`parse_sidecar_settings` | Sample 側 |
| `legacy_read_adapter::scan_registered_root` | 共有の orchestrator（両側の scan を順に呼ぶだけ） |

## 3. Sample Slot Reference の中身と解決

### 3.1 中身

Sample Slot Reference は一つの型ではない。次の二つを組にしたものである。

| 出所 | 持つもの | 持たないもの |
| --- | --- | --- |
| 構造モデル（`project_structure_reader::bank_parts`） | Bank 文書、Part、Track、有効 machine の種別、`TrackSlotReference`（`Slot(SampleSlotId)` / `RecorderBuffer` / `Unassigned` / `Unrecognized` / `NoSampleMachine`） | `parts.saved`、無効側 machine の Slot、`recorder_slot_id`、sample lock（§3.2 規則 6） |
| `ot_codec::parse_project_document` | `RegularSampleAssignment { slot, raw_path }`（Static / Flex 1–128）、`RecorderBufferObservation { buffer, raw_path }` | `PATH=` が空の通常 Slot（parse 時に落とす。Recorder buffer は空でも残す） |

catalog の `slot_assignments` は、この組を解決した後の root 相対パスと `reference_status` を持つ。`usage_edges` は Machine 参照と sample lock（Pattern × Track × Step）の座標を持つ。

どの出所も次を持たない:

- AudioAsset の content hash や opaque asset ID
- FileInstance ID
- 絶対パス
- lineage、waveform、`.ot` sidecar slice、slice draft

Flex 129–136 は Recorder buffer である（Bank の生値の範囲は #210 で確認中）。Slot ではない。AudioAsset へ解決しない（`TrackSlotReference::RecorderBuffer`、`UnmodeledDependency::RecorderSetup`）。

### 3.2 解決の連鎖

```text
Track (Bank 文書, Part(unsaved), Track, 有効 machine Static/Flex)
  → TrackSlotReference::Slot(SampleSlotId)                 [Project 側 構造モデル]
  → RegularSampleAssignment { slot, raw_path }              [Project 側 ot-codec]
  → resolve_against_inventory(Project dir, raw_path)        [共有関数]
      → (RootRelativePath, SampleReferenceStatus)           [Project 側 scan 投影]
  → FileInstance (root, relative_path)                      [Sample 側 join]
  → AudioAsset (content_hash)                               [Sample 側]
  → lineage (asset_derivations: output → source)            [Sample 側]
```

規則:

1. 解決は観測時点のパスで行う。join key は (root, root 相対パス) である。
2. Slot の identity は Slot 番号である。AudioAsset でも FileInstance でもない。
3. 同じ内容の二つのファイルは、別々の FileInstance と一つの AudioAsset になる。Slot は自分の `PATH=` が指す FileInstance に着地する。
4. `reference_status` は Project 側 scan の投影である。FileInstance / AudioAsset への join は Sample 側である。どちらも構造モデルへ書き戻さない。
5. Slot 番号を別 Project へ写しても同じ AudioAsset に着地するとは限らない。Project 間の再割当は PSE-6 まで扱わない（control plane §9）。
6. 範囲の差を次の表に固定する。Machine edge（unsaved Part、有効 machine）の中で `usage_edges` が構造モデルより少ないのは、Pattern で鳴らない Static machine が既定の Slot（Slot 番号 = Track 番号）を指す場合だけである（`compute_sample_usage_for_documents`）。

| 参照の種類 | 構造モデル | `usage_edges` | 根拠 |
| --- | --- | --- | --- |
| unsaved Part の有効 machine の Slot | あり | あり（既定 Static Slot を除く） | `slot_reference_resolves_through_catalog_path_to_one_file_instance_and_one_asset` |
| (a) sample lock（Pattern × Track × Step） | なし | あり（`SampleLock`。Pattern の unsaved Part の有効 machine 側 pool。Static は `static_slot_id`、Flex は `flex_slot_id`。参照走査は 64 step 全体。有効 Track 長の内側は `audible: true`、長さ外の leftover lock は `audible: false` で潜在参照として残す） | `project_reader` の `static_sample_lock_reads_static_slot_id_not_flex`、`flex_sample_lock_reads_flex_slot_id_not_static`、`sample_lock_field_choice_follows_machine_type_on_each_track`、`sample_locks_beyond_pattern_length_remain_inaudible_references`、`sample_lock_audible_uses_per_track_length_in_scale_mode_one`、`lock_pool_follows_track_machine_type`（#209） |
| (b) 無効側 machine の Slot（Flex machine の `static_slot_id` など） | なし | なし | `structure_and_usage_cover_only_unsaved_active_machine_slots` |
| (c) `parts.saved` の Part | なし | なし | 同上。追跡 fixture でも unsaved と値が違う |
| (d) `recorder_slot_id` | なし | なし | 同上。Recorder buffer は有効 Flex machine の `flex_slot_id` からだけ出る。Bank の生値の範囲は #210 で確認中 |

(a)–(d) は、#181 の前に read model へ加えるか、未モデルとして計画を失敗で閉じるかのどちらかにする。(a) は `usage_edges` にあるが、catalog の投影だけで書き込み計画を作らない（control plane §12）。影響範囲を `usage_edges` だけから数えると既定 Static Slot を落とし、構造モデルだけから数えると (a)–(d) を落とす。

### 3.3 欠落と変更の検出

| 状況 | 検出する側 | 結果 |
| --- | --- | --- |
| `PATH=` が空 | Project 側（parse で `RegularSampleAssignment` を作らない） | `slot_assignments` 行なし。`usage_edges` は `UnassignedSlot` |
| `PATH=` が root の外、絶対パス、NUL | 共有関数（Project 側 scan が呼ぶ） | `InvalidPath` |
| 解決先にファイルが無い | Project 側 scan 投影（rescan） | `Missing`。参照パスは残す。Sample 側では FileInstance が消える |
| 大文字小文字違いの候補が複数 | 共有関数 | `Ambiguous` |
| 同じパスの内容が変わった | Sample 側（rescan） | `reference_status` は `Resolved` のまま。byte size または観測 mtime が変わると content hash を計算し直し、別 AudioAsset になる。byte size と観測 mtime がどちらも前回と同じ置換では、前回の content hash を再利用し、AudioAsset は増えない。旧 AudioAsset の lineage は書き換えない |
| derived 作成時に元ファイルが catalog の hash と違う | Sample 側の Apply | `SOURCE_CHANGED` で失敗。書き込みなし |

内容が変わったことの検出は content hash の再計算である。scan は、byte size と観測 mtime が前回の FileInstance と同じとき、その hash を再利用する（`legacy_read_adapter::can_reuse_hash`）。粗いリムーバブル媒体のタイムスタンプでは、同じ長さの置換がこの再利用に入る。byte size または観測 mtime が変わったときだけ、scan はバイトを読み直して別の AudioAsset を作る。

Project 側の構造モデル（Bank / Pattern / Part / Track / Slot 参照）は、欠落や変更があっても変わらない。

## 4. 書き込み権限

| データ | Project 側 | Sample 側 | M5 rename（Gate C） |
| --- | --- | --- | --- |
| `bankNN.work` / `bankNN.strd` | 将来（PSE-3 Apply。**未承認**） | 書かない | 書かない |
| `project.work` の `[SAMPLE] PATH=` | 将来（PSE-6 の再割当。**未承認**） | 書かない | 対象 Slot の `PATH=` 値だけ（M5-B） |
| `project.work` のその他（slot-local 設定、`[STATES]`） | 将来（**未承認**） | 書かない | 書かない |
| `markers.work` / `markers.strd`（slot-local trim / loop / slice） | Bank 操作は書かない。将来の扱いは P-5 | 書かない | 書かない |
| 媒体上の音声ファイル本体 | 書かない | 書かない。derived 出力は Mac 側 derived root にだけ置く | パスだけ動かす。バイトは変えない |
| `audio_assets` / `file_instances` | 書かない | scan と derived 登録 | rescan で反映 |
| `asset_derivations`（lineage） | 書かない | derived 登録だけ（追記） | 書かない |
| `slice_drafts`、waveform cache | 書かない | 書く | 書かない |
| `state_documents` / `slot_assignments` / `usage_edges` | scan の投影だけ | 書かない | rescan で反映 |

legacy コマンドの `rename_file` / `delete_file` / `delete_audio_files` は `legacy_command_gate::AUTHORIZED_COMMANDS` にある。どちらのラインの所有でもない。両ラインの新機能はこれらの上に組まない。

現行 `main` の状態:

- Project 側に書き込み経路は無い（`v2_project_structure_read` と Viewer だけ）。
- Sample 側の書き込みは、derived export（Mac 側 app data）、catalog の lineage 登録、slice draft、WFM2 cache である。
- Project データへ書く既存経路は M5 rename だけである。Gate C、backup、journal、recovery の内側にあり、対象 Slot の `PATH=` 値以外を変えない。

## 5. 不変条件

| ID | 不変条件 | 固定するテスト | 状態 |
| --- | --- | --- | --- |
| I-1 | Project 側のモデルと DTO は Slot の identity だけを持つ。AudioAsset の hash、asset ID、FileInstance ID、絶対パスを持たない | `project_structure_dto_exposes_slot_identity_only`、frontend `sampleSlotBoundary.test.ts` | TESTED |
| I-2 | `Resolved` の Slot 参照は、ちょうど一つの FileInstance と一つの AudioAsset に解決する。`[SAMPLE]` ブロックが無い Slot は `UnassignedSlot`。Machine edge（unsaved、有効 machine）の中で `usage_edges` が落とすのは既定 Static Slot だけ | `slot_reference_resolves_through_catalog_path_to_one_file_instance_and_one_asset` | TESTED |
| I-3 | 同一内容は一つの AudioAsset を共有し、各 Slot は自分の FileInstance に着地する | `duplicate_content_shares_one_asset_while_each_slot_keeps_its_file_instance` | TESTED |
| I-4 | 参照先の欠落は Project 側 scan 投影の `Missing` と、Sample 側 FileInstance の消失として出る。Project 構造と Project 文書のバイトは変わらない | `missing_referenced_file_is_reported_by_the_sample_projection_only` | TESTED |
| I-5 | 同じパスで byte size または観測 mtime が変わった内容変更は新しい AudioAsset になる。byte size と観測 mtime がどちらも同じ置換は前回の content hash を再利用する。記録済み lineage と Project 構造は変わらない | `changed_referenced_file_rebinds_the_slot_to_a_new_asset_and_keeps_recorded_lineage`、`same_size_and_mtime_replacement_keeps_the_previous_content_hash`、既存 `slice_export_ipc_rejects_source_changed` | TESTED |
| I-6 | Sample 側の操作は Project / Bank / Slot データと、コピー済み `markers.work` のバイトおよびその slot-local 設定投影を変えない | `slice_export_leaves_project_bank_and_slot_projection_unchanged` | TESTED（slice export。TRIM は同じ publisher） |
| I-7 | Project 側の操作は AudioAsset 本体、lineage、AudioAsset の hash を変えない | `project_structure_read_leaves_assets_hashes_and_lineage_unchanged` | TESTED（現行の read 面）。ChangePlan / Apply は PENDING（P-1） |
| I-8 | パスの付け替え（M5 rename の出力）は Slot の identity、Bank 側の参照、AudioAsset の identity を保つ | `path_rebinding_keeps_slot_identity_bank_references_and_asset_identity`、既存 `ot-codec` `real_device_rewrite_changes_only_target_path_value_bytes` | TESTED |
| I-9 | ドメインモデルを重複させない。契約が Project 側と名づけた単一所有ソース、および混在 adapter の Project 側関数は、Sample 側の型を名指ししない。逆も同じ。共有語彙（§2.1。`ContentHash` を含む）は対象外。`RootRegistry` は共有語彙に入れない | `project_line_sources_do_not_name_sample_line_entities`、`sample_line_sources_do_not_name_project_structure_entities` | TESTED（ソース文字列ガード。混在ファイルは関数単位。P-8） |
| I-10 | 構造モデルと `usage_edges` はどちらも unsaved Part の有効 machine だけを読む。(b)–(d) はどちらにも無い。`recorder_slot_id` が `flex_slot_id` / `static_slot_id` と違う生値は、Static / Flex だけでなく Thru / Neighbor / Pickup / Master でも、構造、usage、DTO に出ない | `structure_and_usage_cover_only_unsaved_active_machine_slots` | TESTED（範囲の固定。モデル化は P-10） |

## 6. 最小インターフェース

両ラインのドメイン同士の呼び出しはゼロにする。接点は次だけである。

| 方向 | 許すもの | 許さないもの |
| --- | --- | --- |
| Project → Sample | catalog の `usage_edges` 投影を読み取り専用で受け取り、Viewer の欠落表示に使う（型だけの import） | AudioAsset / FileInstance / lineage / Slice / Waveform の型や API の呼び出し |
| Sample → Project | catalog の `usage_edges` 投影を使用箇所表示に使う | `ProjectStructure` 系の型、Bank reader、Project reference codec の呼び出し |
| 共有 | §2.1 の共有語彙 | どちらかのラインによる共有語彙の再定義 |

新しいインターフェースが要るときは、この文書を先に更新する。

## 7. #181 / #184 への引き継ぎ

### #181 Bank Copy / Move / Swap ChangePlan

- 計画が Slot について持つのは、Slot の identity（Project 文書、`SampleSlotId`、参照座標）、`SampleReferenceStatus`、#207 の `scope_manifest` だけである。AudioAsset の hash や FileInstance を計画に入れない（I-1 / I-9）。
- 影響 Slot は構造モデルから数える。数える元の Bank 文書か `project.work` に parse 済みの証拠が無ければ、計画は `MissingParserEvidence` / `BMS_MISSING_PARSER_EVIDENCE` で止まる（#207）。§3.2 規則 6 の (a)–(d) は、#181 の前に read model へ加えるか、未モデルとして計画を失敗で閉じる。
- 計画の変更対象に `audio_assets`、`file_instances`、`asset_derivations`、媒体上の音声バイトを入れない。入っていたら計画を失敗として閉じる（#207 BMS-CHANGESET の `ExpectedChangeNotBankDocument` / `BMS_CHANGE_NOT_BANK_DOCUMENT` と BMS-SAMPLE）。操作しない Bank の文書（Copy の複製元を含む）も変更対象にしない（`ExpectedChangeOutsideOperatedBanks` / `BMS_CHANGE_OUTSIDE_OPERATED_BANKS`）。
- `Missing` / `InvalidPath` / `Ambiguous` は Broken refs として数える（control plane §6）。
- 同一 Project 内の Bank 操作で Slot 番号は変わらない。Project をまたぐ移植は PSE-6 であり、#181 の範囲外である。

### #184 Bank Reference Integrity Tests

AudioAsset の hash による照合は #184 の cross-line テストで行う。`sample_slot_boundary.rs` の fixture（一時 root に Set ごとコピーし、合成 WAV を置き、登録と索引を行う）を再利用する。

sample の多くは Project の外（`../AUDIO`、Set の Audio Pool）にある。Project 範囲の `scope_manifest` ではそれを検証できない。音声の不変は、Set root 全体、または Slot が参照するファイル群を対象にして確認する。

Bank 操作の後状態では少なくとも次を確認する。

- Set root 全体（または参照ファイル群）の音声の digest が操作前と同じ
- `audio_assets` の hash 一覧と `asset_derivations` が操作前と同じ
- 操作前に `Resolved` だった Slot 参照が、同じ content hash に `Resolved` のまま
- Slot 投影の差分が計画に書いた変更だけ

## 8. Pending（まだテストできない、または未実装）

#207 の名前は PR #207（`PSE_BANK_MUTATION_SAFETY_CONTRACT.md`、`ot_plan::bank_mutation::ReadinessGap`）と `scripts/pse-bank-mutation-gates.json` のものである。

| ID | 内容 | 止まる理由 / 対応する台帳 |
| --- | --- | --- |
| P-1 | Bank ChangePlan / Apply が Sample 側データに触れないこと | #182（#207 BMS-CHANGESET（`ExpectedChangeNotBankDocument`、`BMS_CHANGE_OUTSIDE_OPERATED_BANKS`）/ BMS-VERIFY-BYTES / BMS-SAMPLE）。gate `mutation.expected-changed-files-only` / `mutation.unrelated-files-preserved`。#181 / #183 のコードが無い |
| P-2 | Bank 変更後の参照整合 | #184（#207 BMS-VERIFY-STRUCTURE / BMS-SAMPLE）。gate `mutation.reference-integrity`。Apply が無い |
| P-3 | Project 間の Slot 再割当（AudioAsset 経由） | PSE-6 |
| P-4 | WFM2 cache が Project 側の操作で無効化されないこと | Project 側に書き込みが無い。現状はソースガードだけ |
| P-5 | `.ot` sidecar slice（`FileInstanceSidecar`）と slot-local 設定（`SlotAssignment`、`markers.work` / `markers.strd`）の書き込み分担 | どちらにも writer が無い（Auto Slice `.ot` Apply は NOT_STARTED）。Bank 操作は `markers.*` を書かない |
| P-6 | Recorder buffer と Recorder 設定の扱い | `ReadinessGap::SceneAndRecorderDependencies`。`RecorderSetup` は未モデル |
| P-7 | SavedCheckpoint（`project.strd`、`parts.saved`）側の Slot 解決を計画でどう扱うか | `ReadinessGap::WorkingSavedCheckpointRule`（PSE 監査 §7C） |
| P-8 | I-9 を crate 依存で強制すること | 現状はソース文字列ガード。Project Structure を独立 crate に分ける等は製品コード変更なので、この PR では提案だけ |
| P-9 | catalog の Project 側投影テーブルと Sample 側テーブルが同じ crate にあること | 所有はテーブルと関数の意味だけで分けている。分割は将来の判断 |
| P-10 | §3.2 規則 6 の (a)–(d) を read model に加えるか、未モデルとして失敗で閉じること | ChangePlan 在庫は `MO-PSE-BANK-CHANGEPLAN-REFERENCE-COVERAGE-1` で (a)(c) 列挙、(b) 契約除外、(d) 未モデル。構造 read model（I-10）は変えない |

## 9. 回帰テスト一覧

Rust（`masterocta --features test-seams`、filter `sample_slot_boundary::`）。PSE CI の required-test inventory（[`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json)）に載せている。

| テスト | 保証すること |
| --- | --- |
| `slot_reference_resolves_through_catalog_path_to_one_file_instance_and_one_asset` | Project 構造の Slot 参照 → catalog の Slot 投影 → FileInstance → AudioAsset が一意に決まる。usage edge があれば状態が一致し、無いのは既定 Static Slot だけ（1 件以上あることも確認） |
| `structure_and_usage_cover_only_unsaved_active_machine_slots` | 構造モデルと Machine usage edge は unsaved Part の有効 machine の Slot だけを持つ。fixture に `parts.saved` の差分、無効側 Slot、`flex_slot_id` 由来の Recorder buffer、および Static / Flex 以外を含む `recorder_slot_id` の生値がある。その生値は構造、usage、DTO に出ない |
| `duplicate_content_shares_one_asset_while_each_slot_keeps_its_file_instance` | 同一内容で AudioAsset は一つ、Slot の着地先は各自のパス |
| `missing_referenced_file_is_reported_by_the_sample_projection_only` | 欠落は `Missing` で出て、Project 構造と Project 文書は不変 |
| `changed_referenced_file_rebinds_the_slot_to_a_new_asset_and_keeps_recorded_lineage` | byte size が変わる内容変更で新 AudioAsset。lineage と Project 構造は不変 |
| `same_size_and_mtime_replacement_keeps_the_previous_content_hash` | 同じ byte size と観測 mtime の置換は前回の content hash を再利用する |
| `slice_export_leaves_project_bank_and_slot_projection_unchanged` | Sample 側の書き込み（slice export）後も root 全体のバイト、コピー済み `markers.work`、その slot-local 設定、Project 構造、Slot 投影が不変。Slot は元の AudioAsset を指したまま |
| `project_structure_read_leaves_assets_hashes_and_lineage_unchanged` | Project 側の読取が音声バイト、AudioAsset hash、lineage、catalog snapshot を変えない |
| `path_rebinding_keeps_slot_identity_bank_references_and_asset_identity` | 同一ディレクトリ rename 後も Slot 集合、Bank バイト、Project 構造、AudioAsset が同じ |
| `project_structure_dto_exposes_slot_identity_only` | DTO の Slot は `kind` / `slotKind` / `number` だけ。Sample 側キーが無い |
| `absolute_path_guard_rejects_paths_outside_the_registered_root` | DTO の文字列検査は、登録 root の部分一致に加え、空白の無いラベル付き絶対パス（`root=/tmp/...`、`path=C:\...`）と Application Support、cache、UNC、`file://` も拒否する |
| `function_source_ignores_braces_inside_literals_and_comments` | Project 側関数の切り出しは、文字列リテラルとコメントの中の波括弧で終わらない |
| `project_line_sources_do_not_name_sample_line_entities` | Project 側の単一所有ソースと、契約が Project 側とした関数（`ot_codec::parse_project_document` のソース、`compute_sample_usage_for_documents`、`legacy_read_adapter` の state / marker 関数）が AudioAsset、FileInstance、lineage、Slice、Waveform、catalog を名指ししない（`ContentHash` は共有語彙なので対象外） |
| `sample_line_sources_do_not_name_project_structure_entities` | Sample 側ソースが Project 構造、Bank reader、Project reference codec を名指ししない |

Frontend（`pnpm run test:frontend`）:

| テスト | 保証すること |
| --- | --- |
| `sampleSlotBoundary.test.ts` | `SlotReference` の slot 変種は slot identity だけ（型検査）。guard 対象ファイルからの相対 import をそのファイルのディレクトリ基準で解決し、Sample 側プレフィックスとその子孫は型としてだけ import する。IPC は直接呼ばない |

fixture の安全:

- 追跡済み fixture（`src-tauri/tests/fixtures/real_device`）は一時ディレクトリへコピーしてから使う。原本は読むだけで書かない。
- 音声はテストが一時ディレクトリに書く合成 WAV だけである。実機媒体と元の音声ファイルは使わない。
- catalog と derived 出力はテストごとの一時 data ディレクトリに置く。

## 10. この文書が変えないもの

- 製品コード、DTO、catalog schema、IPC コマンド
- M5 は COMPLETE。Gate C は personal / local の PASS。RC8 は再ビルド・再投入しない
- `BANK_CHANGEPLAN_READINESS = NOT_READY`、`APPLY_READINESS = NOT_READY`（PSE 監査）
- 公開配布、署名、notarization は NOT AUTHORIZED
- M7 の完了条件と #103–#105 の再開禁止
