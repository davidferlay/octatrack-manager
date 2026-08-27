# Octatrack Workbench Next — 次世代アーキテクチャ設計

- Status: Proposed architecture baseline
- Date: 2026-08-26
- Scope: macOS-first / Octatrack MkII / Octatrack OS 1.40+
- License: GPL-3.0を維持する公開フォーク

## 0. 結論

現行Octatrack Managerは捨てない。ただし、新機能を現在の構造へ直接積み増す
こともしない。

現行版を次の3つとして扱う。

1. Octatrack形式について蓄積された解析知識
2. 振る舞いを比較するためのリファレンス実装
3. 次世代コアへ段階移行する間も利用できる既存アプリ

次世代版では、Octatrack形式の意味、読み取り、変更計画、ファイルへの適用、
バックアップ、ローカルカタログ、UIを分離する。最終的に、ファイルを変更できる
コードは安全実行層だけに限定する。

製品の定義は次のとおり。

> Octatrackのプロジェクト、サンプル、スライス、参照関係を可視化し、
> すべての変更を事前確認・復元可能にするローカルファーストのワークベンチ。

AI、MCP、Google Driveは製品の中心ではない。検証可能なローカルデータと安全な
変更基盤が完成した後に接続する。

---

## 1. 設計し直す理由

現行コードには強い機能と大量のテストがある。一方、次世代機能を直接足すには
構造上の限界がある。

- Tauri commandが84個あり、画面から個別コマンドを直接呼ぶ構造になっている
- frontendの`invoke`呼び出しが多数のcomponentとhookへ分散している
- backend commandの多くが絶対パスを`String`として受け取る
- 読み取り、解析、参照更新、バックアップ、コピー、削除が同じ巨大module内にある
- `project_reader.rs`はテスト込みで23,000行を超える
- frontendにも2,000〜4,000行規模のcomponentが複数ある
- ファイル変更処理が複数moduleへ分散し、安全条件を一箇所で証明できない
- 現行の自動バックアップは有用だが、全操作を一つの回復可能なtransactionとして
  扱う境界にはなっていない

これは悪い実装という意味ではない。機能探索とOctatrack形式の解明を優先して
成長したコードを、ユーザーデータを預かる製品向けに再構成する段階へ来ている。

## 2. 目標と非目標

### 2.1 目標

1. **安全性**
   - 元カードを破損させない
   - 全変更に検証済みバックアップと復元経路を持つ
   - 失敗、取消、媒体取り外しを想定する

2. **Octatrackの文脈理解**
   - Set、Project、Bank、Part、Pattern、Track、Slot、Slice、Audio Fileの関係を
     一つのモデルとして扱う

3. **プロジェクトを壊さない整理**
   - rename、move、copy、collect、bundle時に参照を追跡して更新する

4. **ローカルファースト**
   - 閲覧、検索、タグ、ノート、変更、復元はオフラインで完結する
   - Octatrack媒体へ独自DBや認証情報を置かない

5. **段階移行**
   - 現行版を動かしたまま、機能単位で次世代コアへ置換する
   - upstreamの変更を比較・取り込みできる状態を保つ

6. **AIが安全に利用できる構造**
   - AIは生のファイルパスや書き込みAPIへ触れない
   - AIは検索、説明、変更案の作成まで。適用はローカルで人間が承認する

### 2.2 1.0の非目標

- DAW相当の波形編集、ミックス、エフェクト処理
- Octatrack以外の全サンプラーを扱う汎用ライブラリ
- Google Driveとの双方向ライブ同期
- リアルタイム共同編集
- クラウドからOctatrack媒体への直接書き込み
- AIによる無承認のPattern、Part、Slice、ファイル変更
- 主観的な「ビート感」を唯一の正解として自動判定すること
- WebMCPを必須ランタイムとすること
- 最初からWindows/Linux/macOSを同じ優先度で完成させること

---

## 3. 絶対に破らない設計原則

### P1. Octatrack媒体はデータベースではない

媒体はOctatrackが読む正規ファイルの置き場として扱う。タグ、ノート、検索索引、
AI情報、操作履歴、OAuth tokenを媒体へ保存しない。

### P2. frontendへファイルシステム権限を渡さない

root選択時を除き、frontendは絶対パスをbackendへ送らない。backendが発行した
`RootId`、`ProjectId`、`FileInstanceId`、`AssetId`などのopaque IDだけを使う。

### P3. 読み取りと書き込みを分離する

parser/codecはbytesを読み書きする純粋な処理に寄せ、OSファイルシステムへ直接
触れない。実ファイルを変更できるのは`ot-executor`だけにする。

### P4. Intent → Plan → Applyを必須にする

