# Gate C release-candidate ledger

This ledger freezes Human Gate C artifact identity and STOP boundaries.
It is not a substitute for `GATE_C_CLONE_SMOKE.md` and does not authorize
writes to original Octatrack media.

Do not record local absolute paths, volume UUIDs, media fingerprints, or
personal sample names here.

Ambiguous results, missing evidence, or a failed precondition are **STOP**.
Do not classify those outcomes as `PASS_WITH_NOTES`.

Recording a source SHA next to an artifact SHA256 in this table is not, by
itself, source-to-artifact binding. Binding requires the provenance chain in
the RC2 freeze rules below.

A Gate C candidate is not a public release. Candidate creation, Human Gate C,
and public distribution are separate operations and separate gates.

## FAT-HASH-1 status and verdict contract

FAT-HASH-1 uses the same vocabulary in this ledger and in
[FAT_HASH_1_ASSESSMENT.md](FAT_HASH_1_ASSESSMENT.md).

status:

- `ASSESSMENT_REQUIRED`: assessment is incomplete
- `ASSESSED`: assessment and verdict recording are complete

verdict:

- `UNSET`: not judged
- `BLOCKED`: a Gate C blocking finding exists
- `ACCEPTED_WITH_EVIDENCE`: required evidence shows no Gate C blocking finding
  in the assessed scope

Allowed combinations:

| status | verdict | Meaning |
|---|---|---|
| `ASSESSMENT_REQUIRED` | `UNSET` | Waiting for assessment. RC2 freeze is forbidden. |
| `ASSESSED` | `BLOCKED` | Assessed. RC2 freeze is forbidden. |
| `ASSESSED` | `ACCEPTED_WITH_EVIDENCE` | FAT-HASH condition only. Other RC2 conditions remain. |

Any other combination, missing evidence, or inconsistency is **STOP**.

Transition:

- Move from `ASSESSMENT_REQUIRED` to `ASSESSED` only when required evidence and
  a verdict are recorded together, including assessed SHA, scope, and evidence
  references.
- If related implementation or assumptions change so that recorded evidence no
  longer applies, keep the past record and reassess.
- FAT-HASH condition satisfaction is not Gate C PASS and is not M5 COMPLETE.

Current FAT-HASH-1 state: `ASSESSMENT_REQUIRED` / `UNSET`. This ledger update
does not complete that assessment.

## RC1

| Field | Value |
|---|---|
| status | `FROZEN_FAILED` |
| source commit | `466fe6e72a639e6501eb5929b0de7d66247f263b` |
| source tree | `bd1810cd7facb6eb5b46c1b3b08d2c1c23258a98` |
| artifact filename | `Masta-Octa_0.1.0_aarch64.dmg` |
| artifact SHA256 | `29213b04f58a774054dfd7fd0638c5990a7160168e2d28b22ee5212bc665a477` |
| local artifact availability | `CONFIRMED` |
| local hash re-verification | `PASS` |
| Human Gate C | `FAIL` |
| build environment | `NOT RECORDED IN THIS LEDGER` |
| codesign verification | `NOT RECORDED IN THIS LEDGER` |
| DMG verification | `NOT RECORDED IN THIS LEDGER` |
| workflow name | `NOT RECORDED IN THIS LEDGER` |
| workflow run ID | `NOT RECORDED IN THIS LEDGER` |
| workflow run attempt | `NOT RECORDED IN THIS LEDGER` |
| workflow run URL | `NOT RECORDED IN THIS LEDGER` |
| workflow checkout SHA | `NOT RECORDED IN THIS LEDGER` |
| app binary SHA256 | `NOT RECORDED IN THIS LEDGER` |
| in-run checksum manifest | `NOT RECORDED IN THIS LEDGER` |
| candidate storage | `NOT RECORDED IN THIS LEDGER` |
| public distribution | `NOT AUTHORIZED` |

Local hash re-verification proves only that the existing artifact bytes match
the historical SHA256. It is not a reproduction of source-to-artifact binding
and is not a cryptographic proof of that binding.

RC1 source-to-artifact binding is **not proven**. Do not infer, reconstruct, or
backfill workflow provenance, in-run digests, or candidate-storage evidence for
RC1. Do not reopen RC1 under later identity rules.

Failure boundary:

Record Source Evidence returned `clone runtime storage failed`.

Root cause:

Known macOS-managed metadata directories were incorrectly included in physical
filesystem traversal.

Remediation landed after this freeze and does not reopen RC1:

- PR #86
- PR #87
- PR #88

RC1 freeze rules:

- Do not rebuild the RC1 artifact.
- Do not replace the RC1 artifact.
- Do not retest under the RC1 name.
- Do not reclassify RC1 as PASS.

## RC2

