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

Local hash re-verification proves only that the existing artifact bytes match
the historical SHA256. It is not a reproduction of source-to-artifact binding
and is not a cryptographic proof of that binding.

RC1 source-to-artifact binding is **not proven**. Do not infer, reconstruct, or
backfill workflow provenance for RC1. Do not reopen RC1 under later identity
rules.

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

Do not infer these values from the current `main` tip. They stay `UNSET` until
an explicit RC2 freeze records them together.

### RC2 provenance freeze rules

An RC2 artifact may be frozen only when this chain is recorded and mutually
consistent:

```text
frozen source commit/tree
→ workflow checkout
→ same workflow runでbuild
→ artifact hash取得
→ frozen RC artifactとして保存
```

Required evidence for that chain:

- frozen `source commit` SHA
- frozen `source tree` SHA belonging to that commit
- `workflow name`
- `workflow run ID`, `workflow run attempt`, and canonical `workflow run URL`
- `workflow checkout SHA` actually checked out by that run
- `artifact` filename
- DMG SHA256
- app binary SHA256
- `build environment`
- `codesign verification` result
- `DMG verification` result

Consistency required before freeze:

- `workflow checkout SHA` equals frozen `source commit`
- `source tree` is the tree of that frozen commit
- the named workflow run produced the recorded DMG in the same run
- DMG SHA256 and app binary SHA256 were taken from that run's outputs
- `workflow name` is `RC Release Build`, or a successor that does not overwrite
  prior RC provenance

STOP. Do not freeze RC2 when any of the following is true:

- workflow checkout SHA and frozen source SHA disagree
- workflow run provenance is missing
- the artifact was rebuilt or replaced outside that workflow run
- the origin of the artifact hash is unknown
- the same RC number or tag was overwritten
- a unique source-to-artifact correspondence cannot be proven

Missing, ambiguous, or mismatched provenance is **STOP**, not
`PASS_WITH_NOTES`. Keep RC2 `NOT_CREATED`.

Parallel SHA256 and source commit values in this table are insufficient without
the chain above.

## RC2 start conditions

All of the following must be true before RC2 may be created:

- The RC workflow overwrite behavior is resolved.
- The Gate C impact of FAT-HASH-1 is assessed, and any blocking finding is
  resolved before the RC2 source is frozen. See
  [FAT_HASH_1_ASSESSMENT.md](FAT_HASH_1_ASSESSMENT.md).
- If FAT-HASH-1 remains `ASSESSMENT_REQUIRED` or `BLOCKED`, keep RC2
  `NOT_CREATED`.
- All CI checks for the intended `main` source commit are green.
- No open Pull Request or required fix remains that belongs in the RC2 source.
- The RC number, source commit SHA, tree SHA, artifact SHA256, app binary
  SHA256, workflow name, run ID, run attempt, canonical run URL, and workflow
  checkout SHA can be recorded as a unique, immutable tuple with provenance
  consistency.

If any condition is unmet, keep RC2 `NOT_CREATED`.

## Gate C safety boundary

- Original CF/SD media stay disconnected for the entire Gate C run.
- Sole-copy media are forbidden.
- Only a verified disposable clone may receive writes.
- A pre-run manifest of the clone is required.
- Updater, cloud sync, and remote filesystems are out of scope.
- After a code change, do not reuse the same RC. Advance to the next RC
  number with a new frozen identity.

If any safety boundary cannot be demonstrated, STOP without registering a
root and without applying a rename.

## Gate C PASS conditions

Gate C is PASS only when every item below is demonstrated:

- Artifact identity is verified against the frozen RC filename, DMG SHA256, and
  app binary SHA256.
- Source-to-artifact provenance is verified: workflow name, run ID, run
  attempt, canonical URL, and workflow checkout SHA bind the frozen source
  commit/tree to that artifact through the freeze chain above.
- Automated Gate C is PASS.
- External clone verification is PASS.
- Rename Plan → Prepare → restart → Continue → Apply completes on the
  verified disposable clone.
- The operation ends `COMMITTED` / `VERIFIED`.
- Missing / Invalid / Unresolved reference counts are 0.
- Unrelated bytes are unchanged versus the pre-run manifest.
- Octatrack MkII can load the Set and Project from the clone.
- The renamed sample can be played on that hardware.
- Original media remained disconnected for the entire run.

Any gap in this evidence is STOP, not PASS.
