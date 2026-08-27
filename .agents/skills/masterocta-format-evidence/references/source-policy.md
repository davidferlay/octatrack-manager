# Octatrack format source policy

Use the following evidence hierarchy. Higher-priority sources carry more weight,
but scope and version still matter.

| Priority | Source | Treatment |
| --- | --- | --- |
| 1 | Elektron official manuals and official documentation | Primary evidence for publicly documented behavior. Record the document and applicable OS or product version. |
| 2 | Reproduced observations from a safe copied fixture | Empirical evidence limited to the recorded device/OS version and fixture coverage. Record provenance and reproduction steps. |
| 3 | Current MasterOCTa and legacy implementation | Evidence of existing behavior, not necessarily an official or universal specification. |
| 4 | `OCTATRACK_DIARY_R13_低解像度.pdf` | Secondary material for operating context, workflow, and terminology. |
| 5 | Inference or hypothesis | Keep isolated and explicitly unresolved; do not wire it directly into runtime semantics. |

## DIARY constraints

Do not commit `OCTATRACK_DIARY_R13_低解像度.pdf` to this repository. Do not
infer its license or redistribution rights.

The DIARY may inform:

- how users work with Sets, Projects, Banks, Parts, Patterns, and samples;
- user context needed by future UI and note features;
- practical relationships among Octatrack terms;
- hypotheses for future workflows.

Do not use the DIARY alone as evidence for:

- binary format or field offsets;
- filesystem write procedures;
- recovery guarantees;
- universal firmware behavior;
- the safety of destructive operations.

When sources disagree, preserve each claim with its provenance and stop before
turning the conflict into parser behavior, a schema constraint, or a write path.