UI、バッチ、AIのどこから来た要求でも、直接副作用を起こさない。

```text
Intent
  -> validate
  -> ChangePlan + diff + warnings
  -> explicit approval
  -> verified backup
  -> recoverable apply
  -> post-write verification
```

### P5. multi-file atomicityを偽らない

FAT系を含むリムーバブル媒体で、複数ファイルの完全な原子的更新は保証できない。
次世代版は「全ファイルが同時に切り替わる」と約束せず、事前バックアップ、
回復ジャーナル、適用順序、rollbackによる**回復可能transaction**を提供する。

### P6. 不明な形式はread-onlyへ退避する

未対応OS version、不明なblock、checksum不一致、解釈不能な参照がある場合、
表示できる範囲は表示しても書き込みを許可しない。

### P7. unknown bytesを保持する

ファイルをparseして再serializeするだけで未知fieldが消える設計にしない。
no-op roundtripは原則byte-for-byte一致させる。部分patchの方が安全な形式では、
surgical patchを使う。

### P8. source of truthを分ける

- Octatrackの演奏・Project状態: Octatrackファイル
- タグ、ノート、ユーザー分類: ローカルSQLite
- backupの完全性: immutable manifest + checksum
- 人間とAIへ渡す説明: generated Markdown

JSONを人間向け正本にはしない。JSONはIPCとbackup manifestなど、機械検証が必要な
境界だけに使う。

---

## 4. 全体アーキテクチャ

```text
┌────────────────────────────────────────────────────────────┐
│ React Desktop UI                                           │
│ Browser / Inspector / Waveform / Diff / Operation Status   │
└──────────────────────────┬─────────────────────────────────┘
                           │ typed, versioned IPC
┌──────────────────────────▼─────────────────────────────────┐
│ Tauri API Gateway                                          │
│ raw pathを受けるのはroot登録のみ / DTO変換 / session管理   │
└──────────────────────────┬─────────────────────────────────┘
                           │ use cases
┌──────────────────────────▼─────────────────────────────────┐
│ Application Layer                                          │
│ Scan / Query / Plan Change / Apply / Restore / Export      │
└───────────────┬──────────────────────┬─────────────────────┘
                │                      │
┌───────────────▼──────────────┐  ┌────▼────────────────────┐
│ Domain Model                 │  │ Change Planner          │
│ Set/Project/Pattern/Usage    │  │ intent -> validated plan│
│ Asset/File/Slice/Lineage     │  └────┬────────────────────┘
└───────────────┬──────────────┘       │ approved plan
                │                      ▼
┌───────────────▼──────────────┐  ┌─────────────────────────┐
│ Reader / Codec Ports         │  │ Safety Executor         │
│ legacy adapter + new codecs  │  │ lock/backup/journal/    │
└───────────────┬──────────────┘  │ apply/verify/rollback   │
                │                 └──────────┬──────────────┘
                │                            │
┌───────────────▼──────────────┐  ┌──────────▼──────────────┐
│ SQLite Catalog + caches      │  │ Approved Source Root    │
│ App Support上                │  │ Card / clone / backup   │
└──────────────────────────────┘  └─────────────────────────┘
```

### 4.1 dependency方向

```text
tauri-app (composition root)
  ├──> ot-application ──> codec/storage ports ──> ot-domain
  ├──> ot-legacy-adapter ──> codec ports ───────> ot-domain
  ├──> ot-codec ───────────> codec ports ───────> ot-domain
  └──> ot-local-storage / ot-executor / ot-catalog
                  └───────> storage ports ──────> ot-domain
```

内側のcrateは外側を知らない。

- `ot-domain`はTauri、SQLite、filesystem、Reactを知らない
- codecは実ファイルのpathを知らず、bytesとdomain valueを扱う
- application layerは具体的なlegacy moduleへ直接依存せずportを使う
- Tauri commandはbusiness logicを持たない
- React componentは`invoke()`を直接呼ばない

---

## 5. backend module設計

### 5.1 `ot-domain`

副作用を持たない中心モデル。

- Set / Project / Bank / Part / Pattern / Track
- SampleSlot / SlotAssignment / SliceSet / SliceMarker
- AudioAsset / FileInstance / UsageEdge
- Tag / Note / Provenance / Derivation
- Domain validation
- Octatrack上限値、index、命名規則

ここにはraw absolute pathを置かない。必要なpathは検証済みの相対path value object
として表現する。

Project／Bank state、sample storage scope、sample settings ownershipの意味論は
`docs/domain/OCTATRACK_STATE_AND_SAMPLE_SEMANTICS.md`を正本とする。ProjectとBank、
WorkingとSavedCheckpoint、Set Audio PoolとProject-local sample、SlotAssignmentと
FileInstanceSidecarをそれぞれ独立した軸として扱う。OS 1.40+で未確認のfilename mappingや
上限値をdomain constantへ先行して固定しない。

