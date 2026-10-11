# Bank Mutation Safety Contract

- Work ID: `MO-PSE-BANK-MUTATION-CONTRACT-1`
- Parent issue: #182
- Contract schema: `masterocta.bank-mutation-contract:v1`
- Code: [`ot_plan::bank_mutation`](../../src-tauri/crates/ot-plan/src/bank_mutation.rs)（pure、filesystem 非依存）
- Contract tests on fixtures: [`src-tauri/src/bank_mutation_contract.rs`](../../src-tauri/src/bank_mutation_contract.rs)
- Inventory: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json)（`ot-plan-bank-mutation-contract`、`masterocta-bank-mutation-contract`）
- Gate ledger: [`scripts/pse-bank-mutation-gates.json`](../../scripts/pse-bank-mutation-gates.json)（`contract.document` がこの文書を指す。各 gate の `contract_rules` / `contract_tests` は §14）
- Static guard: [`scripts/pse-bank-mutation-guard.mjs`](../../scripts/pse-bank-mutation-guard.mjs)（#206、CI foundation §12）
- Related: [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md) §6 / §9、[`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md) §7C / §11、[`../testing/PSE_CI_FOUNDATION.md`](../testing/PSE_CI_FOUNDATION.md)、[`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md) P4 / P5 / §5.6–5.8

## 0. この文書の位置づけ

Bank Copy / Move / Swap の Apply（#183）が満たすべき安全契約である。Apply を実装してよい条件と、Apply を始めてはいけない STOP 条件を、テストで検証できる形に固定する。

この文書と付随コードは次をしない。

- Apply、Recovery、Backup の実装。Bank 用の write API、Tauri command、frontend 操作
- 実機 CF 原本、ユーザー原本、tracked fixture への書き込み
- PSE-3 の承認。control plane §9 のとおり、PSE-3 は別文書で明示承認するまで着手しない
- #181 ChangePlan の内容決定。Plan をどう計算するかは #181 の責任。この契約は Plan が何を持ち、どう検査されるかだけを決める
- Sample management（AudioAsset、lineage、hash、catalog、slice）の変更。Bank 側は Sample Slot 参照だけを持つ

```text
BANK_MUTATION_CONTRACT = DEFINED (v1)
APPLY_READINESS        = NOT_READY
```

## 1. 依存と現在の判定

`ReadinessEvidence::current_main()` は 7 項目中 **`ArrangementFileSlot` のみ解決済み**（#204、`P_ARR_TEST` on MkII `R0173` / OS `1.40`）。残り 6 gap が open の間、他の検査がすべて通っても Apply entry permit は発行されない（テスト `current_main_withholds_the_permit_even_for_a_clean_plan`、`a_single_open_gap_withholds_the_permit`）。実装可能な read-only ChangePlan 計画器と実行可能計画の区別は [`PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md`](./PSE_BANK_CHANGEPLAN_READINESS_RECONCILIATION.md) を参照。

| `ReadinessGap` | 未解決の理由 | 追跡 |
| --- | --- | --- |
| `BankChangePlan` | #181 は `BANK_CHANGEPLAN_READINESS = NOT_READY` | #181 |
| `ArrangementFileSlot` | `[STATES] ARRANGEMENT` のファイル対応は MkII `R0173` / OS `1.40` の `P_ARR_TEST`（UI 1/2/8 → raw 0/1/7 → `arr01`/`arr02`/`arr08`）でのみ解決済み。それ以外の OS は `Unrecognized` のまま | #204 |
| `ArrangerPatternReferences` | Arranger `pattern_id`（`n_rows == 0` を含む）の番号付けが未証明 | 監査 §7C / §8 |
| `BankInternalIdentity` | A/B/C/E/F 監査後も `BANK_INTERNAL_IDENTITY = NOT_OBSERVED`（[`PSE_BANK_INTERNAL_IDENTITY.md`](./PSE_BANK_INTERNAL_IDENTITY.md) #221） | 監査 §7C |
| `SceneAndRecorderDependencies` | Scene / Recorder は unmodeled。unmodeled 依存は計画を失敗で閉じる | 監査 §7C、control plane §6 |
| `WorkingSavedCheckpointRule` | `.work` / `.strd` のどちらを動かすか、`[STATES] BANK` をどう扱うか未決 | 監査 §7C、control plane §12 |
| `ApplyAuthorization` | PSE-3 Apply の明示承認文書がない | control plane §9 |

