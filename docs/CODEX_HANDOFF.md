# Codex引継ぎ — MasterOCTa

更新日: 2026-08-31

## 1. 目的

MasterOCTaは既存OSSのOctatrack Managerを素体に、macOSでマウントしたOctatrack MkIIの
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
- fork: `https://github.com/kaz4g/masterocta.git`
- Macローカル: `/Users/kaz4g/Documents/ChatGPT/masterocta`
- repository／Mac directoryのMasterOCTa rename: 完了
- upstream基準SHA: `8d32913`
- ベースラインPR: #1マージ済み
- PR-0 updater containment: #2マージ済み
- PR-1 next-core skeleton: #4マージ済み
- pnpm移行: #5マージ済み
- fork Pages URL修正: #6マージ済み
- 依存advisory分類: #7マージ済み
- PR-2 RootRegistry read-only vertical slice: #8マージ済み
- M3-A SQLite catalog foundation: #9マージ済み
- M3-B catalog indexing/query vertical slice: #10マージ済み
- M3-C0 domain semantics contract: #11マージ済み
- MasterOCTa rename: #12マージ済み
- M3-C1 incremental file inventory: #13マージ済み
- M3-C2 Project／Bank state and usage graph: #14マージ済み
- repository固有development skills: #15マージ済み
- M3-C3 sample settings／slice read model: #16マージ済み
- Design System DS1〜DS3 foundation: #17マージ済み
- Design System DS4 StatusBadge／Toolbar: #18マージ済み
- M3-D catalog-backed Library UI: #20マージ済み
- Design System DS5 DataTable foundation: #21マージ済み
- M3-E1 manual tags／notes catalog foundation: #23マージ済み
- M3-E2 manual metadata API／UI: #24マージ済み
- M3-E3 waveform peak cache／期限付きpreview token: #27マージ済み
- P0 containment追加hardening: #28マージ済み
- UI1 AppShell／SourcesPane: #29マージ済み
- macOS AppShell import resolution hotfix: #31マージ済み
- UI2 ProjectWorkspace: #32マージ済み
- M4-A additive copy transaction foundation: #34マージ済み
- UI3 AudioLibrary: #35マージ済み
- UI4 Notes Inspector: #36マージ済み
- M4-A transaction boundary hardening: #37マージ済み
- UI5 Usage Graph: #38マージ済み
- M4-B approved additive copy／live write grant: #39マージ済み
- UI6 MasterOCTa branding rename artifacts: #40マージ済み
- Design System DS7 `--elektron-*` removal: #41マージ済み
- Security recheck R2／v2 error sanitization: #42マージ済み
- opportunistic `App.css` unused rule cleanup: #45マージ済み
- M4-B recovery gate／production recovery導線: #43マージ済み（#47含む）
- Gate B合成ディスクsmoke証拠: #48／#56／#57マージ済み；`199114e` で Linux／macOS 両 PASS
- DEP-1 Tauri security baseline: #49マージ済み
- DEP-2 frontend toolchain: #50マージ済み
- SEC-1 containment CI guard: #51マージ済み
- Gate B smoke macOS移植: #55マージ済み
- Project compatibility policy: #58／#59マージ済み
- Gate B human sign-off: **PASS**（personal/local use、source `a10437f`）
- 現在のmain基準SHA: `6d54238`（M5-A P1 planning fixes PR #65 merge後。本作業は M5-C1）
- M5-A sample rename impact planning: #61 マージ済み
- M5-A fail-closed blocker tests: #64 マージ済み
- M5-A P1 planning fixes（unparseable Project / destination unresolved slots）: #65 マージ済み
- M5-B lossless Project reference rewrite codec: #62 マージ済み
- M5-B codec fail-closed／contract tests: #63 マージ済み
- M2: 完了
- M3: 完了
- M4-A: 完了
- M4-B: 完了
- Gate B: 完了（personal/local use。public distribution承認ではない）
- Design System Phase A–D: 完了（DS1–DS7 / UI1–UI6）
- M5-A: **完了**（pure domain/planning contract + blocker matrix）
- M5-B: **完了**（メモリ専用 PATH 置換 codec）
- M5-C1 rename verified multi-file backup: **このPR**
- 現在の作業: M5-C1（Mac側 immutable rename backup。媒体 write なし）
- SQLite schema: v6（compatibility evidence を含む）
- 次の機能実装: M5-C1 完了後 **M5-C2**（Mac staging: backup再検証、codec rewrite、
  semantic diff、authorization、未適用 journal 準備）。媒体 mutation は **M5-C3**
- Gate C rename Apply 残条件: C2/C3、clone上 rename→rescan missing 0、
  非対象hash不変、rollback byte復元、実機clone load smoke
