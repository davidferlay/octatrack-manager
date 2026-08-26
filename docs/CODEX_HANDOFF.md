# Codex引継ぎ — Octatrack Manager fork

更新日: 2026-08-26

## 1. 目的

既存OSSのOctatrack Managerを素体に、macOSでマウントしたOctatrack MkIIの
ストレージを安全に管理する公開・非商用フォークを開発する。

最終的に狙う機能は次のとおり。

- マウントしたディスク／バックアップの検出
- Octatrackのディレクトリ構造を保ったブラウズ
- Finderに近いカラム表示
- サンプルの波形、長さ、形式、チャンネル等の表示
- 安全なリネーム、移動、コピー、バックアップ
- Google Driveへのバックアップ／同期
- 非破壊または原本保護を前提としたサンプル加工
- Octatrack用スライス設定の作成・編集
- サンプルへの簡単なタグ付け
- 複数のキック等を連結したサンプルチェーンとスライス生成

販売は現在予定していない。GPL-3.0を維持し、公開フォークとして進める。

## 1.1 次世代設計の正本

新規機能と段階移行のアーキテクチャは
`docs/NEXT_GENERATION_ARCHITECTURE.md`を正本とする。

方針は、現行Octatrack Managerを全面破棄するリライトではない。現行版を解析知識、
比較対象、移行期間中の利用可能なアプリとして残し、legacy adapter越しに段階的に
次世代コアへ置換する。

次世代コアの非交渉事項:

- frontendとAIは、root登録時を除いてraw absolute pathを扱わない
- 全writeはIntent → Plan → Applyと検証済みlocal backupを通す
- removable mediaへmulti-file atomicityを約束せず、回復journal付きtransactionにする
- parser/codecは実filesystemへ直接writeしない
- SQLite catalogとAI用MarkdownはMac側へ保存し、Octatrack媒体を汚さない
- cloudは一方向backupから始め、remote direct writeを実装しない

## 2. 正本と現在地

- upstream: `https://github.com/davidferlay/octatrack-manager.git`
- fork: `https://github.com/kaz4g/octatrack-manager-xx.git`
- Macローカル: `/Users/kaz4g/sandbox/gitHub/octatrack-manager-xx`
- upstream基準SHA: `8d32913`
- ベースラインPR: #1マージ済み
- fork基準コミット: `447950f084e33b61c4b7ddd22209865ce7790605`
- PR-0作業ブランチ: `security/p0-updater-containment`
- Node基準: 22 (`.nvmrc`)
- `ot-tools-io`はコミット
  `cd246d8a595647364eb4cc78211033b2d1302526`へ固定済み
- `origin`はfork、`upstream`は本家を参照する

PR-0では、起動時とversionクリック時のupdate確認、download/install、再起動／終了、
frontendとRustのupdater/process plugin、Tauri capability、本家endpointと公開鍵、
updater artifact生成、release workflowのupdater署名経路を無効化した。version番号の
静的表示は維持している。

基準コミット時点で、TypeScript typecheck、frontend build、frontend tests
367件は成功済み。Linux環境のRust/TauriフルテストはGTK/WebKit系system
library不足で未完了。macOS実機で再確認する。

## 3. セキュリティ監査の判定

ソース、本家履歴、直接Git依存、npm/Cargo依存、自動更新、Tauri権限、CIを
確認した範囲では、バックドア、認証情報窃取、サンプルの外部送信、隠れた
コマンド実行、難読化ペイロードなど、明確な悪意の兆候は見つかっていない。

ただし、そのまま実カードへ書き込める安全水準ではない。主な問題は次のとおり。

1. 自動更新が本家GitHub Releasesと本家署名鍵を信頼している
2. Tauri 2.10系に既知のセキュリティ修正漏れがある
3. CSPが`null`
4. Rustコマンドが任意のパスを受け取り、読取・削除・移動できる
5. リネーム／ディレクトリ作成で名前とパストラバーサルの検証が弱い
6. 削除に`remove_file`／`remove_dir_all`を使う箇所があり、復元できない
7. updater依存の`tar 0.4.44`などに既知脆弱性がある
8. `ot-tools-io`経由の`serde_yml`／`libyml`がunsoundかつ保守終了
9. GitHub Actionsが可変タグ参照で、releaseが`npm install`を使う
10. `v0.45.0`は署名タグではなく、配布DMGとソースの同一性保証が弱い

