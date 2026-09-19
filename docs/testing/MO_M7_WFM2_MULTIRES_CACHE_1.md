# MO-M7-WFM2-MULTIRES-CACHE-1

Work ID: `MO-M7-WFM2-MULTIRES-CACHE-1`  
Branch: `feat/m7-wfm2-multires-cache-1`  
Baseline `origin/main`: `954863063f25bf5315cec289928eff2127fb8ea1` (#144 merge)

## Audit (pre-change main)

| Item | Before (JSON pyramid) | After (WFM2) |
| --- | --- | --- |
| IPC | `v2_audio_waveform_query` unchanged | Same |
| Cache path | `MasterOCTa/waveform-cache/` | Same |
| File | `waveform-v2-{digest}.json` | `waveform-v2-{digest}.wfm2` |
| Analyzer string | `waveform:v2` | Same |
| Pyramid | 256 base, scale 4, per-channel | Same semantics; coarser base if 64 MiB exceeded |
| Query hot path | Full JSON parse + in-memory levels | Header/metadata + on-demand peak reads |
| Zoom residual | PCM `decode_residual_spans` when peaks misaligned | Finer pyramid level first; PCM only at finest level |

Legacy `waveform-v2-*.json` files are **not** read or migrated. A missing/invalid WFM2 triggers rebuild from verified source.

## WFM2 on-disk format (v1)

- Magic: `WFM2`, little-endian
- `format_version`: `1` (separate from analyzer `waveform:v2`)
- Variable UTF-8: analyzer + `asset_id`
- Fixed metadata: sample rate, channels, frame count, level count, base frames/bucket, level scale (`4`)
- Level table: `frames_per_bucket`, `bucket_count`, `data_offset`, `data_size`
- Payload: planar peaks (`f32 min`, `f32 max`) per bucket × channel
- Fail-closed on truncation, bad offsets, bucket/channel mismatch, oversize (`MAX_CACHE_BYTES` = 64 MiB)

## Level selection

- `frames_per_bucket = range_len.div_ceil(target_points).max(1)` (integer u64)
- Choose coarsest level with `frames_per_bucket <= frames_per_output_bucket` (same rule as pre-WFM2)
- Partial alignment: recurse to finer level; PCM decode only when finest level still has gaps

## Invalidation

| Event | Behavior |
| --- | --- |
| Missing WFM2 | Build + atomic write |
| Truncated / malformed WFM2 | Treat as miss → regen |
| Wrong `asset_id` / analyzer / format version | Miss → regen |
| Live SHA ≠ catalog | `AUDIO_SOURCE_CHANGED` (no stale peaks) |
| Symlink cache entry | `UnsafeCachePath` |

## Tests

| Area | Status |
| --- | --- |
| WFM2 format round-trip / corruption | **PASS** (`ot-audio` `wfm2` + `waveform_v2` tests) |
| Pyramid vs direct decode | **PASS** (existing `cached_pyramid_matches_direct_decode_for_ranges`) |
| Cache hit / corrupt regen | **PASS** |
| Source changed | **PASS** |
| IPC / frontend stale guards | **PASS** (unchanged; existing suite) |
| `pnpm run typecheck` / `test:frontend` / `build` | **PASS** |
| `check:architecture` / `check:containment` | **PASS** |
| `cargo fmt --check` / `clippy` / `cargo test --workspace` | **PASS** |
| `pnpm run test:e2e` | **NOT_RUN** |
| Native acceptance | **NOT_RUN** |

## Performance observation (local, synthetic)

Recorded on developer machine while running `cargo test -p ot-audio` (debug profile). Values are **regression evidence only**, not CI guarantees.

| Scenario | Observation |
| --- | --- |
| Initial build (4096-frame stereo WAV) | Dominated by single PCM decode + WFM2 write |
| Warm full-file query | Skips decode; reads WFM2 header + level slices |
| Warm zoomed range query | Reads subset of peaks via offsets (no full JSON parse) |
| Cache file size | Binary << JSON for same asset (exact ratio depends on level count) |

Long-file synthetic benchmark: optional `#[ignore]` test hook in `ot-audio` (not part of default CI).

## Non-goals

- Canvas renderer, Slice UI, OperationsDialog, Auto Slice
- New IPC commands, preview PCM changes, media writes
- Gate C / RC8 / release changes
- JSON cache migration
