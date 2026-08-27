# Codex Working Agreement

## Product direction

MasterOCTa is a public, non-commercial GPL-3.0 fork of the upstream Octatrack
Manager project. The goal is to build a safe macOS-first Octatrack MkII library
and project manager. Preserve compatibility with upstream Octatrack project
files and keep upstream changes easy to review and merge.

Read `docs/CODEX_HANDOFF.md` before planning or implementing work.
For new architecture, API boundaries, data ownership, and migration order, also
read `docs/NEXT_GENERATION_ARCHITECTURE.md`. New code must not bypass its
Intent -> Plan -> Apply write boundary.

## Non-negotiable data-safety rules

- Treat mounted Octatrack media as irreplaceable user data.
- Default to read-only discovery and inspection.
- Never test destructive operations against original removable media. Use a
  copied card image, a temporary fixture, or an explicit test directory.
- Before a write, verify that the target is inside a user-approved Octatrack
  root and reject traversal, symlink escape, and malformed names.
- Prefer atomic replacement, automatic backups, and recoverable trash over
  permanent deletion.
- A failed or cancelled operation must leave the original data unchanged.
- Do not add cloud synchronization until the local path boundary and backup
  model are implemented and tested.

## Security and supply-chain rules

- Keep the upstream auto-updater disabled until the fork has its own release
  endpoint and signing key.
- Enable a restrictive Tauri CSP and grant the frontend only the permissions it
  actually needs.
- Pin Git dependencies to immutable revisions and GitHub Actions to full commit
  SHAs.
- Use lockfiles and reproducible install commands (`pnpm install --frozen-lockfile`,
  `cargo --locked`).
- Do not introduce binary blobs, install-time shell downloads, telemetry, or
  new network endpoints without an explicit review.
- Run `pnpm audit` and `cargo audit` when dependencies change. Document accepted
  risk instead of silently ignoring advisories.

## Change discipline

- Keep security hardening separate from product features.
- Make small, reviewable commits and preserve upstream attribution.
- Do not rewrite upstream history.
- Add regression tests for every parser, filesystem, rename, delete, move,
  backup, conversion, and slice-metadata change.
- Preserve unrelated user changes in the worktree.

## Minimum verification

Run the relevant subset for each change, and run the full available suite before
handoff:

```bash
pnpm run typecheck
pnpm run test:frontend
pnpm run build
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings
cd src-tauri && cargo test --workspace
```

Rust/Tauri verification may require macOS or Linux GTK/WebKit system packages.
If the environment blocks a command, report the exact environmental blocker and
do not present the unrun check as passing.