結論は「フォークの素体として条件付き採用」。安全化が終わるまでは、原本SD／
CFカードではなく複製データだけを使う。

## 4. 実装順序

### P0 — 安全化ゲート

最初の実装単位。機能追加と混ぜない。

1. 本家自動更新を無効化する
2. Tauriとupdater関連依存を安全な版へ更新する
3. restrictive CSPを設定し、capabilityを最小化する
4. ユーザーが選択したOctatrackルートをセッションの許可範囲として保持する
5. Rust側の全ファイル操作でルート境界を強制する
6. basename、`..`、絶対パス、区切り文字、symlink escapeを拒否する
7. 削除をゴミ箱またはバックアップ付き処理へ変更する
8. write前バックアップ、atomic write、失敗時rollbackを共通化する
9. パス境界と異常終了をテストする
10. macOSの複製カードでread/write smoke testを行う

1〜3は即時containmentとしてlegacy appへ適用する。4〜10は既存84 commandへ個別に
安全patchを積み上げず、`docs/NEXT_GENERATION_ARCHITECTURE.md`のM1〜M4で新しい
RootRegistry、Plan、Backup、Executor境界として実装する。移行完了までは未移行の
legacy writeを原本媒体向けに有効化しない。

P0の完了条件:

- 起動・スキャン・閲覧は書き込みなしで動く
- 許可ルート外へのread/write/delete/moveがRust側で拒否される
- symlinkと`..`で境界を越えられない
- cancel／失敗後も原本がbyte-for-byteで変わらない
- updaterが本家から自動インストールしない
- `npm audit`／`cargo audit`の残存リスクが記録されている

### P1 — ライブラリ閲覧MVP

- ディスク／バックアップ選択
- ディレクトリツリーとカラム表示
- WAV／AIFF等のメタデータ表示
- 波形表示とプレビュー
- 読み取り専用インデックス
- ローカルDBまたはsidecar metadataによるタグ

Octatrackメディア内に独自タグDBを勝手に置かない。初期案ではMac側の
Application Supportへ、ファイルの相対パス・サイズ・mtime・content hashを
キーに保存する。

### P2 — 安全な編集

- リネーム／移動と参照更新
- バックアップ付きサンプル変換
- normalize、trim、fade、sample-rate／bit-depth変換
- 元ファイル保持と変更プレビュー
- undoまたは操作ジャーナル

### P3 — スライスとサンプルチェーン

- `.ot`メタデータの読取・書込をfixtureで固定
- 波形上でslice markerを編集
- transient／均等分割
- 複数サンプルの連結と自動slice生成
- Octatrackへ渡す前の整合性検証

### P4 — バックアップとGoogle Drive

- まずローカル世代バックアップを完成させる
- manifest、checksum、dry-run、差分表示を実装する
- Google Driveはバックアップ先として開始し、双方向同期は後回しにする
- 削除伝播、競合、部分アップロード、復元を明示的に扱う
- OAuth tokenをOctatrackメディアやリポジトリへ保存しない

## 5. STOP条件

次のいずれかに当たったら書き込み処理を止め、原因を切り分ける。

- 対象がユーザー承認ルート外、または境界を証明できない
- デバイスが取り外された、read-only化した、容量不足になった
- Octatrackファイル形式の解釈に確信がない
- 書込前バックアップまたはchecksum作成に失敗した
- 参照更新が一部だけ成功した
- 同名衝突や大文字小文字差を安全に解決できない
- クラウド同期の競合解決にユーザー判断が必要
- 実カードしかテスト対象がない

## 6. 次のCodex作業

ベースラインPR #1はマージ済みで、PR-0ではupstream updater経路を無効化した。
次は`docs/NEXT_GENERATION_ARCHITECTURE.md`のPR-1 `next-core skeleton`に従い、
runtime behaviorを変えずに次世代coreのcrate/port境界を追加する。既存の巨大moduleを
最初に全面分割
しない。PR-2のread-only vertical sliceで新しい境界が成立することを先に証明する。