項目を解決済みにするには、`ReadinessEvidence::current_main()` とそれを固定するテスト `current_main_readiness_keeps_remaining_changeplan_gaps_open` を、追跡先の証拠を添えたレビュー済み PR で変更する。`ReadinessEvidence::assume_resolved` は `#[cfg(test)]` の契約テスト専用であり、製品ビルドからは呼べない。`ReadinessEvidence` の field は private で、製品から得られる値は `current_main()`（と同値の `Default` / `Clone`）だけである。証拠: `ot-plan` の doctest（`current_main()` は compile でき、`assume_resolved` の呼び出しと struct literal は compile できない）と、inventory 内のテスト `production_cannot_resolve_readiness_or_forge_a_permit`（`#[cfg(test)]` の位置、`-> Self` を返す公開関数が 2 つだけであること、field が private であることを source で検査）。stable の rustdoc は `compile_fail` の error code を照合しないため、各 snippet が意図した error（E0599 / E0451 など）だけで失敗することは手元で個別に compile して確認した。

## 2. 既存 safety primitive の再利用監査

| 既存 | 場所 | Bank mutation での扱い |
| --- | --- | --- |
| `RootRegistry` / `RootId` / 登録時のみ raw path | `root_registry.rs`、`v2_api.rs` | **再利用**。Bank 操作も `RootId` + `RootRelativePath` だけを受ける |
| contained read（non-following descriptor、root 内確認） | `legacy_read_adapter.rs`、`project_structure_reader.rs` | **再利用**。PRE/POST の read model と manifest 取得はこの境界を通す |
| write grant（`v2_root_enable_write` / `disable_write`） | `v2_api.rs` | **再利用**。`LiveTargetObservation.write_enabled` が false なら STOP |
| cross-domain mutation gate | `mutation_gate.rs` `ensure_cross_domain_mutation_allowed` | **拡張が必要**（#185）。現在は additive / rename journal だけを見る。Bank journal を加え、同じ root の未完了 journal があれば `recovery_pending = true` とする |
| PlanId（`plan:v1:` + SHA-256、canonical field encoding） | `ot-plan` `lib.rs` / `rename.rs` | **再利用**。`derive_bank_mutation_plan_id` は同じ形式で envelope の全 field を封じる |
| freshness / stale 再検証 | `ot-plan` `validate_rename_plan_freshness` | **型を踏襲**。Bank では project scope 全体の manifest 差分で判定する |
| verified backup snapshot（Mac 側、complete、再読込検証） | `ot-backup` `BackupStore` | **型を踏襲**。Bank 用 manifest（plan binding、file 一覧）は #185 で追加する。`BackupEvidence` が満たすべき値を定義する |
| executor lock / journal / staging | `ot-executor` | **型を踏襲**。Bank 用 journal と Apply は #183 / #185。媒体を変更できるのは `ot-executor` だけ（P3） |
| fixture PRE/POST manifest（Node） | `scripts/pse-fixture-manifest.mjs` | **同じ意味論を Rust 型にした**。path、entry type、size、SHA-256、symlink を記録。mtime は使わない |
| legacy write 停止 | `legacy_command_gate.rs` | **維持**。`copy_bank` / `copy_parts` / `copy_patterns` / `copy_tracks` / `copy_sample_slots` は DISABLED のまま。復活させない |
| rename API | `v2_rename_*` | **流用しない**。Bank swap を rename として実装しない（control plane §5、CI foundation §8） |

## 3. Flow（BMS-FLOW）

```text
Intent → Plan → Review → Backup → Prepare → Apply → Verify → Committed
                                              │        │
                                              └────────┴→ Recovery → RolledBack
                                                              │
                                                              └→ RecoveryRequired ⇄ Recovery
Intent / Plan / Review / Backup / Prepare → Cancelled
```

| ルール | 内容 | テスト |
| --- | --- | --- |
| BMS-FLOW-1 | 段階を飛ばさない（例: Plan → Apply、Backup → Apply は不可） | `phase_flow_cannot_skip_steps_or_cancel_mid_apply` |
| BMS-FLOW-2 | Apply 中・Verify 中は Cancel しない。Recovery へ進むか Verify を終える（architecture §5.8） | 同上 |
| BMS-FLOW-3 | Committed / RolledBack / Cancelled は終端。stale になった Plan は rebase せず Cancelled にして再計画する | 同上 |
| BMS-FLOW-4 | target へ write してよい phase は Apply と Recovery だけ。Verify は read only | `only_apply_and_recovery_may_write_and_failures_have_one_disposition` |

## 4. 何を write とみなすか（BMS-WRITE / BMS-NOWRITE）

project directory 配下の全 entry を `TreeManifest` に取る。key は root 相対 path。entry は `File { byte_size, content_hash }`、`Directory`、`Symlink { target_digest }`、`Other` のいずれか。

