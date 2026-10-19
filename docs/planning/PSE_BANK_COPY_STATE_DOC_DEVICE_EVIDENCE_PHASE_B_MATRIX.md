# P_BANK_COPY_STATE — Phase B transition matrix

Operator capture root (local, not in git): `~/octa-captures/P_BANK_COPY_STATE`
Generated: 2026-10-19 (harness `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1`)
S3/S4/S5 redone after control-bank correction.

## Analyze summary

```json
{
  "device_capture": "PASS",
  "device_evidence_promotion": "ALLOWED",
  "result": "READY_FOR_REVIEW",
  "capture_transport_confidence": "PROVEN_NON_MUTATING",
  "pre_source_work_strd_divergence": "PASS",
  "immediate_copy_timing_attribution": "PASS",
  "dest_work_first_changed_at": "NATIVE_BANK_COPY",
  "dest_strd_first_changed_at": "NATIVE_BANK_COPY",
  "dest_work_provenance": "DERIVED_OTHER",
  "dest_strd_provenance": "DERIVED_OTHER",
  "copy_project_bank_effect": "CHANGED_TO_DESTINATION",
  "copy_project_pattern_effect": "CHANGED",
  "control_bank_immediate_change": "NO",
  "copy_state_doc_rule": "BLOCKED"
}
```

## project.work [STATES] by stage

| Stage | Directory | BANK raw | PATTERN raw | Bank UI | Pattern UI |
| --- | --- | --- | --- | --- | --- |
| S0 | s0_baseline_saved | 0 | 3 | A | A04 |
| S1 | s1_source_working_diverged_pre_copy | 0 | 3 | A | A04 |
| S2 | s2_immediately_after_bank_copy | 3 | 0 | D | A01 |
| S3 | s3_after_control_switch | 1 | 0 | B | A01 |
| S4 | s4_after_project_save | 1 | 0 | B | A01 |
| S5 | s5_after_project_reload | 1 | 0 | B | A01 |

## Transition: SOURCE_WORKING_ONLY_EDIT

`s0_baseline_saved` → `s1_source_working_diverged_pre_copy`

Changed files: **2** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | no | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e |
| project.strd | no | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e |
| bank01.work | YES | 636113 | 636113 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 | e3a4fe1f3bf5b3c02e8cbdfca4d343c7986ac2a87eb4b3c117302b4b1e21e22a |
| bank01.strd | no | 636113 | 636113 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | YES | 636113 | 636113 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 | cba6f40e5922f3b35478db438ac2c570f37b45f68ea89c6c5e58b05dac01d4b8 |
| bank04.strd | no | 636113 | 636113 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 |

## Transition: NATIVE_BANK_COPY

`s1_source_working_diverged_pre_copy` → `s2_immediately_after_bank_copy`

Changed files: **6** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | YES | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 |
| project.strd | YES | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 |
| bank01.work | YES | 636113 | 636113 | e3a4fe1f3bf5b3c02e8cbdfca4d343c7986ac2a87eb4b3c117302b4b1e21e22a | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | YES | 636113 | 636113 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | YES | 636113 | 636113 | cba6f40e5922f3b35478db438ac2c570f37b45f68ea89c6c5e58b05dac01d4b8 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b |
| bank04.strd | YES | 636113 | 636113 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b |

## Transition: CONTROL_SWITCH

`s2_immediately_after_bank_copy` → `s3_after_control_switch`

Changed files: **3** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | YES | 3327 | 3327 | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| project.strd | YES | 3327 | 3327 | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| bank01.work | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | YES | 636113 | 636113 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |
| bank04.strd | no | 636113 | 636113 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b |

## Transition: PROJECT_SAVE

`s3_after_control_switch` → `s4_after_project_save`

Changed files: **1** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| project.strd | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| bank01.work | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | no | 636113 | 636113 | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |
| bank04.strd | YES | 636113 | 636113 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |

## Transition: PROJECT_RELOAD

`s4_after_project_save` → `s5_after_project_reload`

Changed files: **0** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| project.strd | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| bank01.work | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | no | 636113 | 636113 | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |
| bank04.strd | no | 636113 | 636113 | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |

## First change attribution (destination bank04 vs S1 baseline)

- bank04.work: **NATIVE_BANK_COPY**
- bank04.strd: **NATIVE_BANK_COPY**

Machine-readable: `evidence-transition-matrix.json`