### 5.2 `ot-codec`

Octatrack形式のdecode/encodeを担当する。

- `project.work` / `project.strd`
- `bankXX.work` / `bankXX.strd`
- arranger関連ファイル
- `.ot` sample attributes / slice metadata
- checksum
- Octatrack charset

API例:

```rust
trait ProjectCodec {
    fn inspect(&self, bytes: &[u8]) -> Result<ProjectDocument, CodecError>;
    fn plan_patch(
        &self,
        original: &[u8],
        patch: &ProjectPatch,
    ) -> Result<EncodedPatch, CodecError>;
}
```

`EncodedPatch`は変更後bytesだけでなく、変更field、保持したunknown領域、checksum、
検証結果を持つ。

### 5.3 `ot-legacy-adapter`

現行`project_reader.rs`と`ot-tools-io`をport越しに利用する隔離層。

- 初期は既存readerの出力を新domain DTOへ変換する
- legacyのwrite関数を新UIから直接呼ばない
- 新codecの結果とlegacy結果をdifferential testで比較する
- 新codecが対応した機能からadapterを縮小する
- `ot-tools-io`依存はこの境界内へ閉じ込め、revision固定を維持する

### 5.4 `ot-indexer`

段階的にindexを作る。

1. root、Set、Project、directoryの高速列挙
2. file metadataとaudio header
3. Project/Bankのparseとusage graph
4. content hash
5. waveform peak cache
6. 任意の音響特徴量

全hash完了を待たずに画面を表示する。ただし変更計画の対象ファイルはapply前に
必ずcontent hashを確定する。FATのmtime粒度は信用しすぎない。

filesystem watcherは補助扱いにする。媒体mount時、app復帰時、apply完了後の
incremental rescanを正規経路にする。

### 5.5 `ot-catalog`

SQLiteをmacOS Application Supportへ置く。初期実装は`rusqlite`と明示的migrationを
使う想定。

```text
Application Support/OctatrackWorkbench/
├── catalog.sqlite3
├── backups/
├── staging/
├── waveform-cache/
├── exports/
└── logs/
```

主要table:

| table | 内容 |
|---|---|
| `roots` | fingerprint、表示名、最後の観測情報。絶対pathはbackend内のみ |
| `scan_sessions` | scan revisionと完了状態 |
| `file_instances` | root内の相対path、size、mtime、content hash |
| `audio_assets` | content hash単位の音声実体、format、duration等 |
| `projects` | Set/Projectのidentityとformat状態 |
| `project_entities` | Bank/Pattern/Part/Trackなどの検索用projection |
| `sample_slots` | slot種別、番号、参照先 |
| `usage_edges` | sample/slot/pattern/track間の使用関係 |
| `slice_sets` | `.ot`由来またはdraftのslice情報 |
| `tags` / `tag_assignments` | 手動・解析・AIを区別したタグ |
| `notes` | Asset、Project、Pattern等へscopeされたノート |
| `derivations` | chain、convert、trimなどの生成元関係 |
| `change_plans` | 承認前planとbase revision |
| `operation_journal` | apply/rollbackの安全criticalな履歴 |
| `backup_snapshots` | manifestと検証状態 |

`audio_assets`と`file_instances`を分ける。同じ音声内容が複数pathにあっても一つの
Assetとしてタグを共有でき、rename後もタグを失わない。Project固有のメモは
FileInstanceまたはUsageEdgeへ付けられる。

解析値にはprovenanceを持たせる。

```text
source = user | file | analyzer | ai
confidence = 0.0..1.0 or null
model_or_algorithm = optional identifier
created_at
```

### 5.6 `ot-plan`

ユーザーのintentを副作用のない`ChangePlan`へ変換する。

対応intentの例:

- `ImportSamples`
- `RenameFileInstance`
- `MoveFileInstances`
- `RenameProject`
- `BuildPortableProject`
- `CreateSampleChain`
- `UpdateSliceSet`
- `QuarantineUnusedFiles`
- `RestoreBackup`

Octatrack固有のsample整理では、次のIntentを同一操作へ畳み込まない。

- `UnassignUnusedSlots`: slot assignmentだけを解除し、物理fileを削除しない
- `CollectProjectSamples`: Project参照sampleをProject directoryへcopyし、参照更新を計画する
- `ExportProjectToSet`: Projectと参照sampleを別Setへportableにcopyする
- `DeleteUnreferencedFile`: usage graphで未参照を証明した物理fileを削除する