次のどれか 1 つでも起きれば write とみなす（`TreeChangeKind`）。

- `Created`: PRE に無い entry が POST にある
- `Removed`: PRE の entry が POST に無い
- `ContentChanged`: regular file の size または SHA-256 が変わった
- `EntryKindChanged`: file / directory / symlink / other の種別が変わった
- `SymlinkRetargeted`: symlink の参照先テキストが変わった

### `ContentHash` の意味

`ContentHash`（`ot-domain`、`sha256:` + 64 桁 hex）は、ファイル 1 つの **byte 列の SHA-256 digest** という汎用の値である。plan、backup、executor、そして `TreeManifest` が同じ型を使う。**AudioAsset の identity ではない。** manifest の entry hash が等しいことは「この path の byte が変わっていない」ことだけを意味し、同じ AudioAsset であることも、Slot 参照が同じ sample に解決されることも意味しない。AudioAsset の identity と lineage は Sample management 側（#208 の sample-boundary contract）が持つ。

symlink の参照先は digest だけを保持し、manifest に root 外の path を持たせない。mtime、atime、permission bit は契約に含めない。FAT 系媒体では信用できないためである。

**no-write 証明**（`prove_no_write`）は PRE と POST の manifest が等しいことである。CI foundation §5 と同じく、これは byte と entry 種別が変わっていない証拠であり、write syscall が起きなかった証明ではない。no-write を主張するコードパスは、write API を持たないことと組み合わせて示す。

| ルール | 内容 | テスト |
| --- | --- | --- |
| BMS-WRITE-1 | 上の 5 種類はすべて write として検出される | `every_kind_of_tree_difference_counts_as_a_write` |
| BMS-NOWRITE-1 | Intent〜Prepare、Cancelled、RolledBack では target は PRE と byte 一致でなければならない | `only_apply_and_recovery_may_write_and_failures_have_one_disposition` |
| BMS-NOWRITE-2 | 契約評価（read model の取得、envelope の封印、entry gate）は TempDir コピーを変更しない | `contract_evaluation_on_a_real_read_model_leaves_the_copy_byte_identical` |

## 5. Plan envelope（BMS-PLAN / BMS-SCHEMA）

`BankMutationEnvelope` は #181 ChangePlan の安全に関わる射影である。#181 の Plan は、少なくとも次を envelope として出せなければならない。

| field | 意味 |
| --- | --- |
| `contract_schema` | `masterocta.bank-mutation-contract:v1` |
| `read_model_schema` | Plan を計算した read model の DTO schema（現行 `masterocta.project-structure:v4`） |
| `root_id`、`device_fingerprint`、`base_observed_revision` | root の identity と観測 revision |
| `project_relative_path` | 対象 project directory |
| `kind`、`source`、`destination` | Copy / Move / Swap と Bank index |
| `affected_roles` | 動かす文書 role（Working / SavedCheckpoint）。含まれない role は両 Bank とも不変 |
| `scope_manifest` | Plan 時点の project scope 全体の manifest（byte digest のみ。§4） |
| `documents` | Plan が読んだ state 文書と parse status |
| `expected_changes` | 変更してよい path ごとの `before` / `after`（`Absent` または size + SHA-256） |
| `unmodeled` | Plan がモデル化できなかった依存 |

envelope が precondition として記録してよいのは、**Slot の identity と参照状態（read model の `TrackSlotReference` など）、および `scope_manifest`** だけである。AudioAsset id、FileInstance id、catalog の sample content hash、lineage、slice は記録しない。Slot identity は structure verify（§10）で比較し、参照状態の追跡は #184 で加える。テスト `envelope_records_no_audio_asset_or_sample_identity` が envelope の field 定義と import を検査する。

`BankMutationEnvelope::seal` が全 field を canonical encoding して `PlanId` を作る。どの field を書き換えても `validate_integrity` が失敗する（`sealed_plan_id_is_deterministic_and_detects_tampering`）。

### 変更してよいファイル（BMS-CHANGESET）

Bank 操作の `expected_changes` に入れてよい path は、project directory 直下の **`bankNN.work` / `bankNN.strd`（`NN` = `01`–`16`）だけ**である（`bank_document_target`）。さらに、その Bank が操作で書く Bank（Copy は `destination` だけ、Move / Swap は `source` と `destination`）であり、その role が `affected_roles` に含まれなければならない。違反は次の安定コードで STOP する。

