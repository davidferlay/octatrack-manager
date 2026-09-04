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

This checklist runs after the frozen RC candidate is recorded in
`GATE_C_RC_LEDGER.md`. Executing it is not required to complete FAT-HASH
assessment or to freeze RC2. Missing evidence here is STOP for Human Gate C.

Human Gate C unrelated-byte proof uses the deterministic per-file tool
`scripts/gate-c-byte-manifest.mjs`. It hashes file bytes directly and does not
use catalog hash reuse. Keep generated manifests outside the repository; they
may contain personal sample names. Record only the manifest digest, entry
counts, and verdict in repository evidence.

Clone integrity excludes explicitly-known host OS metadata (for example
`.Spotlight-V100`, `.Trashes`, `.fseventsd`, `.DS_Store`, and AppleDouble
`._*` sidecars). Unknown files and unreadable unknown paths remain fail-closed.
This policy applies to source evidence, managed clone creation, external clone
verification, re-verification semantics, and byte-manifest capture; it does not
mean all macOS dotfiles are ignored.

## Preconditions

- A human prepares a disposable clone from non-original media. Record provenance
  outside the repository.
- The original SD/CF card stays disconnected for the entire smoke.
- The clone is not the sole copy of personal audio or project data.
- Capture a complete pre-run per-file byte manifest with
  `scripts/gate-c-byte-manifest.mjs` **before** root registration and **before**
  rename. Whole-image checksums are not a substitute.
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

## Byte-manifest commands

Store `PRE`, `POST`, `EXPECTED`, and `REPORT` outside the repository. Do not
commit those files. Replace the path arguments with local operator paths; do
not record those paths in repository evidence.

Capture:

```bash
node scripts/gate-c-byte-manifest.mjs capture \
  --root CLONE_ROOT \
  --output PRE.json
```

Capture must print a non-zero `entries` count and exit 0. Any `STOP` code,
partial file, or output written inside the clone root is Gate C STOP.

After Prepare, export the durable prepared plan JSON that the operator already
has locally. Audio and sidecar expected changes can be derived without guessing
hashes:

```bash
node scripts/gate-c-byte-manifest.mjs expected-from-prepared \
  --plan PREPARED_PLAN.json \
  --output EXPECTED.json
```

That command does **not** invent rewritten Project post-write SHA256 values.
The public `rename-plan:v1` DTO and prepared-plan snapshot keep pre-write
project hashes only; apply-time `staged_content_hash` is not exported as a
Human Gate file. If rewritten projects exist, the command exits 1 after writing
audio/sidecar expected changes and names the project paths that still need
post-write SHA256.

Fill each rewritten project as `content_changed` with the post-write SHA256
from apply-time rewrite evidence. If that evidence is unavailable, do not
guess. Run compare anyway so every diff is listed, then match each diff to the
displayed plan by path. Dest audio and dest sidecar SHA256 must equal the
source hashes already in the prepared plan. Project byte identity is also
checked in-app by committed verification; unexplained extra diffs remain STOP.

Post-run capture and compare:

```bash
node scripts/gate-c-byte-manifest.mjs capture \
  --root CLONE_ROOT \
  --output POST.json

node scripts/gate-c-byte-manifest.mjs compare \
  --pre PRE.json \
  --post POST.json \
  --expected EXPECTED.json \
  --report REPORT.json
```

Compare must report `verdict: PASS` and `unrelated_entries_unchanged: true`.
Any unexplained add, remove, content change, type change, schema mismatch,
exclusion-policy mismatch, missing expected change, or hash mismatch is STOP.

Record evidence with file digests only:

```bash
shasum -a 256 PRE.json POST.json EXPECTED.json REPORT.json
```

## Real-hardware clone-load smoke

1. Disconnect original media. Keep it disconnected for the entire run.
2. Prepare the disposable clone from non-original media.
3. Before root registration and before rename, capture the pre-run per-file
   manifest with the `capture` command above. Write the output outside the
   clone root and outside the repository.
4. Confirm capture succeeded: exit 0, complete JSON, `schema` is
   `masterocta-gate-c-byte-manifest:v1`, and no `.partial` file remains.
5. Verify the frozen RC DMG (`hdiutil verify` must succeed), record the
   codesign/`spctl` outcome, install or launch from that DMG, and confirm the
   launched executable SHA256 matches the recorded inner app binary SHA256.
   Rebuilding from the recorded commit is STOP.
6. Register the disposable clone read-only and confirm baseline catalog scan
   shows the intended source sample as `Resolved` with zero blocking
   references.
7. Plan a sample rename to an unused destination stem in the same Set Audio Pool.
8. Review backup count, impacted Project documents, sidecars, and destination
   collision state before approval.
9. Approve and apply the exact displayed plan once on the **clone** only, using
   the launched frozen candidate.
10. Capture the post-run per-file manifest with the same `capture` command.
11. Build or complete `EXPECTED.json` as described above, then run `compare`.
    Expected rename changes must occur with the expected post hashes. Every
    other entry must match on path, type, size, and SHA256.
12. If compare is not `PASS`, Gate C is STOP. Do not continue to hardware load.
13. Rescan the clone in MasterOCTa and confirm missing/invalid/unresolved
    reference counts are zero and affected slots resolve to the destination.
14. Safely eject the clone, load it on Octatrack MkII hardware, and confirm the
    renamed sample and Project references behave as expected in a minimal
    playback/smoke pattern chosen by the operator.
15. Retain the disposable clone or discard it according to the external test
    plan; do not use MasterOCTa to mutate the original removable media.

## Evidence record

Record the following in the Pull Request or a follow-up issue without absolute
paths, volume identifiers, personal filenames, or media fingerprints:

- frozen RC identity, DMG SHA256, launched executable SHA256 match, and host OS
- clone provenance reviewed: yes/no
- original media disconnected: yes/no
- pre/post byte-manifest SHA256, entry counts, compare verdict, and
  `unrelated_entries_unchanged`
- rename apply + rescan result on clone
- hardware load result
- deviations, failures, and whether the disposable clone was retained

Gate C remains incomplete until both the controlled operator harness and this
human clone-load checklist are executed and signed off.

Automated synthetic-clone smoke (no original media) is available via
`scripts/gate-c-synthetic-smoke.sh`. Generated reports under `/tmp` are not
committed to the repository. Byte-manifest unit tests are
`pnpm run test:gate-c-manifest` and also do not access removable media.