`DeleteUnreferencedFile`はverified backup、完全なusage graph、`ChangePlan`、journalが
完成するまで実装しない。slot purgeを物理削除の根拠にしてはならない。

planには次を必須とする。

```text
PlanId
RootId + device fingerprint
base scan revision
対象ファイルごとのpath・size・hash precondition
作成、変更、移動、隔離されるファイル一覧
Octatrack参照のbefore / after
容量見積
backup対象
警告とblocking error
postcondition
```

同じplanを二度applyできない。root revisionまたは対象hashが変わったplanは失効し、
再計画を要求する。

### 5.7 `ot-backup`

backupはOctatrack媒体の`backups/`だけに依存しない。変更対象の原本をMac側へ先に
保存する。

snapshot構造:

```text
backups/<root-fingerprint>/<snapshot-id>/
├── manifest.json
├── context.md
└── files/
    └── <original-relative-path>
```

`manifest.json`には次を含める。

- schema version
- source fingerprint
- app/version
- operation/plan ID
- original relative paths
- byte sizeとSHA-256
- Octatrack file version情報
- snapshot完成状態

snapshotは作成後に再読込してchecksumを検証する。`complete`でないsnapshotを
復元元として扱わない。restoreも直接上書きではなく、新しいChangePlanとして
preview、backup、applyを通す。

### 5.8 `ot-executor`

本番ファイルを変更できる唯一のmodule。

apply手順:

1. rootごとのexclusive writer lockを取得
2. root fingerprint、mount状態、read/write状態、空き容量を再確認
3. 対象全ファイルのprecondition hashを再確認
4. Mac側stagingへ変更後の完成形を構築
5. staged Projectをparseし、checksum、参照、音声互換性を検証
6. 変更対象のlocal backup snapshotを作り、再読込検証
7. fsync可能なoperation journalへ`prepared`を記録
8. 安全な順序で媒体へ反映
9. 各step完了をjournalへ記録
10. 媒体から再読込してpostconditionを確認
11. catalogを再indexし、operationを`committed`にする

適用順序は、壊れた参照より一時的な重複を優先する。

```text
新しいaudioを先に配置
  -> Project参照を更新
  -> Project再読込検証
  -> 古いaudioを最後にquarantine/delete
```

失敗時はjournalからrollbackする。app起動時に未完了journalがあれば通常操作を止め、
`resume`か`restore`を提示する。

cancelは次の状態で扱いを変える。

- planning/staging: 即時cancel可能
- prepared以前: 原本変更なしでcancel
- applying: 任意停止せず、安全点まで進めてrollbackまたはcommit
- verifying: 検証終了後に結果を提示

### 5.9 `ot-audio`

初期範囲:

- metadata inspection
- waveform peak生成
- preview用decode
- Octatrack互換formatへのconvert
- trim / fade / normalize
- sample chain生成

加工は常に新しいAssetを生成し、`derivations`へ元Assetとの関係を残す。原本への
in-place加工は行わない。

---

## 6. Source Rootと権限モデル

### 6.1 Root登録

生pathを受け取れるのは`register_root`だけにする。

```text
native folder picker
  -> register_root(raw_path, requested_mode=read_only)
  -> canonicalize
  -> supported rootか検査
  -> device fingerprint作成
  -> RootSession発行
```

`RootSession`:

```text
RootId
display name
device fingerprint
mode = read_only | write_enabled
observed revision
capabilities
session expiry
```

絶対pathはbackendの`RootRegistry`内だけに保持する。frontendには表示用のvolume名と
検証済みrelative pathを返す。

`device fingerprint`はmount pathから作らない。macOSから取得できるvolume UUIDまたは
filesystem serialを主identityとし、filesystem種別とcapacityを補助情報にする。
安定した媒体identityを取得できない場合はread-onlyのまま扱い、write grantを出さない。
Projectやfileの変更状態はfingerprintへ混ぜず、別の`observed revision`と対象file hashで
検出する。

### 6.2 write grant

- 起動時は必ずread-only
- editを有効化するたびにroot fingerprintを再確認
- write grantはsession限定で永続化しない
- 媒体取り外し、再mount、fingerprint変化で失効
- applyごとにdiff画面で明示承認する
- 未対応formatや破損状態ではgrantを発行しない

### 6.3 path境界

- absolute path、`..`、空component、separator混入をdomain valueで拒否
- root自身と対象parentをcanonicalizeして境界確認
- symlinkは原則たどらない。必要な場合もroot内を証明できるread-only対象に限定
- case-insensitive衝突とUnicode normalization衝突を事前検出
- Octatrack charsetとfilename長を別validatorで確認
- root外へのcopy sourceは、native pickerで別途読み取り許可したsource handleを使う