- Developer ID signing / notarization / public distribution は別release gate
- M5-A contract 正本: `docs/planning/M5_A_SAMPLE_RENAME_IMPACT.md`
- M5-B contract 正本: `docs/planning/M5_B_REFERENCE_REWRITE.md`
- M5-C contract 正本: `docs/planning/M5_C_RENAME_TRANSACTION.md`
- Node基準: 22（`>=22.13.0`、`.nvmrc`）
- package manager: `pnpm@11.24.0`
- `ot-tools-io`はコミット
  `cd246d8a595647364eb4cc78211033b2d1302526`へ固定済み
- `origin`はfork、`upstream`は本家を参照する

PR-0では、起動時とversionクリック時のupdate確認、download/install、再起動／終了、
frontendとRustのupdater/process plugin、Tauri capability、本家endpointと公開鍵、
updater artifact生成、release workflowのupdater署名経路を無効化した。version番号の
静的表示は維持している。

依存advisory分類では、現在の製品runtimeから到達可能なcritical/highは確認されず、
RootRegistry read-only vertical sliceへ進む判定となった。受容期限と再確認条件は
`docs/security/DEPENDENCY_AUDIT.md`を正本とする。

## 3. セキュリティ監査の判定

ソース、本家履歴、直接Git依存、JavaScript/Cargo依存、自動更新、Tauri権限、CIを
確認した範囲では、バックドア、認証情報窃取、サンプルの外部送信、隠れた
コマンド実行、難読化ペイロードなど、明確な悪意の兆候は見つかっていない。

ただし、そのまま実カードへ書き込める安全水準ではない。主な問題は次のとおり。

1. 自動更新が本家GitHub Releasesと本家署名鍵を信頼している
2. Tauri 2.10系に既知のセキュリティ修正漏れがある
3. CSPが`null`（→ 本ブランチでrestrictive CSPを設定）
4. Rustコマンドが任意のパスを受け取り、読取・削除・移動できる（legacy残存）
5. リネーム／ディレクトリ作成で名前とパストラバーサルの検証が弱い（legacyはbasename検証を追加）
6. 削除に`remove_file`／`remove_dir_all`を使う箇所があり、復元できない（ユーザー削除はtrashへ移行）
7. updater依存の`tar 0.4.44`などに既知脆弱性がある（updater除去で解消）
8. `ot-tools-io`経由の`serde_yml`／`libyml`がunsoundかつ保守終了
9. 一部GitHub Actionsが可変タグ参照のまま残っている（→ 本ブランチでSHA固定）
10. `v0.45.0`は署名タグではなく、配布DMGとソースの同一性保証が弱い

結論は「フォークの素体として条件付き採用」。安全化が終わるまでは、原本SD／
CFカードではなく複製データだけを使う。

最新のcontainment状況（CSP、Actions SHA固定、ゴミ箱削除、basename検証、残課題）
は `docs/security/SECURITY_STATUS.md` を正本とする。

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
- `pnpm audit`／`cargo audit`の残存リスクが記録されている

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

ベースラインPR #1、PR-0、PR-1、pnpm移行#5、fork Pages修正#6、依存監査#7、
PR-2 RootRegistry read-only vertical slice #8はマージ済みで、M2は完了した。

M3は小さなPRへ分割する。M3-A #9でcatalog foundation、M3-B #10でApplication
Support上のproduction catalog、root登録時のread-only full scan保存、live `RootId`
再検証後のcatalog queryまで完了した。catalogはraw／canonical／mount pathとsession
`RootId`を保存せず、同一persistent fingerprint rootの同時登録とcatalog path symlinkを
fail-closedで拒否する。schemaはM3-C3までにv4へ移行済みである。

M3-C0 #11はOctatrack固有のstate、sample scope、sample settings ownershipをpure
domain typeと設計契約として固定した。参照した`OCTATRACK DIARY R13`は2016年作成・
Octatrack OS 1.25基準の非公式二次資料であり、MkII OS 1.40+仕様の正本ではない。
version依存の数値、filename mapping、format制約は現行公式資料とfixtureで確認するまで
実装定数にしない。M3-C0ではSQLite schema、runtime、frontend、writeを変更していない。

MasterOCTa rename #12はマージ済みで、repository／Mac directoryのrenameも完了した。
M3-C1 #13はread-onlyで`AudioAsset`／`FileInstance`、streaming SHA-256、size、mtime、
`SampleStorageScope`、schema v2、metadata baselineによるincremental hash再利用を追加した。
size／mtime一致による再利用はcatalog検索用の観測projectionに限り、将来のwrite安全証明
には使わない。write前には実fileを必ず再hashする。frontend DTOとTauri command surfaceは
変更していない。