| Field | Value |
|---|---|
| status | `NOT_CREATED` |
| source commit | `UNSET` |
| source tree | `UNSET` |
| artifact | `UNSET` |
| artifact SHA256 | `UNSET` |
| app binary SHA256 | `UNSET` |
| workflow name | `UNSET` |
| workflow run ID | `UNSET` |
| workflow run attempt | `UNSET` |
| workflow run URL | `UNSET` |
| workflow checkout SHA | `UNSET` |
| build environment | `UNSET` |
| codesign verification | `UNSET` |
| DMG verification | `UNSET` |
| in-run checksum manifest identity | `UNSET` |
| in-run checksum manifest storage | `UNSET` |
| in-run checksum manifest retrieval | `UNSET` |
| candidate storage | `UNSET` |
| candidate access boundary | `UNSET` |
| public distribution | `NOT AUTHORIZED` |

Do not infer these values from the current `main` tip. They stay `UNSET` until
an explicit RC2 freeze records them together.

This document does not record that provenance has been obtained. The current
`.github/workflows/rc-release.yml` does not satisfy the freeze rules below.

### Gate C candidate versus public distribution

Gate C candidate creation and public distribution are separate operations.

- A Gate C candidate build stores a personal/local evaluation artifact.
- Candidate creation must not start a public release, public distribution, or
  updater delivery.
- Human Gate C PASS does not authorize public distribution.
- Public distribution additionally requires signing, notarization or equivalent
  public-distribution conditions, and an explicit public-release decision.
- That public-distribution gate is separate from this ledger freeze and from
  `GATE_C_CLONE_SMOKE.md`, which excludes updater, release, and deploy from the
  smoke.

Do not treat the current `RC Release Build` workflow as the required Gate C
candidate builder. That workflow creates a GitHub Release with `draft: false`,
overwrites tag `v0.0.1-rc`, retries uploads with `--clobber`, and has a
`publish-release` job that publishes the release. Using it as written would
expose a candidate before Human Gate C and before the public-distribution gate
in `docs/security/SECURITY_STATUS.md`.

Do not conclude non-public status from the names “Actions artifact” or “draft
release” alone. Before freeze, confirm all of the following for the chosen
candidate store:

- repository visibility
- who can view and download the candidate
- whether any publish, undraft, or make-latest step runs
- whether an updater or release endpoint can consume the candidate
- whether an unapproved party can replace the stored bytes

If candidate storage or its access boundary is undetermined, **STOP** and keep
RC2 `NOT_CREATED`. This docs change does not select a storage method and does
not change workflow or repository settings.

### RC2 provenance freeze rules

An RC2 artifact may be frozen only when this chain is recorded and mutually
consistent:

```text
frozen source commit/tree
→ workflow checkout of that SHA in a recorded run/attempt
→ same run/attempt builds the candidate
→ same run/attempt generates a checksum manifest or equivalent attestation
  of the final packaged bytes
→ candidate stored under a recorded non-public-distribution store
→ freeze RC identity from that run-scoped digest
```

Required evidence for that chain:

- frozen `source commit` SHA
- frozen `source tree` SHA belonging to that commit
- `workflow name` of the Gate C candidate workflow, not a public-release
  workflow
- `workflow run ID`, `workflow run attempt`, and canonical `workflow run URL`
- `workflow checkout SHA` actually checked out by that run
- `artifact` filename
- DMG SHA256 of the final packaged DMG
- app binary SHA256 of the binary enclosed in that DMG, after signing,
  packaging, or any other byte-changing step has finished
- proof that the hashed binary is the binary enclosed in that DMG
- `build environment`
- `codesign verification` result that matches an acceptable outcome below
- `DMG verification` result that matches an acceptable outcome below
- in-run checksum manifest or equivalent attestation identity, storage
  location, and retrieval path
- candidate storage location and confirmed access boundary

Acceptable artifact-verification outcomes for RC2 freeze and Gate C PASS
follow the Gate B personal/local procedure in `GATE_B_CLONE_SMOKE.md`:

- `DMG verification` must be `PASS`: `hdiutil verify` against the frozen DMG
  succeeds.
- `codesign verification` must record `codesign --verify --deep --strict
  --verbose=2` and `spctl --assess --type execute --verbose=4`.
- Expected unsigned or ad-hoc state for a personal/local candidate is
  acceptable. Record it explicitly. Do not treat it as signed, and do not
  treat it as public-distribution approval.
- A valid Developer ID signature may be recorded, but still does not
  authorize public distribution without the separate public-distribution gate.

All other codesign or DMG outcomes are **STOP**, including:

- `hdiutil verify` failure, skip, or ambiguous output
- codesign or `spctl` not run
- signature integrity failure, including a claimed signature that does not
  verify
- recording unsigned or ad-hoc as `signed` or as public-distribution approval
- `FAIL` recorded as freeze evidence without treating it as STOP

In-run digest rules:

- The checksum manifest or equivalent attestation must be generated inside the
  same workflow run and attempt that built the candidate.
- Hash the final bytes after signing, packaging, or other mutations.
- After digest generation, do not modify or replace the hashed artifacts.
- Local re-hash after retrieval is only a check against the run-generated
  digest. It is not an independent source of identity.