| 違反 | `StopCondition` | code |
| --- | --- | --- |
| project directory の外 | `ExpectedChangeOutsideProject` | `BMS_CHANGE_OUTSIDE_PROJECT` |
| project 内だが Bank 文書ではない（`project.work` / `project.strd`、`markers.work`、`arrNN.work`、sample ファイル、`.ot`、サブディレクトリ内の path、大文字や桁数違いの名前など） | `ExpectedChangeNotBankDocument` | `BMS_CHANGE_NOT_BANK_DOCUMENT` |
| 操作で書かない Bank の文書（Copy の複製元を含む） | `ExpectedChangeOutsideOperatedBanks` | `BMS_CHANGE_OUTSIDE_OPERATED_BANKS` |
| `affected_roles` に無い role の文書 | `ExpectedChangeRoleNotAffected` | `BMS_CHANGE_ROLE_NOT_AFFECTED` |

テスト: `bank_operations_may_only_plan_changes_to_operated_bank_documents`、`bank_document_target_accepts_only_direct_bank_files`。

`project.work`（`[STATES] BANK` の追従など）を変更対象に加える判断（§16-3）が出た場合は、この whitelist を広げる contract schema の更新として扱う。

`expected_changes[].after` は Prepare で作った staged bytes から取る。Bank internal identity が未証明なので、複製先 Bank が複製元と byte 一致すると仮定しない。

変更してよい path は、操作が必ず書く Bank ファイルを過不足なく含む。Copy は複製先、Move と Swap は複製元と複製先で、それぞれ `affected_roles` の文書が change set に無いときは `MissingOperatedBankChange` になる。つまり change set は「操作で書く Bank × `affected_roles`」の Bank 文書と完全に一致しなければならない。Copy の複製元は byte 不変であるべきなので change set に含められない（`copy_change_set_may_not_touch_the_source_bank`）。

schema 慣行は #197 / #199 と同じである。rule または encode する field を変えるときは `contract_schema` と canonical prefix を上げ、v1 を in-place で拡張しない。read model の DTO schema が Plan 時点と Apply 直前で違えば STOP する（`ReadModelSchemaChanged`）。

## 6. Apply entry の STOP 条件（BMS-ENTRY）

`evaluate_apply_entry` は検査対象の envelope を消費し、通ったときだけ `ApplyEntryPermit` を作る。permit はその envelope を保持する。`fields` は `seal` のあと外から変更できない。`id` も private で、`Deref` は読み取り専用である（`DerefMut` は無い）。permit を外で組み立てることはできない。将来の Apply は `permit.envelope()` を使い、同じ `PlanId` の別 envelope を書き込まない（`permit_keeps_the_checked_fields_not_a_later_edit`）。

permit は 1 回の観測に対する証拠であり、lease ではない。**#183 の executor は、root の writer lock を取ったあと、最初の write の直前に target を再観測し、`ApplyEntryPermit::reverify` で integrity と entry 検査をすべてやり直さなければならない。** その write には `reverify` が返した permit だけを使う。`reverify` は permit を消費するので、古い permit は残らない（`permit_must_be_reverified_against_a_fresh_observation`）。STOP 条件は 1 つ見つけた時点で止めず、該当するものをすべて決定的な順序で返す。各条件には `BMS_*` の安定コードがある（`stop_condition_codes_are_unique`）。

| 区分 | `StopCondition` | テスト |
| --- | --- | --- |
| readiness | `ReadinessGap(_)` | `current_main_withholds_the_permit_even_for_a_clean_plan` |
| envelope | `ContractSchemaMismatch`、`PlanIntegrityMismatch`、`InvalidRootFingerprint`、`InvalidObservedRevision`、`SourceEqualsDestination`、`NoAffectedRoles`、`DuplicateAffectedRole`、`EmptyChangeSet` | `envelope_shape_fails_closed`、`sealed_plan_id_is_deterministic_and_detects_tampering` |
| change set | `DuplicateExpectedChange`、`NoOpExpectedChange`、`ExpectedChangeOutsideProject`、`MissingOperatedBankChange`、`ExpectedChangeNotBankDocument`、`ExpectedChangeOutsideOperatedBanks`、`ExpectedChangeRoleNotAffected`、`ExpectedChangeBeforeMismatch` | `expected_changes_must_be_unique_real_and_inside_the_project`、`project_prefix_check_does_not_accept_a_sibling_with_the_same_prefix`、`bank_operations_may_only_plan_changes_to_operated_bank_documents`、`change_set_is_limited_to_operated_bank_files` |
| parse / model | `DocumentNotParsed`（`Malformed`、`UnsupportedVersion`）、`MissingParserEvidence`、`UnmodeledDependency(_)`、`NonRegularEntryInScope`（symlink、FIFO など） | `unparsed_documents_unmodeled_dependencies_and_links_block_the_plan`、`omitted_affected_bank_evidence_blocks_the_plan`、`trusted_read_model_supplies_unmodeled_blockers`、`trusted_read_model_rejects_an_unparsed_affected_bank`、`a_symlink_in_the_project_scope_blocks_the_plan_without_being_followed` |
| stale / root | `RootMismatch`、`DeviceFingerprintChanged`、`UnstableRootIdentity`、`ObservedRevisionChanged`、`ReadModelSchemaChanged`、`StalePrecondition(_)` | `stale_live_observation_withholds_the_permit`、`a_byte_changed_after_planning_makes_the_plan_stale` |
| 権限 / 他操作 | `WriteNotEnabled`、`RecoveryPending` | `stale_live_observation_withholds_the_permit` |
| target | `TargetNotFixtureScope(_)` | `only_fixture_scope_targets_are_writable` |
| backup | `BackupMissing`、`BackupPlanMismatch`、`BackupIncomplete`、`BackupNotReverified`、`BackupNotLocal(_)`、`BackupDoesNotCover`、`BackupHashMismatch` | `backup_must_be_complete_local_reverified_and_cover_every_changed_file` |

