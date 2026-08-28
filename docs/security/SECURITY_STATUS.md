# Security status — MasterOCTa

Audit date: 2026-08-28

Base commit at review start: `49eba2b` (main after M3-E3).

This document tracks the live status of the containment items from
`docs/CODEX_HANDOFF.md` §3 and the follow-up hardening in this branch.
It does **not** declare the product safe for destructive operations against
original Octatrack media.

## Verdict

- No backdoor, credential theft, sample exfiltration, hidden command execution,
  or obfuscated payload was found in the reviewed source and dependency graph.
- Next-generation RootRegistry / catalog / waveform-preview paths are
  fail-closed for traversal, symlink escape, and absolute-path leakage.
- Legacy Tauri commands remain registered and still accept caller-supplied
  absolute paths. Treat original SD/CF cards as out of scope until M4 write
  boundaries replace that surface.
- Immediate P0 containment progress in this review: restrictive CSP, GitHub
  Actions SHA pinning, recoverable trash for user deletes, basename rejection
  for legacy rename/mkdir, and audio runtime product-directory creation.

## CODEX_HANDOFF §3 checklist

| # | Issue | Status |
| --- | --- | --- |
| 1 | Upstream auto-update trusts upstream releases/keys | **Fixed** — updater plugin, endpoints, and artifacts disabled (PR-0). |
| 2 | Tauri 2.10.x missing security fixes | **Open** — lockfile still resolves `tauri@2.10.2`; remediate in a dedicated dependency PR (≥2.11.1 per audit). |
| 3 | CSP is `null` | **Fixed in this branch** — restrictive CSP in `src-tauri/tauri.conf.json`. |
| 4 | Rust commands accept arbitrary paths | **Partial** — v2 API bounded by `RootId` / opaque IDs; legacy ~80 commands still path-unbounded. |
| 5 | Weak rename/mkdir traversal checks | **Partial** — next-gen `RootRelativePath` strong; legacy `rename_file` / `create_directory` now reject separators / `..` / absolute names. |
| 6 | Unrecoverable `remove_file` / `remove_dir_all` deletes | **Partial** — user-facing `delete_files`, `delete_project`, and `delete_set` now use `trash`. Copy/move rollback and internal temp cleanup still use hard removes. |
| 7 | Updater-related `tar` advisories | **Fixed** via updater removal. |
| 8 | `ot-tools-io` → `serde_yml` / `libyml` | **Open / accepted** — documented in `DEPENDENCY_AUDIT.md` as not runtime-reachable for current YAML use. |
| 9 | GitHub Actions mutable tags | **Fixed in this branch** — workflows pin full commit SHAs with version comments. When pinning `dtolnay/rust-toolchain`, set `toolchain: stable` explicitly because the action no longer infers the channel from the `@stable` ref. |
| 10 | Weak DMG↔source binding for historical `v0.45.0` | **Open** — release-process risk; not a runtime code defect. |

## Next-gen surface notes

- Allowed v2 commands: root register/status/close, library list, asset metadata
  get/replace, waveform get, preview create/read.
- Only `v2_root_register` accepts a raw absolute path.
- Preview tokens are opaque, root-bound, TTL-limited, and one-shot.
- Manual metadata writes Mac-side SQLite only; they are not the full M4
  Intent → Plan → Apply media-write boundary.
- Waveform cache and catalog refuse symlinked product paths.

## Remaining high-priority risks

1. Legacy command surface can still read/write/delete arbitrary absolute paths
   once the desktop app is running. Do not point it at original media.
2. Tauri crate upgrade and frontend toolchain advisory remediation remain due
   by the deadlines in `DEPENDENCY_AUDIT.md`.
3. Architecture guard does not yet enforce Intent → Plan → Apply or CSP; it
   enforces crate dependency direction and the v2 command/path allowlist only.

## Verification performed in this review

- Architecture hotspot review of RootRegistry, v2 API, audio runtime, legacy
  delete/rename/mkdir, CSP, updater containment, and workflow pinning.
- Regression tests added/updated for basename traversal rejection and audio
  product-directory creation.
- Full suite commands are listed in the PR handoff; environment blockers are
  reported explicitly when a check cannot run.
