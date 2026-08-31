# Security status — MasterOCTa

Audit date: 2026-08-29

Base commit at this recheck: `44554d0` (main after M4-B, UI5, UI6, and PR #28).

Gate B status updated: 2026-08-31 (human sign-off source `a10437f`).

This document tracks the live status of the containment items from
`docs/CODEX_HANDOFF.md` §3. It does **not** declare the product safe for
destructive operations against original Octatrack media.

## Verdict

- No backdoor, credential theft, sample exfiltration, hidden command execution,
  or obfuscated payload was found in the reviewed source and dependency graph.
- Next-generation RootRegistry / catalog / waveform-preview / M4 additive-copy
  paths are fail-closed for traversal, symlink escape, forged grants, and
  absolute-path leakage in success DTOs.
- M4-B live write grants are session-scoped, TTL-limited, one-shot plan
  approved, and re-checked at executor checkpoints.
- Legacy Tauri commands remain registered and still accept caller-supplied
  absolute paths. Treat original SD/CF cards as out of scope until that surface
  is retired or root-bounded.
- Gate B production recovery is merged (PR #43 / #47). Automated synthetic-disk
  smoke is **PASS on Linux and macOS** at `199114e` (portable script via PR #55;
  evidence via PR #56, tip reconfirmed). Human DMG verification,
  Octatrack OS 1.40 compatibility, additive-copy invariance, and remount
  persistence are **PASS** on source `a10437f`; Gate B is signed off for
  personal/local use and M5 may start.
- The signed-off DMG is ad-hoc signed and is not approved as a public
  distribution artifact. Developer ID signing/notarization and release
  provenance remain a separate public-distribution gate.

## CODEX_HANDOFF §3 checklist

| # | Issue | Status |
| --- | --- | --- |
| 1 | Upstream auto-update trusts upstream releases/keys | **Fixed** — updater plugin, endpoints, and artifacts disabled (PR-0). |
| 2 | Tauri 2.10.x missing security fixes | **Fixed** — `tauri@2.11.5` with aligned CLI/API/plugins (DEP-1). |
| 3 | CSP is `null` | **Fixed** — restrictive CSP in `src-tauri/tauri.conf.json` (PR #28); **CI-enforced** by SEC-1 (exact directive freeze, rejects `*` / `'unsafe-eval'`, checks `tauri.*.conf.json` merges). |
| 4 | Rust commands accept arbitrary paths | **Partial** — v2 API bounded by `RootId` / opaque IDs + M4 write path; legacy ~80 commands still path-unbounded; **legacy surface frozen** by SEC-1 (generate_handler + per-file invoke command freeze). |
| 5 | Weak rename/mkdir traversal checks | **Partial** — next-gen `RootRelativePath` strong; legacy `rename_file` / `create_directory` reject separators / `..` / absolute names (PR #28). |
| 6 | Unrecoverable `remove_file` / `remove_dir_all` deletes | **Partial** — user-facing `delete_files`, `delete_project`, and `delete_set` use `trash`. Copy/move rollback and internal temp cleanup still use hard removes. |
| 7 | Updater-related `tar` advisories | **Fixed** via updater removal; **CI-enforced** (no updater reintroduction / `createUpdaterArtifacts: false`). |
| 8 | `ot-tools-io` → `serde_yml` / `libyml` | **Open / accepted** — documented in `DEPENDENCY_AUDIT.md` as not runtime-reachable for current YAML use. |
| 9 | GitHub Actions mutable tags | **Fixed** — workflows and composite actions pin full commit SHAs; **CI-enforced** by SEC-1 (scans `.github/workflows` and `.github/actions`). |
| 10 | Weak DMG↔source binding for historical `v0.45.0` | **Open** — release-process risk; not a runtime code defect. |

## Next-gen surface notes (post M4-B)

Allowed v2 commands (architecture guard allowlist):

- root: `register`, `status`, `close`, `enable_write`, `disable_write`
- library / metadata / audio: `library_list`, `asset_metadata_*`, `audio_waveform_get`, `audio_preview_*`
- changes: `change_plan`, `change_get_plan`, `change_apply`, `change_status`,
  `change_recovery_status`, `change_recover`

Only `v2_root_register` accepts a raw absolute path. `v2_change_plan` accepts only a
validated `destination_relative_path` via `RootRelativePath::parse`.

Write path properties:

- Intent → Plan → Apply with integrity-bound `ChangePlan`
- Mac-side verified backup and journal under Application Support
- Descriptor-relative copy with `NOFOLLOW`; symlink escape rejected
- Write grant: live, non-persistent, 15-minute TTL, requires stable identity
- Apply: exact displayed `planId` one-shot approval; consumed afterward
- Recovery: status fail-closed; production recover-execute is available
  (`v2_change_recover` / PR #43–#47) with journal-bound approval. Gate B human
  sign-off is complete for personal/local use on source `a10437f`.

## Findings from 2026-08-29 recheck

Fixed in this recheck branch:

1. **Medium** — v2 `ApiError` messages/`details` could embed OS I/O strings with
   absolute paths (`RootRegistryError::Io`, write/executor/backup I/O,
   catalog `details`, audio source/cache errors, library scan adapter strings).
   Public messages are now stable and path-free; `details` is no longer populated
   for those conversions.
2. **Low** — plan-time `hash_live_source` now opens with `O_NOFOLLOW` on Unix
   after a symlink_metadata regular-file check, matching apply-time fail-closed
   posture more closely.

Still open / deferred:

1. **High (legacy)** — absolute-path command surface remains fully wired.
2. **High (distribution)** — the Gate B DMG is ad-hoc signed and approved only
   for personal/local use; public distribution still requires its own signing,
   notarization, provenance, and release-security gate.
3. **Resolved in follow-up PRs** — frontend toolchain (DEP-2) and React Router
   (DEP-3) production advisories; Tauri DEP-1 and SEC-1 containment CI are
   merged on main.

## Remaining high-priority risks

1. Legacy command surface can still read/write/delete arbitrary absolute paths
   once the desktop app is running. Do not point it at original media.
2. The ad-hoc signed Gate B DMG must not be treated as a public distribution
   artifact.
## Verification performed in this recheck

- Architecture guard pass against the live 15-command v2 surface.
- Hotspot review of RootRegistry, write_runtime, ot-plan/backup/executor,
  CSP, Actions pins, and legacy delete/rename.
- Regression tests for path-free ApiError serialization and symlink-source
  hashing.
- Full suite commands are listed in the PR handoff; environment blockers are
  reported explicitly when a check cannot run.