stale 判定は対象ファイルだけでなく project scope 全体で行う。Plan 後に scope 内のどの entry が増減・変化しても、その Plan は使えない。

parser 証拠は Plan が選んだ文書だけではなく、操作が読む Bank を覆わなければならない。`project.work` と、affected role の複製元 Bank は Parsed で plan に含まれる。Swap、および manifest に既にある複製先 Bank も同じである。unmodeled 依存は envelope の任意リストではなく、executor が Apply 直前に渡す `LiveTargetObservation.project_structure` から取る。Plan が文書を省いたり unmodeled を空にしても、read model が未解析または unmodeled なら permit は出ない。

**未完了（#183 / fail closed）**: `LiveTargetObservation.project_structure` は今のところ呼び出し側が渡す値である。これを信頼できる read model とするには、#183 の executor が writer lock の内側で、contained reader（`project_structure_reader`）を使って同じ project を再読込した結果を入れる必要がある。その配線は #183 の範囲で、まだ無い。それまでは readiness gap がすべて未解決なので permit は出ない（§1）。#183 はこの配線と、read model を executor 以外から注入できないことのテストを、gate を ACTIVE にする条件に含める。

## 7. Target（BMS-TARGET）

#183 の間、Apply 先は `TrackedFixtureCopy` と `TemporaryProjectCopy` だけである。`UserProject`、`OriginalMedia`、`Unclassified` は STOP する。target class は backend が root について持つ証拠から決める。frontend の flag や表示名から決めない。tracked fixture そのものは対象にしない（コピーだけ）。

## 8. Backup（BMS-BACKUP）

Apply 前に、次をすべて満たす backup が必要である。

- この Plan の `PlanId` に束縛されている
- `complete` であり、作成後に再読込して検証済み（`reverified`）
- Mac 側 Application Support にある（target 媒体上の backup は認めない。architecture §5.7）
- `before` が `File` の全 expected change について、同じ path、size、SHA-256 のファイルを含む

`before` が `Absent` の path（Copy 先など）は backup 対象のファイルが無い。その path が PRE で存在しなかったことは `scope_manifest` が記録しており、Recovery はそれを根拠に作成物を取り除く。取り除いたファイルは即時削除せず、回復可能な隔離を優先する（AGENTS.md）。

## 9. Partial failure（BMS-FAIL）

複数ファイルの原子的更新は約束しない（architecture P5）。代わりに phase ごとの扱いを固定する（`BankMutationPhase::on_failure`）。

| 失敗した phase | 義務 |
| --- | --- |
| Intent / Plan / Review / Backup / Prepare | `CancelWithoutTargetChange`。target は PRE と byte 一致であることを示して閉じる |
| Apply / Verify | `RecoverToPre`。Recovery へ進む。途中で止めて成功扱いにしない |
| Recovery / RecoveryRequired | `BlockRootUntilRecovered`。同じ root の mutation をすべて止める（`RecoveryPending`） |

app の再起動や中断のあとも未完了 journal が残っていれば、通常操作を止めて resume か restore を提示する（architecture §5.8）。journal の形式と再開手順は #185 の範囲である。

## 10. Verify（BMS-VERIFY）

Apply 後は 2 つの検査を両方通す。片方だけでは Committed にしない。