M3-C2 #14はProject／BankのWorking（`.work`）とSavedCheckpoint（`.strd`）をread-onlyで
indexし、parser revisionとsource version、typed sample slot assignment、machine／sample
lock usage、resolved／missing／invalid／unassignedの参照状態をschema v3へtransactionalに
保存する。公式OS 1.40A manualはProject／BankのSAVE／RELOAD意味論を裏付けるが、媒体上の
filename mappingは記載していないため、`.work`／`.strd`対応のprovenanceは追跡済みfixture、
既存reader、固定`ot-tools-io` revisionとして保持する。parse不能・未対応versionは黙って
除外せず状態として保存し、partial usageを最新結果にしない。raw／canonical／mount pathと
session `RootId`はcatalogへ保存しない。frontend DTO、Tauri command、write処理は変更しない。

M3-C3 #16はslot assignment所有のraw settings、検証済み`.ot` file-sidecar settings、slice
markerをschema v4へtransactionalに保存する。各rowはparser revision、source revision、
source OS version（取得可能な場合）、categorical evidence、Parsed／UnsupportedVersion／
Malformedを保持する。曖昧なsame-stem sidecar ownerはfail-closedとし、unsupported／malformed
sourceからpartial値を公開しない。frontend DTO、Tauri command、write／round-trip behaviorは
変更していない。

M3-D #20では既存`v2_library_list`のcatalog snapshotを安全なfrontend DTOへ投影し、Set、
Standalone Project、Set Audio Pool、Project-local sample、Unclassified sampleをread-onlyの
カラム表示で閲覧する。frontendへ返すfile identityはDTO専用opaque IDと検証済みrelative pathに
限定する。FileInstance IDは永続root identityとrelative pathから生成し、content変更後も同じ
instance identityを維持しつつ、別rootの同一relative pathとは衝突しない。raw absolute path、
content hash、mtimeは公開しない。新command、filesystem再scan、
SQLite migration、write処理は追加していない。

M3-Eはさらに分割する。M3-E1 #23ではcontent hash単位の`AudioAsset`へmanual tag／noteを
関連付けるdomain value、catalog port、application use case、schema v5 migration、
transactional replacementを追加した。同じcontentを持つFileInstance間でmetadataを共有し、
rename、一時的なcatalog非観測、別root上のduplicate後も保持する。

M3-E2 #24ではopaque `AssetId`をlive `RootId`のcatalog snapshotに照合してからMac側SQLiteの
manual metadataだけを取得・更新するTauri APIとLibrary Inspector UIを追加する。raw content
hash、absolute path、session `RootId`をcatalogへ保存せず、Octatrack媒体やaudio fileへwrite
しない。

M3-E3 #27ではcontent hashと一致するlive audio sourceを再検証してから、Mac側Application
Supportへversion付きmulti-resolution waveform peak cacheを生成する。previewはbackendで
最大60秒・32 MiBのPCM WAVへ変換し、live `RootId`に束縛した2分間・one-shotのopaque
tokenで即時取得する。frontendへraw content hashやabsolute pathを返さず、cacheやpreviewを
Octatrack媒体へ保存しない。SQLite schemaはv5のまま変更しない。

M4は安全境界を先に固定するためM4-A／M4-Bへ分割する。M4-Aは同一の承認済みroot内で、
既存sampleを未使用のroot-relative destinationへ追加copyするtransaction foundationに限定する。
`ot-plan`、`ot-backup`、`ot-executor`を追加し、IDと内容を再照合するversion付きChangePlan、Mac側local staging、
planへ束縛した再読込検証済みbackup、fsync付きoperation journal、root単位writer lock、
descriptor-relative path解決、operation固有partialのno-replace公開、post-write hash検証、
rollback／crash recoveryを一時fixtureだけで検証する。削除、上書き、参照更新、production
RootRegistry wiring、Tauri command、frontend、write grant発行はM4-Aに含めない。M4-Bで
session限定write authority、plan diff／明示承認、production compositionを別PRとして扱う。
テストDBとaudio fixtureは一時directoryだけを使用し、実SD／CFカードやOctatrack原本
データを使用しない。依存監査の既存受容期限と再確認条件は維持する。

M4-Bでは、stable identityを持つlive RootRegistry sessionに15分以内の非永続write grantを
明示的に付与し、executorの各checkpointで再検証する。`change-plan:v1`はcatalogのopaque
FileInstance IDと検証済みroot-relative destinationから生成し、frontendのChange Drawerで
CREATE diff、verified backup対象、警告、overwrite/delete禁止を表示する。Applyは表示した
同一PlanIdの明示承認を一回だけ受理し、成功後にcatalogを再scanして置換する。plan、grant、
session RootId、absolute pathは永続化しない。journal／backup／stagingはMac側Application
Support配下だけに置く。

