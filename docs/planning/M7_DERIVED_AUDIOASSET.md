# M7 derived AudioAsset lineage foundation

- Work ID: `MO-M7-DERIVED-AUDIOASSET-1`
- Status: Foundation merged in progress (registration boundary only)
- Updated: 2026-09-20

## Purpose

Persist **original → derived** relationships for Mac-side catalog metadata without
mutating Octatrack media or conflating content identity with filesystem paths.

This document is the product semantics reference for M7-06 vertical slice #1.
It does **not** authorize audio processing, media Apply, or frontend write APIs.

## Identity

| Concept | Meaning |
| --- | --- |
| `AudioAsset` | SHA-256 **content identity** (`ContentHash` + byte size) |
| `FileInstance` | Root-relative path observation bound to one content hash |
| Derived lineage | Catalog edge: output asset was produced from source asset |

Derived assets are **not** a separate domain type. A derived sample is still an
`AudioAsset` once indexed; lineage is metadata stored in `asset_derivations`.

Frontend/API identity remains opaque `asset:v1:` identifiers. Raw content hashes
and absolute paths are not exposed to the UI.

## Provenance

Each lineage row records:

- `source` and `output` content hashes (resolved to catalog rows at registration)
- `kind` (closed enum: TRIM, NORMALIZE, RESAMPLE, …, STEM, …)
- `processor` name + revision (no paths, session IDs, or secrets)
- `parameters_envelope` (versioned `v1` typed envelope; STEM supports `role`)
- `source_hash_evidence` (must equal source at registration time)
- `created_at` (RFC3339, supplied by application/catalog boundary)

## Safety invariants

1. Original Octatrack files are never modified by this layer.
2. No metadata is written to removable media.
3. Lineage lives in Application Support SQLite only.
4. One immediate parent per output asset.
5. Self-reference and cycles are rejected in domain and SQLite trigger.
6. Rescan orphan cleanup must not delete assets referenced by lineage.
7. Registration requires both assets to exist in the catalog (fail closed).
8. Stale source evidence is rejected; re-attribution to changed source is blocked.

## Lifecycle

1. An indexer or future processor creates/observes a **new** audio file (out of scope here).
2. Catalog scan projects the new bytes as an `AudioAsset` + `FileInstance`.
3. Application calls `RegisterAssetDerivation` with validated provenance.
4. Queries (`LoadAssetDerivation`, `ListDerivedChildren`) serve read models for later UI/IPC.

Deletion of catalog assets referenced by lineage is blocked via `ON DELETE RESTRICT`.

## Future integration boundaries

| Track | Connection |
| --- | --- |
| Auto Slice | Draft stays FileInstance-bound; export produces new bytes → catalog asset → `SLICE_EXPORT` lineage |
| Stem separation | Multiple outputs from one source via `STEM` + `StemRole` parameters |
| Node recording | `NODE_RECORDING_PROCESS` / `IMPORT_PROCESS` kinds without PerformanceSession in core |

## Schema

Catalog migration **12** adds `asset_derivations`. Prior migrations are unchanged.

## M7-06 status

This work package delivers **lineage registration and persistence** only.
Actual derived audio generation, query IPC, and operator workflows remain follow-up work.
