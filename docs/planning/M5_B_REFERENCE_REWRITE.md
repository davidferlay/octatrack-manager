# M5-B Lossless Project Reference Rewrite Codec

- Status: memory-only codec contract
- Scope: `ot-codec-ports` types plus `ot-codec::MemoryProjectReferenceCodec`
- Non-scope: filesystem writes, executor, backup, journal, Tauri, frontend, Bank
  rewrite, `.ot` content rewrite, directory / Set move

## Purpose

M5-B isolates the only Project mutation M5 may perform: replace the `PATH=`
value of named `[SAMPLE]` blocks. Parse and full `ot-tools-io` serialization
are not the same thing. `ProjectFile::to_bytes` is lossy on the tracked
`real_device/project.work` fixture (drops `TRIM_BARSx100`, rewrites
`TRIGQUANTIZATION=-1`, normalizes `TEMPOx24` and `MIDI_CLOCK_SEND`). This
codec never calls that serializer.

## Evidence

| Claim | Source | Limit |
|---|---|---|
| Project documents are Windows-1258 text with `[SAMPLE]` / `PATH=` | tracked `real_device/project.work`; existing raw reader | fixture and current reader only |
| Working / SavedCheckpoint filenames are `.work` / `.strd` | M3-C2 domain contract; not in the official OS 1.40A manual | filename mapping is repository evidence |
| `ot-tools-io` Project serialize is not byte-stable | `src-tauri/tests/real_device_roundtrip.rs` | 1.40B fixture |
| FLEX slots 129–136 appear as recorder buffers with `PATH=` | `real_device` and `real_device_os_1_40` fixtures | not promoted to `SampleSlotId` (1–128) |
| R0173 / 1.40 empty-PATH BaseProject is read-only | `tests/fixtures/real_device_os_1_40/README.md` | do not write the tracked file |

## API

`ProjectReferenceCodec` lives on the port crate so application code can depend
on the trait without taking a filesystem or Tauri dependency.

- `inspect_sample_paths(bytes)` → `STATIC` / `FLEX` slots 1–128 and their raw
  `PATH=` values, in document order
- `apply_path_patches(bytes, patches)` → `EncodedPatch`
- `rewrite_same_directory_path(from, basename)` builds a destination PATH that
  keeps the observed prefix and separator

A patch is accepted only when:

1. the target `SampleSlotId` exists exactly once
2. the current raw `PATH=` equals `from_raw_path`
3. `from_raw_path` and `to_raw_path` share the same directory prefix and
   separator (same-directory rename)
4. both basenames pass `RootPathComponent` (no `/`, `\`, `..`, empty, NUL)
5. Windows-1258 decode/encode of the original bytes is reversible, and the
   patched text encodes without unmappable characters

No-op patches (including an empty patch list, or `from == to`) return the
original bytes unchanged.

## Fail closed

Unclosed `[SAMPLE]`, missing or duplicate `TYPE` / `SLOT` / `PATH`, unknown
`TYPE`, invalid `SLOT`, duplicate TYPE+SLOT, missing target, `from` mismatch,
directory / separator change, empty PATH, irreversible encoding, and a reparse
that does not match the intended PATH set all return `ReferenceRewriteError`
and produce no patched document.

Recorder buffers (FLEX 129–136 on current fixtures) are preserved and are not
inspectable `SampleSlotId` values.

## Filesystem boundary

The codec accepts `&[u8]` only. Tests may read tracked fixtures and must leave
those files byte-identical. The R0173 / 1.40 fixture is inspect-only.

## Handoff to M5-C

M5-C should call `MemoryProjectReferenceCodec` from Mac-side staging. It must
not write codec output with `std::fs::write` from this crate, and it must not
route Project rewrite through `ot-tools-io` or
`update_project_file_paths_surgical`.