---

## 7. IPC/API設計

既存84 commandをそのまま次世代APIへ持ち込まない。use case単位の小さな公開面へ
まとめる。

初期のlogical APIを次に示す。実際のTauri commandは`v2_`prefixまたは同等のversioned
envelopeを持たせ、legacy APIと衝突させない。

```text
root_register
root_close
root_enable_write
root_status

library_scan_start
library_scan_status
library_query
library_get_node

project_get_snapshot
project_get_usage_graph
audio_get_waveform
audio_create_preview_token

change_plan
change_get_plan
change_apply
change_status
change_cancel

backup_list
backup_verify
backup_plan_restore

context_export_markdown
```

ルール:

- command名とDTOにAPI versionを持たせる
- frontendの全IPCは`src/api/`の単一clientを通す
- React componentから`invoke()`を直接呼ばない
- errorを文字列だけで返さず、code、message、recoverability、detailsを持つ
- long-running operationは`OperationId`を返し、progress eventを送る
- audio previewは任意path readではなく、有効期限付きpreview tokenで取得する
- legacy commandは`legacy`境界へ寄せ、新UIから利用禁止にする

error code例:

```text
ROOT_NOT_APPROVED
ROOT_CHANGED
ROOT_REMOVED
READ_ONLY
PATH_ESCAPE
SYMLINK_ESCAPE
UNSUPPORTED_FORMAT
CORRUPT_SOURCE
PLAN_STALE
BACKUP_FAILED
NO_SPACE
WRITE_FAILED
VERIFY_FAILED
RECOVERY_REQUIRED
```

---

## 7.1 threat boundary

| Threat | 主な対策 |
|---|---|
| 壊れた、または意図的に細工された媒体 | bounded parser、unsupported時read-only、fixture/fuzz test |
| frontendのXSSや誤ったIPC呼び出し | restrictive CSP、opaque ID、backend authorization |
| `..`、symlink、Unicode/case衝突 | validated relative path、canonical parent、collision check |
| scan後にOctatrackや別appがfileを変更 | plan revisionと対象hashの再検証 |
| 書込中の取り外し、電源断、app crash | local backup、journal、safe ordering、resume/rollback |
| 空き容量不足、部分copy | preflight、staging、copy後checksum、原本削除を最後にする |
| dependency/release改ざん | lockfile、immutable revision、updater無効、将来のfork署名 |
| AI prompt injectionや誤提案 | untrusted metadata、typed proposal、local validation、人間承認 |

---

## 8. frontend設計

### 8.1 画面構造

```text
┌ Sources ───────┬ Library / Project ──────────┬ Inspector ───────┐
│ Card/Backup    │ Finder風column browser      │ Waveform         │
│ Set/Project    │ Search results              │ Usage            │
│ Saved views    │ Pattern/Slot/Asset relations│ Tags/Notes       │
│                │                              │ File details     │
└────────────────┴──────────────────────────────┴──────────────────┘
┌ Change Drawer: summary / diff / warnings / backup / approve ───┐
└──────────────────────────────────────────────────────────────────┘
```

常に表示する状態:

- `READ ONLY` / `EDIT ENABLED`
- 選択中rootとfingerprint短縮表示
- 最終scan時刻
- 未完了operationまたはrecovery required
- 現在の変更planと影響ファイル数

### 8.2 frontend module

```text
src/
├── app/                 # router、providers、shell
├── api/                 # typed IPC client、DTO、events
├── features/
│   ├── roots/
│   ├── library/
│   ├── project-inspector/
│   ├── waveform/
│   ├── metadata/
│   ├── changes/
│   ├── backups/
│   └── context-export/
├── entities/            # UI projection types
└── shared/              # pure UI、format、icons
```

feature間でcomponent内部stateを直接参照しない。server/backend stateと一時UI stateを
分離する。巨大なpage/componentを作らず、feature単位でquery、view、testを持つ。

### 8.3 waveform

- full audioをReactへ渡さず、backendでmulti-resolution peakを生成する
- zoom levelに応じたpeakだけを取得する
- cacheはAssetId + analyzer versionでkey化する
- Slice編集はdraftとしてcatalogへ保存し、Applyするまで`.ot`へ書かない
- transient候補とユーザー確定markerを明確に区別する

---

## 9. AI-native設計

AIをファイル操作の近道にしない。AIはcatalogとdomain modelを利用する別adapterに
する。

### 9.1 最初に提供する能力

- Libraryの自然言語検索
- Project構造の説明
- sampleの使用箇所、未使用、重複の説明
- Track/Patternのmicrotimingやsample配置の要約
- タグ候補、関連sample、chain候補の提案
- 変更intent案の作成

