---
name: masterocta-architecture
description: Apply MasterOCTa architecture boundaries when changing or reviewing domain models, Tauri commands, RootRegistry, filesystem access, the SQLite catalog, legacy adapters, frontend/backend DTOs, or dependency direction. Do not use for unrelated documentation-only edits such as README typo fixes.
---

# MasterOCTa Architecture

Read `AGENTS.md`, `docs/NEXT_GENERATION_ARCHITECTURE.md`, and the relevant
domain design documents before changing an architectural boundary. Preserve the
following stable rules:

- Migrate incrementally toward the next-generation core; do not perform a
  big-bang rewrite.
- In a new API, accept a raw absolute path only at the root-registration
  boundary. After registration, use an opaque, session-scoped `RootId`.
- Keep registered absolute paths exclusively in the backend `RootRegistry`.
  Never return an absolute path to the frontend.
- Represent filesystem locations sent to the frontend only as validated,
  root-relative paths.
- Construct paths with path-aware APIs and validated components, never by
  concatenating strings.
- Fail closed on traversal, embedded separators, symlink escape, and any access
  outside the registered root.
- Treat the local SQLite catalog as the source of truth for next-generation
  metadata. Do not turn original Octatrack files into the metadata database.
- Keep the legacy reader behind its adapter boundary. Do not expand the legacy
  command surface without a bounded migration reason.
- Keep the upstream auto-updater disabled.
- Do not mix unrelated product features into an architecture-migration change.
- Do not add a write API unless the currently authorized milestone explicitly
  permits it.

Check dependency direction and existing architecture guards instead of weakening
them to make a change pass. This skill constrains implementation; it does not
authorize filesystem access, writes, dependency changes, or external actions.
