# Octatrack MkII OS 1.40 Project fixture

This directory contains one read-only Project file copied byte-for-byte from a
human-reviewed, disposable disk-image copy. The reviewed BaseProject contains
no personal information, absolute paths, user-specific audio names, or
non-public information. Every `PATH` field is empty.

- device family: Octatrack MkII
- project version: 19
- OS_VERSION: R0173 / 1.40
- byte size: 2898
- SHA256: `742b8228026b0d25b6de72e915adcec428b954f3be769e4f4e177cdfab7c7ae6`
- role coverage: working and saved checkpoint

Only `project.work` is tracked because the reviewed `project.work` and
`project.strd` were byte-for-byte identical. Tests copy this one fixture into a
temporary directory under both names. Tests must not serialize over or
otherwise modify the tracked fixture.
