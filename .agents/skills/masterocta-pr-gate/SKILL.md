---
name: masterocta-pr-gate
description: Use when preparing a commit, pushing a branch, creating or reviewing a Pull Request, assessing merge readiness, summarizing CI, or writing a handoff for MasterOCTa. Do not invoke for ordinary implementation steps before handoff preparation.
---

# MasterOCTa Pull Request Gate

Run this gate before any push or Pull Request mutation. It supplements, and does
not replace, applicable user-level fork-safety instructions.

## Repository boundary

1. Confirm `origin` resolves to `kaz4g/masterocta` and that `upstream` is the
   read-only `davidferlay/octatrack-manager` remote.
2. Immediately before pushing, re-check the origin URL and current branch.
3. Push only the current feature branch to `origin`. Never force-push or commit
   directly to `main`.
4. Create a Pull Request only with an explicit repository target. Confirm all
   four coordinates before submission:
   - base repository: `kaz4g/masterocta`
   - base branch: normally `main`
   - head repository: `kaz4g/masterocta`
   - head branch: the current feature branch

   Use an explicit command shape rather than GitHub's fork contribution UI:

   ```bash
   gh pr create --repo kaz4g/masterocta --base main --head "kaz4g:<current-branch>"
   ```

5. Treat upstream as read-only. Never push, open a Pull Request, create or edit
   an issue or comment, publish a release, or perform any other mutation against
   `davidferlay/octatrack-manager`.
6. After creation, read the Pull Request back and verify its base/head repository
   and branch. If any coordinate is wrong, do not merge it; close the accidental
   Pull Request and report the cause.

## Diff boundary

- Inspect `git status`, `git diff --stat`, `git diff`, and `git diff --check`.
- Keep unrelated changes out of the Pull Request and preserve user changes.
- Never hand-edit a lockfile.
- Do not commit secrets, credentials, local absolute paths, or details from real
  Octatrack media.

## Verification

Inspect current manifests and scripts, then run the commands that actually exist
and are relevant to the diff. Do not copy an obsolete command name into a gate.
Current standard candidates include:

```bash
pnpm install --frozen-lockfile
pnpm run check:architecture
pnpm run typecheck
pnpm run test:frontend
pnpm run build
pnpm run test:e2e
cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cd ..
git diff --check
```

Run only relevant audits when dependencies change:

```bash
pnpm audit
cargo audit
```

Do not globally install `cargo-audit` if it is unavailable; report it as not run.
Never present an environment-blocked or unrun check as passing.

## Pull Request handoff

Report the Pull Request URL, base/head SHA, changed files, diff summary, test and
audit results, unrun items with reasons, remaining risks, and a clear merge
recommendation. After creating the Pull Request, stop without merging or enabling
auto-merge.