A checksum manifest by itself is not cryptographic provenance. Binding also
requires the recorded run identity, a change-controlled store, and an explicit
trust premise for who can write that store.

The following are insufficient:

- a run URL placed next to a hash computed later
- hashing a mutable Release asset after later download
- a checksum file whose origin cannot be shown
- a store where the artifact and its manifest can be replaced together
- source SHA and artifact SHA256 recorded in the same table without the chain
  above

STOP. Do not freeze RC2 when any of the following is true:

- workflow checkout SHA and frozen source SHA disagree
- workflow run provenance is missing
- the in-run checksum manifest is missing
- the artifact was rebuilt or replaced after digest generation or outside that
  workflow run
- the origin of the artifact hash is unknown
- the same RC number or tag was overwritten
- candidate storage would publish, distribute, or feed an updater
- candidate storage or access boundary is undetermined
- `DMG verification` is not `PASS`
- `codesign verification` is missing, integrity-failed, or recorded as signed
  when the candidate is unsigned or ad-hoc
- a unique source-to-artifact correspondence cannot be proven

Missing, ambiguous, or mismatched provenance is **STOP**, not
`PASS_WITH_NOTES`. Keep RC2 `NOT_CREATED`.

### Current workflow gap

`.github/workflows/rc-release.yml` currently:

- does not generate a DMG or app-binary digest in the build run
- uploads to a GitHub Release that is created non-draft and later force-published
- deletes and recreates the same RC tag
- retries failed uploads with `--clobber`

Those behaviors do not satisfy the provenance or candidate-isolation rules.
They are requirements for a future workflow change. This document update does
not implement that change and does not claim that provenance has been obtained.

## RC2 start conditions

All of the following must be true before RC2 may be created:

- A Gate C candidate workflow exists that does not publish, overwrite a public
  RC identity, or start updater delivery.
- Candidate storage and its access boundary are recorded and confirmed.
- The Gate C candidate workflow generates an in-run checksum manifest or
  equivalent attestation of the final packaged bytes.
- `DMG verification` of that candidate is `PASS`, and `codesign verification`
  is an acceptable recorded outcome as defined in the freeze rules.
- The Gate C impact of FAT-HASH-1 is recorded as `ASSESSED` /
  `ACCEPTED_WITH_EVIDENCE`. See
  [FAT_HASH_1_ASSESSMENT.md](FAT_HASH_1_ASSESSMENT.md).
- If FAT-HASH-1 is `ASSESSMENT_REQUIRED` / `UNSET`, or `ASSESSED` / `BLOCKED`,
  keep RC2 `NOT_CREATED`.
- All CI checks for the intended `main` source commit are green.
- No open Pull Request or required fix remains that belongs in the RC2 source.
- The RC number, source commit SHA, tree SHA, artifact SHA256, app binary
  SHA256, workflow name, run ID, run attempt, canonical run URL, workflow
  checkout SHA, in-run manifest identity, and candidate storage can be recorded
  as a unique, immutable tuple with provenance consistency.

If any condition is unmet, keep RC2 `NOT_CREATED`.

## Gate C safety boundary

- Original CF/SD media stay disconnected for the entire Gate C run.
- Sole-copy media are forbidden.
- Only a verified disposable clone may receive writes.
- A pre-run manifest of the clone is required.
- Updater, cloud sync, remote filesystems, public release, and public
  distribution are out of scope.
- After a code change, do not reuse the same RC. Advance to the next RC
  number with a new frozen identity.

If any safety boundary cannot be demonstrated, STOP without registering a
root and without applying a rename.

## Gate C PASS conditions

Gate C is PASS only when every item below is demonstrated:

- Artifact identity is verified against the frozen RC filename, DMG SHA256, and
  app binary SHA256.
- Human Gate C installs or launches only from that verified frozen DMG. A
  rebuild from the frozen source commit is **STOP**.
- The launched executable SHA256 matches the recorded inner app binary SHA256
  of that DMG.
- `DMG verification` is `PASS` and `codesign verification` is an acceptable
  recorded outcome as defined in the freeze rules.
- Source-to-artifact provenance is verified against the in-run checksum
  manifest or equivalent attestation from the recorded workflow run/attempt,
  including workflow name, run ID, run attempt, canonical URL, workflow
  checkout SHA, and candidate storage.
- Local re-hash matches that run-generated digest.
- Automated Gate C is PASS.
- External clone verification is PASS.
- Rename Plan → Prepare → restart → Continue → Apply completes on the
  verified disposable clone, using the launched frozen candidate.
- The operation ends `COMMITTED` / `VERIFIED`.
- Missing / Invalid / Unresolved reference counts are 0.
- Unrelated bytes are unchanged versus the pre-run manifest.
- Octatrack MkII can load the Set and Project from the clone.
- The renamed sample can be played on that hardware.
- Original media remained disconnected for the entire run.
- No public release, public distribution, or updater delivery was started by
  the candidate build or by this Gate C run.

Any gap in this evidence is STOP, not PASS.

Human Gate C PASS does not authorize public distribution.
