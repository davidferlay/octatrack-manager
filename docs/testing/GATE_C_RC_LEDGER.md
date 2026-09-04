# Gate C release-candidate ledger

This ledger freezes Human Gate C artifact identity and STOP boundaries.
It is not a substitute for `GATE_C_CLONE_SMOKE.md` and does not authorize
writes to original Octatrack media.

Do not record local absolute paths, volume UUIDs, media fingerprints, or
personal sample names here.

Ambiguous results, missing evidence, or a failed precondition are **STOP**.
Do not classify those outcomes as `PASS_WITH_NOTES`.

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

Local hash re-verification proves only that the existing artifact bytes match
the historical SHA256. It is not a reproduction of source-to-artifact binding
and is not a cryptographic proof of that binding.

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

Do not infer these values from the current `main` tip. They stay `UNSET` until
an explicit RC2 freeze records them together.

## RC2 start conditions

All of the following must be true before RC2 may be created:

- The RC workflow overwrite behavior is resolved.
- The Gate C impact of FAT-HASH-1 is assessed, and any blocking finding is
  resolved before the RC2 source is frozen.
- All CI checks for the intended `main` source commit are green.
- No open Pull Request or required fix remains that belongs in the RC2 source.
- The RC number, source commit SHA, tree SHA, and artifact SHA256 can be
  recorded as a unique, immutable tuple.

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

- Artifact identity is verified against the frozen RC filename and SHA256.
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