### 9.2 AIへ渡すcontext

正本はSQLiteだが、人間とAIへはMarkdownを生成する。

```markdown
# Project: LIVE_2026_10_24

## Source and integrity
## Set / Project topology
## Track roles
## Banks and patterns
## Sample usage
## Slice sets
## Timing observations
## User tags and notes
## Derived measurements
## Missing or uncertain information
```

測定値、ユーザー記述、AI推論を同じ事実として混ぜない。AI推論にはprovenance、
model、confidenceを付ける。

### 9.3 AI操作境界

```text
AI tool call
  -> typed IntentProposal
  -> local domain validation
  -> ChangePlan
  -> user diff approval
  -> local executor
```

- AIへ`write_file(path)`のようなtoolを渡さない
- filename、tag、note、sample metadataをuntrusted inputとして扱う
- note内の命令文をtool権限の根拠にしない
- remote modelへ音声やmetadataを送る場合は明示的opt-inを求める
- AIが利用できない状態でも全コア機能を使えるようにする

---

## 10. Backup、Portable Project、Cloud

### 10.1 local backupを先に完成させる

backupの最低要件:

- immutable snapshot
- manifest schema version
- fileごとのSHA-256
- snapshot作成後の再検証
- restore dry-run
- restore前にも現状backup
- retentionは自動削除せず、容量と候補を提示してユーザーが決める

### 10.2 Portable Project Bundle

別カードや別ユーザーへProjectを渡すための正式な成果物とする。

```text
portable-project.otbundle/
├── manifest.json
├── PROJECT_NAME/
├── AUDIO/
└── PROJECT_CONTEXT.md
```

bundle作成時に次を検証する。

- 全slot参照の解決
- 参照sampleの同梱
- pathのportable化
- Octatrack互換audio format
- `.ot` sidecarの対応
- checksum
- missing / external / duplicateの報告

### 10.3 Google Drive

初期はGoogle Drive Desktopの同期folderをexport先として選ぶだけにする。

- versioned backup archiveの一方向copy
- upload前後checksum検証
- Octatrack媒体とDriveを直接mirrorしない
- delete伝播を実装しない
- built-in OAuth、競合解決、双方向syncは1.0対象外

### 10.4 MCP

local APIが安定してから追加する。

最初のremote MCPはread-onlyまたはproposal-onlyに限定する。

- `search_library`
- `describe_project`
- `list_sample_usage`
- `export_project_context`
- `propose_change`

`apply_change`はremote toolとして公開しない。実行はMac側の明示承認を必須にする。

---

## 11. repository構成の目標形

現行ファイルを一度に移動しない。移行完了時の目標は次の形。

```text
octatrack-manager/
├── src/                              # React desktop UI
│   ├── app/
│   ├── api/
│   ├── features/
│   ├── entities/
│   └── shared/
├── src-legacy/                       # 必要な期間だけ旧UIを保持
├── src-tauri/
│   ├── src/                          # thin Tauri composition root
│   ├── crates/
│   │   ├── ot-domain/
│   │   ├── ot-codec/
│   │   ├── ot-codec-ports/
│   │   ├── ot-storage-ports/
│   │   ├── ot-legacy-adapter/
│   │   ├── ot-local-storage/
│   │   ├── ot-indexer/
│   │   ├── ot-catalog/
│   │   ├── ot-plan/
│   │   ├── ot-backup/
│   │   ├── ot-executor/
│   │   ├── ot-audio/
│   │   └── ot-application/
│   └── tests/
├── fixtures/
│   ├── synthetic/
│   ├── golden/
│   ├── malformed/
│   └── recovery/
├── docs/
│   ├── NEXT_GENERATION_ARCHITECTURE.md
│   ├── adr/
│   ├── formats/
│   └── threat-model/
└── user-guide/
```

最初から`src-legacy/`へ全旧UIを移す必要はない。新featureへ移行済みの旧componentだけを
削除する。大規模な機械移動と機能変更を同じPRに入れない。

---

## 12. 移行戦略

big-bang rewriteは禁止する。Strangler方式で新コアへ切り替える。

### M0 — 即時containment

- upstream updaterを無効化
- CSPとTauri capabilityを縮小
- 原本カードでwriteしないことをUIとdocumentationへ明示

完了条件: forkがupstream releaseを自動installせず、read-only利用を阻害しない。

### M1 — 次世代coreの骨格

- Cargo workspace/crate境界を追加
- `ot-domain`、ports、`ot-application`を作る
- frontendに単一IPC clientを作る
- architecture dependency testを追加
- productionの振る舞いは変えない