**byte-level**（`verify_expected_changes`）: 宣言した path だけが変わり、それぞれ `after` に一致し、project scope の他の entry はすべて不変であること。entry の whitelist に無い path は planned write になれない。project directory 内の sample ファイルや `markers.work`、`arrNN.work` など宣言外の変更は `UnexpectedChange` になる。project directory の外にあるファイルはこの検査の範囲外である（§13）。

**structure-level**（`verify_bank_structure`）: POST を read model で再読込し、PRE と比べる。

- 操作対象外の Bank は、全 role で PRE と完全一致
- 操作対象の Bank でも `affected_roles` に含まれない role は不変
- `project.work` の project state は不変（`[STATES] BANK` の扱いが決まるまで変えてはならない）
- Copy: 複製先の内容が複製元の PRE と一致し、複製元は不変
- Swap: 両方向で一致
- Move: 複製先が複製元の PRE と一致。**移動元に何を残すかは未決**なので、常に `MoveVacatedSourceUndefined` で失敗する
- 比較は Pattern、Part、Track、Sample Slot 参照、parse status、unmodeled 一覧で行う。ファイル名と Bank index は比較しない。比較する Bank は両側とも `Parsed` でなければならない

| ルール | テスト |
| --- | --- |
| BMS-VERIFY-BYTES | `expected_change_verification_rejects_unplanned_and_wrong_results`、`verifiers_check_a_simulated_post_state_and_rollback_on_a_copy` |
| BMS-VERIFY-STRUCTURE | `copy_structure_check_compares_content_not_file_names`、`swap_structure_check_requires_both_directions`、`move_structure_check_stays_closed_until_the_vacated_state_is_decided`、`structure_check_rejects_unparsed_banks_and_project_state_drift` |

`verifiers_check_a_simulated_post_state_and_rollback_on_a_copy` の POST はテスト自身が TempDir 内で作ったものである。検査器の動作を示すだけで、Bank Copy の正しい実装方法を示すものではない。

## 11. Recovery（BMS-RECOVER）

Recovery の成功条件は、project scope 全体の manifest が Plan 時点の `scope_manifest` と一致することである（`verify_recovered_to_pre`）。変更したファイルだけを戻しても、他の entry が変わっていれば失敗とする。成功で RolledBack、失敗で RecoveryRequired。

テスト: `recovery_must_restore_the_whole_scope_to_pre`、`verifiers_check_a_simulated_post_state_and_rollback_on_a_copy`。

## 12. UI と filesystem（BMS-UI）

- frontend は filesystem へ直接書かない。`fs` / `shell` plugin とその capability を持たない
- Bank 操作の v2 command は存在しない。Project Structure の command は `v2_project_structure_read` だけ
- legacy の Bank / Part / Pattern / Track / Slot 系 write command は DISABLED のまま
- 将来の Bank command も `RootId` と root 相対 path だけを受け、raw absolute path を返さない。command の追加は `scripts/check-architecture.mjs` の command 一覧の更新を伴う

テスト: `frontend_has_no_direct_filesystem_write_capability`、`no_bank_mutation_command_is_exposed_to_the_frontend`。既存の `check-architecture.mjs` も v2 command 一覧を固定している。

### 汎用 change / apply command（BMS-ROUTE）

static guard（CI foundation §12）は command 名に `bank` / `project_structure` を含むものだけを見る。`v2_change_plan` / `v2_change_apply` のような汎用 command に Bank の intent や role を流し込む経路は、名前では検出できない。そこで次を契約とする。

- Bank の Working / SavedCheckpoint 文書を書き換えうる command は、汎用 command であっても、Apply の前に必ず `evaluate_apply_entry` を通し、`ApplyEntryPermit` を受け取ってから executor を呼ぶ
- そうした command は、guard の allowlist（`ALLOWED_PSE_IPC_COMMANDS`）と `check-architecture.mjs` の command 一覧に**明示的に**追加する。名前が Bank 系でないことを理由に guard の対象外にしない
- 既存の汎用 command（`v2_change_*` の additive copy、`v2_rename_*`、`v2_slice_export_apply`）に Bank の role を受け付けさせない

テスト `generic_mutation_commands_are_pinned_and_carry_no_bank_mutation` は、媒体を変更しうる汎用 command（名前に `apply` / `continue` / `commit` / `recover` の語を持つもの）の一覧を固定する。また、`v2_api.rs` と write runtime、`mutation_gate.rs` が Bank mutation の型を参照する場合は `evaluate_apply_entry` も参照していることを確認する。新しい汎用 mutation command を足す PR は、このテストの一覧を変更するため、BMS-ROUTE の review を必ず通る。

## 13. Sample Slot 境界（BMS-SAMPLE）