`change-status:v1`と`change-recovery-status:v1`は未完了journalをfail-closedに公開し、存在時は
新しいgrantとApplyを拒否する。このPRはproduction recovery実行commandを公開しないため、
Gate Bはreview済みclone smokeと明示的recovery導線の要否を確認するまで完了扱いにしない。
production composition testは生成したtemporary rootと合成WAVだけを使用し、sourceの
byte-for-byte不変、追加先の一致、catalog再取得を確認する。

Gate B recovery補完では、通常write grantとは分離したrollback専用authorityを追加する。
frontend／Tauri APIはlive `RootId`、opaque `OperationId`、同じ`OperationId`への明示承認だけを
受け、raw pathやplan内容を受け取らない。Recovery開始時に残存write grantを失効させる。
executorはjournalとverified backupを再検証し、記録済み
file identityとbackup内容に一致するoperation-created destination／partialだけを削除する。
replacement、tampered/missing backup、root identity変更、symlinkはfail closedで保持する。
crash/restart routeはtemporary directoryと合成WAVだけで自動testし、実SD／CFカードや原本データは
使用しない。production fault injectionは追加しない。

recovery destinationはbackup manifest v2のversion付きrecovery bindingへsource、destination、
plan／snapshot ID、root fingerprint、revision、source size／hashとともに束縛する。journal単体の
destination／file identity改変では別fileを削除できない。terminal journalの再実行は
`PLAN_CONSUMED`として拒否し、writer lock取得後とmedia mutation直前にlive rootを再観測する。
file identity checkpoint前のcrashでは、空のoperation固有partialを削除せず保持し、失敗終端として
root全体のwrite blockだけを解除する。

manifestとjournalの同時改変にも依存しないよう、plan時のsource／destination／identity／bindingは
別のread-only plan authorization recordへcreate-onceで固定し、standalone recoveryで三者を照合する。
このrecordにもsession `RootId`、absolute path、mount pathは保存しない。recoveryはmedia dispositionを
terminal journalへfsyncした後にMac側staging cleanupを行うため、local cleanup失敗でrootを再blockしない。

rollbackの削除対象はoperation固有quarantineへno-replace renameしてからidentityと、published fileでは
backup由来contentを再検証する。検証中にdestinationが外部processから置換された場合は置換fileを
restoreまたはquarantineに保持し、削除しない。partialからdestinationへのpublish rename直後にcrashしても、
renameで変化し得るctimeを除いたdevice／inode／size／mtime identityとcontent検証で回復できる。
同一process内の即時rollbackでもpublished fileはexpected size／hashを再検証し、粗いmtimeを維持した
同size外部rewriteを削除しない。unidentified empty partialを`Abandoned`へ終端化した場合もfrontendは
session／recovery状態をrefreshし、partial保持のwarningを残す。
前releaseのjournal v2は互換読取りし、対応するbackup manifest v1は認証済み削除根拠として使用しない。
recovery bindingを持たないlegacy未完了状態はmediaとbackupを保持したまま`Abandoned`へ安全終端化して
root全体のblockだけを解除する。

この補完PRの成功後も、`docs/testing/GATE_B_CLONE_SMOKE.md`のhuman-reviewed smokeは別の残条件
として残った。由来確認済みの使い捨てcloneによるsign-off前はGate B完了や原本media write対応を
宣言せず、M5を開始しなかった。

Project compatibility policy follow-upでは、固定`ot-tools-io`の判定を維持しつつ、同libraryが
unsupportedとする実機Octatrack MkII由来の`VERSION=19`／`R0173`／`1.40`だけを、追跡済みfixtureの
SHA-256とMETAを根拠にMasterOCTa側で限定承認する。revision／releaseはASCII spaceだけで区切る
exact tokenとして扱い、未知・malformed・別Project VERSIONは従来どおりread-onlyとする。
`ensure_write_eligible()`、stable identity、traversal／symlink、overwrite禁止、Intent → Plan → Apply、
backup／journal／recovery境界は変更しない。Projectを全面serializeせず、additive copy時のProject／
Bank不変をSHA-256で検証する。

このfollow-up merge後、source
`a10437f3b32c2c116a8e9133dd21c762843ed36e`のDMGで
`docs/testing/GATE_B_CLONE_SMOKE.md`のcompatibility-policy retestを実施した。
DMG検証、Octatrack OS 1.40互換、human additive copy、source／destination SHA一致、
既存media不変、remount persistenceはいずれもPASSであり、Gate Bはpersonal/local use scopeで
human sign-off済み。M5へ進行できる。

検証DMGはad-hoc signedであり、Developer ID signing／notarizationはpersonal/local use scopeには
要求しない。一方、このDMGをpublic distribution artifactとして扱ってはならない。公開配布には
別途signing、notarization、provenance、release security gateが必要である。