完了条件: crate依存方向がCIで検査でき、legacy appのtest/buildが維持される。

### M2 — 安全なread-only root session

- `RootRegistry`
- opaque ID
- read-only scan API
- legacy reader adapter
- root/path/symlink/device swap test

完了条件: 新APIではroot登録以外にabsolute pathを受け取るcommandがない。

### M3 — catalogと新Library UI

M3はdomain semantics、read model、UIを混ぜない小さな段階へ分割する。

#### M3-A — SQLite catalog foundation（完了 / PR #9）

- version付きroot fingerprint
- 明示的SQLite migration
- Set／Project snapshotのtransactional保存と再取得
- catalog portとapplication use case

#### M3-B — catalog-backed indexing/query vertical slice（完了 / PR #10）

- Application Support上のproduction catalog
- root登録時のread-only full scan保存
- live `RootId`再検証後のcatalog query
- persistent fingerprint単位のprojection分離

#### M3-C0 — Octatrack domain semantics contract（今回）

- Project／BankとWorking／SavedCheckpointの独立したstate軸
- Set Audio Pool／Project-local／Unclassified sample scope
- SlotAssignment／FileInstanceSidecar settings ownership
- purge／collect／export／physical deleteの操作意味論
- OS 1.25二次資料のprovenanceとOS 1.40+確認待ち事項

SQLite schema、runtime parser、Tauri API、frontend、writeは変更しない。

#### M3-C1 — incremental file inventory

- incremental filesystem indexing
- `AudioAsset`／`FileInstance`分離
- content hash、size、mtime
- `SampleStorageScope`
- schema migration
- read-only。slot／Bank parserはまだ実装しない

#### M3-C2 — project/bank state and usage graph

- Project／BankのWorkingとSavedCheckpointをread-only index
- slot assignment
- Projectからsampleへのusage graph
- missing reference検出
- parser provenance
- writeなし

#### M3-C3 — sample settings/slice read model

- slot-local sample settings
- saved file-sidecar settings
- slice read model
- source revision／confidenceとOS version差異
- lossless writeはまだ実装しない

#### M3-D — new Library UI

- catalog-backed column browser
- Set／Project／Audio Pool／Project-local sample表示
- frontendへはopaque IDと検証済み相対情報だけを返す
- raw absolute pathを返さない

#### M3-E — waveform/preview/manual tags and notes

- waveform peaksとpreview
- manual tags／notes
- Mac側SQLiteだけを使い、Octatrack媒体へmetadataを書かない

M3完了条件: cardへ一切書き込まず、実際のライブ用libraryを検索・閲覧できる。
M4以降のIntent → Plan → Apply、backup、journal、rollback方針は変更しない。

### M4 — backup/executor pilot

最初のwrite use caseは**sampleの追加copy**に限定する。既存fileの削除や参照更新を
伴わないadditive operationからtransaction protocolを検証する。

- ChangePlan/diff
- local staging
- verified backup
- operation journal
- post-write verification
- fault injection

完了条件: 全stepで意図的に失敗させても、元ファイルが不整合状態で残らない。

### M5 — rename/move/reference update

- Sample rename/move
- Set内の全Project参照更新
- stale plan detection
- collision/case/Unicode validation
- quarantineとrestore

完了条件: rename後にmissing sampleがなく、rollbackでbyte-level復元できる。

### M6 — Portable Project

- collect all referenced samples
- portable bundle manifest
- 別cloneへのrestore/import
- missing/external sample report

完了条件: 二つ目の複製媒体でProjectを開き、参照欠落がゼロになる。

### M7 — SliceとSample Chain

- `.ot` lossless read/write
- waveform draft markers
- equal/transient split
- chain generation
- slot assignment plan

完了条件: chain、`.ot`、Project slotの三者が一致し、実機cloneで読み込める。

### M8 — AI context

- Markdown export
- read-only query tools
- provenance/confidence
- IntentProposal

完了条件: AIなしでも同じ変更計画をUIから作れ、AIが直接applyできない。

### M9 — optional cloud/MCP

- one-way backup export
- read-only remote MCP
- metadata共有のprivacy設計

WebMCPや双方向syncは、必要性と技術成熟度を再評価してから別decisionとする。

---

## 13. test戦略

### 13.1 test pyramid

1. domain unit test
2. path/property test
3. codec golden fixture test
4. legacy/new differential test
5. filesystem integration test
6. executor fault-injection test
7. Tauri IPC contract test
8. React feature test
9. cloned-media E2E
10. Octatrack MkII hardware smoke

### 13.2 必須invariant

