---
name: masterocta-fixture-safety
description: Apply when scanning filesystems, hashing or parsing test data, testing RootRegistry, building sample inventories, using temporary directories or fixtures, or simulating Octatrack media. Do not use for work that never touches test files or filesystem-like data.
---

# MasterOCTa Fixture Safety

Treat test data as potentially irreplaceable until its origin and target path are
verified. A test label is not proof that a path is safe.

- Never access a physical SD or CF card for development or testing.
- Never use original Octatrack data or a user's original music-production data
  as test input, and never modify it.
- Use only a reviewed copied fixture or a temporary directory created by the
  test.
- Confirm the exact fixture path, its provenance, and its intended read-only use
  before scanning, parsing, or hashing it.
- Verify that a fixture is unchanged before and after the operation. When
  appropriate, compare its file list, byte sizes, and content hashes.
- Do not follow symlinks. Reject symlink escape, canonical paths outside the
  approved root, and traversal.
- Do not interpret AppleDouble files or unintended hidden metadata as Octatrack
  samples.
- Return scan results in deterministic root-relative path order.
- Limit cleanup to a temporary directory created by the current test.
- Never recursively delete `$HOME`, `~`, the repository root, or a real media
  mount point.
- If a fixture contains unrecognized real-world data or its provenance is
  unclear, stop before processing it.
- Do not expand a read-only task into write, repair, or migration work.

Report the approved test root and the evidence that the fixture remained
unchanged. This skill does not authorize access to removable media or user data.
