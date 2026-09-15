# AUTO-SLICE-1 実装状況

設計基準: [AUTO_SLICE_1_TECHNICAL_DESIGN.md](AUTO_SLICE_1_TECHNICAL_DESIGN.md)

AS-0〜AS-4のローカル編集機能を接続した。Libraryの音声Inspectorから
**Detect attacks → 候補確認 → Apply candidates to draft → 手修正・区間試聴**を行える。
ドラフトはアプリ内SQLiteに保存する。`.ot`出力と媒体へのApplyは未実装。
設計全体の完了や、媒体書き込みGateの通過を意味しない。

## 実装した経路

| 配置 | 責務 |
| --- | --- |
| `ot-domain::slicing` / `onsets` | 元音声のu64 PCMフレーム、半開区間、10進文字列IPC、検出パラメーター・候補・抑制理由 |
| `ot-audio::pcm` | 承認済みdescriptorからSHA-256検証済み不変スナップショットを作り、Symphoniaで末尾まで検証して必要区間を保持 |
| `ot-audio::onsets` | RustFFT 6.4.1、3帯域spectral flux、median/MAD、ピーク選択、PCMの立ち上がり補正、pre-roll、任意のquiet-point snap、NMS |
| `ot-domain::slice_draft` | 提案反映、移動、追加、削除、固定。手動点・固定点・削除候補IDと近傍除外区間を保持 |
| `ot-storage-ports::slice_drafts` / `ot-catalog::slice_drafts` | root fingerprint・相対パス・source hashに束縛した独立テーブル。revision CASと全行transaction、schema v7 migration |
| `slice_workbench` / `v2_api` | RootRegistryとfileInstanceId認可、安全なdescriptor open、解析ジョブ、window/root/job束縛、期限付き一回限りの区間PCM token、Undo/Redo |
| `src/features/slicing` / `src/api/slices.ts` | 明示解析と候補反映、設定変更、波形拡大・移動、frame単位の境界編集、固定、削除、Web Audio区間試聴 |
| MO-M7-RANGE-TO-SLICE-ANALYSIS-1 | Library 波形の確定幾何範囲 → **Analyze selected range** → 既存 `v2_audio_onsets_start`。異なる ROI の既存 draft は `ANALYSIS_REGION_MISMATCH` |

元フレーム0を基準にhop=128、low FFT=2048、mid/high FFT=1024とする。
ROI外の実PCMを前後500ms取得し、人工的なROI境界を無音で埋めない。
逆相ステレオはチャンネルごとの特徴量の最大値で扱う。
設定変更では特徴量を再利用し、pre-rollをestimatedAttackから再計算する。
無音の検出結果は空。実ファイル先頭ですでに音がある場合のみ警告付き境界を扱う。

候補の反映で手動・固定境界は保持する。移動・追加は自動固定、明示的な固定解除は
次の提案での置換を許可する。削除は候補IDと推定アタック近傍2msの除外区間を保存する。
Undo/Redoは現在の解析ジョブ内の最大20操作。Undoでもrevisionを巻き戻さず、CASで新しいrevisionを保存する。
再起動やrescanではドラフトを保持するが、Undo履歴と検出パラメーターはセッション内のみ。

## 入力契約と上限

- RIFF/WAVE整数PCM・FORM/AIFF、16/24bit、mono/stereo、44.1/48kHz。
  RF64、WAVE extensible、AIFC、float PCMなどは明示的に拒否。
- 壊れた長さ・チャンク境界・重複必須チャンク・部分フレーム・宣言数不一致・
  フォーマット変更・非有限PCMは失敗。部分的な結果を成功として返さない。
- **元ファイル64 MiB、選択領域10分、解析PCM割り当て256 MiB**が現在の上限。
  これはプロセス全体のRSS上限ではない。大きいファイルを途中で切り詰めない。
- 解析はアプリ全体で1件。別windowの有効ジョブは横取りしない。
  jobは15分、試聴tokenは120秒・一回限り・最大2件。
  画面切替・明示キャンセルでPCMを破棄。未参照ジョブの自動回収は未実装で、
  期限後の参照または次ジョブ開始時に回収する。
- range waveformは最大4096点/ch。試聴は30秒 / float32 16 MiB以下。
  再生位置は元PCM区間で決まり、HTMLAudioの秒seekを使わない。
- raw候補上限32768、ドラフト上限4096。候補が4096件を超える場合は
  表示件数と超過を明示し、反映を拒否。64スライス超過は別途警告する。
- source hashが変わった音声は別ドラフト。旧内容を自動移植しない。
  同一sourceに保存済みのROIを変更する操作は現時点では拒否する。

## 設計の補足

合成アタックの回帰試験で、centered FFTのピークが実アタックより前に出ることを確認した。
ピーク中心の10ms RMS gateでは正しい候補まで無音として落とすため、gateを
**PCM補正後のestimatedAttack周辺10ms**に適用する。
因果RMSによる立ち上がり補正の10%閾値は、勾配rise点の後方`E[rise+W]`と
局所minimumから計算する。これらは設計書にも反映した。
strengthは検出強度であり、正解確率ではない。

## 検証

合成fixtureで44.1/48kHz、mono/逆相stereo、注釈付きアタックの誤差2ms以内、
再実行の決定性、ROIと前後context、pre-rollの非累積、固定境界、無音、
先頭切断・quiet snap、破損PCM・キャンセルを回帰試験する。
SQLiteは手動点・削除記録・除外区間の再起動後保持、scan projection削除からの独立、
別connectionからのCAS競合、無効編集後の内容保持を検証する。
UIは明示反映、設定変更時の解析再利用、空/上限超過、選択変更後の遅延結果破棄、
競合時の再読込、2^53超のフレームとLE区間PCM検証を含む。

ローカルではGUIに依存しないworkspaceクレートをRust 1.91.1で検証する。
Tauri全体のローカルbuildはpkg-configとGTK/WebKit開発環境がなく停止するため、
通常のLinux/macOS PR CIで検証する。`cargo-audit`は未導入のため実行不可。
フロントテストはこの環境のfork pool停止を避け、設定を変更せず
`pnpm exec vitest run --pool=threads --maxWorkers=1`で実行する。
最終的な検証結果と未実行項目はPRに記録する。

## 残る実装・評価

1. AS-1のApp Support内ディスクスナップショット最大2 GiB、全体4 GiBのcache budget、
   自動期限回収、ストリーミング処理、RSS/速度計測。現行のメモリ版はこの完了条件を満たさない。
2. 設定・algorithm provenanceの永続化、既存ROIの変更/別draft作成、候補の詳細ページング、
   Imported `.ot`/slot ownershipとloopメタデータの統合。既存metadataを本モデルに正規化しない。
3. 実音楽100 clipの注釈コーパス評価。特に低音持続中の高域アタック、残響・弱打・密なrollを評価し、
   精度目標を満たすまで合成試験だけで音楽全般の精度を保証しない。
4. AS-5以降のformat evidence / lossless codec / 新規variant出力。
   `.ot` checksum、end/loop意味論を証拠で確定してからIntent → Plan → Applyへ接続する。
   48kHzは別44.1kHz assetへ変換後に再解析する。既存媒体を直接書き換えるAPIは追加していない。