- no-op encodeがbyte-for-byte一致する
- 変更対象外fieldとunknown bytesが変わらない
- checksumがOctatrack形式と一致する
- root外read/write/deleteが失敗する
- symlink escapeが失敗する
- stale planが失敗する
- backup検証失敗時はwriteを開始しない
- applying中の全fault pointからrollbackまたはresumeできる
- delete対象はverified backupなしに消えない
- catalogが壊れてもOctatrack媒体の正規データに影響しない
- media removal後にwrite grantが再利用できない
- AI proposalが承認なしで副作用を起こさない

### 13.3 fixture方針

- 実機由来fixtureは個人音源を除き、必要なら匿名化する
- 合成WAV/AIFFでformat、bit depth、sample rate、channel数を網羅する
- 正常、未知field、checksum破損、途中切断、容量不足、case衝突を用意する
- Octatrack OS versionと生成元をmanifestへ記録する
- fixtureの期待値を人間が確認し、legacy出力だけを無条件に正解としない

---

## 14. release gate

### Gate A — Read Safe

- read-only default
- root境界test成功
- original mediaへ書かない
- updater無効
- restrictive CSP

### Gate B — Recoverable Write

- plan/diff/approval
- verified local backup
- journal
- fault-injection
- restore test
- cloned media smoke

### Gate C — Reference Safe

- rename/move後のusage graph整合
- missing sampleゼロ
- unchanged filesのhash不変
- real-device cloneでload成功

### Gate D — Portable

- collect/bundle/import
- second cloneで参照解決
- backupから復元可能

### Gate E — AI Safe

- read/proposal boundary
- provenance
- prompt injection test
- remote data送信のopt-in
- remote direct writeなし

Gate B完了前に原本カードへのwrite対応を宣言しない。Gate EはA〜Dの代替にならない。

---

## 15. 採用するArchitecture Decision

| ID | Decision | 理由 |
|---|---|---|
| ADR-001 | Local-first SQLite catalog | offline、privacy、card非汚染 |
| ADR-002 | Raw pathではなくopaque ID | frontend/AIからfilesystem権限を隔離 |
| ADR-003 | Intent → Plan → Apply | 全操作へdiff、承認、安全条件を共通化 |
| ADR-004 | Recoverable transaction | removable mediaで偽のmulti-file atomicityを約束しない |
| ADR-005 | Legacy adapterによる段階移行 | 解析成果と既存testを失わない |
| ADR-006 | AssetとFileInstanceを分離 | rename/duplicate後もタグとlineageを保持 |
| ADR-007 | Markdown context / JSON manifest | 人間・AIの可読性と機械検証を分担 |
| ADR-008 | AIはread/proposalまで | AI誤判断を不可逆writeへ直結させない |
| ADR-009 | Cloudは一方向backupから | conflict、削除伝播、OAuth負担を避ける |
| ADR-010 | Additive operationを最初のwrite pilotにする | 破壊的処理より安全にexecutorを検証できる |
| ADR-011 | Slot stateとfile-sidecar stateを分離する | 同じAudioAssetでもslotごとにtrim／slice等が異なり、saved settingsは特定のFileInstance／revisionと結び付くため |

---

## 16. 最初の実装単位

設計承認後の順序は次とする。

### PR-0: upstream updater containment

- updater plugin、endpoint、capability、自動check/install経路を無効化
- product featureやpath refactorを混ぜない

### PR-1: next-core skeleton

- `ot-domain`
- codec/storage port traits
- `ot-application`
- central frontend IPC client
- dependency rulesと最低限のtest
- runtime behavior変更なし

### PR-2: RootRegistry read-only vertical slice

- native pickerで選ばれたrootの登録
- root fingerprint
- opaque ID
- legacy scan adapter
- 新APIでSet/Projectを一覧表示する最小画面
- path traversal / symlink / remount test

ここまでで、設計が実コード上でも成立するかを判定する。成立しなければ巨大moduleの
分割を先に広げず、port境界を修正する。

---

## 17. 成功判定

この再設計が成功したと言える状態:

1. frontendやAIからraw path指定の削除・移動を実行できない
2. 全writeが一つのexecutorとoperation journalを通る
3. 変更前に、影響するProject、Slot、Pattern、Track、Fileを確認できる
4. backupを実際に復元して検証できる
5. sampleをrenameしてもタグ、ノート、使用関係が追従する
6. Projectを別カードcloneへ移してmissing sampleなしで開ける
7. 既存Octatrack Managerの有用な解析結果を維持している
8. AIなしでコア機能が完結し、AIは同じ安全境界を迂回できない
9. カーズの2026-10-24ライブ用Project準備で、実際に繰り返し使える

この条件を満たすまでは、「AI音楽管理プラットフォーム」へ範囲を広げない。
