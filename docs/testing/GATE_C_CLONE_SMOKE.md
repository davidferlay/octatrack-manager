# Gate C cloned-media rename smoke

## Purpose

This checklist is the human-reviewed evidence for the final Gate C sign-off
items that automated tests cannot cover: loading a renamed clone on real
Octatrack hardware and exercising rename Apply through a controlled operator
harness with explicit approval UI.

Automated proof for catalog rescan, missing-reference counts, sentinel hash
invariance, rollback byte restoration, fail-closed unknown-byte handling, and
production-route rename recovery (`v2_rename_recover` + restart discovery) lives
in `src-tauri/src/gate_c_clone_rescan.rs`, `src-tauri/src/v2_api.rs` recovery
tests, and `scripts/gate-c-synthetic-smoke.sh`. Those artifacts do not replace
this checklist.

Clone integrity excludes explicitly-known host OS metadata (for example
`.Spotlight-V100`, `.Trashes`, `.fseventsd`, `.DS_Store`, and AppleDouble
`._*` sidecars). Unknown files and unreadable unknown paths remain fail-closed.
This policy applies to source evidence, managed clone creation, external clone
verification, and re-verification semantics; it does not mean all macOS dotfiles
are ignored.

## Preconditions

- A human prepares a disposable clone from non-original media. Record provenance
  outside the repository.
- The original SD/CF card stays disconnected for the entire smoke.
- The clone is not the sole copy of personal audio or project data.
- A restorable image/checksum manifest of the clone exists before rename.
- Human Gate C uses the frozen RC candidate recorded in
  `GATE_C_RC_LEDGER.md`. Install or launch from that verified DMG only.
- Do not rebuild the application from source for this smoke, even from the
  frozen commit.
- Confirm the launched executable SHA256 matches the recorded inner app binary
  SHA256.
- No updater, release, deploy, cloud sync, or remote filesystem is involved.

If any precondition cannot be demonstrated, stop without registering the root.

## Controlled operator harness

Production now exposes rename Apply through:

- an approved Octatrack root registered in `RootRegistry`
- clone-first setup (`Clone operator`) with verified disposable clone attestation
- explicit two-stage Continue / Apply approvals in `Rename operator`
- durable prepared plan review after restart (`v2_rename_get_prepared_plan`)

M5-C5 Phase 4D automated UI/harness coverage is complete on branch
`m5c5-phase4d-operator-ux`. **Human Gate C clone-load smoke on real Octatrack MkII
hardware remains outstanding** before this checklist can be signed off end-to-end.

## Real-hardware clone-load smoke

1. Verify the frozen RC DMG (`hdiutil verify` must succeed), record the
   codesign/`spctl` outcome, install or launch from that DMG, and confirm the
   launched executable SHA256 matches the recorded inner app binary SHA256.
   Rebuilding from the recorded commit is STOP.
2. Register the disposable clone read-only and confirm baseline catalog scan
   shows the intended source sample as `Resolved` with zero blocking
   references.
3. Plan a sample rename to an unused destination stem in the same Set Audio Pool.
4. Review backup count, impacted Project documents, sidecars, and destination
   collision state before approval.
5. Approve and apply the exact displayed plan once on the **clone** only.
6. Confirm unrelated files match the pre-smoke manifest (byte-for-byte).
7. Rescan the clone in MasterOCTa and confirm missing/invalid/unresolved
   reference counts are zero and affected slots resolve to the destination.
8. Safely eject the clone, load it on Octatrack MkII hardware, and confirm the
   renamed sample and Project references behave as expected in a minimal
   playback/smoke pattern chosen by the operator.
9. Retain the disposable clone or discard it according to the external test
   plan; do not use MasterOCTa to mutate the original removable media.

## Evidence record

Record the following in the Pull Request or a follow-up issue without absolute
paths, volume identifiers, personal filenames, or media fingerprints:

- frozen RC identity, DMG SHA256, launched executable SHA256 match, and host OS
- clone provenance reviewed: yes/no
- original media disconnected: yes/no
- baseline manifest verified: yes/no
- rename apply + rescan result on clone
- hardware load result
- deviations, failures, and whether the disposable clone was retained

Gate C remains incomplete until both the controlled operator harness and this
human clone-load checklist are executed and signed off.

Automated synthetic-clone smoke (no original media) is available via
`scripts/gate-c-synthetic-smoke.sh`. Generated reports under `/tmp` are not
committed to the repository.
