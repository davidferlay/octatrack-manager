# M7 derived AudioAsset

- Work IDs: `MO-M7-DERIVED-AUDIOASSET-1` (lineage), `MO-M7-DERIVED-AUDIOASSET-2` (TRIM generation slice)
- Status: **IN_PROGRESS** (M7-06 — lineage + Mac TRIM vertical slice; query IPC / operator workflow open)
- Updated: 2026-09-20

## Purpose

Persist **original → derived** relationships and, for TRIM, produce **Mac-side derived WAV**
under Application Support without mutating Octatrack media or conflating content identity
with filesystem paths.

Slice #1 (#147) added lineage registration only. Slice #2 adds **lossless integer PCM WAV
TRIM** → verify → content-addressed publish → catalog (`mac_derived`) → lineage. No Tauri
commands, production UI, or media Apply.

## Identity

| Concept | Meaning |
| --- | --- |
| `AudioAsset` | SHA-256 **content identity** (`ContentHash` + byte size) |
| `FileInstance` | Root-relative path observation bound to one content hash |
| Derived lineage | Catalog edge: output asset was produced from source asset |
| Mac derived root | Catalog-internal well-known root (`MAC_DERIVED_AUDIO_ROOT_FINGERPRINT`); not a RootRegistry Octatrack session |

Derived assets are **not** a separate domain type. A derived sample is still an
`AudioAsset` once indexed; lineage is metadata stored in `asset_derivations`.

Frontend/API identity remains opaque `asset:v1:` identifiers. Raw content hashes
and absolute paths are not exposed to the UI.

## TRIM generation (slice #2)

| Step | Behavior |
| --- | --- |
| Input | Verified source bytes + `TrimIntent` (source hash + half-open `FrameRange`) |
| Process | Integer PCM WAV only (16/24-bit, mono/stereo, 44.1/48 kHz); byte-preserving data slice |
| Staging | `{data_dir}/MasterOCTa/derived-audio/staging/` |
| Publish | `{data_dir}/MasterOCTa/derived-audio/published/v1/{sha256}.wav` (no overwrite on hash mismatch) |
| Catalog | Incremental `upsert_derived_file` — does **not** replace other derived instances |
| Lineage | `DerivationKind::Trim` with `v1\|kind=trim\|start=\|end=` envelope; processor `masterocta-trim` / `pcm-wav-v1` |

Idempotency: same source + TRIM parameters → same output hash → reuse published file;
semantically equal lineage → registration no-op.

## Provenance

Each lineage row records:

- `source` and `output` content hashes (resolved to catalog rows at registration)
- `kind` (closed enum: TRIM, NORMALIZE, RESAMPLE, …, STEM, …)
- `processor` name + revision (no paths, session IDs, or secrets)
- `parameters_envelope` (versioned `v1` typed envelope; TRIM requires frame range; STEM supports `role`)
- `source_hash_evidence` (must equal source at registration time)
- `created_at` (RFC3339, supplied by application/catalog boundary)

## Safety invariants

1. Original Octatrack files are never modified by this layer.
2. No metadata is written to removable media.
3. Lineage and Mac derived files live in Application Support only.
4. One immediate parent per output asset.
5. Self-reference and cycles are rejected in domain and SQLite trigger.
6. Rescan orphan cleanup must not delete assets referenced by lineage.
7. Registration requires both assets to exist in the catalog (fail closed).
8. Stale source evidence is rejected; re-attribution to changed source is blocked.
9. `mac_derived` file instances are not valid sources for additive media copy/rename.
10. Octatrack `replace_projection` must not delete derived-root file instances.

## Lifecycle

1. Source exists on an approved Octatrack root (or catalog fixture in tests).
2. **TRIM:** `ApplyTrimDerivation` verifies source hash, stages WAV, publishes, upserts catalog, registers lineage.
3. **Future:** Other processors follow the same pattern (new kinds / scopes as designed).
4. Queries (`LoadAssetDerivation`, `ListDerivedChildren`) serve read models for later UI/IPC (`MO-M7-DERIVED-QUERY-API-1`).

Deletion of catalog assets referenced by lineage is blocked via `ON DELETE RESTRICT`.

## Failure atomicity (filesystem)

Publish success with catalog/lineage failure leaves a **recoverable orphan** under
`published/v1/`; retry verifies hash and completes catalog/lineage without duplicating files.
Original source bytes and hash are unchanged.

## Future integration boundaries

| Track | Connection |
| --- | --- |
| Auto Slice | Draft stays FileInstance-bound; export produces new bytes → catalog asset → `SLICE_EXPORT` lineage |
| Stem separation | Multiple outputs from one source via `STEM` + `StemRole` parameters |
| Node recording | `NODE_RECORDING_PROCESS` / `IMPORT_PROCESS` kinds without PerformanceSession in core |

## Schema

- Migration **12:** `asset_derivations` (#147).
- Migration **13:** `file_instances.storage_scope` adds `mac_derived`.

## M7-06 status

**IN_PROGRESS.** Delivered on branch `feat/m7-derived-audioasset-2`:

- Lineage registration and persistence (#147 on `main`).
- TRIM derived WAV pipeline (domain, ot-audio, catalog upsert, application orchestration, integration test).

Still open for v0.1: query IPC, stem/normalize/resample, operator workflows, production wiring.