Bank 側が持つのは Sample Slot 参照（`TrackSlotReference`）だけである。Bank mutation は AudioAsset、FileInstance、lineage、catalog、slice、`.ot` を変更しない。expected change set に sample ファイルを入れることは BMS-CHANGESET が禁止する。変更が必要になった場合は、Sample management 側との合意（#187、#208）と contract schema の更新を経る。

**`TreeManifest` の範囲は project directory だけである。** Octatrack の sample は多くの場合 project directory の外、Set の Audio Pool（tracked fixture でも多くの Slot の path は `../AUDIO` を指す）にある。したがって:

- project directory 内の sample ファイルは、byte-level verify と recovery の比較対象に入る
- project directory 外の sample ファイルは、この manifest の**範囲外**である。PRE/POST manifest の一致は、それらが変わっていないことの証明に**ならない**
- 外部 sample の不変性は、#184 / #185 が **Set root 単位の manifest**、または **Slot が参照するファイルを列挙した referenced-file check**（PRE で参照先を解決し、size + SHA-256 を記録し、POST / Recovery 後に比較）で検証しなければならない。どちらも root containment と symlink 非追従を守る
- この 2 つの検証が入るまで、「Bank 操作で sample が無傷である」ことは契約上**未証明**のまま扱う。CI 上も `mutation.unrelated-files-preserved` / `mutation.reference-integrity` は BLOCKED のまま

## 14. #191 への gate 提案（workflow は変更しない）

この PR は workflow ファイルを変更しない。既存の `Project Structure CI` が inventory runner 経由で次を required test として実行する。

| suite | package | 内容 |
| --- | --- | --- |
| `ot-plan-bank-mutation-contract` | `ot-plan` | 契約の純粋検査 31 件（このほか `ot-plan` の doctest 6 件を `CI / Rust Tests` が実行） |
| `masterocta-bank-mutation-contract` | `masterocta --features test-seams` | 実 reader + TempDir PRE/POST 5 件、UI / command 境界 3 件、envelope の sample 非依存 1 件、readiness / permit の production 境界 1 件 |

### Gate ledger との対応

`scripts/pse-bank-mutation-gates.json` の `contract.document` はこの文書を指す。各 gate には `contract_rules`（BMS ルール ID）と `contract_tests`（すでに inventory で動いている契約テスト）を記録した。これは gate の `required_tests` では**ない**。gate は全部 **BLOCKED** のままである。契約テストは検査器そのものの正しさを示すだけで、#183 の runner が fixture コピー上で実際の Apply を行うまで gate を満たしたことにはならない。guard は `contract_tests` が inventory に存在すること、`contract_rules` が `BMS-*` 形式であること、contract 文書が設定されていることを検査する。

| gate | `contract_rules` |
| --- | --- |
| `change-plan.stale-precondition-detection` | BMS-ENTRY、BMS-PLAN |
| `change-plan.plan-generation-no-write` | BMS-NOWRITE |
| `mutation.pre-manifest` / `mutation.post-manifest` | BMS-WRITE |
| `mutation.expected-changed-files-only` | BMS-CHANGESET、BMS-VERIFY-BYTES |
| `mutation.unrelated-files-preserved` | BMS-VERIFY-BYTES、BMS-SAMPLE（project 外の sample は §13 のとおり未証明） |
| `mutation.reference-integrity` | BMS-VERIFY-STRUCTURE、BMS-SAMPLE |
| `recovery.backup-creation` | BMS-BACKUP |
| `recovery.failure-injection` | BMS-FAIL |
| `recovery.partial-apply-failure` | BMS-FAIL、BMS-RECOVER |
| `recovery.verify-failure` | BMS-FAIL、BMS-VERIFY-BYTES、BMS-VERIFY-STRUCTURE |
| `recovery.rollback` | BMS-RECOVER |
| `recovery.restores-pre-state` | BMS-RECOVER、BMS-VERIFY-STRUCTURE |
| `recovery.retry-idempotency` | BMS-FLOW（`RecoveryRequired` ⇄ `Recovery`。idempotency 自体の契約テストは #185） |

ChangePlan の deterministic / reference enumeration の 4 gate は #181 の範囲なので、契約側の対応付けは置いていない。

#191 で配線してほしい gate（提案）:

1. `Bank Mutation Safety` は #183 の Apply 実装が入るまで **BLOCKED** のまま。空テストや `continue-on-error` で PASS にしない（CI foundation §4）
2. #183 では、Apply の各テストが `evaluate_apply_entry` の permit を経由していること、POST に `verify_expected_changes` と `verify_bank_structure` を適用していることを inventory の required test で固定する
3. failure injection（#185）では、各 phase での失敗後に `BankMutationPhase::on_failure` の義務どおりになったことを `prove_no_write` または `verify_recovered_to_pre` で示す
4. `current_main_readiness_keeps_remaining_changeplan_gaps_open` の変更を含む PR は、追跡先の証拠リンクがあるかを review gate で確認する
5. scope: `src-tauri/crates/ot-plan/src/bank_mutation.rs`、`src-tauri/crates/ot-plan/Cargo.toml`、`src-tauri/src/bank_mutation_contract.rs` は `pse-ci-scope.mjs` の in-scope に追加済み。`bank_mutation.rs` と `bank_mutation_contract.rs` は file 名に `bank` を含むので、static guard の `RUST_WRITE_API` 走査対象にもなっている
6. 将来、汎用 change / apply command が Bank role を扱う場合（§12 BMS-ROUTE）、その command を guard の allowlist に明示的に追加し、permit を経由しているかを guard 側でも検査する

## 15. 残作業

| Issue | この契約のあとに必要なこと |
| --- | --- |
| #181 | Copy / Move / Swap の ChangePlan が `BankMutationEnvelope` を出す。§1 の §7C 系 gap（#204 ほか）が先 |
| #183 | Prepare（staged bytes）、Apply、Verify を fixture / temporary copy 上で実装する。Apply 入口は `ApplyEntryPermit` を取り、writer lock 下で `reverify` してから書く。`LiveTargetObservation.project_structure` を lock 内の contained reader の再読込結果で埋める。production 用の contained manifest capture（symlink 非追従、root 内）を実装する。target class を backend 証拠から決める |
| #184 | 正常系・境界・失敗系の reference integrity。Arranger / arrangement 参照が読めるようになったら structure verify に加える。project 外 sample を含む Slot 参照先の referenced-file check（§13） |
| #185 | Bank 用 backup manifest、journal、resume / rollback、`mutation_gate` への Bank journal 追加、failure injection、retry / idempotency。Recovery 後に Set root 単位または referenced-file 単位で外部 sample の不変を確認（§13） |
| #186 | Native 受入。実機 CF 原本は別承認まで対象外 |
| #191 | §14 の gate 配線と required-check 候補の整理 |

## 16. Owner への未決事項

1. **Move の移動元**: Move 後の移動元 Bank は何になるべきか（空 Bank テンプレート、ファイル不在、別の初期状態）。決まるまで Move の structure verify は常に失敗する
2. **Working / SavedCheckpoint**: Bank 操作は `.work` と `.strd` を両方動かすのか、Working だけか。片方だけだと装置の SAVE / RELOAD と食い違う（control plane §12）。`MO-PSE-BANK-STATE-DOC-SEMANTICS-1`（[#217](https://github.com/kaz4g/masterocta/issues/217)）は存在分類と候補 path 列挙まで記録し、**本項は未受理**（`COPY/MOVE/SWAP_STATE_DOC_RULE = BLOCKED`、`ReadinessGap::WorkingSavedCheckpointRule` は open のまま）。詳細: [`PSE_BANK_STATE_DOC_SEMANTICS.md`](./PSE_BANK_STATE_DOC_SEMANTICS.md)。
3. **`[STATES] BANK`**: active Bank が操作対象のとき、`project.work` の選択を追従させるか。現契約では project state の変更を一切認めない。同上監査は `ACTIVE_BANK_RETARGET = UNKNOWN` とし、**本項は未受理**（whitelist に `project.work` を載せない）。
4. **Scene / Recorder**: Bank ファイルを丸ごと動かすなら Part 内の Scene も一緒に動く、という扱いで unmodeled gap を閉じてよいか。それとも Scene の read model を先に要求するか
5. **Backup の範囲**: 変更ファイルだけで足りるか、project directory 全体を snapshot するか
6. **readiness の粒度**: 監査 §11 のとおり 3 操作まとめての解禁を前提にしている。Copy だけ先に fixture Apply する選択肢を残すか
7. **Project Snapshot（control plane §7）**: 構造編集の Undo を、この契約の backup / recovery とどう関係づけるか

## 判定

```text
BANK_MUTATION_CONTRACT   = DEFINED (masterocta.bank-mutation-contract:v1)
CONTRACT_TESTS           = IN_INVENTORY (Project Structure CI)
BANK_CHANGEPLAN_READINESS = NOT_READY (#181, §7C except ArrangementFileSlot)
APPLY_READINESS          = NOT_READY
APPLY_AUTHORIZATION      = NOT_GRANTED (PSE-3)
```
