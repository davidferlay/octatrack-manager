# Project Structure Control Plane

- Work ID: `MO-PSE-DESIGN-1`
- Status: **PROPOSED**（設計のみ。実装・媒体書き込みは未承認）
- Updated: 2026-09-30
- Canonical milestone numbers: [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md)（この文書は M5–M11 を増やさない）
- Current execution status: [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md)
- Bank ChangePlan readiness (post-#227 reconciliation): [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md)
- Domain vocabulary: [`../domain/OCTATRACK_STATE_AND_SAMPLE_SEMANTICS.md`](../domain/OCTATRACK_STATE_AND_SAMPLE_SEMANTICS.md)
- Write boundary: [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md)

## 1. 目的

Masta-Octa の次の大きな製品面は、Sample 管理の延長ではなく **Octatrack Project / Performance Control Plane** である。

Bank、Pattern、Part、Scene、Track、Sample Slot 参照を見ながら、コピー・移動・交換・複製できるようにする。操作単位は「Pattern のコピペ」ではない。Pattern が依存する Part、Sample Slot、Track 設定を計画に含めてからでないと、Project は参照切れのまま静かに壊れる。

この文書は、その方向の設計契約である。最初の実装マイルストーンは **Project Structure Viewer と Bank 操作の ChangePlan** までに限る。Apply は後続フェーズであり、この文書は書き込みを承認しない。

現行 `main` の次作業は M7 Integrated Native 受入のままである（[`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md)）。このトラックは別 worktree で進める。M7 の Sample / Slice 実装を壊して Bank 編集を足さない。

## 2. 二つの世界

Sample そのものを管理する世界と、Project の中で Sample をどう使っているかを管理する世界は別物である。UI、ドメイン、作業ブランチを混ぜない。

```text
Masta-Octa
├─ Library / Sample Management          ← M6 / M7（現行トラック）
│   ├─ AudioAsset
│   ├─ Sample / FileInstance
│   ├─ Waveform
│   ├─ Slice
│   └─ Derived Export
│
└─ Project Structure Management         ← この提案
    ├─ Bank
    ├─ Pattern
    ├─ Part
    ├─ Track
    ├─ Scene
    └─ Sample Slot Reference
```

| 要素 | このトラックでの意味 | 根拠の種類 |
| --- | --- | --- |
| Bank | 曲・章。ライブセットの曲順 | オペレーター運用（下記 §3.2）。フォーマット定数ではない |
| Pattern | 曲内の展開・シーケンス | 同上。装置上の Pattern と同一視してよいのは manual が言う範囲だけ |
| Part | 音色、Machine、Sample 割当、FX、Track 構成 | 既存 reader が Part / Track machine を読める。コピー意味論は未契約 |
| Scene | Crossfader で使う演奏状態 | **現行コードに Scene モデルは無い**（§5） |
| Sample Slot | Project 全体の Sample 参照 | M3-C2 slot assignment / usage edge |
| AudioAsset | Masta-Octa 側の独立した Sample 資産 | ADR-006。Slot 参照とは別 |

AudioAsset を動かしても Slot 参照は変わらない。Slot 番号を別 Project へ写しても、同じ AudioAsset に着地するとは限らない。Phase 6 までこの二つを短絡しない。

## 3. 構造の扱い

### 3.1 ドメイン階層

既存契約（M3-C0 / M3-C2）を維持する。新しい階層を発明しない。

```text
Root
└─ Set
   └─ Project
      ├─ Sample Slots / Audio Pool 参照
      ├─ Project state（Working `.work` / SavedCheckpoint `.strd`）
      └─ Bank
         ├─ Bank state（Working / SavedCheckpoint）
         ├─ Pattern
         └─ Part
            ├─ Track settings
            ├─ Machine
            ├─ Sample assignment
            ├─ FX / Amp / LFO
            └─ Scene（読取モデルは未存在）
```

`Working` は編集・使用中の状態、`SavedCheckpoint` は Octatrack SAVE/RELOAD が指す復元点である。SavedCheckpoint は Mac 側の安全バックアップでも、この文書の Project Snapshot でもない（§7）。

filename の `.work` / `.strd` 対応は公式 manual に無い。provenance は追跡済み fixture、既存 reader、固定 `ot-tools-io` のままとする。

### 3.2 オペレーター語彙

次の対応は、現行ライブ構成を読むための語彙である。パーサ定数、UI の初期トラック名、スキーマ制約にはしない。

```text
Bank    = 1曲
Pattern = 曲中の展開
Part    = 音色や構成変化
Scene   = ライブ中のモーフィング / transition
```

現行セットのトラック役割例（比較表示の対象。製品デフォルトではない）:

```text
T1 Kick
T2 Break / Snare
T3 Volca Drum
T4 AS-1
T5 Phrase
T6 Phrase
T7 Looper
T8 Master
```

Part を並べてこの役割を比較できることが、Viewer の価値である。例: Part 1 `NORMAL`、Part 2 `ACID`、Part 3 `BREAKDOWN`、Part 4 `DESTROY`。Part 名はユーザー注釈であり、装置が必ず持つ名前とは限らない。

ライブの遷移確認も Viewer の読み取り用途に含める。例: T7 Looper → Kick Only Scene → Bank 切替 → Crossfader → 新 Bank。Scene 行は §5 の証拠が揃うまでプレースホルダにしない。未対応なら「Scene は未読取」と出す。

## 4. 欲しい操作

最終形の操作面である。この節は目標であり、実装順序は §9 に従う。Phase 1–2 は Bank の計画までで止まる。

### Bank

曲順の組み換え。

```text
Bank A ↔ Bank D
Bank B → Bank F へ複製
Bank C → 空 Bank へ移動
```

### Pattern

ドラッグ＆ドロップの並び替えを含む。Pattern 単体の移動では終わらない。計画は次を列挙する。

- どの Part を使っているか
- どの Sample Slot を参照しているか
- どの Track 設定に依存しているか

```text
A01 → A05 copy
A02 ↔ A07 swap
Bank A Pattern 01 → Bank D Pattern 09
```

### Part

音色コピーではなく、演奏状態の複製に近い。別 Bank へのコピー時に、計画がまとめて扱う対象:

- Track Machine
- Sample Slot
- FX
- Amp
- LFO
- Scene
- Recorder 関連

Scene と Recorder は、読取証拠が無い間は「未モデル」として計画に出す。黙って落とした成功にしない。

### Scene

一覧し、Part をまたいでコピーする。Scene セットの保存は Phase 5。例: Part 1 Scene 3 → Part 2 Scene 11。

## 5. すでにあり、まだ無いもの

### 再利用する

| 既存 | このトラックでの使い方 |
| --- | --- |
| M3-C2 Project/Bank projection、slot assignment、usage edge | Viewer と影響件数の土台。catalog は Mac 側。媒体をメタデータ DB にしない |
| `StateDocumentKind` / `StateDocumentRole` / parse status | Working と SavedCheckpoint を混ぜない。`UnsupportedVersion` / `Malformed` は read-only のまま |
| legacy `project_reader` の Bank / Part / Pattern / Track（machine、amp、LFO、FX） | 読取の既存実装。新 API は raw absolute path を frontend に返さない |
| M4/M5 の Intent → Plan → Backup → Prepare → Apply → Verify → Recover | 手続きの型。rename API を Bank 交換に流用しない |
| ADR-003 / ADR-004 | 承認前に書かない。媒体上の複数ファイル原子性を約束しない |

### まだ無い

- Project 構造を Bank → Pattern → Part → Track → Slot 参照で見せる UI
- Bank copy / move / swap の ChangePlan
- Pattern / Part / Scene の copy / move / swap
- **Scene のドメイン、catalog 行、legacy reader フィールド**（`src-tauri` に Scene シンボルは無い）
- 構造操作専用の Project Snapshot と Restore
- Project 間の Slot 再割当と参照書き換え

Viewer 初版の表示範囲は、既存の読取が説明できるものに限る。Bank、Pattern、Part、Track、Sample Slot 参照、参照状態（resolved / missing / invalid / unassigned）、文書の parse status。Scene 行は証拠付きの読取モデルができるまで出さない。

## 6. 安全機構

媒体上の Project を直接書き換えない。流れは既存の書き込み境界に合わせる。

```text
Intent
  → Plan
  → Review
  → Backup
  → Prepare
  → Apply
  → Read Back
  → Verify
  → Recovery
```

「Bank A と Bank D を交換」は即実行しない。まず計画を出す。件数は実行時に数えた観測であり、固定定数ではない。次は計画の形の例である。

```text
BANK SWAP PLAN

A → temporary
D → A
temporary → D

Affected:
  Patterns:        (counted)
  Parts:           (counted)
  Scenes:          (counted, or UNMODELED)
  Sample refs:     (counted)
  Broken refs:     (counted)

Documents:
  Working / SavedCheckpoint listed separately
Parse:
  any Malformed or UnsupportedVersion blocks later Apply
```

`Broken refs` が 1 以上、または Scene / Recorder のように未モデルの依存がある場合、計画は失敗として閉じる。成功表示のまま欠落を隠さない。

Phase 2 の終わりは ChangePlan、Backup、Prepare、Status までである。Apply コマンドは出さない。Phase 3 の Apply 先は、テスト用に複製した Project だけである。実機 CF 原本は対象にしない。

Bank Apply が満たすべき検査可能な契約は [`PSE_BANK_MUTATION_SAFETY_CONTRACT.md`](./PSE_BANK_MUTATION_SAFETY_CONTRACT.md)（#182）に置く。契約の定義は Apply の承認ではない。

書き込みフェーズに入る前に、対象がユーザー承認済み Octatrack root の内側であることを検証する。traversal、symlink escape、壊れた名前は拒否する。失敗または取消のあとに原本が変わっている状態を成功にしない。

## 7. Undo は Project Snapshot

構造編集の取り消しは、エディタの `Ctrl+Z` スタックではない。操作の前後で Project Snapshot を残し、壊れたら以前の snapshot へ戻す。

```text
Before   Project Snapshot #42
Operation  Bank A ↔ Bank D
After    Project Snapshot #43
Restore  #42
```

次の三つは名前を分けたままにする。

| 名前 | 何か | 構造編集の Undo か |
| --- | --- | --- |
| Octatrack SavedCheckpoint（`.strd`） | 装置の SAVE/RELOAD 点 | 違う |
| Mac verified backup + journal（M4/M5） | 承認済み操作の回復記録 | 回復手段の一部になり得る。snapshot そのものではない |
| Project Snapshot（この提案） | 構造操作の前後の復元点 | これ |

Snapshot の中身、保持場所、世代上限、Restore が Working と SavedCheckpoint のどちらを戻すかは未決である（§12）。決まるまで Restore API は作らない。保持場所は Mac 側であり、Octatrack 媒体へ snapshot を書かない。

## 8. 作業の隔離

M7 Sample / Slice の worktree とこのトラックを重ねない。

```text
main
.worktrees/
├─ m7-native-final
└─ project-structure-editor
```

ブランチは操作単位で切る。名前は系列の例であり、この設計 PR は実装ブランチを作らない。

```text
feat/project-structure-viewer-1
feat/bank-copy-1
feat/bank-swap-1
feat/part-copy-1
feat/scene-copy-1
```

開発とテストでは次を分ける。

- 専用 HOME
- 専用 Application Support
- 専用 catalog
- テスト用 Project コピー

実機 CF 原本は、最後の人手確認まで対象にしない。破壊的操作の試験はコピー、一時 fixture、明示したテストディレクトリだけを使う。

## 9. フェーズ

依存順は固定する。番号を飛ばして Apply や Project 間移植へ進まない。

### PSE-1 — Project Structure Viewer

Read only。Project を読み、Bank / Pattern / Part / Track / Sample Slot 参照を表示する。Pattern が指す Part、Part 内トラックの sample 参照、参照の欠け、文書の parse status が見えること。

出口: 承認済み root のテストコピーで、catalog または既存 reader の観測と画面が一致する。媒体への write がゼロであること。frontend に absolute path を返さないこと。

範囲外: コピー、移動、交換、ChangePlan、Scene の推測表示。

### PSE-2 — Bank Copy / Move / Swap の計画

最初の編集ドメイン。操作は Copy Bank、Move Bank、Swap Bank。原本には書かない。

出口: Intent から ChangePlan を作り、影響 Pattern / Part / Sample 参照、未解決参照、Working と SavedCheckpoint の別計上を出せる。Backup と Prepare と Status の境界は M5 の型に合わせ、Apply には接続しない。`Malformed` / `UnsupportedVersion` は計画を止める。

範囲外: Apply、Pattern 編集、Part / Scene 編集、実機 CF。

### PSE-3 — Apply + Verify

書き込み先はテスト Project コピーだけ。

```text
Apply → 再読込 → 構造比較 → hash / reference verify
```

出口: 計画どおりの構造になり、対象外バイトと対象外 Bank が変わっていないこと。失敗時は Recovery で操作前へ戻ること。原本 CF は未使用のままであること。

PSE-3 は、別文書で Apply を明示承認するまで着手しない。この設計文書はその承認ではない。

### PSE-4 — Pattern

copy、move、swap、duplicate。各計画は Part、Sample Slot、Track 依存を含む。出口は PSE-3 と同じ検証を Pattern 単位で満たすこと。

### PSE-5 — Part / Scene

Part copy / swap。Scene copy / move と Scene セットの保存。Scene に入る前に、公式 manual と複製 fixture で Scene の所在と保存単位を記録する。証拠が無い項目は未モデルのまま失敗として閉じる。

### PSE-6 — Cross Project Transfer

最後。例: Project A の Bank C を Project B の Bank F へ。Slot 番号をそのまま写せないときは、旧 Slot → AudioAsset の特定 → 新 Project の Slot 割当 → 参照の書き換え、の順で計画する。AudioAsset が特定できない参照は失敗として閉じ、欠番を埋めない。

## 10. 最初の実装マイルストーン

次にコードへ落とす範囲は、PSE-1 と PSE-2 の計画生成までである。

```text
Octatrack Project を読む
  → Bank / Pattern / Part / Track / Sample Reference をモデル化する
  → UI で表示する
  → Bank Copy / Move / Swap の ChangePlan を生成する
```

まだ書き込まない。この範囲がテストコピー上で通ってから、別承認で PSE-3 Bank Apply に進む。

実装時の境界:

- root 登録以外で raw absolute path を受けない
- 登録後のパスは backend の RootRegistry に置く
- frontend へ返す場所は検証済みの root 相対パスだけ
- parser は実ファイルへ書かない
- 新コマンドは、このマイルストーンが許す read と plan だけ
- M7 の derived export、slice、waveform のコードパスをこの作業で変更しない

## 11. 以前の規模感

オペレーターが見積もった開発量である。日程でも、この設計の完了条件でもない。

| 範囲 | 見積もり |
| --- | ---: |
| Bank 管理 MVP | 30〜45 時間 |
| Pattern / Part / Scene を含む | 75〜120 時間 |
| Project 間移植まで | 150〜240 時間 |

短縮が見込める理由は、Catalog、安全境界、lineage、受入の型が M5–M7 に既にあることである。Scene の未モデルと、Bank バイト列の可逆な組み替え契約がまだ無いことは、見積もりを自動では縮めない。

## 12. 未決（ADR 候補。未受理）

次を実装で先に決めない。受理は専用 ADR か、フェーズごとの設計 PR で行う。

| 話題 | 止まる理由 |
| --- | --- |
| Bank 交換の物理単位 | ファイル名の入れ替えなのか、文書バイトの入れ替えなのか。未知バイトを落とす codec は不可 |
| Working と SavedCheckpoint のどちらを将来 Apply が触るか | 片方だけ変えると装置の SAVE/RELOAD と食い違う |
| Project Snapshot の identity、保存先、世代、Restore 対象 | §7。Mac 側以外へは書かない |
| Viewer の正本 | catalog projection か、表示直前の再 parse か。write 計画は catalog 単独を信用しない（M5 rename と同じ再検証） |
| Scene / Recorder の所在 | `src-tauri` にモデルが無い。manual と fixture の記録が先 |
| Project 間 Slot 再割当 | AudioAsset 特定に失敗したときの閉じ方。Phase 6 まで延期 |
| Part 表示名 | 装置名とユーザー注釈のどちらを正とするか |

## 13. この設計が変えないもの

- M5 は COMPLETE。Gate C は personal / local の PASS。RC8 は再ビルド・再投入しない
- 公開配布、署名、notarization は NOT AUTHORIZED
- M7 の完了条件と #103–#105 の再開禁止
- クラウド同期は、ローカルのパス境界とバックアップモデルがテストされるまで追加しない
- upstream auto-updater は無効のまま
