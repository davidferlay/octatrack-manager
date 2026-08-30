# Security status — MasterOCTa

Audit date: 2026-08-29

Base commit at this recheck: `44554d0` (main after M4-B, UI5, UI6, and PR #28).

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
  smoke is PASS on `70d622e`; human review of
  `docs/testing/GATE_B_SMOKE_EVIDENCE.md` remains required before Gate B
  sign-off / M5.

## CODEX_HANDOFF §3 checklist

| # | Issue | Status |
| --- | --- | --- |
| 1 | Upstream auto-update trusts upstream releases/keys | **Fixed** — updater plugin, endpoints, and artifacts disabled (PR-0). |
| 2 | Tauri 2.10.x missing security fixes | **Fixed** — `tauri@2.11.5` with aligned CLI/API/plugins (DEP-1). |
| 3 | CSP is `null` | **Fixed** — restrictive CSP in `src-tauri/tauri.conf.json` (PR #28); **CI-enforced** by SEC-1 `scripts/check-containment.mjs`. |
| 4 | Rust commands accept arbitrary paths | **Partial** — v2 API bounded by `RootId` / opaque IDs + M4 write path; legacy ~80 commands still path-unbounded; **legacy surface frozen** by SEC-1. |
| 5 | Weak rename/mkdir traversal checks | **Partial** — next-gen `RootRelativePath` strong; legacy `rename_file` / `create_directory` reject separators / `..` / absolute names (PR #28). |
| 6 | Unrecoverable `remove_file` / `remove_dir_all` deletes | **Partial** — user-facing `delete_files`, `delete_project`, and `delete_set` use `trash`. Copy/move rollback and internal temp cleanup still use hard removes. |
| 7 | Updater-related `tar` advisories | **Fixed** via updater removal; **CI-enforced** (no updater reintroduction / `createUpdaterArtifacts: false`). |
| 8 | `ot-tools-io` → `serde_yml` / `libyml` | **Open / accepted** — documented in `DEPENDENCY_AUDIT.md` as not runtime-reachable for current YAML use. |
| 9 | GitHub Actions mutable tags | **Fixed** — workflows pin full commit SHAs; **CI-enforced** by SEC-1. |
| 10 | Weak DMG↔source binding for historical `v0.45.0` | **Open** — release-process risk; not a runtime code defect. |

## Next-gen surface notes (post M4-B)

Allowed v2 commands (architecture guard allowlist):

- root: `register`, `status`, `close`, `enable_write`
- library / metadata / audio: `library_list`, `asset_metadata_*`, `audio_waveform_get`, `audio_preview_*`
- changes: `change_plan`, `change_get_plan`, `change_apply`, `change_status`, `change_recovery_status`

Only `v2_root_register` accepts a raw absolute path. `v2_change_plan` accepts only a
validated `destination_relative_path` via `RootRelativePath::parse`.

Write path properties:

- Intent → Plan → Apply with integrity-bound `ChangePlan`
- Mac-side verified backup and journal under Application Support
- Descriptor-relative copy with `NOFOLLOW`; symlink escape rejected
- Write grant: live, non-persistent, 15-minute TTL, requires stable identity
- Apply: exact displayed `planId` one-shot approval; consumed afterward
- Recovery: status fail-closed; **no** production recover-execute command yet

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

1. **High (ops / Gate B)** — incomplete journals refuse new grants/applies until
   an explicit recovery path exists.
2. **High (legacy)** — absolute-path command surface remains fully wired.
3. **Open** — frontend advisory deadlines in `DEPENDENCY_AUDIT.md` (DEP-2;
   Vitest/Vite/Rollup/PostCSS by 2026-09-15). Tauri DEP-1 is merged separately.

## Remaining high-priority risks

1. Legacy command surface can still read/write/delete arbitrary absolute paths
   once the desktop app is running. Do not point it at original media.
2. Without a reviewed recovery-execute flow, a crashed M4 apply can leave the
   root write-blocked until manual intervention.
3. Frontend toolchain advisory remediation (Vitest ≥4.1.0 / Vite ≥7.3.5 line)
   remains due by 2026-09-15.

## Verification performed in this recheck

- Architecture guard pass against the live 15-command v2 surface.
- Hotspot review of RootRegistry, write_runtime, ot-plan/backup/executor,
  CSP, Actions pins, and legacy delete/rename.
- Regression tests for path-free ApiError serialization and symlink-source
  hashing.
- Full suite commands are listed in the PR handoff; environment blockers are
  reported explicitly when a check cannot run.
